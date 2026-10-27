use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameQueueError {
    Closed,
    Poisoned,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FrameQueueCounters {
    pub accepted: u64,
    pub replaced: u64,
    pub discarded_on_close: u64,
}

struct Slot<T> {
    frame: Option<T>,
    closed: bool,
    counters: FrameQueueCounters,
}

/// Exactly one pending frame. Slow consumers receive the latest frame rather
/// than growing a latency/memory backlog. Frame buffers remain native values.
/// Buffer destructors execute outside the mutex, including on replacement/close.
pub struct LatestFrameQueue<T> {
    slot: Mutex<Slot<T>>,
}

impl<T> Default for LatestFrameQueue<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T> LatestFrameQueue<T> {
    pub fn new() -> Self {
        Self {
            slot: Mutex::new(Slot {
                frame: None,
                closed: false,
                counters: FrameQueueCounters::default(),
            }),
        }
    }

    /// Takes ownership even on rejection, releasing a rejected frame immediately.
    pub fn push(&self, frame: T) -> Result<(), FrameQueueError> {
        let discarded = {
            let mut slot = self.slot.lock().map_err(|_| FrameQueueError::Poisoned)?;
            if slot.closed {
                return Err(FrameQueueError::Closed);
            }

            let discarded = slot.frame.replace(frame);
            slot.counters.accepted = slot.counters.accepted.saturating_add(1);
            if discarded.is_some() {
                slot.counters.replaced = slot.counters.replaced.saturating_add(1);
            }
            discarded
        };
        drop(discarded);

        Ok(())
    }

    /// Nonblocking with respect to frame arrival; the media driver's own wakeup
    /// mechanism schedules consumers. The mutex protects only this small slot.
    pub fn take(&self) -> Result<Option<T>, FrameQueueError> {
        let mut slot = self.slot.lock().map_err(|_| FrameQueueError::Poisoned)?;
        Ok(slot.frame.take())
    }

    pub fn close(&self) -> Result<(), FrameQueueError> {
        let discarded = {
            let mut slot = self.slot.lock().map_err(|_| FrameQueueError::Poisoned)?;
            slot.closed = true;
            let discarded = slot.frame.take();
            if discarded.is_some() {
                slot.counters.discarded_on_close =
                    slot.counters.discarded_on_close.saturating_add(1);
            }
            discarded
        };
        drop(discarded);

        Ok(())
    }

    pub fn counters(&self) -> Result<FrameQueueCounters, FrameQueueError> {
        let slot = self.slot.lock().map_err(|_| FrameQueueError::Poisoned)?;
        Ok(slot.counters)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    struct Buffer(Arc<AtomicUsize>);

    impl Drop for Buffer {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn latest_pending_frame_replaces_older_frames_without_backlog() {
        let queue = LatestFrameQueue::new();
        queue.push(1).expect("open queue");
        queue.push(2).expect("open queue");
        queue.push(3).expect("open queue");
        assert_eq!(queue.take(), Ok(Some(3)));
        assert_eq!(queue.take(), Ok(None));
        assert_eq!(
            queue.counters(),
            Ok(FrameQueueCounters {
                accepted: 3,
                replaced: 2,
                discarded_on_close: 0,
            })
        );
    }

    #[test]
    fn replacement_close_rejection_and_queue_drop_release_owned_buffers() {
        let released = Arc::new(AtomicUsize::new(0));
        let queue = LatestFrameQueue::new();
        queue
            .push(Buffer(released.clone()))
            .expect("first frame accepted");
        queue
            .push(Buffer(released.clone()))
            .expect("second frame accepted");
        assert_eq!(released.load(Ordering::SeqCst), 1);
        queue.close().expect("close succeeds");
        queue.close().expect("close is idempotent");
        assert_eq!(released.load(Ordering::SeqCst), 2);
        assert_eq!(
            queue.push(Buffer(released.clone())),
            Err(FrameQueueError::Closed)
        );
        assert_eq!(released.load(Ordering::SeqCst), 3);
        assert!(queue.take().expect("slot remains readable").is_none());
        assert_eq!(
            queue
                .counters()
                .expect("counters available")
                .discarded_on_close,
            1
        );

        let other = LatestFrameQueue::default();
        other
            .push(Buffer(released.clone()))
            .expect("frame accepted");
        drop(other);
        assert_eq!(released.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn producer_and_consumer_can_share_a_bounded_native_slot() {
        let queue = Arc::new(LatestFrameQueue::new());
        let producer = queue.clone();
        let task = std::thread::spawn(move || {
            for sequence in 0..1000 {
                producer.push(sequence).expect("open queue");
            }
        });
        let mut last = None;
        while !task.is_finished() {
            if let Some(sequence) = queue.take().expect("unpoisoned slot") {
                assert!(last.is_none_or(|previous| sequence > previous));
                last = Some(sequence);
            }
            std::thread::yield_now();
        }
        task.join().expect("producer exited");
        if let Some(sequence) = queue.take().expect("unpoisoned slot") {
            assert!(last.is_none_or(|previous| sequence > previous));
            last = Some(sequence);
        }
        assert_eq!(last, Some(999));
        assert_eq!(queue.counters().expect("counter snapshot").accepted, 1000);
        queue.close().expect("close succeeds");
    }
}
