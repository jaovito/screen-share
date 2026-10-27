use super::NativeTransportError;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::{Host, Url};
use uuid::Uuid;

/// A client envelope is not proof of membership. The SFU verifies the JWT signature,
/// then the adapter verifies acknowledged identity and scoped publication permission.
/// Credentials deliberately have no Debug, Clone, or Serialize implementation.
pub struct PublisherGrant {
    pub(super) session_id: String,
    pub(super) epoch: u64,
    pub(super) room: String,
    pub(super) identity: String,
    pub(super) server_url: String,
    pub(super) access_token: String,
    pub(super) deadline: Instant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    version: u8,
    session_id: String,
    epoch: u64,
    rtc_room: String,
    participant_id: String,
    publisher_id: String,
    role: String,
    server_url: String,
    access_token: String,
    expires_at: u64,
}

#[derive(Deserialize)]
struct JwtHeader {
    alg: String,
}

#[derive(Deserialize)]
struct Claims {
    sub: String,
    exp: u64,
    nbf: Option<u64>,
    video: VideoGrant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VideoGrant {
    room: String,
    room_join: bool,
    can_publish: bool,
    can_publish_sources: Vec<String>,
    can_subscribe: bool,
    can_publish_data: bool,
    can_update_own_metadata: bool,
    can_subscribe_metrics: bool,
    room_create: bool,
    room_list: bool,
    room_admin: bool,
    room_record: bool,
    ingress_admin: bool,
    hidden: bool,
    recorder: bool,
}

impl PublisherGrant {
    pub fn from_json(json: &str) -> Result<Self, NativeTransportError> {
        if json.len() > 12_000 {
            return Err(NativeTransportError::InvalidGrant);
        }
        // Anchor monotonic time before observing wall time, so parsing and
        // clock-read overhead cannot extend publication beyond the JWT expiry.
        let observed_at = Instant::now();
        let wall_now = SystemTime::now();
        let now = wall_now
            .duration_since(UNIX_EPOCH)
            .map_err(|_| NativeTransportError::InvalidGrant)?
            .as_secs();
        let envelope: Envelope =
            serde_json::from_str(json).map_err(|_| NativeTransportError::InvalidGrant)?;
        let remaining = remaining_lifetime(envelope.expires_at, wall_now)?;
        let deadline = observed_at
            .checked_add(remaining)
            .ok_or(NativeTransportError::InvalidGrant)?;
        let room_id = envelope.rtc_room.strip_prefix("m1-").unwrap_or("");
        if envelope.version != 1
            || envelope.role != "publisher"
            || envelope.participant_id != envelope.publisher_id
            || envelope.epoch == 0
            || envelope.epoch > 9_007_199_254_740_991
            || !valid_uuid(&envelope.session_id)
            || !valid_uuid(&envelope.participant_id)
            || !valid_uuid(room_id)
            || !valid_server(&envelope.server_url)
        {
            return Err(NativeTransportError::InvalidGrant);
        }
        validate_claims(&envelope, now)?;
        if Instant::now() >= deadline {
            return Err(NativeTransportError::InvalidGrant);
        }

        Ok(Self {
            session_id: envelope.session_id,
            epoch: envelope.epoch,
            room: envelope.rtc_room,
            identity: envelope.participant_id,
            server_url: envelope.server_url,
            access_token: envelope.access_token,
            deadline,
        })
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn epoch(&self) -> u64 {
        self.epoch
    }
}

fn remaining_lifetime(expires_at: u64, now: SystemTime) -> Result<Duration, NativeTransportError> {
    let expiration = UNIX_EPOCH
        .checked_add(Duration::from_secs(expires_at))
        .ok_or(NativeTransportError::InvalidGrant)?;
    let remaining = expiration
        .duration_since(now)
        .map_err(|_| NativeTransportError::InvalidGrant)?;
    if remaining.is_zero() || remaining > Duration::from_secs(300) {
        return Err(NativeTransportError::InvalidGrant);
    }
    Ok(remaining)
}

fn valid_uuid(value: &str) -> bool {
    value.len() == 36 && Uuid::parse_str(value).is_ok()
}

fn valid_server(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let loopback = match url.host() {
        Some(Host::Domain("localhost")) => true,
        Some(Host::Ipv4(ip)) => ip == std::net::Ipv4Addr::LOCALHOST,
        Some(Host::Ipv6(ip)) => ip == std::net::Ipv6Addr::LOCALHOST,
        _ => false,
    };

    (url.scheme() == "wss" || (url.scheme() == "ws" && loopback))
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}

fn validate_claims(envelope: &Envelope, now: u64) -> Result<(), NativeTransportError> {
    let token = &envelope.access_token;
    if token.len() > 8192 {
        return Err(NativeTransportError::InvalidGrant);
    }
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|part| part.is_empty()) {
        return Err(NativeTransportError::InvalidGrant);
    }
    if URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_or(true, |signature| signature.len() != 32)
    {
        return Err(NativeTransportError::InvalidGrant);
    }
    let header = URL_SAFE_NO_PAD
        .decode(parts[0])
        .map_err(|_| NativeTransportError::InvalidGrant)?;
    let header: JwtHeader =
        serde_json::from_slice(&header).map_err(|_| NativeTransportError::InvalidGrant)?;
    let body = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| NativeTransportError::InvalidGrant)?;
    let claims: Claims =
        serde_json::from_slice(&body).map_err(|_| NativeTransportError::InvalidGrant)?;
    let video = claims.video;
    let sources = video.can_publish_sources;
    if header.alg != "HS256"
        || claims.sub != envelope.participant_id
        || claims.exp < envelope.expires_at
        || claims.exp.saturating_sub(now) > 300
        || claims.nbf.is_some_and(|not_before| not_before > now)
        || video.room != envelope.rtc_room
        || !video.room_join
        || !video.can_publish
        || sources.as_slice() != ["screen_share"]
        || video.can_subscribe
        || video.can_publish_data
        || video.can_update_own_metadata
        || video.can_subscribe_metrics
        || video.room_create
        || video.room_list
        || video.room_admin
        || video.room_record
        || video.ingress_admin
        || video.hidden
        || video.recorder
    {
        return Err(NativeTransportError::InvalidGrant);
    }

    // Signature verification intentionally remains at the SFU; no signing secret
    // belongs in a publisher. Successful connection alone is checked again by scope.
    Ok(())
}

/// Media material is supplied independently; never deserialize it with the grant.
pub struct MediaKey(pub(super) Vec<u8>);

impl MediaKey {
    pub fn from_encoded_secret(value: &str) -> Result<Self, NativeTransportError> {
        if value.len() != 43
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err(NativeTransportError::InvalidKey);
        }

        // Keep the encoded UTF-8 string: JavaScript's string provider uses PBKDF2.
        Ok(Self(value.as_bytes().to_vec()))
    }
}

#[cfg(test)]
mod tests;
