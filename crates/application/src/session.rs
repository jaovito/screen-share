use ss_domain::{
    CaptureSelection, PauseReason, SessionError, SessionLease, SharingState, VideoProfile,
};

/// A trusted monotonic clock. Its milliseconds and verified lease deadlines must
/// share one origin. Project a server TTL onto this clock; do not use wall time or
/// a UI-supplied timestamp. A regressing implementation fails closed.
pub trait SessionClock {
    fn now_ms(&self) -> u64;
}

/// Verifies server authorization/revocation; it must not trust client-supplied identity.
/// The fast media path should read a bounded verified/revocable snapshot rather
/// than perform a network request for every frame. Lease deadlines use SessionClock.
pub trait SessionAuthorizer {
    fn authorize(&mut self, now_ms: u64) -> Result<SessionLease, SessionError>;
}

/// Owns native resources. Preparation verifies key availability and configures E2EE
/// before opening any source. All operations, including cleanup, must have deadlines.
/// The media driver must not forward frames until the controller's start/resume
/// succeeds, and must recheck access before subsequent frame delivery.
pub trait SharingPipeline {
    fn prepare_encrypted_transport(&mut self, lease: &SessionLease) -> Result<(), SessionError>;
    fn start(
        &mut self,
        source: &CaptureSelection,
        profile: VideoProfile,
    ) -> Result<(), SessionError>;
    fn pause(&mut self) -> Result<(), SessionError>;
    fn resume(&mut self, source: &CaptureSelection) -> Result<(), SessionError>;
    /// Idempotently release capture, encoder, transport, queued frames, and keys.
    fn stop(&mut self) -> Result<(), SessionError>;
}

/// A single explicit selection and a single publication. A new selection/session
/// needs a new controller; recovery has no API for substituting another source.
pub struct SharingSession<A: SessionAuthorizer, P: SharingPipeline, C: SessionClock> {
    authorizer: A,
    pipeline: P,
    clock: C,
    last_now_ms: Option<u64>,
    session_id: String,
    selection: CaptureSelection,
    profile: VideoProfile,
    lease: Option<SessionLease>,
    state: SharingState,
    owns_resources: bool,
}

impl<A: SessionAuthorizer, P: SharingPipeline, C: SessionClock> SharingSession<A, P, C> {
    pub fn new(
        authorizer: A,
        pipeline: P,
        clock: C,
        session_id: String,
        selection: CaptureSelection,
        profile: VideoProfile,
    ) -> Result<Self, SessionError> {
        // Revalidate public profile fields so callers cannot bypass its constructor.
        if VideoProfile::new(profile.height, profile.fps) != Ok(profile) {
            return Err(SessionError::InvalidProfile);
        }
        SessionLease::new(session_id.clone(), 1, 1)?;

        Ok(Self {
            authorizer,
            pipeline,
            clock,
            last_now_ms: None,
            session_id,
            selection,
            profile,
            lease: None,
            state: SharingState::Selected,
            owns_resources: false,
        })
    }

    pub fn state(&self) -> SharingState {
        self.state
    }

    pub fn selection(&self) -> &CaptureSelection {
        &self.selection
    }

    /// Must be called only after the user explicitly confirms this selection.
    pub fn start(&mut self) -> Result<(), SessionError> {
        if self.state != SharingState::Selected {
            return Err(SessionError::InvalidTransition);
        }

        let lease = match self.authorize() {
            Ok(lease) => lease,
            Err(error) => return self.fail(error),
        };
        self.owns_resources = true;
        if let Err(error) = self.pipeline.prepare_encrypted_transport(&lease) {
            return self.fail(error);
        }
        if let Err(error) = self.ensure_live(&lease) {
            return self.fail(error);
        }
        if let Err(error) = self.pipeline.start(&self.selection, self.profile) {
            return self.fail(error);
        }
        // Blocking native startup may cross the deadline. Release it before the
        // driver can forward its first frame or report an active publication.
        if let Err(error) = self.ensure_live(&lease) {
            return self.fail(error);
        }

        self.lease = Some(lease);
        self.state = SharingState::Sharing;
        Ok(())
    }

