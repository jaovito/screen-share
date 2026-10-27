use super::*;
use serde_json::{Value, json};

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("test clock")
        .as_secs()
}

fn claims(expires: u64) -> Value {
    json!({
        "sub": "2be00d58-9715-4319-a747-725ac0735130",
        "exp": expires,
        "nbf": now(),
        "video": {
            "room": "m1-6cfb37ba-b89c-4406-8880-caa4973752d4",
            "roomJoin": true,
            "canPublish": true,
            "canPublishSources": ["screen_share"],
            "canSubscribe": false,
            "canPublishData": false,
            "canUpdateOwnMetadata": false,
            "canSubscribeMetrics": false,
            "roomCreate": false,
            "roomList": false,
            "roomAdmin": false,
            "roomRecord": false,
            "ingressAdmin": false,
            "hidden": false,
            "recorder": false
        }
    })
}

// Synthetic signature deliberately cannot authenticate to an SFU. These tests
// establish envelope/scope parsing only, not JWT signature verification.
fn token(header: Value, claims: Value) -> String {
    format!(
        "{}.{}.{}",
        URL_SAFE_NO_PAD.encode(header.to_string()),
        URL_SAFE_NO_PAD.encode(claims.to_string()),
        URL_SAFE_NO_PAD.encode([0u8; 32])
    )
}

fn envelope() -> Value {
    let expires = now() + 120;
    json!({
        "version": 1,
        "sessionId": "e8c4591d-e665-4d88-9e80-88f7411088f1",
        "epoch": 1,
        "rtcRoom": "m1-6cfb37ba-b89c-4406-8880-caa4973752d4",
        "participantId": "2be00d58-9715-4319-a747-725ac0735130",
        "publisherId": "2be00d58-9715-4319-a747-725ac0735130",
        "role": "publisher",
        "serverUrl": "ws://127.0.0.1:7880",
        "accessToken": token(json!({ "alg": "HS256" }), claims(expires)),
        "expiresAt": expires
    })
}

#[test]
fn accepts_scoped_metadata_and_preserves_the_independent_utf8_media_key() {
    let grant = PublisherGrant::from_json(&envelope().to_string()).expect("valid proof metadata");
    assert_eq!(grant.session_id(), "e8c4591d-e665-4d88-9e80-88f7411088f1");
    assert_eq!(grant.epoch(), 1);
    assert!(grant.deadline > Instant::now());
    let encoded = "a".repeat(43);
    let key = MediaKey::from_encoded_secret(&encoded).expect("encoded secret material");
    assert_eq!(key.0, encoded.as_bytes());
}

#[test]
fn rejects_wrong_roles_rooms_identity_epochs_expiration_and_unsafe_urls() {
    for (field, value) in [
        ("version", json!(2)),
        ("role", json!("viewer")),
        ("publisherId", json!("e9128130-5c5a-43c1-a571-3146240e4ea5")),
        ("sessionId", json!("invalid")),
        ("participantId", json!("invalid")),
        ("rtcRoom", json!("m1-invalid")),
        ("epoch", json!(0)),
        ("epoch", json!(9_007_199_254_740_992u64)),
        ("expiresAt", json!(now())),
        ("expiresAt", json!(now() + 301)),
        ("serverUrl", json!("ws://example.com")),
        ("serverUrl", json!("https://example.com")),
        ("serverUrl", json!("wss://user:secret@example.com")),
        ("serverUrl", json!("wss://example.com?token=sensitive")),
        ("serverUrl", json!("wss://example.com#fragment")),
        ("accessToken", json!("invalid.signature")),
        ("extra", json!(true)),
    ] {
        let mut candidate = envelope();
        candidate[field] = value;
        assert!(PublisherGrant::from_json(&candidate.to_string()).is_err());
    }
    assert!(PublisherGrant::from_json(&"x".repeat(12_001)).is_err());
}

#[test]
fn rejects_elevated_or_different_unsigned_claims_before_sfu_connection() {
    for (field, value) in [
        ("canPublish", json!(false)),
        ("canSubscribe", json!(true)),
        ("canPublishData", json!(true)),
        ("canUpdateOwnMetadata", json!(true)),
        ("canSubscribeMetrics", json!(true)),
        ("roomAdmin", json!(true)),
        ("roomCreate", json!(true)),
        ("roomList", json!(true)),
        ("roomRecord", json!(true)),
        ("ingressAdmin", json!(true)),
        ("hidden", json!(true)),
        ("recorder", json!(true)),
        ("roomJoin", json!(false)),
        ("canPublishSources", json!(["camera"])),
        ("canPublishSources", json!(["screen_share", "microphone"])),
        ("room", json!("m1-2be00d58-9715-4319-a747-725ac0735130")),
        ("unknownPermission", json!(true)),
    ] {
        let mut candidate = envelope();
        let mut body = claims(candidate["expiresAt"].as_u64().expect("expiration"));
        body["video"][field] = value;
        candidate["accessToken"] = json!(token(json!({ "alg": "HS256" }), body));
        assert!(PublisherGrant::from_json(&candidate.to_string()).is_err());
    }
    for (field, value) in [
        ("sub", json!("e9128130-5c5a-43c1-a571-3146240e4ea5")),
        ("exp", json!(now() + 119)),
        ("nbf", json!(now() + 10)),
    ] {
        let mut candidate = envelope();
        let mut body = claims(candidate["expiresAt"].as_u64().expect("expiration"));
        body[field] = value;
        candidate["accessToken"] = json!(token(json!({ "alg": "HS256" }), body));
        assert!(PublisherGrant::from_json(&candidate.to_string()).is_err());
    }
    let mut candidate = envelope();
    candidate["accessToken"] = json!(token(json!({ "alg": "none" }), claims(now() + 120)));
    assert!(PublisherGrant::from_json(&candidate.to_string()).is_err());
}

#[test]
fn permits_secure_or_loopback_servers_and_rejects_invalid_keys() {
    for server in [
        "wss://example.com",
        "ws://localhost:7880",
        "ws://[::1]:7880",
    ] {
        let mut candidate = envelope();
        candidate["serverUrl"] = json!(server);
        assert!(PublisherGrant::from_json(&candidate.to_string()).is_ok());
    }
    for key in ["".into(), "a".repeat(42), "a".repeat(44), "=".repeat(43)] {
        assert!(MediaKey::from_encoded_secret(&key).is_err());
    }
}

#[test]
fn preserves_subsecond_expiry_and_rejects_expired_or_overlong_lifetimes() {
    let before_boundary = UNIX_EPOCH + Duration::new(10, 999_000_000);
    assert_eq!(
        remaining_lifetime(11, before_boundary),
        Ok(Duration::from_millis(1))
    );
    assert_eq!(
        remaining_lifetime(11, UNIX_EPOCH + Duration::from_secs(11)),
        Err(NativeTransportError::InvalidGrant)
    );
    assert_eq!(
        remaining_lifetime(11, UNIX_EPOCH + Duration::new(11, 1)),
        Err(NativeTransportError::InvalidGrant)
    );
    assert_eq!(
        remaining_lifetime(311, before_boundary),
        Err(NativeTransportError::InvalidGrant)
    );
    assert_eq!(
        remaining_lifetime(310, UNIX_EPOCH + Duration::from_secs(10)),
        Ok(Duration::from_secs(300))
    );
    assert_eq!(
        remaining_lifetime(311, UNIX_EPOCH + Duration::from_secs(10)),
        Err(NativeTransportError::InvalidGrant)
    );
}
