use super::*;
use std::cell::Cell;

fn binding() -> Binding {
    Binding {
        room_id: "11111111-1111-4111-8111-111111111111".into(),
        session_id: "22222222-2222-4222-8222-222222222222".into(),
        epoch: 2,
        rtc_room: "ss-33333333-3333-4333-8333-333333333333".into(),
        participant: "44444444-4444-4444-8444-444444444444".into(),
        server_url: "wss://rtc.example.test".into(),
        include_audio: true,
    }
}
fn response() -> serde_json::Value {
    let binding = binding();
    serde_json::json!({"grant": {
        "version":1,"sessionId":binding.session_id,"epoch":binding.epoch,
        "rtcRoom":binding.rtc_room,"participantId":binding.participant,
        "publisherId":binding.participant,"role":"publisher","serverUrl":binding.server_url,
        "accessToken":"synthetic-server-grant-not-a-real-token","expiresAt":100
    }})
}

#[test]
fn only_authorized_server_responses_with_the_original_binding_can_be_forwarded() {
    let binding = binding();
    assert!(parse_response(&binding, 200, response()).is_ok());
    for status in [301, 401, 403, 500] {
        assert!(matches!(
            parse_response(&binding, status, response()),
            Err("authorization_denied")
        ));
    }
    for (field, replacement) in [
        (
            "sessionId",
            serde_json::json!("55555555-5555-4555-8555-555555555555"),
        ),
        ("epoch", serde_json::json!(3)),
        ("rtcRoom", serde_json::json!("ss-other")),
        (
            "participantId",
            serde_json::json!("55555555-5555-4555-8555-555555555555"),
        ),
        (
            "publisherId",
            serde_json::json!("55555555-5555-4555-8555-555555555555"),
        ),
        ("serverUrl", serde_json::json!("wss://other.example.test")),
        ("role", serde_json::json!("viewer")),
    ] {
        let mut body = response();
        body["grant"][field] = replacement;
        assert!(
            parse_response(&binding, 200, body).is_err(),
            "Rejected changed {field}"
        );
    }
    assert!(parse_response(&binding, 200, serde_json::json!({})).is_err());
    assert!(parse_response(&binding, 200, serde_json::json!({"grant":null})).is_err());
}

#[test]
fn cancellation_invalidates_in_flight_success_and_failure_before_a_new_session() {
    let manager = Authorization::new();
    let engine = Engine::new();
    let first = manager.reserve(binding(), &engine).unwrap();
    let writes = Cell::new(0);
    manager
        .with_current(first, || {
            writes.set(writes.get() + 1);
            Ok(())
        })
        .unwrap();
    assert!(manager.reserve(binding(), &engine).is_err());
    manager.invalidate();
    let second = manager.reserve(binding(), &engine).unwrap();
    assert_ne!(first, second);
    assert!(
        manager
            .with_current(first, || {
                writes.set(100);
                Ok(())
            })
            .is_err()
    );
    manager.fail(first, &engine);
    assert!(manager.with_current(second, || Ok(())).is_ok());
    assert_eq!(writes.get(), 1);
    manager.fail(second, &engine);
    assert!(manager.with_current(second, || Ok(())).is_err());
    assert!(manager.binding().is_err());
}

#[test]
fn explicit_stop_cancels_native_renewal_even_when_engine_already_ended() {
    let manager = Authorization::new();
    let engine = Engine::new();
    let nonce = manager.reserve(binding(), &engine).unwrap();
    let _ = manager.stop(&engine);
    assert!(manager.with_current(nonce, || Ok(())).is_err());
    for invalid in [
        "",
        "../rooms",
        "11111111/1111-4111-8111-111111111111",
        "g1111111-1111-4111-8111-111111111111",
    ] {
        assert!(!uuid_shape(invalid));
    }
    assert!(uuid_shape(&binding().room_id));
}

#[test]
fn overlapping_refreshes_are_bounded_and_old_completion_cannot_unlock_new_refresh() {
    let manager = Authorization::new();
    let engine = Engine::new();
    let first = manager.reserve(binding(), &engine).unwrap();
    assert!(manager.binding().is_err());
    manager.finish_refresh(first);
    assert!(manager.binding().is_ok());
    assert!(manager.binding().is_err());
    manager.invalidate();
    let second = manager.reserve(binding(), &engine).unwrap();
    manager.finish_refresh(first);
    assert!(manager.begin_refresh(first).is_err());
    assert!(manager.binding().is_err());
    manager.finish_refresh(second);
    assert!(manager.binding().is_ok());
}

#[test]
fn sign_out_blocks_new_starts_until_every_native_logout_operation_finishes() {
    let manager = Authorization::new();
    let engine = Engine::new();
    let nonce = manager.reserve(binding(), &engine).unwrap();
    let first = manager.suspend(&engine).unwrap();
    let second = manager.suspend(&engine).unwrap();
    assert!(manager.with_current(nonce, || Ok(())).is_err());
    assert!(manager.reserve(binding(), &engine).is_err());
    drop(first);
    assert!(manager.reserve(binding(), &engine).is_err());
    drop(second);
    assert!(manager.reserve(binding(), &engine).is_ok());
}
