use super::*;

impl Pipeline {
    pub(super) fn pause_for_recovery(
        &mut self,
        publisher: &mut NativePublisher,
    ) -> Result<(), &'static str> {
        if self.capture_recovering {
            return Ok(());
        }
        publisher
            .set_paused(true)
            .map_err(|_| "Publication recovery pause failed")?;
        if let Some(audio) = self.audio.as_mut() {
            // Reset the retained WASAPI client rather than accumulating packets
            // or silently replacing the user's selected audio process/device.
            audio
                .set_paused(true)
                .map_err(|_| "Audio recovery pause failed")?;
        }
        self.capture_recovering = true;
        self.stop_encoder()?;
        self.control.suspend();
        Ok(())
    }

    pub(super) fn resume_after_recovery(
        &mut self,
        publisher: &mut NativePublisher,
    ) -> Result<(), &'static str> {
        if !self.capture_recovering {
            return Ok(());
        }
        // Generation-change handling retired all old frames and established the
        // new parameter-set IDR gate before this point. User pause remains in force.
        if let Some(audio) = self.audio.as_mut() {
            audio
                .set_paused(self.paused)
                .map_err(|_| "Audio recovery resume failed")?;
        }
        publisher
            .set_paused(self.paused)
            .map_err(|_| "Publication recovery resume failed")?;
        self.capture_recovering = false;
        Ok(())
    }
}
