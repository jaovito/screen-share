use crate::{MediaError, VideoProfile};

/// An explicit preference, independent of source-content classification.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum QualityMode {
    #[default]
    Motion,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QualityReason {
    SustainedNetworkPressure,
    SustainedNetworkHeadroom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QualityUpdate {
    pub profile: VideoProfile,
    pub reason: QualityReason,
}

/// Slow resolution/cadence decisions from actual transport bitrate targets.
/// Relative pixel-rate budgets are a policy, not measured quality or capacity.
/// Encoder/GPU pressure cannot be inferred from these network observations.
pub struct AdaptiveQuality {
    ceiling: VideoProfile,
    current: VideoProfile,
    bitrate_cap: u32,
    mode: QualityMode,
    last_sample: Option<(u64, u64)>,
    pressure_since: Option<u64>,
    headroom_since: Option<u64>,
    last_now: u64,
}

impl AdaptiveQuality {
    pub fn new(
        ceiling: VideoProfile,
        bitrate_cap: u32,
        mode: QualityMode,
    ) -> Result<Self, MediaError> {
        if VideoProfile::new(ceiling.height, ceiling.fps) != Ok(ceiling)
            || !(64_000..=50_000_000).contains(&bitrate_cap)
        {
            return Err(MediaError::InvalidProfile);
        }
        Ok(Self {
            ceiling,
            current: ceiling,
            bitrate_cap,
            mode,
            last_sample: None,
            pressure_since: None,
            headroom_since: None,
            last_now: 0,
        })
    }

    pub fn profile(&self) -> VideoProfile {
        self.current
    }

    /// `now_ms` is monotonic elapsed time. Missing/stale observations never
    /// establish sustained pressure or headroom, including after a pause.
    pub fn observe(&mut self, now_ms: u64, bitrate_bps: Option<u64>) -> Option<QualityUpdate> {
        if now_ms < self.last_now {
            self.last_sample = None;
            self.reset_windows();
        }
        self.last_now = now_ms;
        if self
            .last_sample
            .is_some_and(|(at, _)| now_ms.saturating_sub(at) > 2_500)
        {
            self.last_sample = None;
            self.reset_windows();
        }
        if let Some(bitrate) = bitrate_bps {
            self.last_sample = Some((now_ms, bitrate.min(u64::from(self.bitrate_cap))));
        }
        let (_, bitrate) = self.last_sample?;
        let lower = self.lower();
        let higher = self.higher();
        let pressured = bitrate.saturating_mul(100) < self.budget(self.current) * 80;
        let headroom = higher.is_some_and(|profile| bitrate * 100 >= self.budget(profile) * 90);
        let change = if pressured && lower.is_some() {
            self.headroom_since = None;
            let since = *self.pressure_since.get_or_insert(now_ms);
            (now_ms.saturating_sub(since) >= 8_000)
                .then_some((lower?, QualityReason::SustainedNetworkPressure))
        } else if headroom {
            self.pressure_since = None;
            let since = *self.headroom_since.get_or_insert(now_ms);
            (now_ms.saturating_sub(since) >= 25_000)
                .then_some((higher?, QualityReason::SustainedNetworkHeadroom))
        } else {
            self.reset_windows();
            None
        };
        change.map(|(profile, reason)| {
            self.current = profile;
            self.reset_windows();
            QualityUpdate { profile, reason }
        })
    }

    pub fn suspend(&mut self) {
        self.last_sample = None;
        self.reset_windows();
    }

    fn reset_windows(&mut self) {
        self.pressure_since = None;
        self.headroom_since = None;
    }

    fn budget(&self, profile: VideoProfile) -> u64 {
        let pixels = u64::from(profile.width) * u64::from(profile.height) * u64::from(profile.fps);
        let ceiling_pixels = u64::from(self.ceiling.width)
            * u64::from(self.ceiling.height)
            * u64::from(self.ceiling.fps);
        (u64::from(self.bitrate_cap) * pixels / ceiling_pixels).max(64_000)
    }

    fn lower(&self) -> Option<VideoProfile> {
        if self.mode == QualityMode::Text && self.current.fps == 60 {
            return VideoProfile::new(self.current.height, 30).ok();
        }
        let height = match self.current.height {
            1440 => 1080,
            1080 => 720,
            720 => 480,
            _ if self.current.fps == 60 => return VideoProfile::new(480, 30).ok(),
            _ => return None,
        };
        VideoProfile::new(height, self.current.fps).ok()
    }

    fn higher(&self) -> Option<VideoProfile> {
        if self.mode == QualityMode::Motion && self.current.fps < self.ceiling.fps {
            return VideoProfile::new(self.current.height, self.ceiling.fps).ok();
        }
        if self.current.height < self.ceiling.height {
            let height = match self.current.height {
                480 => 720,
                720 => 1080,
                _ => 1440,
            };
            return VideoProfile::new(height, self.current.fps).ok();
        }
        (self.current.fps < self.ceiling.fps)
            .then(|| VideoProfile::new(self.current.height, self.ceiling.fps).ok())?
    }
}

#[cfg(test)]
mod tests;
