# JobTracker

A Windows desktop application for organizing a job search, built with **React, TypeScript, Tauri, Rust, and SQLite**. The desktop interface is branded **JobTrack**.

JobTracker brings opportunities, hiring stages, follow-ups, notes, and resume versions into one local workflow.

## Project highlights

- Track applications through hiring stages with searchable details and activity timelines.
- Organize recurring follow-up tasks, priorities, snoozing, and Windows notifications.
- Use saved filters, bulk status updates, sortable tables, and dashboard views.
- Manage resume versions and track which version was used for each application.
- Import and export CSV files with validation and duplicate-opportunity warnings.
- Preserve records with automatic SQLite migrations, daily backups, restore support, and reversible deletion.
- Review outcome rates, source comparisons, and time spent in pipeline stages.

## Architecture

| Layer | Technology and responsibility |
| --- | --- |
| Desktop interface | React, strict TypeScript, and Vite |
| Native application | Tauri 2 with Rust commands |
| Data access | SQLite through rusqlite, parameterized queries, and versioned migrations |
| Frontend/native boundary | Typed services connecting interface actions to Tauri commands |
| Local storage | Application records, backup archives, and managed resume files |

The core application workflow stores records locally rather than requiring a cloud database. The frontend relies on the Tauri runtime for native database operations.

## Engineering focus

This project combines a typed user interface with native desktop behavior and persistent relational data. Its documented development checks include TypeScript validation, frontend tests and builds, and Rust checks and tests.

## Repository scope

This is a **public portfolio overview**. Application source code, installers, personal application records, and resume files are not included in this repository.
