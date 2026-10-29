# JobTracker Capture for Chrome

1. Build the standalone desktop app and helper from the project folder:
   `npm run build`
   `cargo build --manifest-path src-tauri/Cargo.toml --release --features custom-protocol --bins`
2. Run `src-tauri/target/release/job-application-tracker.exe`. This build embeds the frontend and does not need a Vite server.
3. In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose this `chrome-extension` directory.
4. In JobTracker Settings → Chrome extension, select **Install Chrome connection**. This registers only this extension for the current Windows user. No administrator access is needed.
5. Pin **JobTracker Capture** in Chrome. On a job posting, click it, review the fields, and choose **Save job** or **I applied**.

The committed public key fixes the extension ID. Do not regenerate it after installation. The helper and desktop executable must stay together at the registered location; rerun Install Chrome connection if they move.

Capture reads only the page invoked by the toolbar click. Some sites omit details or change their page layout; missing fields remain editable. The extension does not submit applications, monitor browsing, read cookies, or upload postings to an AI service.

Preview drafts are stored locally in Chrome so a failed connection does not lose edits. Capturing the page again replaces that tab's preview. Chrome extension storage is separate from JobTracker backups. Uninstalling the extension removes its drafts.

To remove the desktop connection, delete the current-user registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jobtrack.capture`; application records are unaffected.
