use super::*;

#[test]
fn authorization_that_returns_after_expiry_cannot_open_transport_or_capture() {
    let (mut session, state) = setup();
    state.borrow_mut().advance_on = Some(("authorize", 1000));
    assert_eq!(session.start(), Err(SessionError::LeaseExpired));
    assert_eq!(state.borrow().events, ["authorize"]);
    assert!(state.borrow().source_ids.is_empty());
    assert_eq!(
        session.state(),
        SharingState::Failed(SessionError::LeaseExpired)
    );
}

#[test]
fn encryption_preparation_that_crosses_expiry_is_cleaned_up_before_capture_opens() {
    let (mut session, state) = setup();
    state.borrow_mut().advance_on = Some(("prepare", 1000));
    assert_eq!(session.start(), Err(SessionError::LeaseExpired));
    assert_eq!(state.borrow().events, ["authorize", "prepare", "stop"]);
    assert!(state.borrow().source_ids.is_empty());
    assert_eq!(
        session.state(),
        SharingState::Failed(SessionError::LeaseExpired)
    );
}

#[test]
fn native_start_that_crosses_expiry_is_released_before_reporting_sharing() {
    let (mut session, state) = setup();
    state.borrow_mut().advance_on = Some(("start", 1000));
    assert_eq!(session.start(), Err(SessionError::LeaseExpired));
    assert_eq!(
        state.borrow().events,
        ["authorize", "prepare", "start", "stop"]
    );
    assert_eq!(
        session.state(),
        SharingState::Failed(SessionError::LeaseExpired)
    );
}

#[test]
fn blocked_resume_authorization_cannot_restart_expired_capture() {
    let (mut session, state) = setup();
    session.start().expect("start succeeds");
    session
        .pause(PauseReason::SourceInactive)
        .expect("pause succeeds");
    state.borrow_mut().advance_on = Some(("authorize", 1000));
    assert_eq!(session.resume(), Err(SessionError::LeaseExpired));
    assert!(!state.borrow().events.contains(&"resume"));
    assert_eq!(state.borrow().events.last(), Some(&"stop"));
    assert_eq!(
        session.state(),
        SharingState::Failed(SessionError::LeaseExpired)
    );
}

#[test]
fn native_resume_that_crosses_expiry_is_released_before_reporting_sharing() {
    let (mut session, state) = setup();
    session.start().expect("start succeeds");
    session.pause(PauseReason::User).expect("pause succeeds");
    state.borrow_mut().advance_on = Some(("resume", 1000));
    assert_eq!(session.resume(), Err(SessionError::LeaseExpired));
    let events = &state.borrow().events;
    assert_eq!(&events[events.len() - 2..], ["resume", "stop"]);
    assert_eq!(
        session.state(),
        SharingState::Failed(SessionError::LeaseExpired)
    );
}

#[test]
fn native_pause_that_crosses_expiry_releases_remaining_session_resources() {
    let (mut session, state) = setup();
    session.start().expect("start succeeds");
    state.borrow_mut().advance_on = Some(("pause", 1000));
    assert_eq!(
        session.pause(PauseReason::User),
        Err(SessionError::LeaseExpired)
    );
    assert_eq!(state.borrow().events.last(), Some(&"stop"));
    assert_eq!(
        session.state(),
        SharingState::Failed(SessionError::LeaseExpired)
    );
}

#[test]
fn blocked_renewal_cannot_conceal_an_expired_original_lease() {
    let (mut session, state) = setup();
    session.start().expect("start succeeds");
    state.borrow_mut().authorization = Ok(lease("session-1", 2000, 1));
    state.borrow_mut().advance_on = Some(("authorize", 1500));
    assert_eq!(
        at(&state, 999, || session.check_access()),
        Err(SessionError::LeaseExpired)
    );
    assert_eq!(state.borrow().events.last(), Some(&"stop"));
    assert_eq!(
        session.state(),
        SharingState::Failed(SessionError::LeaseExpired)
    );
}

#[test]
fn a_regressing_clock_fails_closed_instead_of_extending_lease_lifetime() {
    let (mut session, state) = setup();
    session.start().expect("start succeeds");
    assert_eq!(
        at(&state, 9, || session.check_access()),
        Err(SessionError::InvalidLease)
    );
    assert_eq!(
        state.borrow().events,
        ["authorize", "prepare", "start", "stop"]
    );
    assert_eq!(
        session.state(),
        SharingState::Failed(SessionError::InvalidLease)
    );
}
