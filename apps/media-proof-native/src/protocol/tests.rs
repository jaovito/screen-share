use super::*;
use std::io::Cursor;

#[test]
fn bounded_protocol_round_trips_metadata_and_rejects_unterminated_or_oversized_packets() {
    let mut output = vec![];
    write_packet(&mut output, &SharingStatus::idle()).expect("bounded metadata");
    let decoded = read_status(&mut Cursor::new(output))
        .expect("valid packet")
        .expect("status");
    assert_eq!(decoded.state, SharingState::Idle);
    assert!(!decoded.audio_supported);
    assert!(read_command(&mut Cursor::new(b"{\"type\":\"stop\"}".to_vec())).is_err());
    assert!(read_command(&mut Cursor::new(vec![b'x'; MAX_PACKET_BYTES + 1])).is_err());
    assert!(
        read_status(&mut Cursor::new(
            b"{\"state\":\"sharing\",\"mediaKey\":\"secret\"}\n".to_vec()
        ))
        .is_err()
    );
    assert!(
        read_status(&mut Cursor::new(vec![]))
            .expect("clean EOF")
            .is_none()
    );
}

#[test]
fn control_commands_reject_extra_fields_and_invalid_profiles() {
    let command =
        read_command(&mut Cursor::new(b"{\"type\":\"pause\"}\n".to_vec())).expect("valid pause");
    assert!(matches!(command, Some(Command::Pause {})));
    assert!(
        read_command(&mut Cursor::new(
            b"{\"type\":\"pause\",\"executable\":\"other.exe\"}\n".to_vec()
        ))
        .is_err()
    );
    for profile in [
        "480p30", "480p60", "720p30", "720p60", "1080p30", "1080p60", "1440p30", "1440p60",
    ] {
        assert!(validate_profile(profile, 8_000_000).is_ok());
    }
    assert!(validate_profile("2160p60", 8_000_000).is_err());
    assert!(validate_profile("1080p60", 0).is_err());
}

#[test]
fn diagnostics_reject_nonfinite_or_negative_measurements() {
    let mut status = SharingStatus::idle();
    status.capture_fps = Some(f64::NAN);
    assert!(status.validate().is_err());
    status.capture_fps = Some(-1.0);
    assert!(status.validate().is_err());
    status.capture_fps = None;
    assert!(status.validate().is_ok());
}

#[test]
fn idle_metadata_matches_the_shared_typescript_ipc_fixture() {
    let actual = serde_json::to_value(SharingStatus::idle()).expect("serializable status metadata");
    let expected: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../packages/contracts/fixtures/native-sharing-status.json"
    ))
    .expect("versioned IPC fixture");
    assert_eq!(actual, expected);
}

#[test]
fn adaptive_diagnostics_are_bounded_and_old_metadata_defaults_are_compatible() {
    let mut status = SharingStatus::idle();
    status.adaptation_reason = Some(AdaptationReason::NetworkPressure);
    status.quality_changes = 2;
    status.target_bitrate_bps = Some(1_000_000);
    let mut bytes = Vec::new();
    write_packet(&mut bytes, &status).unwrap();
    let decoded = read_status(&mut Cursor::new(bytes)).unwrap().unwrap();
    assert_eq!(decoded.quality_changes, 2);
    assert_eq!(
        decoded.adaptation_reason,
        Some(AdaptationReason::NetworkPressure)
    );
    for bitrate in [0, 63_999, 50_000_001] {
        status.target_bitrate_bps = Some(bitrate);
        assert!(status.validate().is_err());
    }
    let mut legacy = serde_json::to_value(SharingStatus::idle()).unwrap();
    for field in ["adaptationReason", "qualityChanges", "targetBitrateBps"] {
        legacy.as_object_mut().unwrap().remove(field);
    }
    let decoded: SharingStatus = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(decoded.quality_changes, 0);
    assert_eq!(decoded.target_bitrate_bps, None);
    legacy["adaptationReason"] = serde_json::json!("gpu_saturated");
    assert!(serde_json::from_value::<SharingStatus>(legacy).is_err());
}

