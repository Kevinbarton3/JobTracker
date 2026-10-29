use std::io::{Read, Write};
pub const MAX_MESSAGE: usize = 128 * 1024;
pub const EXTENSION_ID: &str = include_str!("../../chrome-extension/extension-id.txt");
pub fn read_frame(r: &mut impl Read) -> Result<Vec<u8>, String> {
    let mut len = [0; 4];
    r.read_exact(&mut len)
        .map_err(|_| "Incomplete message header")?;
    let n = u32::from_le_bytes(len) as usize;
    if n == 0 || n > MAX_MESSAGE {
        return Err("Invalid message length".into());
    }
    let mut data = vec![0; n];
    r.read_exact(&mut data).map_err(|_| "Incomplete message")?;
    Ok(data)
}
pub fn write_frame(w: &mut impl Write, data: &[u8]) -> Result<(), String> {
    if data.is_empty() || data.len() > MAX_MESSAGE {
        return Err("Invalid message length".into());
    }
    w.write_all(&(data.len() as u32).to_le_bytes())
        .and_then(|_| w.write_all(data))
        .and_then(|_| w.flush())
        .map_err(|_| "Could not deliver message".into())
}
#[cfg(windows)]
mod win {
    use super::*;
    use std::{
        ptr,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::*,
        Security::{Authorization::*, SECURITY_ATTRIBUTES},
        Storage::FileSystem::*,
        System::Pipes::*,
    };
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }
    fn name() -> Vec<u16> {
        use sha2::{Digest, Sha256};
        let identity = format!(
            "{}\\{}",
            std::env::var("USERDOMAIN").unwrap_or_default(),
            std::env::var("USERNAME").unwrap_or_default()
        );
        let hash = Sha256::digest(identity.as_bytes());
        wide(&format!(
            "\\\\.\\pipe\\JobTrackerCapture{}-{:x}",
            if cfg!(test) { "-Test" } else { "" },
            hash
        ))
    }
    struct Pipe(HANDLE);
    impl Pipe {
        fn handle(&self) -> HANDLE {
            self.0
        }
    }
    unsafe impl Send for Pipe {}
    impl Drop for Pipe {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    fn read(pipe: HANDLE, n: usize, deadline: Instant) -> Result<Vec<u8>, String> {
        let mut out = vec![0; n];
        let mut offset = 0;
        while offset < n {
            let mut count = 0;
            let ok = unsafe {
                ReadFile(
                    pipe,
                    out[offset..].as_mut_ptr(),
                    (n - offset) as u32,
                    &mut count,
                    ptr::null_mut(),
                )
            };
            if ok != 0 && count > 0 {
                offset += count as usize;
            } else {
                let error = unsafe { GetLastError() };
                if error != ERROR_NO_DATA && error != ERROR_PIPE_LISTENING {
                    return Err("Desktop pipe disconnected".into());
                }
                if Instant::now() > deadline {
                    return Err("Desktop response timed out".into());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        Ok(out)
    }
    fn receive(pipe: HANDLE) -> Result<Vec<u8>, String> {
        let deadline = Instant::now() + Duration::from_secs(20);
        let header = read(pipe, 4, deadline)?;
        let n = u32::from_le_bytes(header.try_into().unwrap()) as usize;
        if n == 0 || n > MAX_MESSAGE {
            return Err("Invalid message length".into());
        }
        read(pipe, n, deadline)
    }
    fn send(pipe: HANDLE, data: &[u8]) -> Result<(), String> {
        let mut frame = Vec::new();
        write_frame(&mut frame, data)?;
        let mut offset = 0;
        let deadline = Instant::now() + Duration::from_secs(20);
        while offset < frame.len() {
            let mut n = 0;
            let ok = unsafe {
                WriteFile(
                    pipe,
                    frame[offset..].as_ptr(),
                    (frame.len() - offset) as u32,
                    &mut n,
                    ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err("Desktop pipe write failed".into());
            }
            offset += n as usize;
            if Instant::now() > deadline {
                return Err("Desktop write timed out".into());
            }
            if n == 0 {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        Ok(())
    }
    pub fn exchange(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let h = CreateFileW(
                name().as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                ptr::null(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            );
            if h == INVALID_HANDLE_VALUE {
                return Err("JobTracker is not running".into());
            }
            let p = Pipe(h);
            let mode = PIPE_READMODE_BYTE | PIPE_NOWAIT;
            if SetNamedPipeHandleState(h, &mode, ptr::null(), ptr::null()) == 0 {
                return Err("Cannot configure desktop connection".into());
            }
            send(p.handle(), data)?;
            let reply = receive(p.handle())?;
            send(p.handle(), b"{}")?;
            Ok(reply)
        }
    }
    pub fn serve(handler: impl Fn(&[u8]) -> Vec<u8> + Send + 'static) -> Result<(), String> {
        // OW means owner rights. The pipe owner is the creating Windows user; remote clients are rejected.
        unsafe {
            let mut descriptor = ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide("D:P(A;;GA;;;OW)").as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                ptr::null_mut(),
            ) == 0
            {
                return Err("Cannot create current-user pipe permissions".into());
            }
            let sa = SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: 0,
            };
            let h = CreateNamedPipeW(
                name().as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                MAX_MESSAGE as u32 + 4,
                MAX_MESSAGE as u32 + 4,
                0,
                &sa,
            );
            LocalFree(descriptor);
            if h == INVALID_HANDLE_VALUE {
                return Err("Cannot start Chrome capture bridge".into());
            }
            let p = Pipe(h);
            std::thread::spawn(move || loop {
                let connected = ConnectNamedPipe(p.handle(), ptr::null_mut()) != 0
                    || GetLastError() == ERROR_PIPE_CONNECTED;
                if !connected {
                    std::thread::sleep(Duration::from_millis(50));
                    continue;
                }
                if let Ok(data) = receive(p.handle()) {
                    let reply = handler(&data);
                    if send(p.handle(), &reply).is_ok() {
                        let _ = receive(p.handle());
                    }
                }
                DisconnectNamedPipe(p.handle());
            });
            Ok(())
        }
    }
}
#[cfg(windows)]
pub use win::{exchange, serve};
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn framing_rejects_invalid_lengths_and_truncation() {
        for n in [0u32, MAX_MESSAGE as u32 + 1] {
            assert!(read_frame(&mut &n.to_le_bytes()[..]).is_err());
        }
        assert!(read_frame(&mut &[4, 0, 0, 0, 1][..]).is_err());
    }
    #[test]
    fn framing_roundtrip() {
        let mut bytes = Vec::new();
        write_frame(&mut bytes, b"hello").unwrap();
        assert_eq!(read_frame(&mut bytes.as_slice()).unwrap(), b"hello");
    }
}
