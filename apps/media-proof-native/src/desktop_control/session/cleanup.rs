use super::*;

impl Session {
    pub(super) fn cleanup(
        &mut self,
        window: &ProbeWindow,
        guard: &Guard,
        intentional: bool,
        status: &mut SharingStatus,
    ) -> Result<(), SharingReason> {
        self.worker.stop.store(true, Ordering::Release);
        let capture = self.capture.as_mut().map_or(Ok(()), |capture| {
            capture.stop().map_err(|_| SharingReason::CleanupFailed)
        });
        self.capture = None;
        let deadline = Instant::now() + Duration::from_secs(8);
        while self
            .worker
            .handle
            .as_ref()
            .is_some_and(|thread| !thread.is_finished())
        {
            guard.touch();
            let _ = window.pump();
            if Instant::now() >= deadline {
                ss_media_windows::terminate_probe();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        status.failure = self
            .worker
            .snapshot
            .lock()
            .ok()
            .and_then(|snapshot| snapshot.failure.clone());
        self.worker
            .handle
            .take()
            .ok_or(SharingReason::WorkerFailed)?
            .join()
            .map_err(|_| SharingReason::WorkerFailed)?;
        let report = self
            .worker
            .result
            .try_recv()
            .map_err(|_| SharingReason::WorkerFailed)?;
        status.failure = self
            .worker
            .snapshot
            .lock()
            .ok()
            .and_then(|snapshot| snapshot.failure.clone());
        // Always stop capture, but keep the media error that caused teardown.
        let outcome = match report {
            Ok(_) => Ok(()),
            Err("Publication stopped before capture") if intentional => Ok(()),
            Err(message) => {
                let failure = status.failure.get_or_insert_with(|| {
                    ss_media_proof::protocol::NativeFailure::worker(message)
                });
                Err(failure.reason())
            }
        };
        outcome.and(capture)
    }
}
