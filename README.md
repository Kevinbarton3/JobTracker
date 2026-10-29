# JobTracker

The desktop application is branded **JobTrack**.

JobTrack is a Windows desktop job application tracker with local data storage. It provides a polished local workflow for capturing opportunities, managing hiring stages, scheduling follow-ups, and understanding your pipeline. The core tracking workflow works offline and stores application data in SQLite on your computer. Optional Gmail integration requires an internet connection and Google authorization.

## Features

- Versioned, automatic SQLite migrations that preserve existing v1 records
- Daily automatic backups, manual backup/restore, and validated CSV import/export
- Reversible application deletion and duplicate-opportunity warnings
- Search across application details, contacts, notes, sources, and timeline activity
- Saved filters, bulk status updates, sortable tables, and dashboard drill-down
- Activity timelines for conversations, interviews, status changes, decisions, and notes
- Tasks with priorities, recurrence, snoozing, reopening, and Windows notifications
- Local file links for resumes, cover letters, portfolios, and job descriptions
- Managed resume library with reusable versions, current-resume selection, and per-application history
- Outcome rates, source comparisons, and average pipeline-stage duration
- Theme preference, first-run onboarding, keyboard shortcuts, accessible dialogs, and reduced-motion support

## Technology stack

- React 18 and strict TypeScript
- Vite 6
- Tauri 2 and Rust
- SQLite through `rusqlite` (bundled SQLite)
- CSS and Lucide icons

## Prerequisites (Windows)

1. Install [Node.js](https://nodejs.org/) (LTS recommended).
2. Install Rust with `rustup` from [rustup.rs](https://rustup.rs/), selecting the default MSVC toolchain.
3. Install the **Desktop development with C++** workload in Visual Studio Build Tools 2022.
4. Ensure Microsoft Edge WebView2 is available (included with current Windows 10/11 installations).

After installing Rust, open a new terminal and verify:

```powershell
node --version
npm --version
rustc --version
cargo --version
```

## Installation

From this folder:

```powershell
npm ci
```

## Development

Run the actual desktop application (recommended):

```powershell
npm run tauri dev
```

Frontend-only Vite mode can be started with `npm run dev`, but database calls require the Tauri runtime and will intentionally show an initialization error in a normal browser.

Other checks:

```powershell
npm run typecheck
npm test
npm run build
cd src-tauri
cargo check
cargo test
```

## Build a Windows installer

```powershell
npm run tauri build
```

Tauri places the executable and installer bundles under `src-tauri\target\release\bundle`. The exact installer format depends on the installed Windows packaging tools.

## Database information

The database is initialized automatically on first launch as `jobtrack.db` inside the operating-system application data directory for `com.jobtrack.desktop`. The exact path is shown on the Settings page. SQLite uses WAL journaling, parameterized statements, and indexes for status, follow-up date, and update date. The core tracker stores data locally. If you connect Gmail, the app communicates with Google OAuth and Gmail APIs using read-only Gmail access; client configuration and tokens are stored in Windows Credential Manager. Email content cached locally and backup archives should be treated as private.

Sample data is opt-in and uses dates relative to the current day. A metadata marker prevents repeated insertion; deleting all data also clears that marker so a fresh sample set can be inserted later.

JobTrack creates one `.jobtrack` archive backup per day in the application data directory and keeps the most recent 14. Archives include both SQLite data and managed resume files. Legacy database-only `.db` backups can still be restored without replacing managed resume files. Manual backup, restore, CSV export, and previewed CSV import are available from Settings.

## Project structure

```text
src/
  components/       Reusable form, table, navigation, and UI states
  pages/            Dashboard, applications, details, follow-ups, settings
  services/         Typed Tauri command boundary
  styles/           Desktop application styling
  types/            Domain types and option constants
  utils/            Date and URL helpers
src-tauri/
  capabilities/     Tauri security permissions
  src/app_backend.rs  Application commands, queries, and desktop startup
  src/schema.rs       Versioned SQLite migrations
  src/models.rs       Typed command inputs and response models
  src/backend_tests.rs Database and workflow regression tests
  src/gmail.rs        Optional Gmail OAuth and synchronization
  src/capture.rs      Chrome capture integration
```

## Troubleshooting

- **`cargo` or `rustc` is not recognized:** install Rust with rustup, then restart the terminal.
- **MSVC linker errors:** install Visual Studio Build Tools with Desktop development with C++ and the Windows SDK.
- **Database initialization error in the browser:** use `npm run tauri dev`; frontend-only mode has no native command host.
- **Port 1420 is already in use:** stop the other Vite process, then start Tauri again.
- **Windows packaging fails:** confirm WiX/NSIS prerequisites and the Visual Studio Windows SDK are installed, then rerun `npm run tauri build`.
- **Data location:** open Settings in JobTrack to see the exact database path.

## Optional integrations

- **Chrome capture:** see [extension setup](chrome-extension/README.md). Its manifest contains a public key used to keep the extension ID stable, not a private signing key.
- **Gmail:** import your own Google Desktop OAuth client JSON through the app and authorize read-only access. Never commit that JSON or tokens. Gmail sync is optional; the tracker works without it.

## Publishing this project

Publish source and configuration only. Do not add application databases, backup archives, resumes, email exports, OAuth configuration, or build directories. The repository ignore rules cover common local artifacts; they are not a substitute for reviewing staged files.
