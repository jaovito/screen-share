//! Session-total retry budget for rebuilding resources of one immutable source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecoveryError {
    SourceChanged,
    Exhausted,
    Cancelled,
    ClockRegressed,
}

pub(crate) struct RecoveryBudget {
    source: u64,
    attempts: u8,
    due_ms: Option<u64>,
    last_ms: u64,
    cancelled: bool,
}

impl RecoveryBudget {
    pub(crate) fn new(source: u64) -> Self {
        Self {
            source,
            attempts: 0,
            due_ms: None,
            last_ms: 0,
            cancelled: false,
        }
    }

    fn verify(&mut self, source: u64, now_ms: u64) -> Result<(), RecoveryError> {
        if self.cancelled {
            return Err(RecoveryError::Cancelled);
        }
        if source != self.source {
            return Err(RecoveryError::SourceChanged);
        }
        if now_ms < self.last_ms {
            return Err(RecoveryError::ClockRegressed);
        }
        self.last_ms = now_ms;
        Ok(())
    }

    pub(crate) fn failed(&mut self, source: u64, now_ms: u64) -> Result<(), RecoveryError> {
        self.verify(source, now_ms)?;
        if self.attempts >= 3 {
            return Err(RecoveryError::Exhausted);
        }
        if self.due_ms.is_none() {
            self.due_ms = Some(now_ms.saturating_add(250_u64 << self.attempts));
        }
        Ok(())
    }

    pub(crate) fn poll(
        &mut self,
        source: u64,
        now_ms: u64,
        permitted: bool,
    ) -> Result<bool, RecoveryError> {
        self.verify(source, now_ms)?;
        if !permitted || self.due_ms.is_none_or(|due| now_ms < due) {
            return Ok(false);
        }
        self.due_ms = None;
        self.attempts += 1;
        Ok(true)
    }

    pub(crate) fn cancel(&mut self) {
        self.cancelled = true;
        self.due_ms = None;
    }
}

pub(crate) fn device_lost_hresult(code: i32) -> bool {
    // DXGI: DEVICE_REMOVED, DEVICE_HUNG, DEVICE_RESET, DRIVER_INTERNAL_ERROR.
    [0x887A0005_u32, 0x887A0006, 0x887A0007, 0x887A0020].contains(&(code as u32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immutable_source_and_session_total_three_attempt_budget_survive_successes() {
        let mut budget = RecoveryBudget::new(42);
        for (failed, due) in [(0, 250), (300, 800), (900, 1900)] {
            budget.failed(42, failed).unwrap();
            assert!(!budget.poll(42, due - 1, true).unwrap());
            assert!(budget.poll(42, due, true).unwrap());
            assert!(!budget.poll(42, due, true).unwrap());
        }
        assert_eq!(budget.failed(42, 2000), Err(RecoveryError::Exhausted));
        assert_eq!(budget.failed(43, 2000), Err(RecoveryError::SourceChanged));
    }

    #[test]
    fn pause_authorization_and_cancel_gates_never_spend_or_restart_a_source() {
        let mut budget = RecoveryBudget::new(7);
        budget.failed(7, 10).unwrap();
        assert!(!budget.poll(7, 5000, false).unwrap());
        assert!(budget.poll(7, 5001, true).unwrap());
        budget.failed(7, 5002).unwrap();
        budget.cancel();
        assert_eq!(budget.poll(7, 10000, true), Err(RecoveryError::Cancelled));
        assert_eq!(budget.failed(7, 10000), Err(RecoveryError::Cancelled));
    }

    #[test]
    fn source_replacement_and_regressing_clock_fail_closed() {
        let mut budget = RecoveryBudget::new(7);
        budget.failed(7, 50).unwrap();
        assert_eq!(
            budget.poll(8, 1000, true),
            Err(RecoveryError::SourceChanged)
        );
        assert_eq!(budget.poll(7, 49, true), Err(RecoveryError::ClockRegressed));
    }

    #[test]
    fn only_explicit_device_invalidation_hresult_values_are_recoverable() {
        for code in [0x887A0005_u32, 0x887A0006, 0x887A0007, 0x887A0020] {
            assert!(device_lost_hresult(code as i32));
        }
        for code in [0, 0x80000013_u32, 0x8007000E, 0x80070005, 0x80004005] {
            assert!(!device_lost_hresult(code as i32));
        }
    }
}
