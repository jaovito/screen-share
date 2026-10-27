//! Portable control invariants. A lease is verified by an adapter, never by client identity.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureKind {
    Window,
    Monitor,
}

#[derive(Clone, PartialEq, Eq)]
pub struct CaptureSelection {
    kind: CaptureKind,
    source_id: String,
}

impl CaptureSelection {
    pub fn new(kind: CaptureKind, source_id: String) -> Result<Self, SessionError> {
        if !valid_identifier(&source_id) {
            return Err(SessionError::InvalidSelection);
        }

        Ok(Self { kind, source_id })
    }

    pub fn kind(&self) -> CaptureKind {
        self.kind
    }

    /// An adapter-owned identity, not a display title or an authorization credential.
    pub fn source_id(&self) -> &str {
        &self.source_id
    }
}

/// Validated authorization metadata; this carries no credential or encryption key.
/// Only the trusted authorizer's verification makes a lease authoritative.
#[derive(Clone, PartialEq, Eq)]
pub struct SessionLease {
    session_id: String,
    expires_at_ms: u64,
    key_epoch: u64,
}

impl SessionLease {
    pub fn new(
        session_id: String,
        expires_at_ms: u64,
        key_epoch: u64,
    ) -> Result<Self, SessionError> {
        if !valid_identifier(&session_id) || expires_at_ms == 0 || key_epoch == 0 {
            return Err(SessionError::InvalidLease);
        }

        Ok(Self {
            session_id,
            expires_at_ms,
            key_epoch,
        })
    }

    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    pub fn key_epoch(&self) -> u64 {
        self.key_epoch
    }

    pub fn ensure_live(&self, now_ms: u64) -> Result<(), SessionError> {
        if now_ms >= self.expires_at_ms {
            return Err(SessionError::LeaseExpired);
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PauseReason {
    User,
    SourceInactive,
    SourceUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SharingState {
    Selected,
    Sharing,
    Paused(PauseReason),
    Stopped,
    Failed(SessionError),
    CleanupRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionError {
    InvalidSelection,
    InvalidProfile,
    InvalidLease,
    AccessDenied,
    LeaseExpired,
    SessionMismatch,
    KeyEpochChanged,
    EncryptionUnavailable,
    InvalidTransition,
    SourceUnavailable,
    PipelineFailed,
    CleanupFailed,
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_preserves_explicit_source_scope() {
        let source = CaptureSelection::new(CaptureKind::Window, "window-generation-7".into())
            .expect("valid opaque source identity");
        assert_eq!(source.kind(), CaptureKind::Window);
        assert_eq!(source.source_id(), "window-generation-7");

        for source_id in [
            "".into(),
            " window".into(),
            "window\n".into(),
            "a".repeat(257),
        ] {
            assert!(matches!(
                CaptureSelection::new(CaptureKind::Monitor, source_id),
                Err(SessionError::InvalidSelection)
            ));
        }
    }

    #[test]
    fn lease_rejects_invalid_identity_epoch_and_expiration() {
        for (session, expiration, epoch) in [("", 100, 1), ("s", 0, 1), ("s", 100, 0)] {
            assert!(matches!(
                SessionLease::new(session.into(), expiration, epoch),
                Err(SessionError::InvalidLease)
            ));
        }

        let lease = SessionLease::new("session-1".into(), 100, 2).expect("valid lease metadata");
        assert_eq!(lease.session_id(), "session-1");
        assert_eq!(lease.key_epoch(), 2);
        assert_eq!(lease.ensure_live(99), Ok(()));
        assert_eq!(lease.ensure_live(100), Err(SessionError::LeaseExpired));
        assert_eq!(lease.ensure_live(u64::MAX), Err(SessionError::LeaseExpired));
    }
}
