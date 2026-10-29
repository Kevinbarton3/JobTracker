#[path = "models.rs"]
mod models;
use models::*;

#[path = "schema.rs"]
mod schema;
#[cfg(test)]
use schema::column_exists;
use schema::initialize_schema;

#[path = "capture.rs"]
mod capture;
#[path = "gmail.rs"]
mod gmail;
use chrono::{Duration, Local, NaiveDate, NaiveDateTime};
use rusqlite::{backup::Backup, params, Connection, OptionalExtension, Row};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration as StdDuration,
};
use tauri::Manager;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const STATUSES: [&str; 7] = [
    "Interested",
    "Applied",
    "Phone Screen",
    "Interviewing",
    "Offer",
    "Rejected",
    "Withdrawn",
];
const ACTIVITY_TYPES: [&str; 8] = [
    "Application",
    "Status Change",
    "Email",
    "Phone Screen",
    "Interview",
    "Offer",
    "Rejection",
    "Note",
];
const PRIORITIES: [&str; 3] = ["Low", "Normal", "High"];
const RECURRENCES: [&str; 3] = ["Daily", "Weekly", "Monthly"];

struct AppState {
    connection: Mutex<Connection>,
    path: PathBuf,
    backups_dir: PathBuf,
    exports_dir: PathBuf,
    resumes_dir: PathBuf,
}

fn db_error(error: rusqlite::Error) -> String {
    format!("The local database operation failed: {error}")
}

fn io_error(context: &str, error: std::io::Error) -> String {
    format!("{context}: {error}")
}

fn lock<'a>(
    state: &'a tauri::State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state
        .connection
        .lock()
        .map_err(|_| "The local database is temporarily unavailable.".into())
}

const SELECT_APPLICATION: &str = "SELECT id,company,position,status,location,work_arrangement,employment_type,job_url,salary_range,contact_name,contact_email,date_applied,follow_up_date,follow_up_completed,interview_date,source,notes,created_at,updated_at,resume_id,(SELECT name FROM resumes r WHERE r.id=applications.resume_id),COALESCE((SELECT deleted_at IS NOT NULL FROM resumes r WHERE r.id=applications.resume_id),0) FROM applications";

fn map_application(row: &Row<'_>) -> rusqlite::Result<JobApplication> {
    Ok(JobApplication {
        id: row.get(0)?,
        company: row.get(1)?,
        position: row.get(2)?,
        status: row.get(3)?,
        location: row.get(4)?,
        work_arrangement: row.get(5)?,
        employment_type: row.get(6)?,
        job_url: row.get(7)?,
        salary_range: row.get(8)?,
        contact_name: row.get(9)?,
        contact_email: row.get(10)?,
        date_applied: row.get(11)?,
        follow_up_date: row.get(12)?,
        follow_up_completed: row.get::<_, i64>(13)? != 0,
        interview_date: row.get(14)?,
        source: row.get(15)?,
        notes: row.get(16)?,
        created_at: row.get(17)?,
        updated_at: row.get(18)?,
        resume_id: row.get(19)?,
        resume_name: row.get(20)?,
        resume_deleted: row.get::<_, i64>(21)? != 0,
    })
}

fn get_by_id(connection: &Connection, id: i64) -> Result<JobApplication, String> {
    connection
        .query_row(
            &format!("{SELECT_APPLICATION} WHERE id=?1 AND deleted_at IS NULL"),
            [id],
            map_application,
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| format!("Application {id} was not found."))
}

fn trim_option(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn valid_date(value: &Option<String>) -> bool {
    value
        .as_deref()
        .map(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok())
        .unwrap_or(true)
}

fn validate_application(input: &ApplicationInput) -> Result<(), String> {
    if input.company.trim().is_empty() {
        return Err("Company name is required.".into());
    }
    if input.position.trim().is_empty() {
        return Err("Position title is required.".into());
    }
    if !STATUSES.contains(&input.status.as_str()) {
        return Err("The selected application status is invalid.".into());
    }
    if let Some(url) = trim_option(&input.job_url) {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("The job posting URL must start with http:// or https://.".into());
        }
    }
    if !valid_date(&input.date_applied)
        || !valid_date(&input.follow_up_date)
        || !valid_date(&input.interview_date)
    {
        return Err("One or more application dates are invalid.".into());
    }
    Ok(())
}

fn validate_resume_assignment(
    connection: &Connection,
    resume_id: Option<i64>,
    existing_resume_id: Option<i64>,
) -> Result<(), String> {
    let Some(id) = resume_id else {
        return Ok(());
    };
    if existing_resume_id == Some(id) {
        return Ok(());
    }
    let active: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM resumes WHERE id=?1 AND deleted_at IS NULL)",
            [id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if active {
        Ok(())
    } else {
        Err("The selected resume is no longer available.".into())
    }
}

fn duplicate_matches(
    connection: &Connection,
    company: &str,
    position: &str,
    job_url: Option<&str>,
    exclude_id: Option<i64>,
) -> Result<Vec<DuplicateMatch>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id,company,position,
               CASE WHEN ?3<>'' AND lower(COALESCE(job_url,''))=lower(?3)
                    THEN 'Same posting URL' ELSE 'Same company and position' END
             FROM applications
             WHERE deleted_at IS NULL
               AND (?4 IS NULL OR id<>?4)
               AND ((lower(company)=lower(?1) AND lower(position)=lower(?2))
                 OR (?3<>'' AND lower(COALESCE(job_url,''))=lower(?3)))
             ORDER BY updated_at DESC",
        )
        .map_err(db_error)?;
    let result = statement
        .query_map(
            params![
                company.trim(),
                position.trim(),
                job_url.unwrap_or("").trim(),
                exclude_id
            ],
            |row| {
                Ok(DuplicateMatch {
                    id: row.get(0)?,
                    company: row.get(1)?,
                    position: row.get(2)?,
                    reason: row.get(3)?,
                })
            },
        )
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

fn insert_activity(
    connection: &Connection,
    application_id: i64,
    activity_type: &str,
    occurred_at: &str,
    notes: Option<&str>,
    from_status: Option<&str>,
    to_status: Option<&str>,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO activities(application_id,activity_type,occurred_at,notes,from_status,to_status)
             VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                application_id,
                activity_type,
                occurred_at,
                notes,
                from_status,
                to_status
            ],
        )
        .map_err(db_error)?;
    Ok(())
}

#[tauri::command]
fn initialize_database(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let connection = lock(&state)?;
    initialize_schema(&connection)?;
    Ok("Database ready".into())
}

#[tauri::command]
fn get_database_path(state: tauri::State<'_, AppState>) -> String {
    state.path.to_string_lossy().to_string()
}

#[tauri::command]
fn get_application(state: tauri::State<'_, AppState>, id: i64) -> Result<JobApplication, String> {
    let connection = lock(&state)?;
    get_by_id(&connection, id)
}

