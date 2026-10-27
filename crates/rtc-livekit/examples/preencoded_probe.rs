//! Test-only native transport probe. It reads bounded synthetic Annex B fixtures,
//! never acquires capture/media devices, and never logs credentials or payloads.
#[cfg(all(
    feature = "native-proof",
    any(target_os = "windows", target_os = "macos")
))]
mod probe {
    use ss_domain::{EncodedAccessUnit, MAX_ACCESS_UNIT_BYTES, VideoProfile};
    use ss_rtc_livekit::native_proof::{
        MediaKey, NativePublisher, NativeTransportError, PublisherGrant,
    };
    use std::{fs, io::Read, sync::mpsc, time::Duration};

    pub fn main() -> Result<(), &'static str> {
        let args: Vec<_> = std::env::args().skip(1).collect();
        if !(3..=5).contains(&args.len()) {
            return Err("Usage: preencoded_probe <grant.json> <key-file> <synthetic-packets>");
        }
        let grant = PublisherGrant::from_json(&text(&args[0], 12_000)?)
            .map_err(|_| "Invalid publisher grant")?;
        let key = MediaKey::from_encoded_secret(&text(&args[1], 43)?)
            .map_err(|_| "Invalid independent media key")?;
        let packets = packets_file(&args[2])?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| "Native runtime unavailable")?;
        let higher = args.get(3).map(|path| packets_file(path)).transpose()?;
        let audio = args
            .get(4)
            .is_some_and(|value| value == "--synthetic-audio");
        if args.len() == 5 && !audio {
            return Err("Unknown synthetic mode");
        }
        runtime.block_on(run(grant, key, packets, higher, audio))
    }

    fn transport_error(error: NativeTransportError, stage: &'static str) -> &'static str {
        eprintln!("Native transport code: {error:?}");
        stage
    }

    fn bounded_file(path: &str, limit: u64) -> Result<Vec<u8>, &'static str> {
        let file = fs::File::open(path).map_err(|_| "Private input unavailable")?;
        if !file
            .metadata()
            .map_err(|_| "Private input unavailable")?
            .is_file()
        {
            return Err("Input must be a regular file");
        }
        let mut bytes = Vec::new();
        file.take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Private input invalid")?;
        if bytes.len() as u64 > limit {
            return Err("Private input too large");
        }
        Ok(bytes)
    }

    fn text(path: &str, limit: u64) -> Result<String, &'static str> {
        String::from_utf8(bounded_file(path, limit)?).map_err(|_| "Private input invalid")
    }

    fn packets_file(path: &str) -> Result<Vec<Vec<u8>>, &'static str> {
        let bytes = bounded_file(path, 8 * 1024 * 1024)?;
        let mut packets = Vec::new();
        let mut cursor = 0;
        while cursor < bytes.len() {
            let header: [u8; 4] = bytes
                .get(cursor..cursor + 4)
                .ok_or("Invalid fixture header")?
                .try_into()
                .map_err(|_| "Invalid fixture header")?;
            cursor += 4;
            let size = u32::from_le_bytes(header) as usize;
            if size == 0 || size > MAX_ACCESS_UNIT_BYTES || packets.len() >= 30 {
                return Err("Invalid fixture bounds");
            }
            let packet = bytes
                .get(cursor..cursor + size)
                .ok_or("Truncated fixture")?
                .to_vec();
            cursor += size;
            packets.push(packet);
        }
        if packets.len() < 5 {
            return Err("Insufficient synthetic packets");
        }
        Ok(packets)
    }

    enum Command {
        Stop,
        Renew(PublisherGrant),
        Profile(u16),
    }

    async fn run(
        grant: PublisherGrant,
        key: MediaKey,
        packets: Vec<Vec<u8>>,
        higher: Option<Vec<Vec<u8>>>,
        audio: bool,
    ) -> Result<(), &'static str> {
        let mut profile = VideoProfile::new(if higher.is_some() { 720 } else { 480 }, 30)
            .map_err(|_| "Invalid proof profile")?;
        let mut publisher = NativePublisher::connect(grant, key, profile, 200_000)
            .await
            .map_err(|error| {
                // Fieldless public error enum; no SDK text or credentials are logged.
                eprintln!("Native transport code: {error:?}");
                "Native encrypted connection failed"
            })?;
        if audio {
            publisher.enable_audio().await.map_err(|error| {
                transport_error(error, "Encrypted synthetic audio initialization failed")
            })?;
        }
        println!("Native encrypted publication prepared.");
        let (send, commands) = mpsc::sync_channel(1);
        // Test-only private pipe: fixed command and explicitly bounded signed grant.
        std::thread::spawn(move || {
            let mut input = std::io::stdin();
            loop {
                let mut command = [0; 4];
                if input.read_exact(&mut command).is_err() || command == *b"stop" {
                    let _ = send.send(Command::Stop);
                    break;
                }
                if command == *b"lowr" || command == *b"high" {
                    let height = if command == *b"lowr" { 480 } else { 720 };
                    if send.send(Command::Profile(height)).is_err() {
                        break;
                    }
                    continue;
                }
                let renewal = (|| {
                    if command != *b"rene" {
                        return None;
                    }
                    let mut size = [0; 4];
                    input.read_exact(&mut size).ok()?;
                    let size = u32::from_le_bytes(size) as usize;
                    if size == 0 || size > 12000 {
                        return None;
                    }
                    let mut bytes = vec![0; size];
                    input.read_exact(&mut bytes).ok()?;
                    PublisherGrant::from_json(std::str::from_utf8(&bytes).ok()?).ok()
                })();
                let Some(grant) = renewal else {
                    let _ = send.send(Command::Stop);
                    break;
                };
                if send.send(Command::Renew(grant)).is_err() {
                    break;
                }
            }
        });
        let mut ticker = tokio::time::interval(Duration::from_millis(200));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut sent = 0_u64;
        let mut audio_tick = tokio::time::interval(Duration::from_millis(20));
        audio_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut audio_cursor = 0_u64;
        let mut packet_index = 0;
        let result = async {
            // Test-owned process: finite 45-second ceiling even if the browser disappears.
            for sequence in 0..225 {
                loop {
                    tokio::select! {
                        _ = ticker.tick() => break,
                        _ = audio_tick.tick(), if audio => {
                            let samples: Vec<i16> = (0..960).flat_map(|sample| {
                                let time = (audio_cursor + sample) as f64 / 48000.0;
                                let value = (f64::sin(time * 440.0 * std::f64::consts::TAU) * 3000.0) as i16;
                                [value, value]
                            }).collect();
                            audio_cursor += 960;
                            publisher.push_audio(&samples).await.map_err(|error| transport_error(error, "Encrypted synthetic audio stopped"))?;
                        }
                    }
                }
                match commands.try_recv() {
                    Ok(Command::Stop) => break,
                    Ok(Command::Renew(grant)) => {
                        publisher.renew(grant).await.map_err(|error| {
                            transport_error(error, "SFU lease reauthentication failed")
                        })?;
                        packet_index = 0;
                        println!("Native encrypted publication renewed.");
                    }
                    Ok(Command::Profile(height)) => {
                        if higher.is_none() { return Err("Adaptive fixture unavailable"); }
                        profile = VideoProfile::new(height, 30)
                            .map_err(|_| "Invalid adaptive fixture profile")?;
                        publisher.reconfigure_profile(profile).map_err(|error| {
                            transport_error(error, "Adaptive profile rejected")
                        })?;
                        packet_index = 0;
                        println!("Native synthetic profile target: {height}.");
                    }
                    Err(_) => {}
                }
                let selected = if profile.height == 720 {
                    higher.as_ref().unwrap_or(&packets)
                } else {
                    &packets
                };
                let packet = &selected[packet_index % selected.len()];
                packet_index += 1;
                let frame =
                    EncodedAccessUnit::h264(packet.clone(), profile, (sequence as i64) * 200_000)
                        .map_err(|_| "Invalid synthetic H.264 access unit")?;
                match publisher.push(&frame) {
                    Ok(_) => sent += 1,
                    Err(
                        NativeTransportError::FrameRejected
                        | NativeTransportError::KeyframeRequired,
                    ) => {}
                    Err(error) => return Err(transport_error(error, "Native publication stopped by transport policy")),
                }
            }
            Ok(())
        }
        .await;
        publisher
            .close()
            .await
            .map_err(|_| "Native transport cleanup failed")?;
        result?;
        println!(
            "Native synthetic access units accepted: {sent}. No capture or hardware encoder was used."
        );
        Ok(())
    }
}

fn main() {
    #[cfg(all(
        feature = "native-proof",
        any(target_os = "windows", target_os = "macos")
    ))]
    if let Err(error) = probe::main() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    #[cfg(not(all(
        feature = "native-proof",
        any(target_os = "windows", target_os = "macos")
    )))]
    {
        eprintln!("Enable native-proof on a supported Windows/macOS SDK host.");
        std::process::exit(1);
    }
}
