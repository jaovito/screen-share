use super::*;

impl Pipeline {
    /// Drain and submit one bounded batch, checking the capture generation before
    /// every publication so invalidated-device output cannot cross recovery.
    pub(super) async fn encode_pending(
        &mut self,
        publisher: &mut NativePublisher,
        reader: &CaptureReader,
        generation: u64,
        signals: &Signals,
    ) -> Result<(), &'static str> {
        tokio::task::yield_now().await;
        if signals.stop.load(Ordering::Acquire)
            || signals.paused.load(Ordering::Acquire)
            || !capture_active(reader, generation)?
        {
            return Ok(());
        }
        self.feedback(publisher, signals)?;
        for _ in 0..8 {
            if signals.stop.load(Ordering::Acquire)
                || signals.paused.load(Ordering::Acquire)
                || !capture_active(reader, generation)?
            {
                return Ok(());
            }
            self.feedback(publisher, signals)?;
            let Some(encoder) = self.encoder.as_mut() else {
                break;
            };
            let event = match encoder.poll() {
                Ok(event) => event,
                Err(_) if encoder.device_lost() => {
                    let _ = reader.report_device_loss(generation);
                    self.pause_for_recovery(publisher)?;
                    return Ok(());
                }
                Err(error) => {
                    super::super::failure::encoder(
                        signals,
                        ss_media_proof::protocol::FailureStage::EncoderOutput,
                        error,
                    );
                    return Err("Asynchronous hardware encoding failed");
                }
            };
            tokio::task::yield_now().await;
            self.feedback(publisher, signals)?;
            match event {
                EncoderPoll::Pending => break,
                EncoderPoll::NeedInput => {}
                EncoderPoll::Output(unit) => {
                    let unit = unit
                        .offset_timestamp_us(self.encoder_offset_us)
                        .map_err(|_| "Publication clock overflowed")?;
                    self.report.access_units = self.report.access_units.saturating_add(1);
                    tokio::task::yield_now().await;
                    self.feedback(publisher, signals)?;
                    if signals.stop.load(Ordering::Acquire)
                        || signals.paused.load(Ordering::Acquire)
                        || !capture_active(reader, generation)?
                    {
                        return Ok(());
                    }
                    let pushed = reader
                        .with_generation(generation, || publisher.push(&unit))
                        .map_err(|_| "Capture generation gate failed")?;
                    let Some(pushed) = pushed else {
                        return Ok(());
                    };
                    match pushed {
                        Ok(feedback) => {
                            self.report.bytes_sent = self
                                .report
                                .bytes_sent
                                .saturating_add(unit.payload().len() as u64);
                            self.control.accepted(unit.is_keyframe());
                            self.control.feedback(feedback, &mut self.report)?;
                        }
                        Err(NativeTransportError::KeyframeRequired) => self.control.recover(false),
                        Err(NativeTransportError::FrameRejected) => self.control.recover(true),
                        Err(_) => {
                            return Err("Encoded publication failed or its lease became invalid");
                        }
                    }
                }
            }
        }
        self.feedback(publisher, signals)?;
        if signals.stop.load(Ordering::Acquire)
            || signals.paused.load(Ordering::Acquire)
            || !capture_active(reader, generation)?
        {
            return Ok(());
        }
        if let Some(encoder) = self.encoder.as_mut()
            && let Some(frame) = self.pending.as_ref()
            && self
                .pacing
                .due(frame.timestamp_100ns(), self.control.interval_100ns())?
        {
            let submitted = match encoder.submit(frame) {
                Ok(result) => result,
                Err(_) if encoder.device_lost() => {
                    let _ = reader.report_device_loss(generation);
                    self.pause_for_recovery(publisher)?;
                    return Ok(());
                }
                Err(error) => {
                    super::super::failure::encoder(
                        signals,
                        ss_media_proof::protocol::FailureStage::EncoderInput,
                        error,
                    );
                    return Err("GPU conversion or hardware encoder input failed");
                }
            };
            match submitted {
                SubmitOutcome::Accepted => {
                    self.pacing.accepted(frame.timestamp_100ns())?;
                    self.report.samples_submitted = self.report.samples_submitted.saturating_add(1);
                    self.pending = None;
                }
                SubmitOutcome::Backpressure => {}
            }
        }
        Ok(())
    }
}
