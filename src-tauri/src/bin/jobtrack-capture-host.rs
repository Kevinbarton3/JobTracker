use job_application_tracker_lib::capture_transport::*;
use serde_json::json;
fn run() -> Result<Vec<u8>, String> {
    let origin = std::env::args().nth(1).ok_or("Missing extension origin")?;
    if origin != format!("chrome-extension://{}/", EXTENSION_ID.trim()) {
        return Err("Unauthorized extension".into());
    }
    let data = read_frame(&mut std::io::stdin())?;
    #[cfg(windows)]
    {
        if let Ok(reply) = exchange(&data) {
            return Ok(reply);
        }
        let exe = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .with_file_name("job-application-tracker.exe");
        if !exe.is_file() {
            return Err("Desktop executable is missing. Reinstall the Chrome connection from JobTracker Settings.".into());
        }
        // Chrome's original handles may remain inheritable even with redirected stdio.
        // Remove inheritance so the desktop cannot keep the native response pipe alive.
        use std::os::windows::io::AsRawHandle;
        for handle in [
            std::io::stdin().as_raw_handle(),
            std::io::stdout().as_raw_handle(),
            std::io::stderr().as_raw_handle(),
        ] {
            unsafe {
                windows_sys::Win32::Foundation::SetHandleInformation(
                    handle,
                    windows_sys::Win32::Foundation::HANDLE_FLAG_INHERIT,
                    0,
                );
            }
        }
        std::process::Command::new(exe)
            .arg("--background")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|_| "Could not start JobTracker")?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(25);
        loop {
            if let Ok(reply) = exchange(&data) {
                return Ok(reply);
            }
            if std::time::Instant::now() > deadline {
                return Err(
                    "JobTracker could not be reached. Open the desktop app and retry.".into(),
                );
            }
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
    }
    #[cfg(not(windows))]
    Err("Chrome capture currently supports Windows only".into())
}
fn main() {
    let reply =
        run().unwrap_or_else(|e| serde_json::to_vec(&json!({"ok":false,"error":e})).unwrap());
    let _ = write_frame(&mut std::io::stdout(), &reply);
}
