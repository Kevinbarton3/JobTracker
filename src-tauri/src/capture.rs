use super::*;
use crate::capture_transport;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Emitter;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Draft {
    company: String,
    position: String,
    location: String,
    work_arrangement: String,
    employment_type: String,
    salary_range: String,
    job_url: String,
    source: String,
    description: String,
    resume_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: u32,
    action: String,
    request_id: Option<String>,
    mode: Option<String>,
    allow_duplicate: Option<bool>,
    existing_id: Option<i64>,
    id: Option<i64>,
    draft: Option<Draft>,
}
fn canonical(raw: &str) -> Result<String, String> {
    let mut u = url::Url::parse(raw).map_err(|_| "Enter a valid job URL")?;
    if !matches!(u.scheme(), "https" | "http")
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err("Only ordinary HTTP/HTTPS job URLs are supported".into());
    }
    u.set_fragment(None);
    let pairs = u
        .query_pairs()
        .filter(|(k, _)| {
            !k.to_lowercase().starts_with("utm_")
                && !matches!(
                    k.as_ref(),
                    "trk" | "trackingId" | "refId" | "ref" | "source" | "src" | "fbclid" | "gclid"
                )
        })
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect::<Vec<_>>();
    u.set_query(None);
    if !pairs.is_empty() {
        u.query_pairs_mut().extend_pairs(pairs);
    }
    Ok(u.to_string())
}
fn input(d: Draft, mode: &str) -> Result<ApplicationInput, String> {
    if !matches!(mode, "save" | "applied") {
        return Err("Choose Save job or I applied".into());
    }
    for (value, max) in [
        (&d.company, 300),
        (&d.position, 300),
        (&d.location, 500),
        (&d.salary_range, 300),
        (&d.job_url, 4000),
        (&d.description, 40000),
    ] {
        if value.chars().count() > max {
            return Err("A captured field exceeds its length limit".into());
        }
    }
    let resume_id = if d.resume_id.is_empty() {
        None
    } else {
        Some(
            d.resume_id
                .parse::<i64>()
                .map_err(|_| "Invalid resume selection")?,
        )
    };
    let a = ApplicationInput {
        company: d.company,
        position: d.position,
        status: if mode == "applied" {
            "Applied"
        } else {
            "Interested"
        }
        .into(),
        location: trim_option(&Some(d.location)),
        work_arrangement: trim_option(&Some(d.work_arrangement)),
        employment_type: trim_option(&Some(d.employment_type)),
        job_url: Some(canonical(&d.job_url)?),
        salary_range: trim_option(&Some(d.salary_range)),
        contact_name: None,
        contact_email: None,
        date_applied: if mode == "applied" {
            Some(Local::now().format("%Y-%m-%d").to_string())
        } else {
            None
        },
        follow_up_date: None,
        follow_up_completed: false,
        interview_date: None,
        source: trim_option(&Some(d.source)),
        notes: if d.description.trim().is_empty() {
            None
        } else {
            Some(format!("Job description\n\n{}", d.description.trim()))
        },
        resume_id,
    };
    validate_application(&a)?;
    Ok(a)
}
fn save(c: &mut Connection, r: Request) -> Result<Value, String> {
    let key = r.request_id.ok_or("Missing request ID")?;
    if key.len() > 80
        || key.len() < 16
        || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid request ID".into());
    }
    let mode = r.mode.as_deref().ok_or("Missing save action")?;
    let a = input(r.draft.ok_or("Missing posting")?, mode)?;
    let tx = c.transaction().map_err(db_error)?;
    let previous: Option<i64> = tx
        .query_row(
            "SELECT application_id FROM capture_requests WHERE request_id=?1",
            [&key],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    if let Some(id) = previous {
        get_by_id(&tx, id)?;
        return Ok(json!({"id":id}));
    }
    let mut stmt = tx
        .prepare(
            "SELECT id,company,position,status,job_url FROM applications WHERE deleted_at IS NULL",
        )
        .map_err(db_error)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    drop(stmt);
    let mut matches = Vec::new();
    for (id, company, position, status, url) in rows {
        let exact = url.as_deref().and_then(|u| canonical(u).ok()) == a.job_url;
        let similar = company.trim().eq_ignore_ascii_case(a.company.trim())
            && position.trim().eq_ignore_ascii_case(a.position.trim());
        if exact || similar {
            matches.push(json!({"id":id,"company":company,"position":position,"status":status,"exact":exact}));
        }
    }
    if r.action == "duplicates" {
        return Ok(json!({"matches":matches}));
    }
    let id = if let Some(id) = r.existing_id {
        if mode != "applied" || !matches.iter().any(|m| m["id"].as_i64() == Some(id)) {
            return Err("Existing application does not match this posting".into());
        }
        let old = get_by_id(&tx, id)?;
        if !matches!(old.status.as_str(), "Interested" | "Applied") {
            return Err(
                "An advanced application status cannot be replaced by Chrome capture".into(),
            );
        }
        if old.status == "Interested" {
            tx.execute("UPDATE applications SET status='Applied',date_applied=COALESCE(date_applied,?1),updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![a.date_applied,id]).map_err(db_error)?;
            insert_activity(
                &tx,
                id,
                "Status Change",
                &Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                Some("Marked applied from Chrome"),
                Some(&old.status),
                Some("Applied"),
            )?;
        }
        id
    } else {
        if !matches.is_empty()
            && (!r.allow_duplicate.unwrap_or(false) || matches.iter().any(|m| m["exact"] == true))
        {
            return Ok(json!({"matches":matches}));
        }
        create_application_record(&tx, a)?.id
    };
    tx.execute(
        "INSERT INTO capture_requests(request_id,application_id) VALUES(?1,?2)",
        params![key, id],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(json!({"id":id}))
}
fn handle(app: &tauri::AppHandle, data: &[u8]) -> Result<Value, String> {
    if data.len() > capture_transport::MAX_MESSAGE {
        return Err("Capture request too large".into());
    }
    let r: Request = serde_json::from_slice(data).map_err(|_| "Invalid capture request")?;
    if r.version != 1 {
        return Err("Update the JobTracker extension".into());
    }
    match r.action.as_str() {
        "ping" => Ok(json!({"version":1,"connected":true})),
        "resumes" => {
            let state = app.state::<AppState>();
            let c = lock(&state)?;
            let mut st = c
                .prepare("SELECT id,name FROM resumes WHERE deleted_at IS NULL ORDER BY name")
                .map_err(db_error)?;
            let rows = st
                .query_map([], |r| {
                    Ok(json!({"id":r.get::<_,i64>(0)?,"name":r.get::<_,String>(1)?}))
                })
                .map_err(db_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(db_error)?;
            Ok(json!(rows))
        }
        "save" | "duplicates" => {
            let state = app.state::<AppState>();
            let result = save(&mut *lock(&state)?, r)?;
            let _ = app.emit("capture-changed", ());
            Ok(result)
        }
        "open" => {
            let id = r.id.ok_or("Missing application ID")?;
            {
                let state = app.state::<AppState>();
                get_by_id(&*lock(&state)?, id)?;
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            app.emit("capture-open", id).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        _ => Err("Unknown capture operation".into()),
    }
}
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let a = app.handle().clone();
    capture_transport::serve(move |data| {
        let response = match handle(&a, data) {
            Ok(data) => json!({"ok":true,"data":data}),
            Err(error) => json!({"ok":false,"error":error}),
        };
        serde_json::to_vec(&response).unwrap_or_default()
    })
    .map_err(std::io::Error::other)?;
    Ok(())
}
#[tauri::command]
pub fn capture_setup(app: tauri::AppHandle, install: bool) -> Result<Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let helper = exe.with_file_name("jobtrack-capture-host.exe");
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let manifest = directory.join("chrome-native-host.json");
    if install {
        if !helper.is_file() {
            return Err("Build jobtrack-capture-host.exe beside JobTracker before installing the connection.".into());
        }
        fs::write(&manifest,serde_json::to_vec_pretty(&json!({"name":"com.jobtrack.capture","description":"JobTracker Chrome capture bridge","path":helper,"type":"stdio","allowed_origins":[format!("chrome-extension://{}/",capture_transport::EXTENSION_ID.trim())]})).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        let result = std::process::Command::new("reg.exe")
            .args([
                "add",
                r"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jobtrack.capture",
                "/ve",
                "/t",
                "REG_SZ",
                "/d",
            ])
            .arg(&manifest)
            .arg("/f")
            .output()
            .map_err(|_| "Could not register Chrome connection")?;
        if !result.status.success() {
            return Err("Chrome native-host registration failed".into());
        }
    }
    let request = serde_json::to_vec(&json!({"version":1,"action":"ping"})).unwrap();
    let connected = capture_transport::exchange(&request)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .is_some_and(|v| v["ok"] == true);
    Ok(
        json!({"connected":connected,"helperAvailable":helper.is_file(),"registered":std::process::Command::new("reg.exe").args(["query",r"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jobtrack.capture","/ve"]).output().ok().is_some_and(|r|r.status.success()&&String::from_utf8_lossy(&r.stdout).contains(manifest.to_string_lossy().as_ref())),"extensionId":capture_transport::EXTENSION_ID.trim()}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        initialize_schema(&c).unwrap();
        c
    }
    fn req(id: &str, mode: &str) -> Request {
        serde_json::from_value(json!({"version":1,"action":"save","requestId":id,"mode":mode,"draft":{"company":"Acme","position":"Engineer","location":"","workArrangement":"","employmentType":"","salaryRange":"","jobUrl":"https://example.com/jobs/12?utm_source=test&jobId=12","source":"Company Website","description":"Role description","resumeId":""}})).unwrap()
    }
    #[test]
    fn retries_and_duplicates() {
        let mut c = fixture();
        let r = save(&mut c, req("request-000000000001", "save")).unwrap();
        assert_eq!(
            r,
            save(&mut c, req("request-000000000001", "save")).unwrap()
        );
        assert!(
            save(&mut c, req("request-000000000002", "applied")).unwrap()["matches"].is_array()
        );
        let mut update = req("request-000000000003", "applied");
        update.existing_id = r["id"].as_i64();
        save(&mut c, update).unwrap();
        let app = get_by_id(&c, r["id"].as_i64().unwrap()).unwrap();
        assert_eq!(app.status, "Applied");
        assert!(app.date_applied.is_some());
        assert_eq!(
            app.notes.as_deref(),
            Some("Job description\n\nRole description")
        );
        assert!(app.resume_id.is_none());
    }
    #[test]
    fn interested_and_validation() {
        let mut c = fixture();
        let r = save(&mut c, req("request-000000000001", "save")).unwrap();
        assert!(get_by_id(&c, r["id"].as_i64().unwrap())
            .unwrap()
            .date_applied
            .is_none());
        let mut bad = req("request-000000000002", "save");
        bad.draft.as_mut().unwrap().company.clear();
        assert!(save(&mut c, bad).is_err());
        assert!(canonical("javascript:alert(1)").is_err());
        assert_eq!(
            canonical("https://example.com/jobs?id=42&utm_campaign=x").unwrap(),
            "https://example.com/jobs?id=42"
        );
    }
    #[test]
    fn advanced_status_is_preserved() {
        let mut c = fixture();
        let r = save(&mut c, req("request-000000000001", "save")).unwrap();
        let id = r["id"].as_i64().unwrap();
        c.execute("UPDATE applications SET status='Offer' WHERE id=?1", [id])
            .unwrap();
        let mut update = req("request-000000000002", "applied");
        update.existing_id = Some(id);
        assert!(save(&mut c, update).is_err());
        assert_eq!(get_by_id(&c, id).unwrap().status, "Offer");
    }
}

#[cfg(test)]
mod bridge_tests {
    use super::*;
    #[test]
    fn pipe_save_ack_and_retry_use_fixture_database() {
        let c = Connection::open_in_memory().unwrap();
        initialize_schema(&c).unwrap();
        let database = std::sync::Arc::new(Mutex::new(c));
        let worker = database.clone();
        capture_transport::serve(move |bytes| {
            let result = serde_json::from_slice::<Request>(bytes)
                .map_err(|_| "Invalid request".to_string())
                .and_then(|r| save(&mut worker.lock().unwrap(), r));
            serde_json::to_vec(&match result {
                Ok(data) => json!({"ok":true,"data":data}),
                Err(e) => json!({"ok":false,"error":e}),
            })
            .unwrap()
        })
        .unwrap();
        let bytes=serde_json::to_vec(&json!({"version":1,"action":"save","requestId":"pipe-fixture-0000001","mode":"applied","draft":{"company":"Fixture","position":"Engineer","location":"","workArrangement":"","employmentType":"","salaryRange":"","jobUrl":"https://example.org/jobs/1","source":"Other","description":"Fixture only","resumeId":""}})).unwrap();
        let first = capture_transport::exchange(&bytes).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let second = capture_transport::exchange(&bytes).unwrap();
        assert_eq!(first, second);
        let result: Value = serde_json::from_slice(&first).unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(
            database
                .lock()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM applications", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn activity_failure_rolls_back_capture() {
        let mut c = Connection::open_in_memory().unwrap();
        initialize_schema(&c).unwrap();
        c.execute_batch("CREATE TRIGGER reject_activity BEFORE INSERT ON activities BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
        let r:Request=serde_json::from_value(json!({"version":1,"action":"save","requestId":"rollback-fixture-00001","mode":"save","draft":{"company":"Fixture","position":"Engineer","location":"","workArrangement":"","employmentType":"","salaryRange":"","jobUrl":"https://example.org/jobs/1","source":"Other","description":"","resumeId":""}})).unwrap();
        assert!(save(&mut c, r).is_err());
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM applications", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[cfg(test)]
mod request_tests {
    use super::*;
    #[test]
    fn rejects_unknown_fields_and_invalid_resumes() {
        assert!(serde_json::from_value::<Request>(
            json!({"version":1,"action":"ping","unexpected":"value"})
        )
        .is_err());
        let mut c = Connection::open_in_memory().unwrap();
        initialize_schema(&c).unwrap();
        let r:Request=serde_json::from_value(json!({"version":1,"action":"save","requestId":"resume-fixture-00001","mode":"applied","draft":{"company":"Fixture","position":"Engineer","location":"","workArrangement":"","employmentType":"","salaryRange":"","jobUrl":"https://example.org/jobs/1","source":"Other","description":"","resumeId":"999999"}})).unwrap();
        assert!(save(&mut c, r).is_err());
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM applications", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn duplicate_check_does_not_write() {
        let mut c = Connection::open_in_memory().unwrap();
        initialize_schema(&c).unwrap();
        let r:Request=serde_json::from_value(json!({"version":1,"action":"duplicates","requestId":"duplicate-check-00001","mode":"save","draft":{"company":"Fixture","position":"Engineer","location":"","workArrangement":"","employmentType":"","salaryRange":"","jobUrl":"https://example.org/jobs/1","source":"Other","description":"","resumeId":""}})).unwrap();
        assert_eq!(save(&mut c, r).unwrap()["matches"], json!([]));
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM applications", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
