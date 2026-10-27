use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

fn fixture(responses: Vec<String>) -> (String, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("owned loopback listener");
    let address = format!("http://{}", listener.local_addr().unwrap());
    let thread = thread::spawn(move || {
        let mut requests = Vec::new();
        for response in responses {
            let (mut stream, _) = listener.accept().expect("owned client");
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut chunk = [0; 1024];
                let count = stream.read(&mut chunk).unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..count]);
                assert!(request.len() <= 32768);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            requests.push(String::from_utf8(request).unwrap());
            stream.write_all(response.as_bytes()).unwrap();
        }
        requests
    });
    (address, thread)
}

fn response(status: u16, headers: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
        body.len()
    )
}

fn request(method: Method, path: &str, body: Option<Value>) -> ControlRequest {
    ControlRequest {
        method,
        path: path.into(),
        body,
    }
}

#[tokio::test(flavor = "current_thread")]
async fn owns_http_only_cookies_and_never_exposes_authentication_secrets_through_ipc() {
    let user =
        serde_json::json!({"id": "opaque", "name": "Synthetic", "email": "synthetic@example.test"});
    let body = serde_json::json!({"token": "private-auth-token", "session": {"token": "private-cookie"}, "user": user}).to_string();
    let (base, server) = fixture(vec![
        response(
            200,
            "Set-Cookie: owned=session; HttpOnly; SameSite=Lax; Path=/\r\n",
            &body,
        ),
        response(200, "", &body),
        response(200, "Set-Cookie: owned=; Max-Age=0; Path=/\r\n", "{}"),
        response(200, "", "null"),
    ]);
    let client = ControlClient::new(&base).unwrap();
    let signed_in = client.request(request(Method::Post, "/api/auth/sign-in/email", Some(serde_json::json!({"email": "synthetic@example.test", "password": "synthetic-password"})))).await.unwrap();
    assert_eq!(signed_in.body, serde_json::json!({"user": user}));
    let current = client
        .request(request(Method::Get, "/api/auth/get-session", None))
        .await
        .unwrap();
    assert_eq!(current.body, signed_in.body);
    client
        .request(request(
            Method::Post,
            "/api/auth/sign-out",
            Some(serde_json::json!({})),
        ))
        .await
        .unwrap();
    assert!(
        client
            .request(request(Method::Get, "/api/auth/get-session", None))
            .await
            .unwrap()
            .body
            .is_null()
    );
    let requests = server.join().unwrap();
    assert!(requests[1].to_lowercase().contains("cookie: owned=session"));
    assert!(!requests[3].to_lowercase().contains("cookie: owned=session"));
    assert!(requests[0].contains(&format!("origin: {base}")));
}

#[tokio::test(flavor = "current_thread")]
async fn rejects_nonlocal_plaintext_arbitrary_paths_large_requests_redirects_and_invalid_responses()
{
    assert!(matches!(
        ControlClient::new("http://example.test"),
        Err(ControlError::InvalidServer)
    ));
    let (base, server) = fixture(vec![
        response(302, "Location: https://example.test/\r\n", "{}"),
        response(200, "", "invalid-json"),
        response(401, "", r#"{"secret":"never-expose"}"#),
    ]);
    let client = ControlClient::new(&base).unwrap();
    assert!(matches!(
        client
            .request(request(Method::Post, "/not-allowed", None))
            .await,
        Err(ControlError::InvalidRequest)
    ));
    assert!(matches!(
        client
            .request(request(Method::Get, "/v1/rooms", Some(Value::Null)))
            .await,
        Err(ControlError::InvalidRequest)
    ));
    assert!(matches!(
        client
            .request(request(
                Method::Post,
                "/v1/rooms",
                Some(Value::String("x".repeat(17000)))
            ))
            .await,
        Err(ControlError::InvalidRequest)
    ));
    assert!(matches!(
        client
            .request(request(Method::Get, "/v1/rooms", None))
            .await,
        Err(ControlError::InvalidResponse)
    ));
    assert!(matches!(
        client
            .request(request(Method::Get, "/v1/rooms", None))
            .await,
        Err(ControlError::InvalidResponse)
    ));
    let rejected = client
        .request(request(
            Method::Post,
            "/api/auth/sign-in/email",
            Some(Value::Null),
        ))
        .await
        .unwrap();
    assert_eq!(rejected.status, 401);
    assert_eq!(
        rejected.body,
        serde_json::json!({"error":"authentication_failed"})
    );
    assert_eq!(server.join().unwrap().len(), 3);
}
