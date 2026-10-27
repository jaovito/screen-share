//! Bounded wall-clock observations for the external conversion/MFT stages.
//! These durations include host/driver scheduling; they are not GPU execution time.
use std::collections::VecDeque;

const MAX_IN_FLIGHT: usize = 2;
const MAX_SAMPLES: usize = 300;
const WINDOW_US: u64 = 5_000_000;

#[derive(Clone, Copy, Default)]
pub struct EncoderDiagnostics {
    pub conversion_submission_ms: Option<f64>,
    pub encoder_output_latency_ms: Option<f64>,
}

struct Observation {
    at_us: u64,
    duration_us: u64,
}

struct Pending {
    timestamp: i64,
    submitted_us: u64,
}

/// The same two-input bound as the hardware encoder. No frame/texture is retained.
#[derive(Default)]
pub(crate) struct EncoderTiming {
    pending: VecDeque<Pending>,
    conversion: VecDeque<Observation>,
    output: VecDeque<Observation>,
    last_clock_us: Option<u64>,
}

impl EncoderTiming {
    pub fn pending(&self) -> usize {
        self.pending.len()
    }

    pub fn submitted(
        &mut self,
        timestamp: i64,
        submitted_us: u64,
        conversion_us: u64,
    ) -> Result<(), ()> {
        self.observe_clock(submitted_us)?;
        if timestamp < 0
            || self.pending.len() >= MAX_IN_FLIGHT
            || self
                .pending
                .back()
                .is_some_and(|entry| entry.timestamp >= timestamp)
        {
            return Err(());
        }
        self.pending.push_back(Pending {
            timestamp,
            submitted_us,
        });
        Self::record(&mut self.conversion, submitted_us, conversion_us);
        Ok(())
    }

    pub fn completed(&mut self, timestamp: i64, now_us: u64) -> Result<(), ()> {
        self.observe_clock(now_us)?;
        let pending = self.pending.front().ok_or(())?;
        if pending.timestamp != timestamp {
            return Err(());
        }
        let latency_us = now_us.checked_sub(pending.submitted_us).ok_or(())?;
        self.pending.pop_front();
        Self::record(&mut self.output, now_us, latency_us);
        Ok(())
    }

    pub fn snapshot(&self, now_us: u64) -> EncoderDiagnostics {
        if self.last_clock_us.is_some_and(|previous| now_us < previous) {
            return EncoderDiagnostics::default();
        }
        EncoderDiagnostics {
            conversion_submission_ms: Self::average(&self.conversion, now_us),
            encoder_output_latency_ms: Self::average(&self.output, now_us),
        }
    }

    fn observe_clock(&mut self, now_us: u64) -> Result<(), ()> {
        if self.last_clock_us.is_some_and(|previous| now_us < previous) {
            return Err(());
        }
        self.last_clock_us = Some(now_us);
        Ok(())
    }

    fn record(window: &mut VecDeque<Observation>, at_us: u64, duration_us: u64) {
        while window
            .front()
            .is_some_and(|entry| at_us.saturating_sub(entry.at_us) > WINDOW_US)
        {
            window.pop_front();
        }
        if window.len() >= MAX_SAMPLES {
            window.pop_front();
        }
        window.push_back(Observation { at_us, duration_us });
    }

    fn average(window: &VecDeque<Observation>, now_us: u64) -> Option<f64> {
        let mut total = 0_u128;
        let mut count = 0_u32;
        for observation in window {
            if now_us >= observation.at_us && now_us - observation.at_us <= WINDOW_US {
                total += u128::from(observation.duration_us);
                count += 1;
            }
        }
        (count > 0).then(|| total as f64 / f64::from(count) / 1000.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn correlates_only_matching_output_and_measures_async_wall_latency() {
        let mut timing = EncoderTiming::default();
        assert!(timing.snapshot(0).encoder_output_latency_ms.is_none());
        timing.submitted(0, 1000, 200).unwrap();
        timing.submitted(33, 2000, 400).unwrap();
        assert!(timing.submitted(66, 2500, 100).is_err());
        assert!(timing.completed(33, 3000).is_err());
        assert_eq!(timing.pending(), 2);
        timing.completed(0, 5000).unwrap();
        timing.completed(33, 8000).unwrap();
        let sample = timing.snapshot(8000);
        assert_eq!(sample.conversion_submission_ms, Some(0.3));
        assert_eq!(sample.encoder_output_latency_ms, Some(5.0));
        assert_eq!(timing.pending(), 0);
        assert!(timing.completed(33, 9000).is_err());
    }

    #[test]
    fn rejects_regressing_clocks_and_expires_stale_observations() {
        let mut timing = EncoderTiming::default();
        timing.submitted(0, 1000, 200).unwrap();
        assert!(timing.completed(0, 999).is_err());
        timing.completed(0, 2000).unwrap();
        assert!(timing.snapshot(1999).encoder_output_latency_ms.is_none());
        assert!(
            timing
                .snapshot(5_002_001)
                .encoder_output_latency_ms
                .is_none()
        );
        assert!(timing.submitted(-1, 3000, 200).is_err());
    }

    #[test]
    fn bounds_history_and_reset_never_carries_old_stage_evidence() {
        let mut timing = EncoderTiming::default();
        for index in 0..1000 {
            timing.submitted(index, index as u64 * 2000, 50).unwrap();
            timing.completed(index, index as u64 * 2000 + 1000).unwrap();
        }
        assert_eq!(timing.conversion.len(), MAX_SAMPLES);
        assert_eq!(timing.output.len(), MAX_SAMPLES);
        let reset = EncoderTiming::default();
        assert!(reset.snapshot(2_000_000).conversion_submission_ms.is_none());
        assert!(
            reset
                .snapshot(2_000_000)
                .encoder_output_latency_ms
                .is_none()
        );
    }
}
