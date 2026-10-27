use super::NativeTransportError;
use livekit::{Room, RoomEvent, webrtc::native::frame_cryptor::EncryptionState};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::{sync::Notify, task::JoinHandle, time::timeout};

pub(super) type Gate = Arc<Mutex<Option<NativeTransportError>>>;

pub(super) fn stop(gate: &Gate, reason: NativeTransportError) {
    if let Ok(mut stopped) = gate.lock() {
        stopped.get_or_insert(reason);
    }
}

pub(super) async fn close_room(room: &Room) -> Result<(), NativeTransportError> {
    // livekit 0.9.7 closes peer connections before awaiting signal shutdown.
    timeout(Duration::from_secs(3), room.close())
        .await
        .map_err(|_| NativeTransportError::CloseFailed)?
        .map_err(|_| NativeTransportError::CloseFailed)
}

/// A wait deadline does not establish that the owned shutdown completed. Keep its
/// handle for a truthful retry and preserve terminal failures after it has joined.
pub(super) async fn join_shutdown(
    task: &mut Option<JoinHandle<Result<(), NativeTransportError>>>,
    terminal: &mut Option<Result<(), NativeTransportError>>,
    wait: Duration,
) -> Result<(), NativeTransportError> {
    if let Some(result) = *terminal {
        return result;
    }
    let result = match task.as_mut() {
        Some(handle) => match timeout(wait, handle).await {
            Err(_) => return Err(NativeTransportError::CloseFailed),
            Ok(joined) => joined.unwrap_or(Err(NativeTransportError::CloseFailed)),
        },
        None => Err(NativeTransportError::CloseFailed),
    };
    *task = None;
    *terminal = Some(result);
    result
}

pub(super) fn supervise(
    room: Arc<Room>,
    mut events: tokio::sync::mpsc::UnboundedReceiver<RoomEvent>,
    gate: Gate,
    wake: Arc<Notify>,
    deadline: Instant,
) -> JoinHandle<Result<(), NativeTransportError>> {
    tokio::spawn(async move {
        loop {
            let reason = tokio::select! {
                biased;
                _ = tokio::time::sleep_until(deadline.into()) => Some(NativeTransportError::Expired),
                _ = wake.notified() => Some(NativeTransportError::Stopped),
                event = events.recv() => match event {
                    Some(event) => failure(&event, &room),
                    None => Some(NativeTransportError::Disconnected),
                },
            };
            if let Some(reason) = reason {
                stop(&gate, reason);
                // Mute synchronously before close so SDK recovery cannot send more
                // frames while its asynchronous signal teardown is completing.
                for publication in room.local_participant().track_publications().values() {
                    publication.mute();
                }
                return close_room(&room).await;
            }
        }
    })
}

fn failure(event: &RoomEvent, room: &Room) -> Option<NativeTransportError> {
    match event {
        RoomEvent::Disconnected { .. } => Some(NativeTransportError::Disconnected),
        RoomEvent::Reconnecting
        | RoomEvent::Reconnected
        | RoomEvent::LocalTrackRepublished { .. }
        | RoomEvent::Moved { .. } => Some(NativeTransportError::ReconnectRequired),
        RoomEvent::E2eeStateChanged { state, .. }
            if !matches!(state, EncryptionState::New | EncryptionState::Ok) =>
        {
            Some(NativeTransportError::EncryptionUnavailable)
        }
        RoomEvent::LocalTrackUnpublished { .. } => Some(NativeTransportError::PublicationFailed),
        RoomEvent::TrackPublished { .. } | RoomEvent::TrackSubscribed { .. } => {
            Some(NativeTransportError::UnexpectedMedia)
        }
        RoomEvent::ParticipantPermissionChanged { participant, .. }
            if participant.identity() == room.local_participant().identity() =>
        {
            Some(NativeTransportError::PermissionDenied)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests;