#[tauri::command]
fn get_applications(
    state: tauri::State<'_, AppState>,
    filters: ApplicationFilters,
) -> Result<Vec<JobApplication>, String> {
    let connection = lock(&state)?;
    let order = match (filters.sort_by.as_str(), filters.sort_direction.as_str()) {
        ("company", "asc") => "a.company COLLATE NOCASE ASC",
        ("company", _) => "a.company COLLATE NOCASE DESC",
        ("dateApplied", "asc") => "a.date_applied IS NULL,a.date_applied ASC",
        ("dateApplied", _) => "a.date_applied IS NULL,a.date_applied DESC",
        ("followUpDate", "asc") => "a.follow_up_date IS NULL,a.follow_up_date ASC",
        ("followUpDate", _) => "a.follow_up_date IS NULL,a.follow_up_date DESC",
        ("updatedAt", "asc") => "a.updated_at ASC",
        _ => "a.updated_at DESC",
    };
    let sql = format!(
        "SELECT a.id,a.company,a.position,a.status,a.location,a.work_arrangement,a.employment_type,a.job_url,a.salary_range,a.contact_name,a.contact_email,a.date_applied,a.follow_up_date,a.follow_up_completed,a.interview_date,a.source,a.notes,a.created_at,a.updated_at,a.resume_id,(SELECT name FROM resumes r WHERE r.id=a.resume_id),COALESCE((SELECT deleted_at IS NOT NULL FROM resumes r WHERE r.id=a.resume_id),0)
         FROM applications a
         WHERE a.deleted_at IS NULL
           AND (?1='' OR a.company LIKE '%'||?1||'%' OR a.position LIKE '%'||?1||'%'
             OR COALESCE(a.location,'') LIKE '%'||?1||'%' OR COALESCE(a.notes,'') LIKE '%'||?1||'%'
             OR COALESCE(a.contact_name,'') LIKE '%'||?1||'%' OR COALESCE(a.contact_email,'') LIKE '%'||?1||'%'
             OR COALESCE(a.source,'') LIKE '%'||?1||'%'
             OR EXISTS(SELECT 1 FROM activities x WHERE x.application_id=a.id AND (COALESCE(x.notes,'') LIKE '%'||?1||'%' OR COALESCE(x.participants,'') LIKE '%'||?1||'%')))
           AND (?2='' OR a.status=?2)
           AND (?3='' OR a.work_arrangement=?3)
           AND (?4='' OR a.employment_type=?4)
         ORDER BY {order},a.id DESC"
    );
    let mut statement = connection.prepare(&sql).map_err(db_error)?;
    let result = statement
        .query_map(
            params![
                filters.search.trim(),
                filters.status,
                filters.work_arrangement,
                filters.employment_type
            ],
            map_application,
        )
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

#[tauri::command]
fn check_duplicates(
    state: tauri::State<'_, AppState>,
    company: String,
    position: String,
    job_url: Option<String>,
    exclude_id: Option<i64>,
) -> Result<Vec<DuplicateMatch>, String> {
    let connection = lock(&state)?;
    duplicate_matches(
        &connection,
        &company,
        &position,
        job_url.as_deref(),
        exclude_id,
    )
}

#[tauri::command]
fn create_application(
    state: tauri::State<'_, AppState>,
    application: ApplicationInput,
) -> Result<JobApplication, String> {
    let mut connection = lock(&state)?;
    let tx = connection.transaction().map_err(db_error)?;
    let result = create_application_record(&tx, application)?;
    tx.commit().map_err(db_error)?;
    Ok(result)
}

fn create_application_record(
    connection: &Connection,
    application: ApplicationInput,
) -> Result<JobApplication, String> {
    validate_application(&application)?;
    validate_resume_assignment(connection, application.resume_id, None)?;
    connection
        .execute(
            "INSERT INTO applications(company,position,status,location,work_arrangement,employment_type,job_url,salary_range,contact_name,contact_email,date_applied,follow_up_date,follow_up_completed,interview_date,source,notes,resume_id)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            params![
                application.company.trim(),
                application.position.trim(),
                application.status,
                trim_option(&application.location),
                application.work_arrangement,
                application.employment_type,
                trim_option(&application.job_url),
                trim_option(&application.salary_range),
                trim_option(&application.contact_name),
                trim_option(&application.contact_email),
                application.date_applied,
                application.follow_up_date,
                application.follow_up_completed as i64,
                application.interview_date,
                application.source,
                trim_option(&application.notes),
                application.resume_id
            ],
        )
        .map_err(db_error)?;
    let id = connection.last_insert_rowid();
    let occurred = application
        .date_applied
        .as_ref()
        .map(|date| format!("{date} 12:00:00"))
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    insert_activity(
        connection,
        id,
        "Application",
        &occurred,
        Some("Application added to JobTrack"),
        None,
        Some(&application.status),
    )?;
    if let Some(date) = application.follow_up_date.as_deref() {
        connection
            .execute(
                "INSERT INTO tasks(application_id,title,due_at,completed,priority) VALUES(?1,?2,?3,?4,'Normal')",
                params![id, format!("Follow up with {}", application.company.trim()), format!("{date} 09:00:00"), application.follow_up_completed as i64],
            )
            .map_err(db_error)?;
    }
    get_by_id(connection, id)
}

#[tauri::command]
fn update_application(
    state: tauri::State<'_, AppState>,
    application: UpdateApplicationInput,
) -> Result<JobApplication, String> {
    validate_application(&application.application)?;
    let connection = lock(&state)?;
    let old = get_by_id(&connection, application.id)?;
    let a = application.application;
    validate_resume_assignment(&connection, a.resume_id, old.resume_id)?;
    let changed = connection
        .execute(
            "UPDATE applications SET company=?1,position=?2,status=?3,location=?4,work_arrangement=?5,employment_type=?6,job_url=?7,salary_range=?8,contact_name=?9,contact_email=?10,date_applied=?11,follow_up_date=?12,follow_up_completed=?13,interview_date=?14,source=?15,notes=?16,resume_id=?17,updated_at=CURRENT_TIMESTAMP WHERE id=?18 AND deleted_at IS NULL",
            params![
                a.company.trim(),a.position.trim(),a.status,trim_option(&a.location),a.work_arrangement,a.employment_type,
                trim_option(&a.job_url),trim_option(&a.salary_range),trim_option(&a.contact_name),trim_option(&a.contact_email),
                a.date_applied,a.follow_up_date,a.follow_up_completed as i64,a.interview_date,a.source,trim_option(&a.notes),a.resume_id,application.id
            ],
        )
        .map_err(db_error)?;
    if changed == 0 {
        return Err(format!("Application {} was not found.", application.id));
    }
    if old.status != a.status {
        insert_activity(
            &connection,
            application.id,
            "Status Change",
            &Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            None,
            Some(&old.status),
            Some(&a.status),
        )?;
    }
    get_by_id(&connection, application.id)
}