    pub fn pause(&mut self, reason: PauseReason) -> Result<(), SessionError> {
        if self.state != SharingState::Sharing {
            return Err(SessionError::InvalidTransition);
        }
        if let Err(error) = self.pipeline.pause() {
            return self.fail(error);
        }
        if let Err(error) = self.ensure_current_lease() {
            return self.fail(error);
        }

        self.state = SharingState::Paused(reason);
        Ok(())
    }

    /// An adapter may report recovery only for the original still-valid identity.
    /// A closed/reused OS handle must fail, never resolve to another source.
    pub fn resume(&mut self) -> Result<(), SessionError> {
        if !matches!(self.state, SharingState::Paused(_)) {
            return Err(SessionError::InvalidTransition);
        }
        self.check_access()?;
        if let Err(error) = self.ensure_current_lease() {
            return self.fail(error);
        }
        if let Err(error) = self.pipeline.resume(&self.selection) {
            return self.fail(error);
        }
        if let Err(error) = self.ensure_current_lease() {
            return self.fail(error);
        }

        self.state = SharingState::Sharing;
        Ok(())
    }

    /// The media driver must call this before accepting/forwarding frames and
    /// periodically while paused. Revocation, expiry, or an epoch change stops it.
    pub fn check_access(&mut self) -> Result<(), SessionError> {
        if !matches!(self.state, SharingState::Sharing | SharingState::Paused(_)) {
            return Err(SessionError::InvalidTransition);
        }
        if let Err(error) = self.ensure_current_lease() {
            return self.fail(error);
        }

        let lease = match self.authorize() {
            Ok(lease) => lease,
            Err(error) => return self.fail(error),
        };
        // A renewed lease cannot conceal a gap while authorization was blocked.
        if let Err(error) = self.ensure_current_lease() {
            return self.fail(error);
        }
        if self.lease.as_ref().map(SessionLease::key_epoch) != Some(lease.key_epoch()) {
            return self.fail(SessionError::KeyEpochChanged);
        }

        self.lease = Some(lease);
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), SessionError> {
        self.lease = None;
        if self.owns_resources {
            if self.pipeline.stop().is_err() {
                self.state = SharingState::CleanupRequired;
                return Err(SessionError::CleanupFailed);
            }
            self.owns_resources = false;
        }

        self.state = SharingState::Stopped;
        Ok(())
    }

    fn authorize(&mut self) -> Result<SessionLease, SessionError> {
        let now_ms = self.current_time()?;
        let lease = self.authorizer.authorize(now_ms)?;
        // Re-read after authorization, which may have performed blocking I/O.
        self.ensure_live(&lease)?;
        if lease.session_id() != self.session_id {
            return Err(SessionError::SessionMismatch);
        }

        Ok(lease)
    }

    fn current_time(&mut self) -> Result<u64, SessionError> {
        let now_ms = self.clock.now_ms();
        if self.last_now_ms.is_some_and(|previous| now_ms < previous) {
            return Err(SessionError::InvalidLease);
        }
        self.last_now_ms = Some(now_ms);

        Ok(now_ms)
    }

    fn ensure_live(&mut self, lease: &SessionLease) -> Result<(), SessionError> {
        lease.ensure_live(self.current_time()?)
    }

    fn ensure_current_lease(&mut self) -> Result<(), SessionError> {
        let now_ms = self.current_time()?;
        self.lease
            .as_ref()
            .ok_or(SessionError::InvalidLease)?
            .ensure_live(now_ms)
    }

    fn fail(&mut self, error: SessionError) -> Result<(), SessionError> {
        if self.stop().is_err() {
            return Err(SessionError::CleanupFailed);
        }

        self.state = SharingState::Failed(error);
        Err(error)
    }
}

impl<A: SessionAuthorizer, P: SharingPipeline, C: SessionClock> Drop for SharingSession<A, P, C> {
    fn drop(&mut self) {
        // Explicit stop reports cleanup failures; Drop is a final best-effort release.
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests;
