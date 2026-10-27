use super::PipelineReport;
use ss_media_windows::HardwareEncoder;
use ss_rtc_livekit::native_proof::EncoderFeedback;

pub(super) struct Control {
    bitrate_cap: u32,
    target_bitrate: u32,
    applied_bitrate: u32,
    fps_cap: f64,
    target_fps: f64,
    needs_keyframe: bool,
    keyframe_requested: bool,
}

impl Control {
    pub fn new(bitrate: u32, fps: u8) -> Result<Self, &'static str> {
        if !(64_000..=50_000_000).contains(&bitrate) || ![30, 60].contains(&fps) {
            return Err("Invalid native publication limits");
        }
        Ok(Self {
            bitrate_cap: bitrate,
            target_bitrate: bitrate,
            applied_bitrate: bitrate,
            fps_cap: f64::from(fps),
            target_fps: f64::from(fps),
            needs_keyframe: true,
            keyframe_requested: false,
        })
    }

    pub fn bitrate(&self) -> u32 {
        self.target_bitrate
    }

    pub fn interval_100ns(&self) -> i64 {
        (10_000_000.0 / self.target_fps).ceil() as i64
    }

    pub fn feedback(
        &mut self,
        feedback: EncoderFeedback,
        report: &mut PipelineReport,
    ) -> Result<(), &'static str> {
        self.needs_keyframe |= feedback.request_keyframe;
        if let Some(bitrate) = feedback.target_bitrate_bps {
            if bitrate < 64_000 {
                return Err(
                    "RTC bitrate is below the hardware encoder minimum; publication stopped",
                );
            }
            self.target_bitrate = bitrate.min(u64::from(self.bitrate_cap)) as u32;
        }
        if let Some(fps) = feedback.target_fps {
            if !fps.is_finite() || fps < 1.0 {
                return Err("RTC frame rate is unavailable or stopped; publication stopped");
            }
            let target = fps.min(self.fps_cap);
            if (self.target_fps - target).abs() > f64::EPSILON {
                self.target_fps = target;
                report.rate_updates = report.rate_updates.saturating_add(1);
            }
        }
        Ok(())
    }

    pub fn initialized(&mut self) {
        // The newly constructed MFT already applied the current bounded target.
        self.applied_bitrate = self.target_bitrate;
    }

    pub fn apply(
        &mut self,
        encoder: &mut HardwareEncoder,
        report: &mut PipelineReport,
    ) -> Result<(), &'static str> {
        if self.applied_bitrate != self.target_bitrate {
            encoder
                .set_bitrate(self.target_bitrate)
                .map_err(|_| "Hardware bitrate feedback failed")?;
            self.applied_bitrate = self.target_bitrate;
            report.rate_updates = report.rate_updates.saturating_add(1);
        }
        if self.needs_keyframe && !self.keyframe_requested {
            encoder
                .request_keyframe()
                .map_err(|_| "Hardware keyframe request failed")?;
            self.keyframe_requested = true;
            report.keyframe_requests = report.keyframe_requests.saturating_add(1);
        }
        Ok(())
    }

    pub fn accepted(&mut self, keyframe: bool) {
        if keyframe {
            self.needs_keyframe = false;
            self.keyframe_requested = false;
        }
    }

    pub fn recover(&mut self, rejected: bool) {
        self.needs_keyframe = true;
        // A rejected keyframe needs a new request; queued delta frames awaiting
        // an already-requested IDR must not trigger a request on every poll.
        if rejected {
            self.keyframe_requested = false;
        }
    }
}

/// A monotonic schedule skips missed slots without bursting to catch up. Keeping
/// the schedule phase avoids dropping every other 60-Hz frame due to integer
/// 100-ns timestamp rounding against a 16.666667-ms target period.
pub(super) struct Pacer {
    interval: i64,
    next_due: Option<i64>,
    last_accepted: Option<i64>,
}

impl Pacer {
    pub fn new() -> Self {
        Self {
            interval: 0,
            next_due: None,
            last_accepted: None,
        }
    }

    pub fn due(&mut self, timestamp: i64, interval: i64) -> Result<bool, &'static str> {
        if timestamp < 0 || interval <= 0 {
            return Err("Invalid capture pacing clock");
        }
        if interval != self.interval {
            self.interval = interval;
            self.next_due = self
                .last_accepted
                .map(|last| {
                    last.checked_add(interval)
                        .ok_or("Capture pacing clock overflowed")
                })
                .transpose()?;
        }
        Ok(self.next_due.is_none_or(|due| timestamp >= due))
    }

    pub fn accepted(&mut self, timestamp: i64) -> Result<(), &'static str> {
        let mut following = self
            .next_due
            .unwrap_or(timestamp)
            .checked_add(self.interval)
            .ok_or("Capture pacing clock overflowed")?;
        if following <= timestamp {
            following = timestamp
                .checked_add(self.interval)
                .ok_or("Capture pacing clock overflowed")?;
        }
        self.next_due = Some(following);
        self.last_accepted = Some(timestamp);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pacing_preserves_cadence_without_bursting_after_inactivity() {
        let mut pacer = Pacer::new();
        let mut accepted = 0;
        for index in 0..120 {
            let timestamp = index * 10_000_000 / 60;
            if pacer.due(timestamp, 166667).expect("valid clock") {
                pacer.accepted(timestamp).expect("accepted time");
                accepted += 1;
            }
        }
        assert!(accepted >= 118);
        assert!(pacer.due(100_000_000, 333334).expect("rate change"));
        pacer
            .accepted(100_000_000)
            .expect("inactive source resumed");
        assert!(!pacer.due(100_000_001, 333334).expect("same period"));
        assert!(!pacer.due(100_300_000, 333334).expect("before due"));
        assert!(pacer.due(100_333_334, 333334).expect("new due"));
    }

    #[test]
    fn receiver_targets_cannot_raise_operator_limits_or_enable_zero_rate() {
        let mut control = Control::new(8_000_000, 60).expect("valid limits");
        let mut report = PipelineReport::default();
        control
            .feedback(
                EncoderFeedback {
                    request_keyframe: false,
                    target_bitrate_bps: Some(100_000_000),
                    target_fps: Some(120.0),
                },
                &mut report,
            )
            .expect("targets clamped");
        assert_eq!(control.bitrate(), 8_000_000);
        control
            .feedback(
                EncoderFeedback {
                    request_keyframe: false,
                    target_bitrate_bps: None,
                    target_fps: Some(30.0),
                },
                &mut report,
            )
            .expect("lower pacing accepted");
        assert_eq!(control.interval_100ns(), 333334);
        assert_eq!(report.rate_updates, 1);
        assert!(
            control
                .feedback(
                    EncoderFeedback {
                        request_keyframe: false,
                        target_bitrate_bps: Some(0),
                        target_fps: None
                    },
                    &mut report
                )
                .is_err()
        );
        for fps in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(
                control
                    .feedback(
                        EncoderFeedback {
                            request_keyframe: false,
                            target_bitrate_bps: None,
                            target_fps: Some(fps)
                        },
                        &mut report
                    )
                    .is_err()
            );
        }
    }
}