#[tauri::command]
fn delete_application(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    let changed = lock(&state)?
        .execute(
            "UPDATE applications SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND deleted_at IS NULL",
            [id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        Err(format!("Application {id} was not found."))
    } else {
        Ok(())
    }
}

#[tauri::command]
fn undo_last_delete(state: tauri::State<'_, AppState>) -> Result<JobApplication, String> {
    let connection = lock(&state)?;
    let id: i64 = connection
        .query_row(
            "SELECT id FROM applications WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| "There is no recently deleted application to restore.".to_string())?;
    connection
        .execute(
            "UPDATE applications SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1",
            [id],
        )
        .map_err(db_error)?;
    get_by_id(&connection, id)
}

#[tauri::command]
fn bulk_update_status(
    state: tauri::State<'_, AppState>,
    ids: Vec<i64>,
    status: String,
) -> Result<usize, String> {
    if !STATUSES.contains(&status.as_str()) {
        return Err("The selected application status is invalid.".into());
    }
    let mut connection = lock(&state)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let mut count = 0;
    for id in ids {
        let old: Option<String> = transaction
            .query_row(
                "SELECT status FROM applications WHERE id=?1 AND deleted_at IS NULL",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        if let Some(old_status) = old {
            if old_status != status {
                transaction
                    .execute(
                        "UPDATE applications SET status=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",
                        params![status, id],
                    )
                    .map_err(db_error)?;
                insert_activity(
                    &transaction,
                    id,
                    "Status Change",
                    &Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                    Some("Bulk status update"),
                    Some(&old_status),
                    Some(&status),
                )?;
                count += 1;
            }
        }
    }
    transaction.commit().map_err(db_error)?;
    Ok(count)
}

#[tauri::command]
fn get_dashboard_statistics(
    state: tauri::State<'_, AppState>,
) -> Result<DashboardStatistics, String> {
    let connection = lock(&state)?;
    let scalar = |sql: &str| {
        connection
            .query_row(sql, [], |row| row.get::<_, i64>(0))
            .map_err(db_error)
    };
    let total = scalar("SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL")?;
    let applied = scalar(
        "SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND status<>'Interested'",
    )?;
    let responded = scalar("SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND status IN ('Phone Screen','Interviewing','Offer','Rejected')")?;
    let interviewed = scalar("SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND status IN ('Interviewing','Offer','Rejected')")?;
    let offers =
        scalar("SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND status='Offer'")?;
    let rejections =
        scalar("SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND status='Rejected'")?;
    let mut status_breakdown = HashMap::new();
    for status in STATUSES {
        let count = connection
            .query_row(
                "SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND status=?1",
                [status],
                |row| row.get(0),
            )
            .map_err(db_error)?;
        status_breakdown.insert(status.to_string(), count);
    }
    let average_days_to_first_response = connection
        .query_row(
            "SELECT AVG(julianday(first_response)-julianday(started)) FROM (
               SELECT a.id,COALESCE(a.date_applied,a.created_at) started,MIN(x.occurred_at) first_response
               FROM applications a JOIN activities x ON x.application_id=a.id
               WHERE a.deleted_at IS NULL AND x.activity_type IN ('Email','Phone Screen','Interview','Offer','Rejection')
               GROUP BY a.id
             )",
            [],
            |row| row.get::<_, Option<f64>>(0),
        )
        .map_err(db_error)?;
    let rate = |value: i64, denominator: i64| {
        if denominator == 0 {
            0.0
        } else {
            (value as f64 / denominator as f64 * 1000.0).round() / 10.0
        }
    };
    Ok(DashboardStatistics {
        total,
        submitted_this_week: scalar("SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND date_applied>=date('now','localtime','-'||((CAST(strftime('%w','now','localtime') AS INTEGER)+6)%7)||' days')")?,
        active_interviews: scalar("SELECT COUNT(*) FROM applications WHERE deleted_at IS NULL AND status IN ('Phone Screen','Interviewing')")?,
        offers,
        requiring_follow_up: scalar("SELECT COUNT(*) FROM tasks t JOIN applications a ON a.id=t.application_id WHERE a.deleted_at IS NULL AND t.completed=0")?,
        rejections,
        status_breakdown,
        response_rate: rate(responded, applied),
        interview_rate: rate(interviewed, applied),
        offer_rate: rate(offers, applied),
        rejection_rate: rate(rejections, applied),
        average_days_to_first_response: average_days_to_first_response.map(|value| (value * 10.0).round() / 10.0),
    })
}

fn map_activity(row: &Row<'_>) -> rusqlite::Result<Activity> {
    Ok(Activity {
        id: row.get(0)?,
        application_id: row.get(1)?,
        activity_type: row.get(2)?,
        occurred_at: row.get(3)?,
        participants: row.get(4)?,
        notes: row.get(5)?,
        meeting_url: row.get(6)?,
        outcome: row.get(7)?,
        from_status: row.get(8)?,
        to_status: row.get(9)?,
        created_at: row.get(10)?,
    })
}

#[tauri::command]
fn get_activities(
    state: tauri::State<'_, AppState>,
    application_id: i64,
) -> Result<Vec<Activity>, String> {
    let connection = lock(&state)?;
    let mut statement = connection
        .prepare("SELECT id,application_id,activity_type,occurred_at,participants,notes,meeting_url,outcome,from_status,to_status,created_at FROM activities WHERE application_id=?1 ORDER BY occurred_at DESC,id DESC")
        .map_err(db_error)?;
    let result = statement
        .query_map([application_id], map_activity)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

#[tauri::command]
fn create_activity(
    state: tauri::State<'_, AppState>,
    activity: ActivityInput,
) -> Result<Activity, String> {
    if !ACTIVITY_TYPES.contains(&activity.activity_type.as_str()) {
        return Err("The selected activity type is invalid.".into());
    }
    if activity.occurred_at.trim().is_empty() {
        return Err("Activity date and time are required.".into());
    }
    if let Some(url) = trim_option(&activity.meeting_url) {
        if !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err("The meeting link must start with http:// or https://.".into());
        }
    }
    let connection = lock(&state)?;
    get_by_id(&connection, activity.application_id)?;
    connection
        .execute(
            "INSERT INTO activities(application_id,activity_type,occurred_at,participants,notes,meeting_url,outcome) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![activity.application_id,activity.activity_type,activity.occurred_at,trim_option(&activity.participants),trim_option(&activity.notes),trim_option(&activity.meeting_url),trim_option(&activity.outcome)],
        )
        .map_err(db_error)?;
    connection
        .query_row(
            "SELECT id,application_id,activity_type,occurred_at,participants,notes,meeting_url,outcome,from_status,to_status,created_at FROM activities WHERE id=last_insert_rowid()",
            [],
            map_activity,
        )
        .map_err(db_error)
}

#[tauri::command]
fn delete_activity(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    let changed = lock(&state)?
        .execute("DELETE FROM activities WHERE id=?1", [id])
        .map_err(db_error)?;
    if changed == 0 {
        Err("Activity was not found.".into())
    } else {
        Ok(())
    }
}

fn map_task(row: &Row<'_>) -> rusqlite::Result<TaskItem> {
    Ok(TaskItem {
        id: row.get(0)?,
        application_id: row.get(1)?,
        title: row.get(2)?,
        due_at: row.get(3)?,
        completed: row.get::<_, i64>(4)? != 0,
        priority: row.get(5)?,
        recurrence: row.get(6)?,
        snoozed_until: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        company: row.get(10)?,
        position: row.get(11)?,
        status: row.get(12)?,
    })
}

const SELECT_TASK: &str = "SELECT t.id,t.application_id,t.title,t.due_at,t.completed,t.priority,t.recurrence,t.snoozed_until,t.created_at,t.updated_at,a.company,a.position,a.status FROM tasks t JOIN applications a ON a.id=t.application_id";

fn get_task(connection: &Connection, id: i64) -> Result<TaskItem, String> {
    connection
        .query_row(
            &format!("{SELECT_TASK} WHERE t.id=?1 AND a.deleted_at IS NULL"),
            [id],
            map_task,
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| "Task was not found.".into())
}

#[tauri::command]
fn get_tasks(state: tauri::State<'_, AppState>) -> Result<TaskGroups, String> {
    let connection = lock(&state)?;
    let mut statement = connection
        .prepare(&format!(
            "{SELECT_TASK} WHERE a.deleted_at IS NULL ORDER BY t.completed,t.due_at,t.id"
        ))
        .map_err(db_error)?;
    let tasks = statement
        .query_map([], map_task)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    let today = Local::now().date_naive();
    let mut groups = TaskGroups {
        overdue: vec![],
        due_today: vec![],
        upcoming: vec![],
        completed: vec![],
    };
    for task in tasks {
        if task.completed {
            groups.completed.push(task);
            continue;
        }
        let effective = task.snoozed_until.as_deref().unwrap_or(&task.due_at);
        let date = effective
            .get(0..10)
            .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok());
        match date {
            Some(value) if value < today => groups.overdue.push(task),
            Some(value) if value == today => groups.due_today.push(task),
            _ => groups.upcoming.push(task),
        }
    }
    Ok(groups)
}

#[tauri::command]
fn create_task(state: tauri::State<'_, AppState>, task: TaskInput) -> Result<TaskItem, String> {
    if task.title.trim().is_empty() || task.due_at.trim().is_empty() {
        return Err("Task title and due date are required.".into());
    }
    if !PRIORITIES.contains(&task.priority.as_str()) {
        return Err("The selected task priority is invalid.".into());
    }
    if let Some(value) = task.recurrence.as_deref() {
        if !RECURRENCES.contains(&value) {
            return Err("The selected recurrence is invalid.".into());
        }
    }
    let connection = lock(&state)?;
    get_by_id(&connection, task.application_id)?;
    connection
        .execute(
            "INSERT INTO tasks(application_id,title,due_at,priority,recurrence) VALUES(?1,?2,?3,?4,?5)",
            params![task.application_id,task.title.trim(),task.due_at,task.priority,task.recurrence],
        )
        .map_err(db_error)?;
    get_task(&connection, connection.last_insert_rowid())
}

#[tauri::command]
fn set_task_completed(
    state: tauri::State<'_, AppState>,
    id: i64,
    completed: bool,
) -> Result<TaskItem, String> {
    let connection = lock(&state)?;
    let old = get_task(&connection, id)?;
    connection
        .execute(
            "UPDATE tasks SET completed=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",
            params![completed as i64, id],
        )
        .map_err(db_error)?;
    if completed {
        if let Some(recurrence) = old.recurrence.as_deref() {
            let parsed = NaiveDateTime::parse_from_str(&old.due_at, "%Y-%m-%d %H:%M:%S")
                .or_else(|_| NaiveDateTime::parse_from_str(&old.due_at, "%Y-%m-%dT%H:%M"))
                .ok();
            if let Some(date) = parsed {
                let next = match recurrence {
                    "Daily" => date + Duration::days(1),
                    "Weekly" => date + Duration::days(7),
                    _ => date + Duration::days(30),
                };
                connection
                    .execute(
                        "INSERT INTO tasks(application_id,title,due_at,priority,recurrence) VALUES(?1,?2,?3,?4,?5)",
                        params![old.application_id,old.title,next.format("%Y-%m-%d %H:%M:%S").to_string(),old.priority,old.recurrence],
                    )
                    .map_err(db_error)?;
            }
        }
    }
    get_task(&connection, id)
}

#[tauri::command]
fn snooze_task(
    state: tauri::State<'_, AppState>,
    id: i64,
    snoozed_until: Option<String>,
) -> Result<TaskItem, String> {
    let connection = lock(&state)?;
    connection
        .execute(
            "UPDATE tasks SET snoozed_until=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",
            params![snoozed_until, id],
        )
        .map_err(db_error)?;
    get_task(&connection, id)
}

#[tauri::command]
fn delete_task(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    let changed = lock(&state)?
        .execute("DELETE FROM tasks WHERE id=?1", [id])
        .map_err(db_error)?;
    if changed == 0 {
        Err("Task was not found.".into())
    } else {
        Ok(())
    }
}

fn map_attachment(row: &Row<'_>) -> rusqlite::Result<Attachment> {
    let file_path: String = row.get(4)?;
    Ok(Attachment {
        id: row.get(0)?,
        application_id: row.get(1)?,
        kind: row.get(2)?,
        name: row.get(3)?,
        file_exists: Path::new(&file_path).exists(),
        file_path,
        created_at: row.get(5)?,
    })
}

#[tauri::command]
fn get_attachments(
    state: tauri::State<'_, AppState>,
    application_id: i64,
) -> Result<Vec<Attachment>, String> {
    let connection = lock(&state)?;
    let mut statement = connection
        .prepare("SELECT id,application_id,kind,name,file_path,created_at FROM attachments WHERE application_id=?1 ORDER BY created_at DESC")
        .map_err(db_error)?;
    let result = statement
        .query_map([application_id], map_attachment)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

#[tauri::command]
fn create_attachment(
    state: tauri::State<'_, AppState>,
    attachment: AttachmentInput,
) -> Result<Attachment, String> {
    if attachment.name.trim().is_empty() || attachment.file_path.trim().is_empty() {
        return Err("Attachment name and file path are required.".into());
    }
    let connection = lock(&state)?;
    get_by_id(&connection, attachment.application_id)?;
    connection
        .execute(
            "INSERT INTO attachments(application_id,kind,name,file_path) VALUES(?1,?2,?3,?4)",
            params![
                attachment.application_id,
                attachment.kind,
                attachment.name.trim(),
                attachment.file_path.trim()
            ],
        )
        .map_err(db_error)?;
    connection
        .query_row(
            "SELECT id,application_id,kind,name,file_path,created_at FROM attachments WHERE id=last_insert_rowid()",
            [],
            map_attachment,
        )
        .map_err(db_error)
}

#[tauri::command]
fn delete_attachment(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    let changed = lock(&state)?
        .execute("DELETE FROM attachments WHERE id=?1", [id])
        .map_err(db_error)?;
    if changed == 0 {
        Err("Attachment was not found.".into())
    } else {
        Ok(())
    }
}

fn map_resume(row: &Row<'_>, resumes_dir: &Path) -> rusqlite::Result<Resume> {
    let stored_file_name: String = row.get(4)?;
    Ok(Resume {
        id: row.get(0)?,
        name: row.get(1)?,
        notes: row.get(2)?,
        original_file_name: row.get(3)?,
        file_exists: resumes_dir.join(&stored_file_name).is_file(),
        stored_file_name,
        created_at: row.get(5)?,
        is_current: row.get::<_, i64>(6)? != 0,
        usage_count: row.get(7)?,
    })
}

#[tauri::command]
fn choose_resume_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Resume documents", &["pdf", "doc", "docx"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_resumes(state: tauri::State<'_, AppState>) -> Result<Vec<Resume>, String> {
    let connection = lock(&state)?;
    let mut statement = connection
        .prepare(
            "SELECT r.id,r.name,r.notes,r.original_file_name,r.stored_file_name,r.created_at,r.is_current,
                    (SELECT COUNT(*) FROM applications a WHERE a.resume_id=r.id AND a.deleted_at IS NULL)
             FROM resumes r WHERE r.deleted_at IS NULL
             ORDER BY r.is_current DESC,r.created_at DESC,r.id DESC",
        )
        .map_err(db_error)?;
    let result = statement
        .query_map([], |row| map_resume(row, &state.resumes_dir))
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error);
    result
}

