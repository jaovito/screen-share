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
        if args.len() != 3 {
            return Err("Usage: preencoded_probe <grant.json> <key-file> <synthetic-packets>");
        }
        let grant = PublisherGrant::from_json(&text(&args[0], 12_000)?)
            .map_err(|_| "Invalid publisher grant")?;
        let key = MediaKey::from_encoded_secret(&text(&args[1], 43)?)
            .map_err(|_| "Invalid independent media key")?;
        let packets = packets(&args[2])?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| "Native runtime unavailable")?;
        runtime.block_on(run(grant, key, packets))
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

    fn packets(path: &str) -> Result<Vec<Vec<u8>>, &'static str> {
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

    async fn run(
        grant: PublisherGrant,
        key: MediaKey,
        packets: Vec<Vec<u8>>,
    ) -> Result<(), &'static str> {
        let profile = VideoProfile::new(480, 30).map_err(|_| "Invalid proof profile")?;
        let mut publisher = NativePublisher::connect(grant, key, profile, 200_000)
            .await
            .map_err(|error| {
                // Fieldless public error enum; no SDK text or credentials are logged.
                eprintln!("Native transport code: {error:?}");
                "Native encrypted connection failed"
            })?;
        println!("Native encrypted publication prepared.");
        let (send, stop) = mpsc::sync_channel(1);
        // Fixed four-byte command, no unbounded input and no runtime-blocking stdin.
        std::thread::spawn(move || {
            let mut command = [0; 4];
            let _ = std::io::stdin().read_exact(&mut command);
            let _ = send.send(());
        });
        let mut ticker = tokio::time::interval(Duration::from_millis(200));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut sent = 0_u64;
        let result = async {
            for sequence in 0..150 {
                ticker.tick().await;
                if stop.try_recv().is_ok() {
                    break;
                }
                let packet = &packets[sequence % packets.len()];
                let frame =
                    EncodedAccessUnit::h264(packet.clone(), profile, (sequence as i64) * 200_000)
                        .map_err(|_| "Invalid synthetic H.264 access unit")?;
                match publisher.push(&frame) {
                    Ok(_) => sent += 1,
                    Err(
                        NativeTransportError::FrameRejected
                        | NativeTransportError::KeyframeRequired,
                    ) => {}
                    Err(_) => return Err("Native publication stopped by transport policy"),
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
