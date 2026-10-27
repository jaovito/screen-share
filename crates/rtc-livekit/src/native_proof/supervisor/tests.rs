use super::*;

#[tokio::test]
async fn retains_pending_shutdown_after_timeout_and_waits_for_actual_completion_on_retry() {
    let release = Arc::new(Notify::new());
    let owned_release = release.clone();
    let mut task = Some(tokio::spawn(async move {
        owned_release.notified().await;
        Ok(())
    }));
    let mut terminal = None;

    assert_eq!(
        join_shutdown(&mut task, &mut terminal, Duration::ZERO).await,
        Err(NativeTransportError::CloseFailed)
    );
    assert!(task.is_some());
    assert_eq!(terminal, None);
    release.notify_one();
    assert_eq!(
        join_shutdown(&mut task, &mut terminal, Duration::from_secs(1)).await,
        Ok(())
    );
    assert!(task.is_none());
    assert_eq!(terminal, Some(Ok(())));
    assert_eq!(
        join_shutdown(&mut task, &mut terminal, Duration::ZERO).await,
        Ok(())
    );
}

#[tokio::test]
async fn preserves_terminal_shutdown_failure_on_every_subsequent_close() {
    let mut task = Some(tokio::spawn(async {
        Err(NativeTransportError::CloseFailed)
    }));
    let mut terminal = None;

    assert_eq!(
        join_shutdown(&mut task, &mut terminal, Duration::from_secs(1)).await,
        Err(NativeTransportError::CloseFailed)
    );
    assert!(task.is_none());
    for _ in 0..2 {
        assert_eq!(
            join_shutdown(&mut task, &mut terminal, Duration::ZERO).await,
            Err(NativeTransportError::CloseFailed)
        );
    }
}

#[tokio::test]
async fn treats_aborted_shutdown_and_an_unowned_handle_as_terminal_failure() {
    let handle = tokio::spawn(async {
        std::future::pending::<()>().await;
        Ok(())
    });
    handle.abort();
    let mut task = Some(handle);
    let mut terminal = None;
    assert_eq!(
        join_shutdown(&mut task, &mut terminal, Duration::from_secs(1)).await,
        Err(NativeTransportError::CloseFailed)
    );
    assert_eq!(terminal, Some(Err(NativeTransportError::CloseFailed)));

    let mut terminal = None;
    assert_eq!(
        join_shutdown(&mut task, &mut terminal, Duration::ZERO).await,
        Err(NativeTransportError::CloseFailed)
    );
}