#[tauri::command]
fn import_resume(
    state: tauri::State<'_, AppState>,
    source_path: String,
    name: String,
    notes: Option<String>,
    make_current: bool,
) -> Result<Resume, String> {
    if name.trim().is_empty() {
        return Err("Resume name is required.".into());
    }
    let source = PathBuf::from(source_path.trim());
    if !source.is_file() {
        return Err("The selected resume file does not exist.".into());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "The selected file has no supported extension.".to_string())?;
    if !["pdf", "doc", "docx"].contains(&extension.as_str()) {
        return Err("Choose a PDF or Word resume (.pdf, .doc, or .docx).".into());
    }
    let original_file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The selected file name is invalid.".to_string())?
        .to_string();
    fs::create_dir_all(&state.resumes_dir)
        .map_err(|error| io_error("Could not create the managed resume folder", error))?;
    let stored_file_name = format!(
        "resume-{}-{}.{}",
        Local::now().timestamp_micros(),
        std::process::id(),
        extension
    );
    let destination = state.resumes_dir.join(&stored_file_name);
    fs::copy(&source, &destination)
        .map_err(|error| io_error("Could not copy the resume into JobTrack", error))?;

    let result: Result<i64, String> = (|| {
        let mut connection = lock(&state)?;
        let transaction = connection.transaction().map_err(db_error)?;
        if make_current {
            transaction
                .execute("UPDATE resumes SET is_current=0 WHERE is_current=1", [])
                .map_err(db_error)?;
        }
        transaction
            .execute(
                "INSERT INTO resumes(name,notes,original_file_name,stored_file_name,is_current)
                 VALUES(?1,?2,?3,?4,?5)",
                params![
                    name.trim(),
                    trim_option(&notes),
                    original_file_name,
                    stored_file_name,
                    make_current as i64
                ],
            )
            .map_err(db_error)?;
        let id = transaction.last_insert_rowid();
        transaction.commit().map_err(db_error)?;
        Ok(id)
    })();
    let id = match result {
        Ok(id) => id,
        Err(error) => {
            let _ = fs::remove_file(&destination);
            return Err(error);
        }
    };
    let connection = lock(&state)?;
    connection
        .query_row(
            "SELECT r.id,r.name,r.notes,r.original_file_name,r.stored_file_name,r.created_at,r.is_current,
                    (SELECT COUNT(*) FROM applications a WHERE a.resume_id=r.id AND a.deleted_at IS NULL)
             FROM resumes r WHERE r.id=?1",
            [id],
            |row| map_resume(row, &state.resumes_dir),
        )
        .map_err(db_error)
}

