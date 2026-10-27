use super::*;

fn policy(mode: QualityMode) -> AdaptiveQuality {
    AdaptiveQuality::new(VideoProfile::new(1080, 60).unwrap(), 10_000_000, mode).unwrap()
}

fn sample(policy: &mut AdaptiveQuality, from: u64, to: u64, bitrate: u64) -> Option<QualityUpdate> {
    let mut change = None;
    for now in (from..=to).step_by(1_000) {
        change = policy.observe(now, Some(bitrate)).or(change);
    }
    change
}

#[test]
fn motion_requires_eight_seconds_then_lowers_resolution_before_cadence() {
    let mut quality = policy(QualityMode::Motion);
    assert!(sample(&mut quality, 0, 7_000, 1_000_000).is_none());
    let update = quality.observe(8_000, Some(1_000_000)).unwrap();
    assert_eq!(update.profile, VideoProfile::new(720, 60).unwrap());
    assert_eq!(update.reason, QualityReason::SustainedNetworkPressure);
    assert!(sample(&mut quality, 9_000, 16_000, 1_000_000).is_none());
    assert_eq!(
        quality
            .observe(17_000, Some(1_000_000))
            .unwrap()
            .profile
            .height,
        480
    );
    sample(&mut quality, 18_000, 26_000, 100_000);
    assert_eq!(quality.profile(), VideoProfile::new(480, 30).unwrap());
    assert!(sample(&mut quality, 27_000, 50_000, 64_000).is_none());
}

#[test]
fn text_preserves_detail_and_recovers_only_after_twenty_five_seconds() {
    let mut quality = policy(QualityMode::Text);
    let update = sample(&mut quality, 0, 8_000, 1_000_000).unwrap();
    assert_eq!(update.profile, VideoProfile::new(1080, 30).unwrap());
    sample(&mut quality, 9_000, 17_000, 1_000_000);
    assert_eq!(quality.profile(), VideoProfile::new(720, 30).unwrap());
    assert!(sample(&mut quality, 18_000, 42_000, 10_000_000).is_none());
    let update = quality.observe(43_000, Some(10_000_000)).unwrap();
    assert_eq!(update.profile, VideoProfile::new(1080, 30).unwrap());
    assert_eq!(update.reason, QualityReason::SustainedNetworkHeadroom);
    sample(&mut quality, 44_000, 69_000, 10_000_000);
    assert_eq!(quality.profile(), VideoProfile::new(1080, 60).unwrap());
    assert!(sample(&mut quality, 70_000, 110_000, u64::MAX).is_none());
}

#[test]
fn stale_missing_interrupted_and_reversed_clocks_do_not_accumulate_evidence() {
    let mut quality = policy(QualityMode::Motion);
    assert!(quality.observe(0, Some(1_000_000)).is_none());
    assert!(quality.observe(8_000, None).is_none());
    assert!(quality.observe(9_000, Some(1_000_000)).is_none());
    assert!(quality.observe(17_000, Some(1_000_000)).is_none());
    assert!(sample(&mut quality, 18_000, 23_000, 1_000_000).is_none());
    assert!(quality.observe(24_000, Some(9_000_000)).is_none());
    assert!(sample(&mut quality, 25_000, 30_000, 1_000_000).is_none());
    assert!(quality.observe(0, Some(1_000_000)).is_none());
    quality.suspend();
    assert!(sample(&mut quality, 1_000, 8_000, 1_000_000).is_none());
}

#[test]
fn dead_band_prevents_oscillation_and_a_new_manual_ceiling_is_respected() {
    let mut quality = policy(QualityMode::Motion);
    sample(&mut quality, 0, 8_000, 1_000_000);
    for now in (9_000..100_000).step_by(1_000) {
        assert!(
            quality
                .observe(
                    now,
                    Some(if now % 2_000 == 0 {
                        4_000_000
                    } else {
                        6_000_000
                    })
                )
                .is_none()
        );
    }
    let mut manual = AdaptiveQuality::new(
        VideoProfile::new(480, 30).unwrap(),
        200_000,
        QualityMode::Motion,
    )
    .unwrap();
    assert!(sample(&mut manual, 0, 60_000, u64::MAX).is_none());
    assert_eq!(manual.profile(), VideoProfile::new(480, 30).unwrap());
}

#[test]
fn invalid_ceiling_or_budget_is_rejected_before_measurement() {
    assert!(
        AdaptiveQuality::new(
            VideoProfile {
                width: 0,
                height: 0,
                fps: 0
            },
            100_000,
            QualityMode::Motion
        )
        .is_err()
    );
    for cap in [0, 63_999, 50_000_001] {
        assert!(
            AdaptiveQuality::new(
                VideoProfile::new(720, 30).unwrap(),
                cap,
                QualityMode::Motion
            )
            .is_err()
        );
    }
}
