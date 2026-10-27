use crate::{ControlError, Method};
use url::{Host, Url};
use uuid::Uuid;

pub(crate) fn server(value: &str) -> Result<Url, ControlError> {
    let url = Url::parse(value).map_err(|_| ControlError::InvalidServer)?;
    let local = match url.host() {
        Some(Host::Domain("localhost")) => true,
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        _ => false,
    };
    if !(url.scheme() == "https" || (url.scheme() == "http" && local))
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(ControlError::InvalidServer);
    }
    Ok(url)
}

pub(crate) fn route(method: Method, path: &str) -> bool {
    if path.contains(['%', '?', '#', '\\']) || path.len() > 200 {
        return false;
    }
    let uuid = |value: &str| value.len() == 36 && Uuid::parse_str(value).is_ok();
    let parts: Vec<_> = path.split('/').collect();
    match parts.as_slice() {
        ["", "api", "auth", "get-session"] => method == Method::Get,
        ["", "api", "auth", "sign-out"] => method == Method::Post,
        ["", "api", "auth", "sign-in" | "sign-up", "email"] => method == Method::Post,
        ["", "v1", "rooms"] => matches!(method, Method::Get | Method::Post),
        ["", "v1", "invites", "accept"] => method == Method::Post,
        ["", "v1", "rooms", room] if uuid(room) => method == Method::Get,
        ["", "v1", "rooms", room, "invites" | "reports"] if uuid(room) => {
            matches!(method, Method::Get | Method::Post)
        }
        ["", "v1", "rooms", room, "sessions" | "grants"] if uuid(room) => method == Method::Post,
        ["", "v1", "rooms", room, "invites" | "members", target] if uuid(room) && uuid(target) => {
            method == Method::Delete
        }
        ["", "v1", "rooms", room, "members", target, "approve"] if uuid(room) && uuid(target) => {
            method == Method::Post
        }
        [
            "",
            "v1",
            "rooms",
            room,
            "sessions",
            target,
            "activate" | "close",
        ] if uuid(room) && uuid(target) => method == Method::Post,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_remote_plaintext_credentials_redirect_targets_and_unrelated_routes() {
        for value in [
            "http://example.com",
            "ftp://localhost",
            "https://u:p@example.com",
            "https://example.com?q=x",
            "https://example.com#x",
            "https://example.com/other",
        ] {
            assert!(server(value).is_err());
        }
        for value in [
            "https://example.com",
            "http://127.0.0.1:3000",
            "http://[::1]:3000",
            "http://localhost:3000",
        ] {
            assert!(server(value).is_ok());
        }
        let id = "2be00d58-9715-4319-a747-725ac0735130";
        assert!(route(Method::Post, &format!("/v1/rooms/{id}/grants")));
        assert!(route(Method::Post, &format!("/v1/rooms/{id}/reports")));
        assert!(route(Method::Get, &format!("/v1/rooms/{id}/reports")));
        assert!(!route(Method::Delete, &format!("/v1/rooms/{id}/reports")));
        assert!(!route(Method::Get, "/v1/rooms/not-a-uuid/reports"));
        assert!(route(
            Method::Post,
            &format!("/v1/rooms/{id}/sessions/{id}/activate")
        ));
        assert!(route(Method::Get, "/api/auth/get-session"));
        for path in [
            "https://other.example",
            "//other.example",
            "/v1/rooms/../secrets",
            "/v1/rooms?x=1",
            "/api/auth/admin/list-users",
            "/v1/rooms/%2f",
            "/v1/rooms/not-an-id",
        ] {
            assert!(!route(Method::Post, path));
        }
        assert!(!route(Method::Delete, "/api/auth/get-session"));
    }
}