#[tauri::command]
fn update_resume(
    state: tauri::State<'_, AppState>,
    resume: ResumeUpdateInput,
) -> Result<(), String> {
    if resume.name.trim().is_empty() {
        return Err("Resume name is required.".into());
    }
    let changed = lock(&state)?
        .execute(
            "UPDATE resumes SET name=?1,notes=?2 WHERE id=?3 AND deleted_at IS NULL",
            params![resume.name.trim(), trim_option(&resume.notes), resume.id],
        )
        .map_err(db_error)?;
    if changed == 0 {
        Err("Resume was not found.".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn set_current_resume(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    let mut connection = lock(&state)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM resumes WHERE id=?1 AND deleted_at IS NULL)",
            [id],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if !exists {
        return Err("Resume was not found.".into());
    }
    transaction
        .execute("UPDATE resumes SET is_current=0 WHERE is_current=1", [])
        .map_err(db_error)?;
    transaction
        .execute("UPDATE resumes SET is_current=1 WHERE id=?1", [id])
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)
}

#[tauri::command]
fn assign_application_resume(
    state: tauri::State<'_, AppState>,
    application_id: i64,
    resume_id: Option<i64>,
) -> Result<JobApplication, String> {
    let connection = lock(&state)?;
    get_by_id(&connection, application_id)?;
    validate_resume_assignment(&connection, resume_id, None)?;
    connection
        .execute(
            "UPDATE applications SET resume_id=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND deleted_at IS NULL",
            params![resume_id, application_id],
        )
        .map_err(db_error)?;
    get_by_id(&connection, application_id)
}

#[tauri::command]
fn delete_resume(state: tauri::State<'_, AppState>, id: i64) -> Result<i64, String> {
    let connection = lock(&state)?;
    let (stored_file_name, usage_count): (String, i64) = connection
        .query_row(
            "SELECT r.stored_file_name,
                    (SELECT COUNT(*) FROM applications a WHERE a.resume_id=r.id AND a.deleted_at IS NULL)
             FROM resumes r WHERE r.id=?1 AND r.deleted_at IS NULL",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| "Resume was not found.".to_string())?;
    connection
        .execute(
            "UPDATE resumes SET deleted_at=CURRENT_TIMESTAMP,is_current=0 WHERE id=?1",
            [id],
        )
        .map_err(db_error)?;
    let path = state.resumes_dir.join(stored_file_name);
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| io_error("Could not remove the managed resume file", error))?;
    }
    Ok(usage_count)
}

#[tauri::command]
fn open_resume(state: tauri::State<'_, AppState>, id: i64) -> Result<(), String> {
    let stored_file_name: String = lock(&state)?
        .query_row(
            "SELECT stored_file_name FROM resumes WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| "Resume is no longer available.".to_string())?;
    open_path(
        state
            .resumes_dir
            .join(stored_file_name)
            .to_string_lossy()
            .to_string(),
    )
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("That local file no longer exists.".into());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|error| io_error("Windows could not open the file", error))?;
    #[cfg(not(target_os = "windows"))]
    return Err("Opening local files is currently supported on Windows.".into());
    Ok(())
}

fn copy_database(source: &Connection, destination_path: &Path) -> Result<(), String> {
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error("Could not create the backup folder", error))?;
    }
    let mut destination = Connection::open(destination_path).map_err(db_error)?;
    let backup = Backup::new(source, &mut destination).map_err(db_error)?;
    backup
        .run_to_completion(5, StdDuration::from_millis(100), None)
        .map_err(db_error)
}

