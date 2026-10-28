use ss_domain::{EncodedVideoError, MAX_ACCESS_UNIT_BYTES};

const MAX_HEADER_BYTES: usize = 64 * 1024;
const START: &[u8] = &[0, 0, 0, 1];

/// Converts MFT sample framing into complete Annex-B access units. Encoded bytes
/// stay in memory; parameter-set caches are bounded and never logged/serialized.
pub(super) struct H264Normalizer {
    parameter_sets: Vec<u8>,
    length_size: usize,
}

impl H264Normalizer {
    pub fn new(header: &[u8]) -> Result<Self, EncodedVideoError> {
        let mut normalizer = Self {
            parameter_sets: vec![],
            length_size: 4,
        };
        if header.len() > MAX_HEADER_BYTES {
            return Err(EncodedVideoError::Oversized);
        }
        if header.is_empty() {
            return Ok(normalizer);
        }
        if prefix(header, 0).is_some() {
            normalizer.parameter_sets = extract_parameters(&annex_nals(header)?)?;
        } else {
            // AVCDecoderConfigurationRecord, including its negotiated length size.
            if header.len() < 7 || header[0] != 1 {
                return Err(EncodedVideoError::InvalidAnnexB);
            }
            normalizer.length_size = usize::from(header[4] & 3) + 1;
            if normalizer.length_size == 3 {
                return Err(EncodedVideoError::InvalidAnnexB);
            }
            let mut cursor = 6;
            let mut nals = Vec::new();
            for _ in 0..header[5] & 31 {
                nals.push(read_nal(header, &mut cursor, 2)?);
            }
            let count = *header.get(cursor).ok_or(EncodedVideoError::InvalidAnnexB)?;
            cursor += 1;
            if count > 32 {
                return Err(EncodedVideoError::InvalidAnnexB);
            }
            for _ in 0..count {
                nals.push(read_nal(header, &mut cursor, 2)?);
            }
            normalizer.parameter_sets = extract_parameters(&nals)?;
        }
        if normalizer.parameter_sets.is_empty() {
            return Err(EncodedVideoError::MissingParameterSets);
        }

        Ok(normalizer)
    }

    pub fn has_parameter_sets(&self) -> bool {
        !self.parameter_sets.is_empty()
    }

    /// Read negotiated metadata lazily: some native transforms can be observed
    /// without an initial header. In-band SPS/PPS also satisfy the same cache.
    pub fn refresh_missing_header<E>(
        &mut self,
        read_header: impl FnOnce() -> Result<Self, E>,
    ) -> Result<(), E> {
        if !self.has_parameter_sets() {
            *self = read_header()?;
        }
        Ok(())
    }

    pub fn normalize(&mut self, bytes: &[u8]) -> Result<Vec<u8>, EncodedVideoError> {
        if bytes.is_empty() || bytes.len() > MAX_ACCESS_UNIT_BYTES {
            return Err(EncodedVideoError::Oversized);
        }
        let nals = if prefix(bytes, 0).is_some() {
            annex_nals(bytes)?
        } else {
            let mut nals = Vec::new();
            let mut cursor = 0;
            while cursor < bytes.len() {
                if nals.len() >= 512 {
                    return Err(EncodedVideoError::InvalidAnnexB);
                }
                nals.push(read_nal(bytes, &mut cursor, self.length_size)?);
            }
            nals
        };
        let parameters = extract_parameters(&nals)?;
        if !parameters.is_empty() {
            self.parameter_sets = parameters;
        }
        let idr = nals.iter().any(|nal| nal[0] & 31 == 5);
        let has_parameters =
            nals.iter().any(|nal| nal[0] & 31 == 7) && nals.iter().any(|nal| nal[0] & 31 == 8);
        let mut output = Vec::new();
        if idr && !has_parameters {
            if self.parameter_sets.is_empty() {
                return Err(EncodedVideoError::MissingParameterSets);
            }
            output.extend_from_slice(&self.parameter_sets);
        }
        for nal in nals {
            if output
                .len()
                .saturating_add(START.len())
                .saturating_add(nal.len())
                > MAX_ACCESS_UNIT_BYTES
            {
                return Err(EncodedVideoError::Oversized);
            }
            output.extend_from_slice(START);
            output.extend_from_slice(nal);
        }

        Ok(output)
    }
}

