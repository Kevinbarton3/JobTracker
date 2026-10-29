use super::db_error;
use rusqlite::Connection;

pub(super) fn column_exists(
    connection: &Connection,
    table: &str,
    column: &str,
) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(db_error)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    Ok(names.iter().any(|name| name == column))
}

fn migration_applied(connection: &Connection, version: i64) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=?1)",
            [version],
            |row| row.get(0),
        )
        .map_err(db_error)
}

pub(super) fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA foreign_keys=ON;
             PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS schema_migrations(
               version INTEGER PRIMARY KEY,
               applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )
        .map_err(db_error)?;

    if !migration_applied(connection, 1)? {
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS applications(
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   company TEXT NOT NULL,
                   position TEXT NOT NULL,
                   status TEXT NOT NULL DEFAULT 'Interested',
                   location TEXT,
                   work_arrangement TEXT,
                   employment_type TEXT,
                   job_url TEXT,
                   salary_range TEXT,
                   contact_name TEXT,
                   contact_email TEXT,
                   date_applied TEXT,
                   follow_up_date TEXT,
                   follow_up_completed INTEGER NOT NULL DEFAULT 0,
                   interview_date TEXT,
                   source TEXT,
                   notes TEXT,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE IF NOT EXISTS app_metadata(
                   key TEXT PRIMARY KEY,
                   value TEXT NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
                 CREATE INDEX IF NOT EXISTS idx_applications_follow_up ON applications(follow_up_date);
                 CREATE INDEX IF NOT EXISTS idx_applications_updated ON applications(updated_at);
                 INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);",
            )
            .map_err(db_error)?;
    }

    if !migration_applied(connection, 2)? {
        if !column_exists(connection, "applications", "deleted_at")? {
            connection
                .execute("ALTER TABLE applications ADD COLUMN deleted_at TEXT", [])
                .map_err(db_error)?;
        }
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS activities(
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
                   activity_type TEXT NOT NULL,
                   occurred_at TEXT NOT NULL,
                   participants TEXT,
                   notes TEXT,
                   meeting_url TEXT,
                   outcome TEXT,
                   from_status TEXT,
                   to_status TEXT,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE INDEX IF NOT EXISTS idx_activities_application ON activities(application_id, occurred_at DESC);
                 CREATE TABLE IF NOT EXISTS tasks(
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
                   title TEXT NOT NULL,
                   due_at TEXT NOT NULL,
                   completed INTEGER NOT NULL DEFAULT 0,
                   priority TEXT NOT NULL DEFAULT 'Normal',
                   recurrence TEXT,
                   snoozed_until TEXT,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(completed, due_at);
                 CREATE TABLE IF NOT EXISTS attachments(
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
                   kind TEXT NOT NULL,
                   name TEXT NOT NULL,
                   file_path TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE INDEX IF NOT EXISTS idx_attachments_application ON attachments(application_id);
                 INSERT INTO activities(application_id,activity_type,occurred_at,notes)
                   SELECT a.id,'Application',COALESCE(a.date_applied || ' 12:00:00',a.created_at),'Imported from JobTrack v1'
                   FROM applications a
                   WHERE NOT EXISTS(SELECT 1 FROM activities x WHERE x.application_id=a.id);
                 INSERT INTO tasks(application_id,title,due_at,completed,priority)
                   SELECT a.id,'Follow up with ' || a.company,a.follow_up_date || ' 09:00:00',a.follow_up_completed,'Normal'
                   FROM applications a
                   WHERE a.follow_up_date IS NOT NULL
                     AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.application_id=a.id);
                 INSERT OR IGNORE INTO schema_migrations(version) VALUES(2);",
            )
            .map_err(db_error)?;
    }
    if !migration_applied(connection, 3)? {
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS resumes(
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   name TEXT NOT NULL,
                   notes TEXT,
                   original_file_name TEXT NOT NULL,
                   stored_file_name TEXT NOT NULL UNIQUE,
                   is_current INTEGER NOT NULL DEFAULT 0,
                   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                   deleted_at TEXT
                 );
                 CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_one_current
                   ON resumes(is_current) WHERE is_current=1 AND deleted_at IS NULL;
                 CREATE INDEX IF NOT EXISTS idx_resumes_created ON resumes(created_at DESC);",
            )
            .map_err(db_error)?;
        if !column_exists(connection, "applications", "resume_id")? {
            connection
                .execute(
                    "ALTER TABLE applications ADD COLUMN resume_id INTEGER REFERENCES resumes(id)",
                    [],
                )
                .map_err(db_error)?;
        }
        connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations(version) VALUES(3)",
                [],
            )
            .map_err(db_error)?;
    }
    crate::email::initialize(connection).map_err(db_error)?;
    connection.execute_batch("CREATE TABLE IF NOT EXISTS capture_requests(request_id TEXT PRIMARY KEY, application_id INTEGER NOT NULL);").map_err(db_error)?;
    Ok(())
}
