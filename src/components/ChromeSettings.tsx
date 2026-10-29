import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
interface Status {
  connected: boolean;
  helperAvailable: boolean;
  registered: boolean;
  extensionId: string;
}
export function ChromeSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const check = async (install: boolean) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await invoke<Status>('capture_setup', { install }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel settings-card">
      <div className="settings-content">
        <h2>Chrome extension</h2>
        <p>
          Capture the posting you are viewing, review its details, then choose Save job or I
          applied.
        </p>
        <ol>
          <li>Open chrome://extensions in Chrome and enable Developer mode.</li>
          <li>
            Choose Load unpacked and select the chrome-extension folder inside your JobTracker
            project.
          </li>
          <li>Click Install Chrome connection below, then pin JobTracker Capture in Chrome.</li>
          <li>Open a job posting and click the extension button.</li>
        </ol>
        <div className="settings-actions">
          <button className="button primary" disabled={busy} onClick={() => void check(true)}>
            Install Chrome connection
          </button>
          <button className="button secondary" disabled={busy} onClick={() => void check(false)}>
            Test desktop connection
          </button>
        </div>
        {status && (
          <p role="status">
            Desktop bridge: {status.connected ? 'Connected' : 'Unavailable'} · Native host:{' '}
            {status.helperAvailable ? 'Available' : 'Needs build'} · Registration:{' '}
            {status.registered ? 'Present' : 'Not installed'}
            <br />
            Extension ID: {status.extensionId}
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