fn extract_parameters(nals: &[&[u8]]) -> Result<Vec<u8>, EncodedVideoError> {
    // The selected H.264 Baseline profile excludes B slices independently of
    // optional vendor CodecAPI controls. Reject ignored/mutated profile requests.
    for nal in nals.iter().filter(|nal| nal[0] & 31 == 7) {
        if nal.len() < 4 || nal[1] != 66 {
            return Err(EncodedVideoError::InvalidAnnexB);
        }
    }
    let has_sps = nals.iter().any(|nal| nal[0] & 31 == 7);
    let has_pps = nals.iter().any(|nal| nal[0] & 31 == 8);
    // Never replace a complete pair with one half of a changed configuration.
    if has_sps != has_pps {
        return Err(EncodedVideoError::MissingParameterSets);
    }
    let mut parameters = Vec::new();
    for nal in nals {
        if matches!(nal[0] & 31, 7 | 8) {
            if parameters.len().saturating_add(4).saturating_add(nal.len()) > MAX_HEADER_BYTES {
                return Err(EncodedVideoError::Oversized);
            }
            parameters.extend_from_slice(START);
            parameters.extend_from_slice(nal);
        }
    }

    Ok(parameters)
}

fn annex_nals(bytes: &[u8]) -> Result<Vec<&[u8]>, EncodedVideoError> {
    let mut nals = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if nals.len() >= 512 {
            return Err(EncodedVideoError::InvalidAnnexB);
        }
        let start = cursor + prefix(bytes, cursor).ok_or(EncodedVideoError::InvalidAnnexB)?;
        let end = (start..bytes.len())
            .find(|index| prefix(bytes, *index).is_some())
            .unwrap_or(bytes.len());
        let nal = bytes
            .get(start..end)
            .ok_or(EncodedVideoError::InvalidAnnexB)?;
        validate_nal(nal)?;
        nals.push(nal);
        cursor = end;
    }
    Ok(nals)
}

fn read_nal<'a>(
    bytes: &'a [u8],
    cursor: &mut usize,
    width: usize,
) -> Result<&'a [u8], EncodedVideoError> {
    let length_bytes = bytes
        .get(*cursor..cursor.saturating_add(width))
        .ok_or(EncodedVideoError::InvalidAnnexB)?;
    let length = length_bytes
        .iter()
        .fold(0_usize, |value, byte| (value << 8) | usize::from(*byte));
    *cursor += width;
    let nal = bytes
        .get(*cursor..cursor.saturating_add(length))
        .ok_or(EncodedVideoError::InvalidAnnexB)?;
    validate_nal(nal)?;
    *cursor += length;
    Ok(nal)
}

fn validate_nal(nal: &[u8]) -> Result<(), EncodedVideoError> {
    if nal.len() < 2 || nal[0] & 128 != 0 || !(1..=23).contains(&(nal[0] & 31)) {
        return Err(EncodedVideoError::InvalidAnnexB);
    }
    Ok(())
}

