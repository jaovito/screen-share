use ss_domain::VideoProfile;
use std::{collections::HashSet, path::PathBuf};

pub(crate) struct Arguments {
    pub grant: PathBuf,
    pub key_output: PathBuf,
    pub profile: VideoProfile,
    pub bitrate: u32,
    pub seconds: u64,
}

impl Arguments {
    pub fn parse_from(args: Vec<String>) -> Result<Self, &'static str> {
        let mut grant = None;
        let mut key_output = None;
        let (mut height, mut fps, mut bitrate, mut seconds) = (1080, 60, 10_000_000, 30);

        if args.is_empty() || !args.len().is_multiple_of(2) {
            return Err(
                "Pass --publisher-grant <file> --private-key-output <absolute-file>, optionally --height --fps --bitrate-bps --seconds.",
            );
        }
        let mut seen = HashSet::new();

        for pair in args.as_chunks::<2>().0 {
            if !seen.insert(pair[0].as_str()) {
                return Err("Unknown or duplicate private input argument");
            }

            match pair[0].as_str() {
                "--publisher-grant" if grant.is_none() => grant = Some(PathBuf::from(&pair[1])),
                "--private-key-output" if key_output.is_none() => {
                    key_output = Some(PathBuf::from(&pair[1]))
                }
                "--height" => height = pair[1].parse().map_err(|_| "Invalid catalog height")?,
                "--fps" => fps = pair[1].parse().map_err(|_| "Invalid catalog frame rate")?,
                "--bitrate-bps" => bitrate = pair[1].parse().map_err(|_| "Invalid bitrate")?,
                "--seconds" => seconds = pair[1].parse().map_err(|_| "Invalid proof duration")?,
                _ => return Err("Unknown or duplicate private input argument"),
            }
        }

        let profile = VideoProfile::new(height, fps).map_err(|_| "Invalid catalog profile")?;
        if !(64_000..=50_000_000).contains(&bitrate) || !(1..=240).contains(&seconds) {
            return Err("Bitrate must be 64000..50000000 and duration 1..240 seconds");
        }

        Ok(Self {
            grant: grant.ok_or("A trusted publisher grant file is required")?,
            key_output: key_output.ok_or("An explicit private key export path is required")?,
            profile,
            bitrate,
            seconds,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(extra: &[&str]) -> Vec<String> {
        [
            "--publisher-grant",
            "grant.json",
            "--private-key-output",
            "key-output",
        ]
        .into_iter()
        .chain(extra.iter().copied())
        .map(str::to_owned)
        .collect()
    }

    #[test]
    fn preserves_explicit_inputs_defaults_and_all_catalog_profiles() {
        let parsed = Arguments::parse_from(args(&[])).expect("required inputs");
        assert_eq!(
            (
                parsed.profile.height,
                parsed.profile.fps,
                parsed.bitrate,
                parsed.seconds
            ),
            (1080, 60, 10_000_000, 30)
        );
        assert_eq!(parsed.grant, PathBuf::from("grant.json"));
        assert_eq!(parsed.key_output, PathBuf::from("key-output"));

        for height in ["480", "720", "1080", "1440"] {
            for fps in ["30", "60"] {
                assert!(Arguments::parse_from(args(&["--height", height, "--fps", fps])).is_ok());
            }
        }
    }

    #[test]
    fn rejects_missing_ambiguous_out_of_catalog_and_unbounded_parameters() {
        assert!(Arguments::parse_from(Vec::new()).is_err());

        for extra in [
            vec!["--height"],
            vec!["--unknown", "value"],
            vec!["--publisher-grant", "another"],
            vec!["--height", "2160"],
            vec!["--height", "720", "--height", "1080"],
            vec!["--fps", "30", "--fps", "60"],
            vec!["--bitrate-bps", "100000", "--bitrate-bps", "200000"],
            vec!["--seconds", "10", "--seconds", "20"],
            vec!["--fps", "45"],
            vec!["--seconds", "0"],
            vec!["--seconds", "241"],
            vec!["--bitrate-bps", "0"],
            vec!["--bitrate-bps", "50000001"],
        ] {
            assert!(Arguments::parse_from(args(&extra)).is_err());
        }
    }
}
