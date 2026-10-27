use super::*;
use ss_domain::CaptureKind;
use std::{cell::RefCell, rc::Rc};

type Shared = Rc<RefCell<Observations>>;
type TestSession = SharingSession<Authorizer, Pipeline, Clock>;

struct Observations {
    events: Vec<&'static str>,
    source_ids: Vec<String>,
    authorization: Result<SessionLease, SessionError>,
    failure: Option<&'static str>,
    cleanup_failures: usize,
    now_ms: u64,
    advance_on: Option<(&'static str, u64)>,
}

struct Authorizer(Shared);
struct Pipeline(Shared);
struct Clock(Shared);

impl SessionClock for Clock {
    fn now_ms(&self) -> u64 {
        self.0.borrow().now_ms
    }
}

fn at<T>(state: &Shared, now_ms: u64, action: impl FnOnce() -> T) -> T {
    state.borrow_mut().now_ms = now_ms;
    action()
}

impl SessionAuthorizer for Authorizer {
    fn authorize(&mut self, _: u64) -> Result<SessionLease, SessionError> {
        let mut state = self.0.borrow_mut();
        state.events.push("authorize");
        if let Some(("authorize", advanced)) = state.advance_on {
            state.now_ms = advanced;
        }
        state.authorization.clone()
    }
}

impl Pipeline {
    fn effect(&mut self, operation: &'static str) -> Result<(), SessionError> {
        let mut state = self.0.borrow_mut();
        state.events.push(operation);
        if let Some((target, advanced)) = state.advance_on
            && target == operation
        {
            state.now_ms = advanced;
        }
        if state.failure == Some(operation) {
            return Err(if operation == "prepare" {
                SessionError::EncryptionUnavailable
            } else {
                SessionError::PipelineFailed
            });
        }

        Ok(())
    }
}

impl SharingPipeline for Pipeline {
    fn prepare_encrypted_transport(&mut self, _: &SessionLease) -> Result<(), SessionError> {
        self.effect("prepare")
    }

    fn start(&mut self, source: &CaptureSelection, _: VideoProfile) -> Result<(), SessionError> {
        self.0
            .borrow_mut()
            .source_ids
            .push(source.source_id().into());
        self.effect("start")
    }

    fn pause(&mut self) -> Result<(), SessionError> {
        self.effect("pause")
    }

    fn resume(&mut self, source: &CaptureSelection) -> Result<(), SessionError> {
        self.0
            .borrow_mut()
            .source_ids
            .push(source.source_id().into());
        self.effect("resume")
    }