fn prefix(bytes: &[u8], cursor: usize) -> Option<usize> {
    if bytes.get(cursor..cursor + 4) == Some(START) {
        Some(4)
    } else if bytes.get(cursor..cursor + 3) == Some(&[0, 0, 1]) {
        Some(3)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_domain::{EncodedAccessUnit, VideoProfile};

    #[test]
    fn annex_b_header_is_repeated_for_idr_and_preserves_delta_samples() {
        let mut normalizer =
            H264Normalizer::new(&[0, 0, 1, 0x67, 66, 0, 30, 0, 0, 1, 0x68, 42]).expect("SPS/PPS");
        let bytes = normalizer
            .normalize(&[0, 0, 1, 0x65, 42])
            .expect("IDR normalized");
        let profile = VideoProfile::new(1080, 60).expect("valid profile");
        assert!(
            EncodedAccessUnit::h264(bytes, profile, 0)
                .expect("complete unit")
                .is_keyframe()
        );
        assert_eq!(
            normalizer.normalize(&[0, 0, 1, 0x41, 42]).expect("delta"),
            [0, 0, 0, 1, 0x41, 42]
        );
    }

    #[test]
    fn avcc_header_and_length_prefixed_sample_are_converted() {
        let header = [
            1, 66, 0, 30, 255, 225, 0, 4, 0x67, 66, 0, 30, 1, 0, 2, 0x68, 42,
        ];
        let mut normalizer = H264Normalizer::new(&header).expect("valid AVC configuration");
        let bytes = normalizer
            .normalize(&[0, 0, 0, 2, 0x65, 42])
            .expect("length-prefixed IDR");
        assert!(
            EncodedAccessUnit::h264(bytes, VideoProfile::new(720, 30).expect("profile"), 0).is_ok()
        );
    }

    #[test]
    fn delayed_negotiated_header_is_read_before_idr_and_cached_afterwards() {
        let mut normalizer = H264Normalizer::new(&[]).expect("initial header absent");
        let sample = [0, 0, 0, 2, 0x65, 42];
        assert!(!normalizer.has_parameter_sets());
        assert!(matches!(
            normalizer.normalize(&sample),
            Err(EncodedVideoError::MissingParameterSets)
        ));
        let mut reads = 0;
        let header = [
            1, 66, 0, 30, 255, 225, 0, 4, 0x67, 66, 0, 30, 1, 0, 2, 0x68, 42,
        ];
        normalizer
            .refresh_missing_header(|| {
                reads += 1;
                H264Normalizer::new(&header)
            })
            .expect("metadata became available with output");
        assert!(normalizer.has_parameter_sets());
        let bytes = normalizer
            .normalize(&sample)
            .expect("complete normalized IDR");
        assert!(
            EncodedAccessUnit::h264(bytes, VideoProfile::new(1080, 60).expect("profile"), 0)
                .expect("framed output")
                .is_keyframe()
        );
        normalizer
            .refresh_missing_header(|| {
                reads += 1;
                Err(EncodedVideoError::InvalidAnnexB)
            })
            .expect("known parameters skip further metadata reads");
        assert_eq!(reads, 1);
    }

    #[test]
    fn first_in_band_parameters_are_preserved_when_metadata_remains_absent() {
        let mut normalizer = H264Normalizer::new(&[]).expect("header absent");
        normalizer
            .refresh_missing_header(|| H264Normalizer::new(&[]))
            .expect("metadata still absent");
        assert!(!normalizer.has_parameter_sets());
        let sample = [
            0, 0, 1, 0x67, 66, 0, 30, 0, 0, 1, 0x68, 42, 0, 0, 1, 0x65, 42,
        ];
        normalizer.normalize(&sample).expect("in-band SPS/PPS/IDR");
        assert!(normalizer.has_parameter_sets());
        normalizer
            .refresh_missing_header(|| Err(EncodedVideoError::InvalidAnnexB))
            .expect("in-band parameter cache skips metadata");
    }

    #[test]
    fn malformed_and_unbounded_samples_fail_without_inventing_parameter_sets() {
        assert!(H264Normalizer::new(&[1, 2, 3]).is_err());
        assert!(H264Normalizer::new(&vec![0; MAX_HEADER_BYTES + 1]).is_err());
        let mut normalizer = H264Normalizer::new(&[]).expect("header may arrive with first IDR");
        for sample in [
            vec![0, 0, 1, 0x65, 42],
            vec![0, 0, 0, 10, 0x41, 42],
            vec![0, 0, 1],
            vec![0, 0, 1, 0x67, 42],
        ] {
            assert!(normalizer.normalize(&sample).is_err());
        }
        assert!(
            normalizer
                .normalize(&vec![0; MAX_ACCESS_UNIT_BYTES + 1])
                .is_err()
        );
    }

    #[test]
    fn rejects_non_baseline_or_truncated_parameter_sets_at_startup_and_during_streaming() {
        for profile in [77, 88, 100, 110, 122, 244] {
            let header = [0, 0, 1, 0x67, profile, 0, 30, 0, 0, 1, 0x68, 42];
            assert!(H264Normalizer::new(&header).is_err());
            let mut baseline =
                H264Normalizer::new(&[0, 0, 1, 0x67, 66, 0, 30, 0, 0, 1, 0x68, 42]).unwrap();
            assert!(baseline.normalize(&header).is_err());
        }
        for header in [
            vec![0, 0, 1, 0x67, 0, 0, 1, 0x68, 42],
            vec![0, 0, 1, 0x67, 66, 0, 0, 1, 0x68, 42],
        ] {
            assert!(H264Normalizer::new(&header).is_err());
        }
    }
}