fn create_backup_file(
    connection: &Connection,
    backups_dir: &Path,
    resumes_dir: &Path,
    requested_path: Option<String>,
) -> Result<String, String> {
    let mut path = requested_path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            backups_dir.join(format!(
                "jobtrack-{}.jobtrack",
                Local::now().format("%Y%m%d-%H%M%S")
            ))
        });
    if path.extension().and_then(|value| value.to_str()) != Some("jobtrack") {
        path.set_extension("jobtrack");
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error("Could not create the backup folder", error))?;
    }
    let staging_db = backups_dir.join(format!(
        ".backup-staging-{}-{}.db",
        Local::now().timestamp_micros(),
        std::process::id()
    ));
    copy_database(connection, &staging_db)?;
    let result: Result<(), String> = (|| {
        let archive_file = fs::File::create(&path)
            .map_err(|error| io_error("Could not create the backup archive", error))?;
        let mut archive = ZipWriter::new(archive_file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        archive
            .start_file("jobtrack.db", options)
            .map_err(|error| format!("Could not write the backup archive: {error}"))?;
        let mut database_file = fs::File::open(&staging_db)
            .map_err(|error| io_error("Could not read the staged database", error))?;
        std::io::copy(&mut database_file, &mut archive)
            .map_err(|error| io_error("Could not add the database to the backup", error))?;
        if resumes_dir.exists() {
            for entry in fs::read_dir(resumes_dir)
                .map_err(|error| io_error("Could not inspect managed resumes", error))?
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_file())
            {
                let file_name = entry.file_name().to_string_lossy().to_string();
                archive
                    .start_file(format!("resumes/{file_name}"), options)
                    .map_err(|error| format!("Could not add a resume to the backup: {error}"))?;
                let mut file = fs::File::open(entry.path())
                    .map_err(|error| io_error("Could not read a managed resume", error))?;
                std::io::copy(&mut file, &mut archive)
                    .map_err(|error| io_error("Could not add a resume to the backup", error))?;
            }
        }
        archive
            .finish()
            .map_err(|error| format!("Could not finish the backup archive: {error}"))?;
        Ok(())
    })();
    let _ = fs::remove_file(&staging_db);
    result?;
    Ok(path.to_string_lossy().to_string())
}

fn automatic_backup(
    connection: &Connection,
    backups_dir: &Path,
    resumes_dir: &Path,
) -> Result<(), String> {
    fs::create_dir_all(backups_dir)
        .map_err(|error| io_error("Could not create the automatic backup folder", error))?;
    let prefix = format!("jobtrack-{}", Local::now().format("%Y%m%d"));
    let already_exists = fs::read_dir(backups_dir)
        .map_err(|error| io_error("Could not inspect automatic backups", error))?
        .filter_map(Result::ok)
        .any(|entry| {
            entry.path().extension().and_then(|value| value.to_str()) == Some("jobtrack")
                && entry.file_name().to_string_lossy().starts_with(&prefix)
        });
    if !already_exists {
        create_backup_file(connection, backups_dir, resumes_dir, None)?;
    }
    let mut backups = fs::read_dir(backups_dir)
        .map_err(|error| io_error("Could not inspect automatic backups", error))?
        .filter_map(Result::ok)
        .filter(|entry| {
            matches!(
                entry.path().extension().and_then(|x| x.to_str()),
                Some("db" | "jobtrack")
            )
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|entry| entry.file_name());
    while backups.len() > 14 {
        let entry = backups.remove(0);
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

#[tauri::command]
fn create_backup(
    state: tauri::State<'_, AppState>,
    path: Option<String>,
) -> Result<String, String> {
    let connection = lock(&state)?;
    create_backup_file(&connection, &state.backups_dir, &state.resumes_dir, path)
}

#[tauri::command]
fn list_backups(state: tauri::State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut paths = fs::read_dir(&state.backups_dir)
        .map_err(|error| io_error("Could not list backups", error))?
        .filter_map(Result::ok)
        .filter(|entry| {
            matches!(
                entry.path().extension().and_then(|x| x.to_str()),
                Some("db" | "jobtrack")
            )
        })
        .map(|entry| entry.path().to_string_lossy().to_string())
        .collect::<Vec<_>>();
    paths.sort();
    paths.reverse();
    Ok(paths)
}

#[tauri::command]
fn restore_backup(state: tauri::State<'_, AppState>, path: String) -> Result<String, String> {
    let _email_guard = gmail::GATE
        .try_lock()
        .map_err(|_| "Wait for Gmail to finish before restoring.")?;
    let source_path = PathBuf::from(path.trim());
    if !source_path.exists() {
        return Err("The selected backup file does not exist.".into());
    }
    let is_legacy_database = source_path.extension().and_then(|value| value.to_str()) == Some("db");
    let staging_root = state.backups_dir.join(format!(
        ".restore-staging-{}-{}",
        Local::now().timestamp_micros(),
        std::process::id()
    ));
    let database_path = if is_legacy_database {
        source_path.clone()
    } else {
        fs::create_dir_all(&staging_root)
            .map_err(|error| io_error("Could not create the restore staging folder", error))?;
        let archive_file = fs::File::open(&source_path)
            .map_err(|error| io_error("Could not open the backup archive", error))?;
        let mut archive = ZipArchive::new(archive_file)
            .map_err(|error| format!("The selected backup archive is invalid: {error}"))?;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| format!("Could not inspect the backup archive: {error}"))?;
            let enclosed = entry
                .enclosed_name()
                .ok_or_else(|| "The backup contains an unsafe file path.".to_string())?
                .to_path_buf();
            let valid = enclosed == Path::new("jobtrack.db")
                || (enclosed.components().count() == 2 && enclosed.starts_with("resumes"));
            if !valid || entry.is_dir() {
                return Err("The backup contains an unexpected file.".into());
            }
            let destination = staging_root.join(&enclosed);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| io_error("Could not stage the backup", error))?;
            }
            let mut output = fs::File::create(destination)
                .map_err(|error| io_error("Could not stage a backup file", error))?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|error| io_error("Could not extract a backup file", error))?;
        }
        let extracted = staging_root.join("jobtrack.db");
        if !extracted.is_file() {
            let _ = fs::remove_dir_all(&staging_root);
            return Err("The backup archive does not contain a JobTrack database.".into());
        }
        extracted
    };
    let source = Connection::open(&database_path).map_err(db_error)?;
    source
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(db_error)
        .and_then(|result| {
            if result == "ok" {
                Ok(())
            } else {
                Err("The selected backup failed its integrity check.".into())
            }
        })?;
    let mut destination = lock(&state)?;
    create_backup_file(&destination, &state.backups_dir, &state.resumes_dir, None)?;
    let rollback_dir = state.backups_dir.join(format!(
        ".resume-rollback-{}-{}",
        Local::now().timestamp_micros(),
        std::process::id()
    ));
    let mut swapped_resumes = false;
    if !is_legacy_database {
        if state.resumes_dir.exists() {
            fs::rename(&state.resumes_dir, &rollback_dir)
                .map_err(|error| io_error("Could not stage current resumes for restore", error))?;
        }
        let staged_resumes = staging_root.join("resumes");
        if staged_resumes.exists() {
            if let Err(error) = fs::rename(&staged_resumes, &state.resumes_dir) {
                if rollback_dir.exists() {
                    let _ = fs::rename(&rollback_dir, &state.resumes_dir);
                }
                return Err(io_error("Could not restore managed resumes", error));
            }
        } else {
            fs::create_dir_all(&state.resumes_dir)
                .map_err(|error| io_error("Could not create the restored resume folder", error))?;
        }
        swapped_resumes = true;
    }
    {
        let backup = Backup::new(&source, &mut destination).map_err(db_error)?;
        if let Err(error) = backup.run_to_completion(5, StdDuration::from_millis(100), None) {
            if swapped_resumes {
                let _ = fs::remove_dir_all(&state.resumes_dir);
                if rollback_dir.exists() {
                    let _ = fs::rename(&rollback_dir, &state.resumes_dir);
                }
            }
            return Err(db_error(error));
        }
    }
    initialize_schema(&destination)?;
    gmail::clear_credentials(&destination)?;
    destination
        .execute("UPDATE email_accounts SET reconnect_required=1", [])
        .map_err(db_error)?;
    drop(destination);
    if rollback_dir.exists() {
        let _ = fs::remove_dir_all(&rollback_dir);
    }
    if staging_root.exists() {
        let _ = fs::remove_dir_all(&staging_root);
    }
    Ok(if is_legacy_database {
        "Legacy database restored. Managed resume files were left unchanged. A safety backup was created."
    } else {
        "Backup restored with managed resume files. A safety backup was created."
    }.into())
}

