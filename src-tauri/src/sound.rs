// The Windows multimedia API plays a tiny generated WAV. No audio files,
// browser autoplay permissions, network requests or audio runtime dependency.
#[cfg(target_os = "windows")]
mod platform {
    use std::{f64::consts::PI, sync::OnceLock};
    #[link(name = "winmm")]
    extern "system" {
        fn PlaySoundW(sound: *const u16, module: *mut std::ffi::c_void, flags: u32) -> i32;
    }
    static CHIME: OnceLock<Vec<u8>> = OnceLock::new();

    fn wave() -> Vec<u8> {
        let rate = 22050u32;
        let count = (f64::from(rate) * 1.2) as usize;
        let bytes = (count * 2) as u32;
        let mut out = Vec::with_capacity(bytes as usize + 44);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(bytes + 36).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&bytes.to_le_bytes());
        for i in 0..count {
            let t = i as f64 / f64::from(rate);
            let mut sample = 0.0;
            for (start, frequency) in [(0.0, 784.0), (0.18, 1046.5)] {
                let age = t - start;
                if (0.0..0.32).contains(&age) {
                    let envelope = (age / 0.015).min(1.0) * (-age * 13.0).exp();
                    sample += (2.0 * PI * frequency * age).sin() * envelope * 0.18;
                }
            }
            out.extend_from_slice(&((sample * f64::from(i16::MAX)) as i16).to_le_bytes());
        }
        out
    }

    pub fn set_playing(playing: bool) {
        // SND_ASYNC | SND_MEMORY | SND_LOOP | SND_NODEFAULT.
        // The buffer remains allocated for the entire process lifetime.
        unsafe {
            if playing {
                let wave = CHIME.get_or_init(wave);
                PlaySoundW(
                    wave.as_ptr().cast(),
                    std::ptr::null_mut(),
                    0x0001 | 0x0004 | 0x0008 | 0x0002,
                );
            } else {
                PlaySoundW(std::ptr::null(), std::ptr::null_mut(), 0);
            }
        }
    }
}

pub fn set_playing(playing: bool) {
    #[cfg(target_os = "windows")]
    platform::set_playing(playing);
    #[cfg(not(target_os = "windows"))]
    let _ = playing;
}
