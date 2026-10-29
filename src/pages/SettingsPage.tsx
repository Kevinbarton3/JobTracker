import { ChromeSettings } from '../components/ChromeSettings';
import { GmailSettings } from '../components/Gmail';
import {
  Database,
  Download,
  Info,
  Laptop,
  Moon,
  RotateCcw,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import type { ImportPreview } from '../types/application';

export type Theme = 'system' | 'light' | 'dark';
interface Props {
  databasePath: string;
  backups: string[];
  busy: boolean;
  theme: Theme;
  importPreview: ImportPreview | null;
  onTheme: (theme: Theme) => void;
  onSamples: () => void;
  onDeleteAll: () => void;
  onBackup: (path?: string) => void;
  onRestore: (path: string) => void;
  onExport: (path?: string) => void;
  onPreviewImport: (path: string) => void;
  onImport: (path: string) => void;
}

export function SettingsPage({
  databasePath,
  backups,
  busy,
  theme,
  importPreview,
  onTheme,
  onSamples,
  onDeleteAll,
  onBackup,
  onRestore,
  onExport,
  onPreviewImport,
  onImport,
}: Props) {
  const [backupPath, setBackupPath] = useState('');
  const [restorePath, setRestorePath] = useState('');
  const [exportPath, setExportPath] = useState('');
  const [importPath, setImportPath] = useState('');
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1>Settings</h1>
          <p>Protect your data and personalize JobTrack.</p>
        </div>
      </header>
      <div className="settings-stack">
        <ChromeSettings />
        <GmailSettings />
        <section className="panel settings-card align-start">
          <span className="settings-icon">
            <ShieldCheck size={21} />
          </span>
          <div className="settings-content">
            <h2>Backups</h2>
            <p>
              JobTrack creates one automatic backup per day with your database and managed resumes,
              and retains the latest 14.
            </p>
            <label className="field">
              <span>Optional backup destination</span>
              <input
                value={backupPath}
                onChange={(event) => setBackupPath(event.target.value)}
                placeholder="Leave blank to use the automatic backup folder"
              />
            </label>
            <div className="settings-actions">
              <button
                className="button primary"
                disabled={busy}
                onClick={() => onBackup(backupPath || undefined)}
              >
                <Download size={17} />
                Create backup
              </button>
            </div>
            {backups.length > 0 && (
              <>
                <h3 className="settings-subtitle">Recent backups</h3>
                <div className="backup-list">
                  {backups.slice(0, 5).map((path) => (
                    <button key={path} onClick={() => setRestorePath(path)}>
                      {path}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
        <section className="panel settings-card align-start">
          <span className="settings-icon">
            <RotateCcw size={21} />
          </span>
          <div className="settings-content">
            <h2>Restore</h2>
            <p>
              Restoring first creates a safety backup. JobTrack archives restore managed resumes;
              legacy .db backups remain supported.
            </p>
            <label className="field">
              <span>Backup file path</span>
              <input
                value={restorePath}
                onChange={(event) => setRestorePath(event.target.value)}
                placeholder="C:\path\to\jobtrack-backup.jobtrack"
              />
            </label>
            <button
              className="button danger-outline"
              disabled={busy || !restorePath.trim()}
              onClick={() => onRestore(restorePath)}
            >
              <RotateCcw size={17} />
              Restore backup
            </button>
          </div>
        </section>
        <section className="panel settings-card align-start">
          <span className="settings-icon">
            <Database size={21} />
          </span>
          <div className="settings-content">
            <h2>CSV portability</h2>
            <p>
              Export applications for spreadsheets or import a JobTrack-formatted CSV. Imports are
              previewed and duplicate rows are skipped.
            </p>
            <div className="settings-two-column">
              <div>
                <label className="field">
                  <span>Optional export path</span>
                  <input
                    value={exportPath}
                    onChange={(event) => setExportPath(event.target.value)}
                    placeholder="Leave blank for the exports folder"
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => onExport(exportPath || undefined)}
                >
                  <Download size={17} />
                  Export CSV
                </button>
              </div>
              <div>
                <label className="field">
                  <span>CSV file to import</span>
                  <input
                    value={importPath}
                    onChange={(event) => setImportPath(event.target.value)}
                    placeholder="C:\path\to\applications.csv"
                  />
                </label>
                <div className="settings-actions">
                  <button
                    className="button secondary"
                    disabled={busy || !importPath.trim()}
                    onClick={() => onPreviewImport(importPath)}
                  >
                    <Upload size={17} />
                    Preview
                  </button>
                  {importPreview && (
                    <button
                      className="button primary"
                      disabled={
                        busy || importPreview.valid === 0 || importPreview.errors.length > 0
                      }
                      onClick={() => onImport(importPath)}
                    >
                      Import {importPreview.valid - importPreview.duplicates}
                    </button>
                  )}
                </div>
                {importPreview && (
                  <div className="import-preview">
                    <strong>
                      {importPreview.valid} valid · {importPreview.duplicates} duplicates ·{' '}
                      {importPreview.errors.length} errors
                    </strong>
                    {importPreview.errors.slice(0, 3).map((error) => (
                      <small key={error}>{error}</small>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
        <section className="panel settings-card align-start">
          <span className="settings-icon">
            {theme === 'dark' ? <Moon size={21} /> : <Sun size={21} />}
          </span>
          <div className="settings-content">
            <h2>Appearance</h2>
            <p>Choose a theme or follow the Windows setting.</p>
            <div className="segmented-control">
              {(['system', 'light', 'dark'] as Theme[]).map((value) => (
                <button
                  key={value}
                  className={theme === value ? 'active' : ''}
                  onClick={() => onTheme(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section className="panel settings-card align-start">
          <span className="settings-icon">
            <Database size={21} />
          </span>
          <div className="settings-content">
            <h2>Local database</h2>
            <p>
              Your database is stored on this computer. Optional Gmail sync reads messages from
              Google.
            </p>
            <code className="path-box">{databasePath || 'Loading database location…'}</code>
            <div className="settings-actions">
              <button className="button secondary" disabled={busy} onClick={onSamples}>
                <RotateCcw size={17} />
                Insert sample data
              </button>
              <button className="button danger-outline" disabled={busy} onClick={onDeleteAll}>
                <Trash2 size={17} />
                Delete all data
              </button>
            </div>
          </div>
        </section>
        <section className="panel settings-card">
          <span className="settings-icon">
            <Laptop size={21} />
          </span>
          <div>
            <h2>Application</h2>
            <p>JobTrack v2.0.0 — private, offline-first job search workspace</p>
          </div>
        </section>
        <section className="panel settings-card align-start">
          <span className="settings-icon">
            <Info size={21} />
          </span>
          <div>
            <h2>Keyboard shortcuts</h2>
            <p>
              <kbd>Ctrl</kbd> + <kbd>N</kbd> new application · <kbd>Ctrl</kbd> + <kbd>K</kbd> search
              · <kbd>Esc</kbd> close dialogs
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