fn csv_to_input(row: CsvApplication) -> ApplicationInput {
    let option = |value: String| {
        if value.trim().is_empty() {
            None
        } else {
            Some(value.trim().to_string())
        }
    };
    ApplicationInput {
        company: row.company,
        position: row.position,
        status: row.status,
        location: option(row.location),
        work_arrangement: option(row.work_arrangement),
        employment_type: option(row.employment_type),
        job_url: option(row.job_url),
        salary_range: option(row.salary_range),
        contact_name: option(row.contact_name),
        contact_email: option(row.contact_email),
        date_applied: option(row.date_applied),
        follow_up_date: option(row.follow_up_date),
        follow_up_completed: false,
        interview_date: option(row.interview_date),
        source: option(row.source),
        notes: option(row.notes),
        resume_id: None,
    }
}

fn read_csv(path: &str) -> Result<Vec<Result<ApplicationInput, String>>, String> {
    let mut reader = csv::Reader::from_path(path)
        .map_err(|error| format!("Could not open the CSV file: {error}"))?;
    Ok(reader
        .deserialize::<CsvApplication>()
        .enumerate()
        .map(|(index, value)| {
            value
                .map(csv_to_input)
                .map_err(|error| format!("Row {}: {error}", index + 2))
        })
        .collect())
}

