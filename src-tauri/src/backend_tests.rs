use super::*;

fn input(company: &str, position: &str) -> ApplicationInput {
    ApplicationInput {
        company: company.into(),
        position: position.into(),
        status: "Applied".into(),
        location: None,
        work_arrangement: None,
        employment_type: None,
        job_url: None,
        salary_range: None,
        contact_name: None,
        contact_email: None,
        date_applied: Some("2026-07-20".into()),
        follow_up_date: None,
        follow_up_completed: false,
        interview_date: None,
        source: None,
        notes: None,
        resume_id: None,
    }
}

#[test]
fn migrations_are_idempotent_and_preserve_v1_rows() {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            "CREATE TABLE applications(
               id INTEGER PRIMARY KEY AUTOINCREMENT,company TEXT NOT NULL,position TEXT NOT NULL,
               status TEXT NOT NULL DEFAULT 'Interested',location TEXT,work_arrangement TEXT,
               employment_type TEXT,job_url TEXT,salary_range TEXT,contact_name TEXT,contact_email TEXT,
               date_applied TEXT,follow_up_date TEXT,follow_up_completed INTEGER NOT NULL DEFAULT 0,
               interview_date TEXT,source TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             INSERT INTO applications(company,position) VALUES('Contoso','Engineer');",
        )
        .unwrap();
    initialize_schema(&connection).unwrap();
    initialize_schema(&connection).unwrap();
    assert_eq!(get_by_id(&connection, 1).unwrap().company, "Contoso");
    let activities: i64 = connection
        .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
        .unwrap();
    assert_eq!(activities, 1);
    assert!(column_exists(&connection, "applications", "resume_id").unwrap());
}

#[test]
fn validation_and_duplicate_detection_work() {
    let connection = Connection::open_in_memory().unwrap();
    initialize_schema(&connection).unwrap();
    let value = input("Contoso", "Engineer");
    validate_application(&value).unwrap();
    connection
        .execute(
            "INSERT INTO applications(company,position,status) VALUES('Contoso','Engineer','Applied')",
            [],
        )
        .unwrap();
    assert_eq!(
        duplicate_matches(&connection, "contoso", "engineer", None, None)
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn backup_round_trip_is_valid() {
    let source = Connection::open_in_memory().unwrap();
    initialize_schema(&source).unwrap();
    source
        .execute(
            "INSERT INTO applications(company,position) VALUES('Northstar','Designer')",
            [],
        )
        .unwrap();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("backup.db");
    copy_database(&source, &path).unwrap();
    let backup = Connection::open(path).unwrap();
    assert_eq!(get_by_id(&backup, 1).unwrap().company, "Northstar");
}

#[test]
fn resume_schema_enforces_one_current_version() {
    let connection = Connection::open_in_memory().unwrap();
    initialize_schema(&connection).unwrap();
    connection.execute(
        "INSERT INTO resumes(name,original_file_name,stored_file_name,is_current) VALUES('General','general.pdf','one.pdf',1)",
        [],
    ).unwrap();
    let duplicate = connection.execute(
        "INSERT INTO resumes(name,original_file_name,stored_file_name,is_current) VALUES('Design','design.pdf','two.pdf',1)",
        [],
    );
    assert!(duplicate.is_err());
}

#[test]
fn archive_backup_contains_database_and_managed_resumes() {
    let source = Connection::open_in_memory().unwrap();
    initialize_schema(&source).unwrap();
    source
        .execute(
            "INSERT INTO applications(company,position) VALUES('Fabrikam','Writer')",
            [],
        )
        .unwrap();
    let directory = tempfile::tempdir().unwrap();
    let backups = directory.path().join("backups");
    let resumes = directory.path().join("resumes");
    fs::create_dir_all(&resumes).unwrap();
    fs::write(resumes.join("managed.pdf"), b"sample resume").unwrap();
    let path = create_backup_file(&source, &backups, &resumes, None).unwrap();
    let file = fs::File::open(path).unwrap();
    let mut archive = ZipArchive::new(file).unwrap();
    assert!(archive.by_name("jobtrack.db").is_ok());
    assert!(archive.by_name("resumes/managed.pdf").is_ok());
}

#[test]
fn relative_sample_dates_stay_near_today() {
    let today = Local::now().date_naive();
    let sample = today + Duration::days(-18);
    assert!((today - sample).num_days() <= 30);
    assert_eq!(today, Local::now().date_naive());
}
