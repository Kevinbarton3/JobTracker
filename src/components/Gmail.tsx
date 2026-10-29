import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  gmail,
  type GmailStatus,
  type GmailMessage,
  type GmailAction,
} from '../services/gmailService';
import type { JobApplication } from '../types/application';
import { applicationService } from '../services/applicationService';
import { ConfirmationDialog } from './ui';

function useGmail() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const refresh = () =>
    gmail<GmailStatus>('status')
      .then(setStatus)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    let disposed = false;
    let stop: undefined | (() => void);
    void refresh();
    void listen('gmail-changed', () => {
      if (!disposed) void refresh();
    })
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      })
      .catch(() => undefined);
    const timer = setInterval(refresh, 5000);
    return () => {
      disposed = true;
      stop?.();
      clearInterval(timer);
    };
  }, []);
  const act = async (action: GmailAction, args: Parameters<typeof gmail>[1] = {}) => {
    setWorking(true);
    setError('');
    try {
      await gmail(action, args);
      await refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setWorking(false);
    }
  };
  return { status, error, working, act };
}
export function GmailSettings() {
  const { status, error, working, act } = useGmail();
  const [confirm, setConfirm] = useState(false);
  const connected = status?.accounts.find((a) => !a.reconnect);
  const busy = working || status?.busy;
  return (
    <section className="panel settings-card align-start">
      <div className="settings-content gmail-settings">
        <h2>Gmail</h2>
        <p>
          Connect your job-search Gmail account independently of ChatGPT. Matching runs locally;
          Google is contacted to read email. Imported previews are included in local backups.
          Credentials stay in Windows Credential Manager.
        </p>
        <details>
          <summary>One-time Google setup</summary>
          <ol>
            <li>Create a project in Google Cloud Console and enable the Gmail API.</li>
            <li>
              Configure Google Auth Platform for personal use. If the project is in Testing, add
              your job-search Gmail address as a test user.
            </li>
            <li>
              Create an OAuth client with application type <strong>Desktop app</strong> and download
              its JSON file.
            </li>
            <li>
              Import that file below, then Connect and choose your job-search account in your
              browser.
            </li>
          </ol>
          <p>
            Google Testing-mode authorization may expire after seven days. Use Reconnect if needed.
            Public distribution requires a separate Google verification review.
          </p>
          <button
            className="text-button"
            onClick={() =>
              void applicationService
                .openUrl('https://console.cloud.google.com/apis/credentials')
                .catch(() => undefined)
            }
          >
            Open Google Cloud Console
          </button>
        </details>
        {status?.accounts.map((a) => (
          <p key={a.address}>
            <strong>{a.address}</strong> — {a.reconnect ? 'Reconnect required' : 'Connected'}
            <br />
            Last successful sync:{' '}
            {a.lastSync
              ? new Date(a.lastSync.replace(' ', 'T') + 'Z').toLocaleString()
              : 'Not synced yet'}
          </p>
        ))}
        {!status?.accounts.length && <p>No Gmail account connected.</p>}
        <p>
          First scan: last 90 days. Checks every five minutes while running, including in the system
          tray. Closing the window hides JobTracker; use the tray menu to Quit.
        </p>
        {(error || status?.error) && (
          <p role="alert" className="error-message">
            {error || status?.error}
          </p>
        )}
        <div className="settings-actions">
          <button
            className="button secondary"
            disabled={busy || !!connected}
            onClick={() => void act('import')}
          >
            Import Google client JSON
          </button>
          <button
            className="button primary"
            disabled={busy || !status?.configured}
            onClick={() => void act('connect')}
          >
            {status?.accounts.length ? 'Reconnect / change account' : 'Connect Gmail'}
          </button>
          <button
            className="button secondary"
            disabled={busy || !connected}
            onClick={() => void act('sync')}
          >
            Sync now
          </button>
          <button
            className="button secondary"
            disabled={busy || !connected}
            onClick={() => void act('disconnect')}
          >
            Disconnect
          </button>
        </div>
        {busy && (
          <p role="status">
            {status?.progress || 'Gmail operation in progress…'}{' '}
            <button className="text-button" onClick={() => void gmail('cancel')}>
              Cancel operation
            </button>
          </p>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={status?.autostart ?? false}
            disabled={busy || !status}
            onChange={(e) => void act('autostart', { enabled: e.target.checked })}
          />
          Start in the tray at Windows sign-in
        </label>
        <button
          className="button danger-outline small"
          disabled={busy || !status?.accounts.length}
          onClick={() => setConfirm(true)}
        >
          Remove imported email data
        </button>
        <ConfirmationDialog
          open={confirm}
          title="Remove imported email data?"
          message="This disconnects Gmail and removes imported messages and suggestions from JobTracker. Your Gmail mailbox and applications are unchanged. Existing backups retain their copies."
          confirmLabel="Remove email data"
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            void act('clear');
          }}
        />
      </div>
    </section>
  );
}
export function EmailInbox({
  applications,
  onChanged,
  applicationId,
}: {
  applications: JobApplication[];
  onChanged?: () => void;
  applicationId?: number;
}) {
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const refresh = () =>
    gmail<GmailMessage[]>('messages')
      .then(setMessages)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    let disposed = false;
    let stop: undefined | (() => void);
    void refresh();
    void listen('gmail-changed', () => {
      if (!disposed) void refresh();
    })
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  const act = async (action: GmailAction, id: number, applicationId?: number) => {
    setBusy(true);
    setError('');
    try {
      await gmail(action, { id, applicationId });
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const visible = messages.filter((m) =>
    applicationId ? m.applicationId === applicationId : showIgnored || m.disposition !== 'ignored',
  );
  return (
    <section className="panel email-inbox">
      <div className="panel-heading">
        <div>
          <h2>{applicationId ? 'Email activity' : 'Email inbox'}</h2>
          <p>
            {applicationId
              ? 'Company responses linked to this application'
              : 'Review uncertain matches. Linked messages appear with their applications.'}
          </p>
        </div>
        {!applicationId && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={showIgnored}
              onChange={(e) => setShowIgnored(e.target.checked)}
            />
            Show ignored
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!visible.length && (
        <p className="padded-empty">
          No imported messages here yet. Connect Gmail in Settings to start.
        </p>
      )}
      {visible.map((m) => (
        <article className="email-message" key={m.id}>
          <h3>{m.subject || '(No subject)'}</h3>
          <p className="email-meta">
            {m.sender} · {new Date(m.receivedAt).toLocaleString()}
            <br />
            Account: {m.account}
          </p>
          <p>{m.preview}</p>
          <div className="settings-actions">
            <select
              aria-label={`Application for ${m.subject}`}
              disabled={busy}
              value={m.applicationId ?? ''}
              onChange={(e) => {
                if (e.target.value) void act('link', m.id, Number(e.target.value));
              }}
            >
              <option value="">Choose application to attach…</option>
              {applications.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.company} — {a.position}
                </option>
              ))}
            </select>
            <button
              className="button ghost"
              disabled={busy}
              onClick={() => void act('ignore', m.id)}
            >
              Ignore
            </button>
            <button
              className="button secondary"
              onClick={() =>
                void applicationService
                  .openUrl(
                    `https://mail.google.com/mail/?authuser=${encodeURIComponent(m.account)}#all/${encodeURIComponent(m.gmailId)}`,
                  )
                  .catch((e) => setError(String(e)))
              }
            >
              Open in Gmail
            </button>
          </div>
          {m.applicationId && m.suggestedStatus && m.suggestionState === 'pending' && (
            <div className="email-suggestion">
              <strong>Suggested status: {m.suggestedStatus}</strong>
              <blockquote>{m.excerpt}</blockquote>
              <button
                className="button primary small"
                disabled={busy}
                onClick={() => void act('apply', m.id)}
              >
                Apply status
              </button>{' '}
              <button
                className="button secondary small"
                disabled={busy}
                onClick={() => void act('dismiss', m.id)}
              >
                Dismiss
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
