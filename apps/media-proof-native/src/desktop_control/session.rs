use super::{Guard, emit, profile};
use crate::pipeline::{self, Renewal, Worker, WorkerPhase};
use ss_media_proof::protocol::{
    AdaptationReason, Command, EncryptionState, GrantPacket, SharingReason, SharingState,
    SharingStatus, StartRequest,
};
use ss_media_windows::{
    CaptureError, CaptureStatus, NativeCapture, PickedSource, ProbeWindow, pick_source,
};
use ss_rtc_livekit::native_proof::{MediaKey, PublisherGrant};
use std::{
    future::Future,
    pin::pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, TryRecvError},
    },
    task::{Context, Poll, Waker},
    time::{Duration, Instant},
};

struct Binding {
    session: String,
    epoch: u64,
    room: String,
    identity: String,
    server: String,
}
impl Binding {
    fn from_grant(grant: &GrantPacket) -> Self {
        Self {
            session: grant.session_id.clone(),
            epoch: grant.epoch,
            room: grant.rtc_room.clone(),
            identity: grant.participant_id.clone(),
            server: grant.server_url.clone(),
        }
    }
    fn matches(&self, grant: &GrantPacket) -> bool {
        self.session == grant.session_id
            && self.epoch == grant.epoch
            && self.room == grant.rtc_room
            && self.identity == grant.participant_id
            && self.server == grant.server_url
    }
}

pub(super) struct Session {
    worker: Worker,
    capture: Option<NativeCapture>,
    binding: Binding,
    source: Option<PickedSource>,
    started: Option<Instant>,
    baseline: (Instant, u64, u64),
    output_paused: bool,
}

impl Session {
    pub fn run(
        mut request: StartRequest,
        input: &Receiver<Command>,
        disconnected: &AtomicBool,
        guard: &Guard,
        status: &mut SharingStatus,
    ) -> Result<(), SharingReason> {
        request
            .validate()
            .map_err(|_| SharingReason::InvalidRequest)?;
        status.state = SharingState::Selecting;
        status.profile_id = Some(request.profile_id.clone());
        emit(status).map_err(|_| SharingReason::WorkerFailed)?;
        let window = ProbeWindow::open().map_err(|_| SharingReason::CaptureFailed)?;
        let Some(source) = select(&window, input, disconnected, guard, status, &mut request)?
        else {
            status.reason = Some(SharingReason::SelectionCanceled);
            return Ok(());
        };
        let binding = Binding::from_grant(&request.grant);
        let grant = PublisherGrant::from_json(
            &request
                .grant
                .private_json()
                .map_err(|_| SharingReason::InvalidRequest)?,
        )
        .map_err(|_| SharingReason::AuthorizationFailed)?;
        let key = MediaKey::from_encoded_secret(&request.media_key)
            .map_err(|_| SharingReason::InvalidRequest)?;
        let worker = pipeline::spawn_with_audio(
            grant,
            key,
            profile(&request.profile_id)?,
            request.bitrate_bps,
            request.audio_mode,
            request
                .audio_process()
                .map_err(|_| SharingReason::InvalidRequest)?,
            request.quality_mode,
        )
        .map_err(|_| SharingReason::WorkerFailed)?;
        drop(request);
        let mut session = Self {
            worker,
            capture: None,
            binding,
            source: Some(source),
            started: None,
            baseline: (Instant::now(), 0, 0),
            output_paused: false,
        };
        status.state = SharingState::Connecting;
        let result = session.drive(&window, input, disconnected, guard, status);
        let intentional = status.reason == Some(SharingReason::StoppedByUser);
        let cleanup = session.cleanup(&window, guard, intentional);
        cleanup?;
        result
    }