#[test]
fn process_audio_requires_an_explicit_pid_and_exact_creation_time_without_fallback() {
    let packet = serde_json::json!({
        "grant": {"version":1,"sessionId":"11111111-1111-4111-8111-111111111111","epoch":1,"rtcRoom":"ss-22222222-2222-4222-8222-222222222222","participantId":"33333333-3333-4333-8333-333333333333","publisherId":"33333333-3333-4333-8333-333333333333","role":"publisher","serverUrl":"wss://rtc.example.test","accessToken":"synthetic-not-usable","expiresAt":1000},
        "profileId":"1080p60","bitrateBps":8_000_000,"mediaKey":"a".repeat(43),"audioMode":"process","audioProcessId":42,"audioProcessCreatedAt":"134058525230000000"
    });
    let request: StartRequest = serde_json::from_value(packet.clone()).unwrap();
    assert!(request.validate().is_ok());
    assert_eq!(
        request.audio_process().unwrap(),
        Some((42, 134058525230000000))
    );
    for (field, value) in [
        ("audioProcessId", serde_json::json!(0)),
        ("audioProcessId", serde_json::Value::Null),
        ("audioProcessCreatedAt", serde_json::Value::Null),
        ("audioProcessCreatedAt", serde_json::json!("0")),
        ("audioProcessCreatedAt", serde_json::json!("01")),
        (
            "audioProcessCreatedAt",
            serde_json::json!("18446744073709551616"),
        ),
        ("audioMode", serde_json::json!("system")),
        ("audioMode", serde_json::json!("off")),
    ] {
        let mut invalid = packet.clone();
        invalid[field] = value;
        let request: StartRequest = serde_json::from_value(invalid).unwrap();
        assert!(request.validate().is_err());
    }
    let mut legacy = packet;
    for field in ["audioMode", "audioProcessId", "audioProcessCreatedAt"] {
        legacy.as_object_mut().unwrap().remove(field);
    }
    let request: StartRequest = serde_json::from_value(legacy).unwrap();
    assert_eq!(request.audio_mode, AudioMode::Off);
    assert_eq!(request.audio_process().unwrap(), None);
}

#[test]
fn processing_diagnostic_bounds_and_legacy_compatibility_are_explicit() {
    let mut status = SharingStatus::idle();
    status.capture_recoveries = 4;
    assert!(status.validate().is_err());
    status.capture_recoveries = 3;
    status.diagnostics_generation = 2;
    status.diagnostics_elapsed_ms = 5000;
    status.conversion_submission_ms = Some(0.5);
    status.encoder_output_latency_ms = Some(8.0);
    status.available_send_bitrate_bps = Some(2_000_000);
    status.manual_bitrate_bps = Some(4_000_000);
    assert!(status.validate().is_ok());
    for invalid in [f64::NAN, f64::INFINITY, -1.0, 60_001.0] {
        status.encoder_output_latency_ms = Some(invalid);
        assert!(status.validate().is_err());
    }
    status.encoder_output_latency_ms = None;
    status.available_send_bitrate_bps = Some(1_000_000_000_001);
    assert!(status.validate().is_err());
    status.available_send_bitrate_bps = None;
    status.manual_bitrate_bps = Some(0);
    assert!(status.validate().is_err());
    let mut legacy = serde_json::to_value(SharingStatus::idle()).unwrap();
    for field in [
        "captureRecoveries",
        "diagnosticsGeneration",
        "diagnosticsElapsedMs",
        "conversionSubmissionMs",
        "encoderOutputLatencyMs",
        "availableSendBitrateBps",
        "manualBitrateBps",
    ] {
        legacy.as_object_mut().unwrap().remove(field);
    }
    let decoded: SharingStatus = serde_json::from_value(legacy).unwrap();
    assert_eq!(decoded.diagnostics_generation, 0);
    assert_eq!(decoded.encoder_output_latency_ms, None);
}