#[tauri::command]
fn export_csv(state: tauri::State<'_, AppState>, path: Option<String>) -> Result<String, String> {
    let path = path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            state.exports_dir.join(format!(
                "jobtrack-export-{}.csv",
                Local::now().format("%Y%m%d-%H%M%S")
            ))
        });
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error("Could not create the export folder", error))?;
    }
    let connection = lock(&state)?;
    let mut statement = connection
        .prepare(&format!(
            "{SELECT_APPLICATION} WHERE deleted_at IS NULL ORDER BY updated_at DESC"
        ))
        .map_err(db_error)?;
    let applications = statement
        .query_map([], map_application)
        .map_err(db_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(db_error)?;
    let mut writer = csv::Writer::from_path(&path)
        .map_err(|error| format!("Could not create the CSV file: {error}"))?;
    for app in applications {
        writer
            .serialize(CsvApplication {
                company: app.company,
                position: app.position,
                status: app.status,
                location: app.location.unwrap_or_default(),
                work_arrangement: app.work_arrangement.unwrap_or_default(),
                employment_type: app.employment_type.unwrap_or_default(),
                job_url: app.job_url.unwrap_or_default(),
                salary_range: app.salary_range.unwrap_or_default(),
                contact_name: app.contact_name.unwrap_or_default(),
                contact_email: app.contact_email.unwrap_or_default(),
                date_applied: app.date_applied.unwrap_or_default(),
                follow_up_date: app.follow_up_date.unwrap_or_default(),
                interview_date: app.interview_date.unwrap_or_default(),
                source: app.source.unwrap_or_default(),
                notes: app.notes.unwrap_or_default(),
            })
            .map_err(|error| format!("Could not write the CSV file: {error}"))?;
    }
    writer
        .flush()
        .map_err(|error| io_error("Could not finish the CSV export", error))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn preview_csv_import(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<ImportPreview, String> {
    let rows = read_csv(&path)?;
    let connection = lock(&state)?;
    let mut preview = ImportPreview {
        total: rows.len(),
        valid: 0,
        duplicates: 0,
        errors: vec![],
    };
    for (index, row) in rows.into_iter().enumerate() {
        match row {
            Err(error) => preview.errors.push(error),
            Ok(input) => match validate_application(&input) {
                Err(error) => preview.errors.push(format!("Row {}: {error}", index + 2)),
                Ok(()) => {
                    preview.valid += 1;
                    if !duplicate_matches(
                        &connection,
                        &input.company,
                        &input.position,
                        input.job_url.as_deref(),
                        None,
                    )?
                    .is_empty()
                    {
                        preview.duplicates += 1;
                    }
                }
            },
        }
    }
    Ok(preview)
}

#[tauri::command]
fn import_csv(
    state: tauri::State<'_, AppState>,
    path: String,
    skip_duplicates: bool,
) -> Result<usize, String> {
    let rows = read_csv(&path)?;
    let mut connection = lock(&state)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let mut count = 0;
    for (index, row) in rows.into_iter().enumerate() {
        let input = row?;
        validate_application(&input).map_err(|error| format!("Row {}: {error}", index + 2))?;
        if skip_duplicates
            && !duplicate_matches(
                &transaction,
                &input.company,
                &input.position,
                input.job_url.as_deref(),
                None,
            )?
            .is_empty()
        {
            continue;
        }
        transaction
            .execute(
                "INSERT INTO applications(company,position,status,location,work_arrangement,employment_type,job_url,salary_range,contact_name,contact_email,date_applied,follow_up_date,follow_up_completed,interview_date,source,notes)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,0,?13,?14,?15)",
                params![input.company.trim(),input.position.trim(),input.status,input.location,input.work_arrangement,input.employment_type,input.job_url,input.salary_range,input.contact_name,input.contact_email,input.date_applied,input.follow_up_date,input.interview_date,input.source,input.notes],
            )
            .map_err(db_error)?;
        let id = transaction.last_insert_rowid();
        insert_activity(
            &transaction,
            id,
            "Application",
            &input
                .date_applied
                .as_ref()
                .map(|date| format!("{date} 12:00:00"))
                .unwrap_or_else(|| Local::now().format("%Y-%m-%d %H:%M:%S").to_string()),
            Some("Imported from CSV"),
            None,
            Some(&input.status),
        )?;
        count += 1;
    }
    transaction.commit().map_err(db_error)?;
    Ok(count)
}

#[tauri::command]
fn get_analytics(state: tauri::State<'_, AppState>) -> Result<Analytics, String> {
    let connection = lock(&state)?;
    let breakdown = |field: &str| -> Result<Vec<OutcomeBreakdown>, String> {
        let sql = format!(
            "SELECT COALESCE({field},'Unknown'),COUNT(*),
               SUM(CASE WHEN status IN ('Interviewing','Offer') THEN 1 ELSE 0 END),
               SUM(CASE WHEN status='Offer' THEN 1 ELSE 0 END)
             FROM applications WHERE deleted_at IS NULL
             GROUP BY COALESCE({field},'Unknown') ORDER BY COUNT(*) DESC"
        );
        let mut statement = connection.prepare(&sql).map_err(db_error)?;
        let result = statement
            .query_map([], |row| {
                Ok(OutcomeBreakdown {
                    label: row.get(0)?,
                    total: row.get(1)?,
                    interviews: row.get(2)?,
                    offers: row.get(3)?,
                })
            })
            .map_err(db_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(db_error);
        result
    };
    let mut average_stage_days = HashMap::new();
    for status in STATUSES {
        let value = connection
            .query_row(
                "SELECT AVG(julianday(COALESCE(next_at,CURRENT_TIMESTAMP))-julianday(occurred_at))
                 FROM (
                   SELECT x.occurred_at,
                     (SELECT MIN(y.occurred_at) FROM activities y WHERE y.application_id=x.application_id AND y.occurred_at>x.occurred_at AND y.activity_type='Status Change') next_at
                   FROM activities x WHERE x.activity_type='Status Change' AND x.to_status=?1
                 )",
                [status],
                |row| row.get::<_, Option<f64>>(0),
            )
            .map_err(db_error)?;
        if let Some(days) = value {
            average_stage_days.insert(status.to_string(), (days * 10.0).round() / 10.0);
        }
    }
    Ok(Analytics {
        by_source: breakdown("source")?,
        by_work_arrangement: breakdown("work_arrangement")?,
        average_stage_days,
    })
}

#[tauri::command]
fn insert_sample_data(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let mut connection = lock(&state)?;
    let transaction = connection.transaction().map_err(db_error)?;
    let exists: Option<String> = transaction
        .query_row(
            "SELECT value FROM app_metadata WHERE key='sample_data'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    if exists.is_some() {
        return Ok(0);
    }
    let today = Local::now().date_naive();
    let samples = [
        (
            "Northstar Labs",
            "Senior Product Designer",
            "Interviewing",
            "Chicago, IL",
            "Hybrid",
            "Full-time",
            -18,
            1,
            "LinkedIn",
            "Second-round portfolio review scheduled.",
        ),
        (
            "Evergreen Health",
            "UX Researcher",
            "Applied",
            "Remote",
            "Remote",
            "Full-time",
            -9,
            3,
            "Company Website",
            "Sent tailored research case study.",
        ),
        (
            "Lakefront Analytics",
            "Product Manager",
            "Phone Screen",
            "Chicago, IL",
            "On-site",
            "Full-time",
            -12,
            0,
            "Referral",
            "Referred by a former colleague.",
        ),
        (
            "Bluebird Studio",
            "Design Systems Lead",
            "Interested",
            "Remote",
            "Remote",
            "Contract",
            -2,
            6,
            "Recruiter",
            "Review contract scope before responding.",
        ),
        (
            "Acme Financial",
            "UX Designer",
            "Rejected",
            "Milwaukee, WI",
            "Hybrid",
            "Full-time",
            -35,
            -20,
            "Indeed",
            "Role closed after final interview.",
        ),
    ];
    for sample in samples {
        let applied = (today + Duration::days(sample.6))
            .format("%Y-%m-%d")
            .to_string();
        let follow_up = (today + Duration::days(sample.7))
            .format("%Y-%m-%d")
            .to_string();
        transaction
            .execute(
                "INSERT INTO applications(company,position,status,location,work_arrangement,employment_type,date_applied,follow_up_date,source,notes,follow_up_completed)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,CASE WHEN ?3='Rejected' THEN 1 ELSE 0 END)",
                params![sample.0,sample.1,sample.2,sample.3,sample.4,sample.5,applied,follow_up,sample.8,sample.9],
            )
            .map_err(db_error)?;
        let id = transaction.last_insert_rowid();
        insert_activity(
            &transaction,
            id,
            "Application",
            &format!("{applied} 12:00:00"),
            Some("Sample application"),
            None,
            Some(sample.2),
        )?;
        transaction
            .execute(
                "INSERT INTO tasks(application_id,title,due_at,completed,priority) VALUES(?1,?2,?3,?4,?5)",
                params![id,format!("Follow up with {}",sample.0),format!("{follow_up} 09:00:00"),(sample.2=="Rejected") as i64,if sample.7<=0{"High"}else{"Normal"}],
            )
            .map_err(db_error)?;
    }
    transaction
        .execute(
            "INSERT INTO app_metadata(key,value) VALUES('sample_data','1')",
            [],
        )
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    Ok(samples.len())
}

#[tauri::command]
fn delete_all_applications(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    let mut connection = lock(&state)?;
    let transaction = connection.transaction().map_err(db_error)?;
    transaction.execute("UPDATE email_messages SET application_id=NULL,disposition='review' WHERE application_id IS NOT NULL", []).map_err(db_error)?;
    let count = transaction
        .execute("DELETE FROM applications", [])
        .map_err(db_error)?;
    transaction
        .execute("DELETE FROM app_metadata WHERE key='sample_data'", [])
        .map_err(db_error)?;
    transaction.commit().map_err(db_error)?;
    Ok(count)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("The URL is invalid.".into());
    }
    #[cfg(target_os = "windows")]
    std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn()
        .map_err(|error| io_error("Windows could not open the link", error))?;
    #[cfg(not(target_os = "windows"))]
    return Err("Opening links is currently supported on Windows.".into());
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let directory = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            fs::create_dir_all(&directory)?;
            let path = directory.join("jobtrack.db");
            let backups_dir = directory.join("backups");
            let exports_dir = directory.join("exports");
            let resumes_dir = directory.join("resumes");
            let connection = Connection::open(&path).map_err(db_error)?;
            initialize_schema(&connection)?;
            fs::create_dir_all(&resumes_dir)?;
            automatic_backup(&connection, &backups_dir, &resumes_dir)?;
            app.manage(AppState {
                connection: Mutex::new(connection),
                path,
                backups_dir,
                exports_dir,
                resumes_dir,
            });
            gmail::setup(app)?;
            capture::setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture::capture_setup,
            gmail::gmail_action,
            initialize_database,
            get_database_path,
            get_applications,
            get_application,
            check_duplicates,
            create_application,
            update_application,
            delete_application,
            undo_last_delete,
            bulk_update_status,
            get_dashboard_statistics,
            get_activities,
            create_activity,
            delete_activity,
            get_tasks,
            create_task,
            set_task_completed,
            snooze_task,
            delete_task,
            get_attachments,
            create_attachment,
            delete_attachment,
            choose_resume_file,
            get_resumes,
            import_resume,
            update_resume,
            set_current_resume,
            assign_application_resume,
            delete_resume,
            open_resume,
            open_path,
            create_backup,
            list_backups,
            restore_backup,
            export_csv,
            preview_csv_import,
            import_csv,
            get_analytics,
            insert_sample_data,
            delete_all_applications,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running JobTrack");
}

#[cfg(test)]
#[path = "backend_tests.rs"]
mod tests;
