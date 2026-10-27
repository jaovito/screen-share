use super::*;

fn shared() -> Shared {
    Shared {
        frames: LatestFrameQueue::new(),
        status: Mutex::new(CaptureStatus::Capturing),
        stopped: AtomicBool::new(false),
        paused: AtomicBool::new(false),
        faulted: AtomicBool::new(false),
        generation: AtomicU64::new(0),
    }
}

#[test]
fn stale_generation_pause_fault_and_terminal_stop_cannot_expose_frames() {
    let shared = shared();
    assert!(shared.accepts(0));
    shared.fault(CaptureError::DeviceLost);
    assert!(!shared.accepts(0));
    assert!(!shared.stopped.load(Ordering::Acquire));
    shared.generation.store(1, Ordering::Release);
    shared.faulted.store(false, Ordering::Release);
    assert!(!shared.accepts(0));
    assert!(shared.accepts(1));
    shared.paused.store(true, Ordering::Release);
    assert!(!shared.accepts(1));
    shared.paused.store(false, Ordering::Release);
    shared.end(CaptureStatus::Stopped);
    assert!(!shared.accepts(1));
}

#[test]
fn source_closed_is_terminal_even_when_a_late_device_loss_callback_arrives() {
    let shared = Arc::new(shared());
    let reader = CaptureReader {
        shared: shared.clone(),
    };
    shared.end(CaptureStatus::SourceClosed);
    shared.fault(CaptureError::DeviceLost);
    assert_eq!(reader.status().unwrap(), CaptureStatus::SourceClosed);
    assert_eq!(reader.generation(), 0);
    assert!(reader.take_frame().unwrap().is_none());
    assert!(!shared.accepts(0));
    assert!(Arc::ptr_eq(&shared, &reader.shared));
}

#[test]
fn publication_gate_runs_only_for_current_live_generation_and_rejects_terminal_source() {
    let shared = Arc::new(shared());
    let reader = CaptureReader {
        shared: shared.clone(),
    };
    assert_eq!(reader.with_generation(0, || 1).unwrap(), Some(1));
    assert_eq!(
        reader
            .with_generation(1, || panic!("stale output published"))
            .unwrap(),
        None
    );
    shared.fault(CaptureError::DeviceLost);
    assert_eq!(
        reader
            .with_generation(0, || panic!("invalidated output published"))
            .unwrap(),
        None
    );
    shared.end(CaptureStatus::SourceClosed);
    assert_eq!(
        reader
            .with_generation(0, || panic!("closed source published"))
            .unwrap(),
        None
    );
}

#[test]
fn late_old_device_fault_cannot_invalidate_a_replacement_generation() {
    let shared = Arc::new(shared());
    let reader = CaptureReader {
        shared: shared.clone(),
    };
    shared.generation.store(1, Ordering::Release);
    assert!(!reader.report_device_loss(0));
    assert_eq!(reader.status().unwrap(), CaptureStatus::Capturing);
    assert_eq!(reader.with_generation(1, || true).unwrap(), Some(true));
    assert!(reader.report_device_loss(1));
    assert_eq!(
        reader.status().unwrap(),
        CaptureStatus::Failed(CaptureError::DeviceLost)
    );
}