    fn stop(&mut self) -> Result<(), SessionError> {
        let mut state = self.0.borrow_mut();
        state.events.push("stop");
        if state.cleanup_failures > 0 {
            state.cleanup_failures -= 1;
            return Err(SessionError::CleanupFailed);
        }

        Ok(())
    }
}

fn lease(session: &str, expiration: u64, epoch: u64) -> SessionLease {
    SessionLease::new(session.into(), expiration, epoch).expect("valid test lease")
}

fn setup() -> (TestSession, Shared) {
    let state = Rc::new(RefCell::new(Observations {
        events: vec![],
        source_ids: vec![],
        authorization: Ok(lease("session-1", 1000, 1)),
        failure: None,
        cleanup_failures: 0,
        now_ms: 10,
        advance_on: None,
    }));
    let session = SharingSession::new(
        Authorizer(state.clone()),
        Pipeline(state.clone()),
        Clock(state.clone()),
        "session-1".into(),
        CaptureSelection::new(CaptureKind::Window, "selected-window-generation-1".into())
            .expect("valid selection"),
        VideoProfile::new(1080, 60).expect("valid profile"),
    )
    .expect("valid controller");

    (session, state)
}

#[test]
fn denied_expired_or_wrong_session_authorization_never_opens_media() {
    for authorization in [
        Err(SessionError::AccessDenied),
        Ok(lease("session-1", 10, 1)),
        Ok(lease("another-session", 1000, 1)),
    ] {
        let (mut session, state) = setup();
        state.borrow_mut().authorization = authorization;
        assert!(at(&state, 10, || session.start()).is_err());
        assert_eq!(state.borrow().events, ["authorize"]);
        assert!(matches!(session.state(), SharingState::Failed(_)));
    }
}

#[test]
fn encryption_precedes_capture_and_failures_release_partially_owned_resources() {
    let (mut session, state) = setup();
    assert_eq!(at(&state, 10, || session.start()), Ok(()));
    assert_eq!(session.state(), SharingState::Sharing);
    assert_eq!(state.borrow().events, ["authorize", "prepare", "start"]);

    for failure in ["prepare", "start"] {
        let (mut session, state) = setup();
        state.borrow_mut().failure = Some(failure);
        assert!(at(&state, 10, || session.start()).is_err());
        assert_eq!(state.borrow().events.last(), Some(&"stop"));
        assert!(matches!(session.state(), SharingState::Failed(_)));
        if failure == "prepare" {
            assert!(state.borrow().source_ids.is_empty());
        }
    }
}

#[test]
fn pause_and_recovery_preserve_exact_selection_and_recheck_access() {
    let (mut session, state) = setup();
    at(&state, 10, || session.start()).expect("start succeeds");
    session
        .pause(PauseReason::SourceInactive)
        .expect("pause succeeds");
    assert_eq!(
        session.state(),
        SharingState::Paused(PauseReason::SourceInactive)
    );
    at(&state, 20, || session.resume()).expect("same-source recovery succeeds");
    assert_eq!(session.state(), SharingState::Sharing);
    assert_eq!(session.selection().kind(), CaptureKind::Window);
    assert_eq!(
        state.borrow().source_ids,
        [
            "selected-window-generation-1",
            "selected-window-generation-1"
        ]
    );
    assert_eq!(
        state.borrow().events,
        [
            "authorize",
            "prepare",
            "start",
            "pause",
            "authorize",
            "resume"
        ]
    );
}

#[test]
fn pause_or_recovery_failure_stops_instead_of_substituting_source() {
    for operation in ["pause", "resume"] {
        let (mut session, state) = setup();
        at(&state, 10, || session.start()).expect("start succeeds");
        if operation == "resume" {
            session
                .pause(PauseReason::SourceUnavailable)
                .expect("pause succeeds");
        }
        state.borrow_mut().failure = Some(operation);
        let result = if operation == "pause" {
            session.pause(PauseReason::User)
        } else {
            at(&state, 20, || session.resume())
        };
        assert_eq!(result, Err(SessionError::PipelineFailed));
        assert_eq!(state.borrow().events.last(), Some(&"stop"));
        assert_eq!(
            session.selection().source_id(),
            "selected-window-generation-1"
        );
    }
}

#[test]
fn expiry_at_deadline_stops_before_a_refresh_or_another_frame() {
    let (mut session, state) = setup();
    at(&state, 10, || session.start()).expect("start succeeds");
    assert_eq!(
        at(&state, 1000, || session.check_access()),
        Err(SessionError::LeaseExpired)
    );
    assert_eq!(
        state.borrow().events,
        ["authorize", "prepare", "start", "stop"]
    );
}

#[test]
fn revocation_session_changes_and_key_epoch_changes_fail_closed_while_paused() {
    for (authorization, expected) in [
        (Err(SessionError::AccessDenied), SessionError::AccessDenied),
        (Ok(lease("other", 1000, 1)), SessionError::SessionMismatch),
        (
            Ok(lease("session-1", 1000, 2)),
            SessionError::KeyEpochChanged,
        ),
        (Ok(lease("session-1", 20, 1)), SessionError::LeaseExpired),
    ] {
        let (mut session, state) = setup();
        at(&state, 10, || session.start()).expect("start succeeds");
        session.pause(PauseReason::User).expect("pause succeeds");
        state.borrow_mut().authorization = authorization;
        assert_eq!(at(&state, 20, || session.resume()), Err(expected));
        assert_eq!(session.state(), SharingState::Failed(expected));
        assert_eq!(state.borrow().events.last(), Some(&"stop"));
        assert!(!state.borrow().events.contains(&"resume"));
    }
}

#[test]
fn verified_renewal_can_extend_same_session_and_epoch_before_expiration() {
    let (mut session, state) = setup();
    at(&state, 10, || session.start()).expect("start succeeds");
    state.borrow_mut().authorization = Ok(lease("session-1", 2000, 1));
    at(&state, 999, || session.check_access()).expect("renewal succeeds");
    at(&state, 1000, || session.check_access()).expect("extended lease remains valid");
    assert_eq!(session.state(), SharingState::Sharing);
}

#[test]
fn cleanup_failure_stays_explicit_and_can_be_retried() {
    let (mut session, state) = setup();
    at(&state, 10, || session.start()).expect("start succeeds");
    state.borrow_mut().cleanup_failures = 1;
    assert_eq!(session.stop(), Err(SessionError::CleanupFailed));
    assert_eq!(session.state(), SharingState::CleanupRequired);
    assert_eq!(
        at(&state, 20, || session.start()),
        Err(SessionError::InvalidTransition)
    );
    session.stop().expect("cleanup retry succeeds");
    session.stop().expect("stop is idempotent");
    assert_eq!(session.state(), SharingState::Stopped);
    assert_eq!(
        state
            .borrow()
            .events
            .iter()
            .filter(|e| **e == "stop")
            .count(),
        2
    );
}

#[test]
fn partial_start_cleanup_failure_requires_cleanup_before_any_other_operation() {
    let (mut session, state) = setup();
    state.borrow_mut().failure = Some("start");
    state.borrow_mut().cleanup_failures = 1;
    assert_eq!(
        at(&state, 10, || session.start()),
        Err(SessionError::CleanupFailed)
    );
    assert_eq!(session.state(), SharingState::CleanupRequired);
    assert_eq!(
        at(&state, 20, || session.resume()),
        Err(SessionError::InvalidTransition)
    );
    session.stop().expect("cleanup retry succeeds");
}

#[test]
fn invalid_transitions_do_not_reopen_media_and_drop_releases_active_resources() {
    let (mut session, state) = setup();
    assert_eq!(
        session.pause(PauseReason::User),
        Err(SessionError::InvalidTransition)
    );
    assert_eq!(
        at(&state, 10, || session.resume()),
        Err(SessionError::InvalidTransition)
    );
    assert_eq!(
        at(&state, 10, || session.check_access()),
        Err(SessionError::InvalidTransition)
    );
    at(&state, 10, || session.start()).expect("start succeeds");
    assert_eq!(
        at(&state, 20, || session.start()),
        Err(SessionError::InvalidTransition)
    );
    drop(session);
    assert_eq!(
        state.borrow().events,
        ["authorize", "prepare", "start", "stop"]
    );
}

#[test]
fn forged_profile_fields_are_rejected_before_effects() {
    let (_, state) = setup();
    let result = SharingSession::new(
        Authorizer(state.clone()),
        Pipeline(state.clone()),
        Clock(state.clone()),
        "session-1".into(),
        CaptureSelection::new(CaptureKind::Monitor, "monitor-1".into()).expect("valid source"),
        VideoProfile {
            width: 1,
            height: 1080,
            fps: 60,
        },
    );
    assert!(matches!(result, Err(SessionError::InvalidProfile)));
    assert!(state.borrow().events.is_empty());
}

mod clock;