    fn drive(
        &mut self,
        window: &ProbeWindow,
        input: &Receiver<Command>,
        disconnected: &AtomicBool,
        guard: &Guard,
        status: &mut SharingStatus,
    ) -> Result<(), SharingReason> {
        let ready_deadline = Instant::now() + Duration::from_secs(35);
        let mut emitted = Instant::now() - Duration::from_secs(1);
        loop {
            guard.touch();
            if disconnected.load(Ordering::Acquire) || !window.pump() {
                status.reason = Some(SharingReason::StoppedByUser);
                break;
            }
            for _ in 0..4 {
                match input.try_recv() {
                    Ok(Command::Stop {}) => {
                        self.worker.stop.store(true, Ordering::Release);
                        status.reason = Some(SharingReason::StoppedByUser);
                    }
                    Ok(Command::Pause {}) => {
                        if let Some(capture) = &self.capture {
                            capture
                                .set_output_paused(true)
                                .map_err(|_| SharingReason::CaptureFailed)?;
                        }
                        self.output_paused = true;
                        self.worker.paused.store(true, Ordering::Release);
                    }
                    Ok(Command::Resume {}) => {
                        self.worker.paused.store(false, Ordering::Release);
                    }
                    Ok(Command::Renew { request }) => {
                        request
                            .validate()
                            .map_err(|_| SharingReason::InvalidRequest)?;
                        if !self.binding.matches(&request.grant) {
                            return Err(SharingReason::AuthorizationFailed);
                        }
                        let grant = PublisherGrant::from_json(
                            &request
                                .grant
                                .private_json()
                                .map_err(|_| SharingReason::InvalidRequest)?,
                        )
                        .map_err(|_| SharingReason::AuthorizationFailed)?;
                        let profile = match (&request.profile_id, request.bitrate_bps) {
                            (Some(id), Some(bitrate)) => Some((profile(id)?, bitrate)),
                            _ => None,
                        };
                        if let Some(capture) = &self.capture {
                            capture
                                .set_output_paused(true)
                                .map_err(|_| SharingReason::CaptureFailed)?;
                        }
                        self.output_paused = true;
                        self.worker
                            .renew
                            .try_send(Renewal { grant, profile })
                            .map_err(|_| SharingReason::WorkerFailed)?;
                    }
                    Ok(Command::Start { .. }) => return Err(SharingReason::InvalidRequest),
                    Err(TryRecvError::Disconnected) => {
                        self.worker.stop.store(true, Ordering::Release);
                    }
                    Err(TryRecvError::Empty) => break,
                }
            }
            if self.capture.is_none() {
                match self.worker.ready.try_recv() {
                    Ok(Ok(())) => {
                        if self.worker.stop.load(Ordering::Acquire) {
                            return Err(SharingReason::AuthorizationFailed);
                        }
                        let capture = NativeCapture::start(
                            self.source.take().ok_or(SharingReason::CaptureFailed)?,
                        )
                        .map_err(|_| SharingReason::CaptureFailed)?;
                        self.worker
                            .frames
                            .try_send(capture.reader())
                            .map_err(|_| SharingReason::WorkerFailed)?;
                        self.started = Some(Instant::now());
                        self.capture = Some(capture);
                    }
                    Ok(Err(_)) | Err(TryRecvError::Disconnected) => {
                        return Err(SharingReason::AuthorizationFailed);
                    }
                    Err(TryRecvError::Empty) => {}
                }
                if Instant::now() >= ready_deadline {
                    return Err(SharingReason::AuthorizationFailed);
                }
            }
            let snapshot = self
                .worker
                .snapshot
                .lock()
                .map_err(|_| SharingReason::WorkerFailed)?
                .clone();
            if snapshot.heartbeat.elapsed() > Duration::from_secs(8) {
                return Err(SharingReason::ChildUnresponsive);
            }
            status.profile_id = Some(format!(
                "{}p{}",
                snapshot.profile.height, snapshot.profile.fps
            ));
            status.state = match snapshot.phase {
                WorkerPhase::Connecting => SharingState::Connecting,
                WorkerPhase::Sharing => SharingState::Sharing,
                WorkerPhase::Paused => SharingState::Paused,
                WorkerPhase::Stopped => SharingState::Stopped,
                WorkerPhase::Failed => SharingState::Failed,
            };
            status.encryption =
                if matches!(status.state, SharingState::Sharing | SharingState::Paused) {
                    EncryptionState::Configured
                } else {
                    EncryptionState::Pending
                };
            status.diagnostics_generation = snapshot.diagnostics_generation;
            status.diagnostics_elapsed_ms = snapshot.diagnostics_elapsed_ms;
            status.conversion_submission_ms = snapshot.conversion_submission_ms;
            status.encoder_output_latency_ms = snapshot.encoder_output_latency_ms;
            status.available_send_bitrate_bps = snapshot.available_send_bitrate_bps;
            status.manual_bitrate_bps = snapshot.manual_bitrate_bps;
            status.frames_encoded = snapshot.report.access_units;
            status.encoded_bytes = snapshot.report.bytes_sent;
            status.audio_samples = snapshot.report.audio_samples;
            status.target_fps = Some(snapshot.target_fps);
            status.target_bitrate_bps = snapshot.target_bitrate_bps;
            status.quality_changes = snapshot.report.quality_changes;
            status.adaptation_reason = snapshot.adaptation_reason.map(|reason| match reason {
                ss_domain::QualityReason::SustainedNetworkPressure => {
                    AdaptationReason::NetworkPressure
                }
                ss_domain::QualityReason::SustainedNetworkHeadroom => {
                    AdaptationReason::NetworkHeadroom
                }
            });
            status.elapsed_ms = self.started.map_or(0, |started| {
                started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
            });
            if let Some(capture) = &mut self.capture {
                capture
                    .service_recovery(
                        matches!(snapshot.phase, WorkerPhase::Sharing)
                            && !self.worker.stop.load(Ordering::Acquire)
                            && !self.worker.paused.load(Ordering::Acquire),
                    )
                    .map_err(|_| SharingReason::CaptureFailed)?;
                match capture.status().map_err(|_| SharingReason::CaptureFailed)? {
                    CaptureStatus::Capturing => {}
                    CaptureStatus::SourceClosed => {
                        status.reason = Some(SharingReason::SourceClosed);
                        break;
                    }
                    CaptureStatus::Stopped => break,
                    CaptureStatus::Failed(CaptureError::DeviceLost) => {}
                    CaptureStatus::Failed(_) => return Err(SharingReason::CaptureFailed),
                }
                let paused = self.worker.paused.load(Ordering::Acquire)
                    || !matches!(snapshot.phase, WorkerPhase::Sharing);
                if paused != self.output_paused {
                    capture
                        .set_output_paused(paused)
                        .map_err(|_| SharingReason::CaptureFailed)?;
                    self.output_paused = paused;
                }
                status.capture_recoveries = capture.reader().generation();
                let counters = capture
                    .queue_counters()
                    .map_err(|_| SharingReason::CaptureFailed)?;
                status.frames_captured = counters.accepted;
                status.queue_replacements = counters.replaced;
                if paused {
                    status.capture_fps = None;
                    status.encoded_fps = None;
                    self.baseline = (
                        Instant::now(),
                        counters.accepted,
                        snapshot.report.access_units,
                    );
                } else if self.baseline.0.elapsed() >= Duration::from_secs(1) {
                    let seconds = self.baseline.0.elapsed().as_secs_f64();
                    status.capture_fps =
                        Some(counters.accepted.saturating_sub(self.baseline.1) as f64 / seconds);
                    status.encoded_fps = Some(
                        snapshot.report.access_units.saturating_sub(self.baseline.2) as f64
                            / seconds,
                    );
                    self.baseline = (
                        Instant::now(),
                        counters.accepted,
                        snapshot.report.access_units,
                    );
                }
            }
            if emitted.elapsed() >= Duration::from_millis(500) {
                emit(status).map_err(|_| SharingReason::WorkerFailed)?;
                emitted = Instant::now();
            }
            if self.worker.stop.load(Ordering::Acquire)
                || self
                    .worker
                    .handle
                    .as_ref()
                    .is_some_and(|thread| thread.is_finished())
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Ok(())
    }

    fn cleanup(
        &mut self,
        window: &ProbeWindow,
        guard: &Guard,
        intentional: bool,
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
        capture?;
        match report {
            Ok(_) => Ok(()),
            Err("Publication stopped before capture") if intentional => Ok(()),
            Err(_) => Err(SharingReason::WorkerFailed),
        }
    }
}

fn select(
    window: &ProbeWindow,
    input: &Receiver<Command>,
    disconnected: &AtomicBool,
    guard: &Guard,
    status: &SharingStatus,
    request: &mut StartRequest,
) -> Result<Option<PickedSource>, SharingReason> {
    let mut operation = pin!(unsafe { pick_source(window.handle) });
    let mut context = Context::from_waker(Waker::noop());
    let deadline = Instant::now() + Duration::from_secs(120);
    let mut emitted = Instant::now();
    loop {
        guard.touch();
        if disconnected.load(Ordering::Acquire) || !window.pump() {
            return Ok(None);
        }
        match input.try_recv() {
            Ok(Command::Stop {}) => return Ok(None),
            Ok(Command::Renew { request: next }) => {
                next.validate().map_err(|_| SharingReason::InvalidRequest)?;
                if !Binding::from_grant(&request.grant).matches(&next.grant) {
                    return Err(SharingReason::AuthorizationFailed);
                }
                request.grant = next.grant;
                if let (Some(profile), Some(bitrate)) = (next.profile_id, next.bitrate_bps) {
                    request.profile_id = profile;
                    request.bitrate_bps = bitrate;
                }
            }
            Ok(_) => return Err(SharingReason::InvalidRequest),
            Err(TryRecvError::Disconnected) => return Ok(None),
            Err(TryRecvError::Empty) => {}
        }
        if let Poll::Ready(selected) = operation.as_mut().poll(&mut context) {
            return selected.map_err(|_| SharingReason::CaptureFailed);
        }
        if Instant::now() >= deadline {
            return Err(SharingReason::CaptureFailed);
        }
        if emitted.elapsed() >= Duration::from_millis(500) {
            emit(status).map_err(|_| SharingReason::WorkerFailed)?;
            emitted = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
