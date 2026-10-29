use super::{db_error, lock, AppState};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

pub static GATE: Mutex<()> = Mutex::new(());
static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static ERROR: Mutex<Option<String>> = Mutex::new(None);
static PROGRESS: Mutex<Option<String>> = Mutex::new(None);
static NEXT_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);
fn progress(message: Option<String>) {
    if let Ok(mut p) = PROGRESS.lock() {
        *p = message;
    }
}
fn wait_sync(delay: Duration) -> Result<(), String> {
    let until = Instant::now() + delay;
    while Instant::now() < until {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("Gmail operation cancelled. You can sync again later.".into());
        }
        std::thread::sleep(
            until
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(250)),
        );
    }
    Ok(())
}
fn retryable(status: u16, body: &Value) -> bool {
    if status == 429 || status >= 500 {
        return true;
    }
    if status != 403 {
        return false;
    }
    ["errors", "details"].iter().any(|field| {
        body["error"][field].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                matches!(
                    item["reason"].as_str(),
                    Some("rateLimitExceeded" | "userRateLimitExceeded" | "RATE_LIMIT_EXCEEDED")
                )
            })
        })
    })
}
fn retry_delay(attempt: u32, retry_after: Option<&str>) -> Duration {
    let server = retry_after
        .and_then(|v| {
            v.parse::<u64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc2822(v)
                    .ok()
                    .map(|d| (d.timestamp() - chrono::Utc::now().timestamp()).max(0) as u64)
            })
        })
        .unwrap_or(0);
    Duration::from_secs((15u64 << attempt.min(3)).max(server))
}
fn gmail_get(
    http: &reqwest::blocking::Client,
    token: &str,
    path: &str,
    query: &[(&str, String)],
) -> Result<Option<Value>, String> {
    for attempt in 0..=4 {
        {
            let mut next = NEXT_REQUEST
                .lock()
                .map_err(|_| "Gmail pacing unavailable")?;
            if let Some(at) = *next {
                wait_sync(at.saturating_duration_since(Instant::now()))?;
            }
            *next = Some(Instant::now() + Duration::from_secs(1));
        }
        let r = http
            .get(format!(
                "https://gmail.googleapis.com/gmail/v1/users/me/{path}"
            ))
            .bearer_auth(token)
            .query(query)
            .send()
            .map_err(|_| "Cannot reach Gmail. Sync will retry when online.".to_string())?;
        let status = r.status().as_u16();
        if status == 404 {
            return Ok(None);
        }
        if r.status().is_success() {
            return response(r).map(Some);
        }
        let after = r
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let mut bytes = Vec::new();
        let _ = r.take(16 * 1024).read_to_end(&mut bytes);
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        let delay = retry_delay(attempt, after.as_deref());
        if attempt == 4 || !retryable(status, &body) || delay > Duration::from_secs(300) {
            return Err(google_error(status, &body));
        }
        progress(Some(format!("Google asked us to slow down. Retrying automatically in about {} seconds (retry {} of 4).",delay.as_secs(),attempt+1)));
        wait_sync(delay + Duration::from_millis(u64::from(rand::random::<u16>() % 1000)))?;
    }
    unreachable!()
}

const SERVICE: &str = "com.jobtrack.desktop.gmail";
fn secret(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, name)
        .map_err(|_| "Windows Credential Manager is unavailable.".into())
}
fn read_secret(name: &str) -> Result<String, String> {
    secret(name)?
        .get_password()
        .map_err(|_| "Reconnect Gmail to continue.".into())
}
fn set_secret(name: &str, value: &str) -> Result<(), String> {
    secret(name)?
        .set_password(value)
        .map_err(|_| "Could not save Gmail credentials in Windows Credential Manager.".into())
}
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize Gmail connection.".into())
}
// Read only Google's error fields; never display or log the full response or tokens.
fn google_error(status: u16, body: &Value) -> String {
    let error = &body["error"];
    let mut reasons = Vec::new();
    if let Some(code) = error.as_str() {
        reasons.push(code);
    }
    for field in ["errors", "details"] {
        if let Some(items) = error[field].as_array() {
            for item in items {
                if let Some(reason) = item["reason"].as_str() {
                    reasons.push(reason);
                }
            }
        }
    }
    let has = |codes: &[&str]| {
        reasons
            .iter()
            .any(|r| codes.iter().any(|c| r.eq_ignore_ascii_case(c)))
    };
    let advice = if has(&["accessNotConfigured", "SERVICE_DISABLED", "API_DISABLED"]) {
        "Gmail API is disabled for the project used by your imported OAuth client. Enable Gmail API in that same project, wait a few minutes, then retry. If you enabled it in a different project, import the Desktop client JSON from the enabled project."
    } else if has(&["insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"]) {
        "Google did not grant the Gmail read permission. Reconnect Gmail and grant the requested Gmail access on Google's consent screen."
    } else if has(&["domainPolicy", "ORG_RESTRICTION_VIOLATION"]) {
        "Your Google Workspace organization blocks this access. Contact its administrator or connect your personal job-search Gmail account."
    } else if has(&[
        "rateLimitExceeded",
        "userRateLimitExceeded",
        "dailyLimitExceeded",
        "quotaExceeded",
        "RATE_LIMIT_EXCEEDED",
    ]) || status == 429
    {
        "Google's request or quota limit was reached. Wait before syncing again; reconnecting will not fix this limit."
    } else if has(&["invalid_client", "unauthorized_client"]) {
        "Google rejected the OAuth client. Import the correct Desktop app client JSON from your JobTracker project and connect again."
    } else if has(&["invalid_grant", "authError"]) || status == 401 {
        "Google authorization expired or was revoked. Reconnect Gmail."
    } else if status >= 500 {
        "Google's service is temporarily unavailable. Retry later."
    } else {
        "Google refused the request. Check the Google reason below before changing your setup."
    };
    let codes = reasons
        .into_iter()
        .filter(|r| r.len() <= 100 && r.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
        .collect::<Vec<_>>()
        .join(", ");
    let detail = error["message"]
        .as_str()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(500)
        .collect::<String>();
    format!(
        "Gmail request failed (HTTP {status}). {advice}{}{}",
        if codes.is_empty() {
            String::new()
        } else {
            format!(" Google reason: {codes}.")
        },
        if detail.is_empty() {
            String::new()
        } else {
            format!(" Google message: {detail}")
        }
    )
}
fn response(r: reqwest::blocking::Response) -> Result<Value, String> {
    let status = r.status();
    if !status.is_success() {
        // Bound error-body reads even if a proxy returns an unexpectedly large page.
        let mut bytes = Vec::new();
        let _ = r.take(16 * 1024).read_to_end(&mut bytes);
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        return Err(google_error(status.as_u16(), &body));
    }
    r.json()
        .map_err(|_| "Gmail returned an invalid response.".into())
}
fn random() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
fn config() -> Result<Value, String> {
    serde_json::from_str(&read_secret("client")?)
        .map_err(|_| "Import Google Desktop client configuration first.".into())
}
fn strval<'a>(v: &'a Value, k: &str) -> Result<&'a str, String> {
    v[k].as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Missing {k} in Google response/configuration."))
}
fn api(
    http: &reqwest::blocking::Client,
    token: &str,
    path: &str,
    query: &[(&str, String)],
) -> Result<Value, String> {
    gmail_get(http, token, path, query)?
        .ok_or_else(|| "Gmail resource is no longer available.".into())
}
fn active(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let c = lock(&state)?;
    c.query_row(
        "SELECT address FROM email_accounts WHERE reconnect_required=0 LIMIT 1",
        [],
        |r| r.get(0),
    )
    .optional()
    .map_err(db_error)
}
fn disconnect(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let c = lock(&state)?;
    clear_credentials(&c)?;
    c.execute("UPDATE email_accounts SET reconnect_required=1", [])
        .map_err(db_error)?;
    Ok(())
}
pub fn clear_credentials(c: &rusqlite::Connection) -> Result<(), String> {
    let mut st = c
        .prepare("SELECT address FROM email_accounts")
        .map_err(db_error)?;
    let addresses = st
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    for address in addresses {
        secret(&address)?
            .delete_credential()
            .or_else(|e| {
                if matches!(e, keyring::Error::NoEntry) {
                    Ok(())
                } else {
                    Err(e)
                }
            })
            .map_err(|_| {
                "Could not remove Gmail credentials from Windows Credential Manager".to_string()
            })?;
    }
    Ok(())
}
fn connect(app: &tauri::AppHandle) -> Result<(), String> {
    let cfg = config()?;
    let id = strval(&cfg, "client_id")?;
    let client_secret = cfg["client_secret"].as_str().unwrap_or("");
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "Could not open local Google sign-in callback.".to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let redirect = format!(
        "http://127.0.0.1:{}/callback",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let state = random();
    let verifier = random();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", id),
        ("redirect_uri", &redirect),
        ("response_type", "code"),
        ("scope", "https://www.googleapis.com/auth/gmail.readonly"),
        ("access_type", "offline"),
        ("prompt", "select_account consent"),
        ("state", &state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
    ]);
    CANCEL.store(false, Ordering::SeqCst);
    super::open_url(url.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(180);
    let code = loop {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("Google sign-in cancelled.".into());
        }
        if Instant::now() > deadline {
            return Err("Google sign-in timed out. Select Connect to retry.".into());
        }
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            let path = request
                .lines()
                .next()
                .and_then(|s| s.split_whitespace().nth(1))
                .unwrap_or("");
            if let Ok(u) = url::Url::parse(&format!("http://localhost{path}")) {
                let pairs: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
                if u.path() == "/callback" && pairs.get("state") == Some(&state) {
                    let _=stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nYou may return to JobTracker.");
                    if let Some(code) = pairs.get("code") {
                        break code.clone();
                    }
                    return Err("Google sign-in was declined.".into());
                }
            }
            let _ = stream.write_all(
                b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\nInvalid sign-in callback.",
            );
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let http = client()?;
    let tokens = response(
        http.post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", id),
                ("client_secret", client_secret),
                ("redirect_uri", &redirect),
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("code_verifier", &verifier),
            ])
            .send()
            .map_err(|_| "Google token exchange failed.".to_string())?,
    )?;
    let token = strval(&tokens, "access_token")?;
    let refresh = strval(&tokens, "refresh_token")?;
    let profile = api(&http, token, "profile", &[])?;
    let address = strval(&profile, "emailAddress")?;
    disconnect(app)?;
    set_secret(address, refresh)?;
    {
        let state = app.state::<AppState>();
        let c = lock(&state)?;
        c.execute("INSERT INTO email_accounts(address,reconnect_required,scan_started_at) VALUES(?1,0,datetime('now','-90 days')) ON CONFLICT(address) DO UPDATE SET reconnect_required=0",[address]).map_err(db_error)?;
    }
    app.autolaunch()
        .enable()
        .map_err(|e| format!("Gmail connected, but Windows startup could not be enabled: {e}"))?;
    Ok(())
}
fn access_token(
    app: &tauri::AppHandle,
    address: &str,
    http: &reqwest::blocking::Client,
) -> Result<String, String> {
    let cfg = config()?;
    let refresh = read_secret(address)?;
    let r = http
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", strval(&cfg, "client_id")?),
            ("client_secret", cfg["client_secret"].as_str().unwrap_or("")),
            ("refresh_token", &refresh),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|_| "Cannot reach Google. Will retry when online.".to_string())?;
    if r.status() == reqwest::StatusCode::BAD_REQUEST {
        let state = app.state::<AppState>();
        lock(&state)?
            .execute(
                "UPDATE email_accounts SET reconnect_required=1 WHERE address=?1",
                [address],
            )
            .map_err(db_error)?;
        return Err("Google authorization expired or was revoked. Reconnect Gmail.".into());
    }
    Ok(strval(&response(r)?, "access_token")?.to_owned())
}
fn sync(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(address) = active(app)? else {
        return Ok(());
    };
    let http = client()?;
    let mut token = access_token(app, &address, &http)?;
    let mut token_refreshed = Instant::now();
    let (account, history, since): (i64, Option<String>, String) = {
        let state = app.state::<AppState>();
        let c = lock(&state)?;
        c.query_row("SELECT id,history_id,COALESCE(scan_started_at,datetime('now','-90 days')) FROM email_accounts WHERE address=?1",[&address],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(db_error)?
    };
    // Capture the boundary BEFORE listing; next history sync catches arrivals during the scan.
    let profile = api(&http, &token, "profile", &[])?;
    let boundary = strval(&profile, "historyId")?.to_owned();
    let mut ids = std::collections::BTreeSet::new();
    let mut full = history.is_none();
    if let Some(h) = history {
        let mut page = String::new();
        loop {
            let mut q = vec![
                ("startHistoryId", h.clone()),
                ("historyTypes", "messageAdded".into()),
                ("maxResults", "500".into()),
            ];
            if !page.is_empty() {
                q.push(("pageToken", page.clone()));
            }
            let Some(v) = gmail_get(&http, &token, "history", &q)? else {
                full = true;
                break;
            };
            if let Some(records) = v["history"].as_array() {
                for record in records {
                    if let Some(messages) = record["messagesAdded"].as_array() {
                        for m in messages {
                            if let Some(id) = m["message"]["id"].as_str() {
                                ids.insert(id.to_owned());
                            }
                        }
                    }
                }
            }
            page = v["nextPageToken"].as_str().unwrap_or("").into();
            if page.is_empty() {
                break;
            }
        }
    }
    if full {
        let mut page = String::new();
        let date = chrono::NaiveDateTime::parse_from_str(&since, "%Y-%m-%d %H:%M:%S")
            .map_err(|_| "Invalid email scan checkpoint.".to_string())?
            .and_utc()
            .timestamp();
        loop {
            let mut q = vec![
                (
                    "q",
                    format!("after:{date} -in:spam -in:trash -in:sent -in:drafts"),
                ),
                ("maxResults", "500".into()),
            ];
            if !page.is_empty() {
                q.push(("pageToken", page.clone()));
            }
            let v = api(&http, &token, "messages", &q)?;
            if let Some(messages) = v["messages"].as_array() {
                for m in messages {
                    if let Some(id) = m["id"].as_str() {
                        ids.insert(id.to_owned());
                    }
                }
            }
            page = v["nextPageToken"].as_str().unwrap_or("").into();
            if page.is_empty() {
                break;
            }
        }
    }
    let total = ids.len();
    for (index, id) in ids.into_iter().enumerate() {
        if token_refreshed.elapsed() >= Duration::from_secs(45 * 60) {
            token = access_token(app, &address, &http)?;
            token_refreshed = Instant::now();
        }
        progress(Some(format!(
            "Checking email {} of {total}. The first scan may take a while.",
            index + 1
        )));
        let exists = {
            let state = app.state::<AppState>();
            let c = lock(&state)?;
            c.query_row(
                "SELECT EXISTS(SELECT 1 FROM email_messages WHERE account_id=?1 AND gmail_id=?2)",
                params![account, id],
                |r| r.get::<_, bool>(0),
            )
            .map_err(db_error)?
        };
        if exists {
            continue;
        }
        // Headers, labels and snippet are sufficient; full message bodies are never used.
        let Some(v) = gmail_get(
            &http,
            &token,
            &format!("messages/{id}"),
            &[
                ("format", "metadata".into()),
                ("metadataHeaders", "From".into()),
                ("metadataHeaders", "Subject".into()),
            ],
        )?
        else {
            continue;
        };
        if v["labelIds"].as_array().is_some_and(|a| {
            a.iter()
                .any(|x| matches!(x.as_str(), Some("SPAM" | "TRASH" | "SENT" | "DRAFT")))
        }) {
            continue;
        }
        let headers = v["payload"]["headers"].as_array();
        let header = |name: &str| {
            headers
                .and_then(|a| {
                    a.iter().find(|h| {
                        h["name"]
                            .as_str()
                            .is_some_and(|s| s.eq_ignore_ascii_case(name))
                    })
                })
                .and_then(|h| h["value"].as_str())
                .unwrap_or("")
                .to_owned()
        };
        let sender = header("From");
        let mailbox = mailparse::addrparse(&sender)
            .ok()
            .and_then(|a| a.extract_single_info())
            .map(|a| a.addr)
            .unwrap_or_default();
        if mailbox.eq_ignore_ascii_case(&address) {
            continue;
        }
        let subject = header("Subject");
        let preview = v["snippet"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(2000)
            .collect::<String>();
        let thread = strval(&v, "threadId")?;
        let received = v["internalDate"]
            .as_str()
            .and_then(|s| s.parse::<i64>().ok())
            .and_then(chrono::DateTime::from_timestamp_millis)
            .ok_or("Invalid Gmail timestamp")?
            .to_rfc3339();
        let state = app.state::<AppState>();
        let c = lock(&state)?;
        let mut stmt=c.prepare("SELECT id,company,position,contact_email FROM applications WHERE deleted_at IS NULL").map_err(db_error)?;
        let apps = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        let candidates = apps
            .iter()
            .map(|a| crate::email::Candidate {
                id: a.0,
                company: &a.1,
                position: &a.2,
                contact: a.3.as_deref(),
                deleted: false,
            })
            .collect::<Vec<_>>();
        let mut st=c.prepare("SELECT DISTINCT application_id FROM email_messages WHERE account_id=?1 AND thread_id=?2 AND disposition='linked' AND application_id IS NOT NULL").map_err(db_error)?;
        let linked = st
            .query_map(params![account, thread], |r| r.get::<_, i64>(0))
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        let matched =
            crate::email::match_message(&mailbox, &subject, &preview, &linked, &candidates);
        let (application, disposition) = match matched {
            crate::email::Match::Attach(id) => (Some(id), "linked"),
            crate::email::Match::Review(_) => (None, "review"),
            crate::email::Match::Irrelevant => continue,
        };
        let suggestion = crate::email::suggest_status(&preview);
        c.execute("INSERT OR IGNORE INTO email_messages(account_id,gmail_id,thread_id,sender,subject,received_at,preview,application_id,disposition,suggested_status,suggestion_excerpt) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",params![account,id,thread,sender,subject,received,preview,application,disposition,suggestion.as_ref().map(|s|s.0),suggestion.as_ref().map(|s|s.1.as_str())]).map_err(db_error)?;
    }
    let state = app.state::<AppState>();
    lock(&state)?
        .execute(
            "UPDATE email_accounts SET history_id=?1,last_success_at=datetime('now') WHERE id=?2",
            params![boundary, account],
        )
        .map_err(db_error)?;
    Ok(())
}
fn status(app: &tauri::AppHandle) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let c = lock(&state)?;
    let mut stmt=c.prepare("SELECT address,last_success_at,reconnect_required FROM email_accounts ORDER BY reconnect_required,id DESC").map_err(db_error)?;
    let accounts=stmt.query_map([],|r|Ok(json!({"address":r.get::<_,String>(0)?,"lastSync":r.get::<_,Option<String>>(1)?,"reconnect":r.get::<_,bool>(2)?}))).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
    Ok(
        json!({"configured":config().is_ok(),"accounts":accounts,"busy":BUSY.load(Ordering::SeqCst),"progress":PROGRESS.lock().map_err(|_|"Email progress unavailable")?.clone(),"error":ERROR.lock().map_err(|_|"Email state unavailable")?.clone(),"autostart":app.autolaunch().is_enabled().unwrap_or(false)}),
    )
}
fn messages(app: &tauri::AppHandle) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let c = lock(&state)?;
    let mut st=c.prepare("SELECT m.id,a.address,m.sender,m.subject,m.received_at,m.preview,m.application_id,m.disposition,m.suggested_status,m.suggestion_excerpt,m.suggestion_state,m.gmail_id FROM email_messages m JOIN email_accounts a ON a.id=m.account_id ORDER BY m.received_at DESC").map_err(db_error)?;
    let rows=st.query_map([],|r|Ok(json!({"id":r.get::<_,i64>(0)?,"account":r.get::<_,String>(1)?,"sender":r.get::<_,String>(2)?,"subject":r.get::<_,String>(3)?,"receivedAt":r.get::<_,String>(4)?,"preview":r.get::<_,String>(5)?,"applicationId":r.get::<_,Option<i64>>(6)?,"disposition":r.get::<_,String>(7)?,"suggestedStatus":r.get::<_,Option<String>>(8)?,"excerpt":r.get::<_,Option<String>>(9)?,"suggestionState":r.get::<_,String>(10)?,"gmailId":r.get::<_,String>(11)?}))).map_err(db_error)?.collect::<Result<Vec<_>,_>>().map_err(db_error)?;
    Ok(json!(rows))
}
fn run_action(
    app: &tauri::AppHandle,
    action: &str,
    id: Option<i64>,
    application_id: Option<i64>,
    enabled: Option<bool>,
) -> Result<Value, String> {
    match action {
        "status" => return status(app),
        "messages" => return messages(app),
        "cancel" => {
            CANCEL.store(true, Ordering::SeqCst);
            return Ok(Value::Null);
        }
        _ => {}
    }
    let _guard = GATE.try_lock().map_err(|_| {
        "Gmail is busy. Wait for the current operation or cancel sign-in.".to_string()
    })?;
    CANCEL.store(false, Ordering::SeqCst);
    progress(Some(
        "Connecting to Gmail and checking for updates...".into(),
    ));
    BUSY.store(true, Ordering::SeqCst);
    let _ = app.emit("gmail-changed", ());
    let result = (|| {
        match action {
            "import" => {
                let path = rfd::FileDialog::new()
                    .add_filter("Google Desktop OAuth client", &["json"])
                    .pick_file()
                    .ok_or("Import cancelled")?;
                let raw =
                    std::fs::read_to_string(path).map_err(|_| "Cannot read Google client file")?;
                let value: Value = serde_json::from_str(&raw).map_err(|_| "Invalid JSON file")?;
                let cfg = &value["installed"];
                let id = strval(cfg, "client_id")?;
                if !id.ends_with(".apps.googleusercontent.com") {
                    return Err("Choose a Google Desktop OAuth client JSON file.".into());
                }
                if active(app)?.is_some() {
                    return Err(
                        "Disconnect Gmail before replacing its client configuration.".into(),
                    );
                }
                set_secret("client", &cfg.to_string())?;
            }
            "connect" => {
                connect(app)?;
                sync(app)?;
            }
            "sync" => sync(app)?,
            "disconnect" => disconnect(app)?,
            "autostart" => {
                if enabled.unwrap_or(false) {
                    app.autolaunch().enable()
                } else {
                    app.autolaunch().disable()
                }
                .map_err(|e| e.to_string())?;
            }
            "clear" => {
                disconnect(app)?;
                let state = app.state::<AppState>();
                let c = lock(&state)?;
                c.execute_batch("SAVEPOINT clear_email;DELETE FROM email_messages;DELETE FROM email_accounts;RELEASE clear_email;").map_err(db_error)?;
            }
            "link" | "ignore" | "dismiss" | "apply" => {
                let id = id.ok_or("Missing email ID")?;
                let state = app.state::<AppState>();
                let mut c = lock(&state)?;
                let tx = c.transaction().map_err(db_error)?;
                if action == "link" {
                    let app_id = application_id.ok_or("Choose an application")?;
                    let exists=tx.query_row("SELECT EXISTS(SELECT 1 FROM applications WHERE id=?1 AND deleted_at IS NULL)",[app_id],|r|r.get::<_,bool>(0)).map_err(db_error)?;
                    if !exists {
                        return Err("Application is no longer available.".into());
                    }
                    tx.execute("UPDATE email_messages SET application_id=?1,disposition='linked',suggestion_state='pending' WHERE id=?2",params![app_id,id]).map_err(db_error)?;
                } else if action == "ignore" {
                    tx.execute("UPDATE email_messages SET application_id=NULL,disposition='ignored' WHERE id=?1",[id]).map_err(db_error)?;
                } else if action == "dismiss" {
                    tx.execute(
                        "UPDATE email_messages SET suggestion_state='dismissed' WHERE id=?1",
                        [id],
                    )
                    .map_err(db_error)?;
                } else {
                    let (app_id,next):(i64,String)=tx.query_row("SELECT application_id,suggested_status FROM email_messages WHERE id=?1 AND disposition='linked' AND suggestion_state='pending'",[id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"No pending suggestion for a linked application")?;
                    let previous: String = tx
                        .query_row(
                            "SELECT status FROM applications WHERE id=?1 AND deleted_at IS NULL",
                            [app_id],
                            |r| r.get(0),
                        )
                        .map_err(|_| "Application is no longer available")?;
                    tx.execute("UPDATE applications SET status=?1,updated_at=CURRENT_TIMESTAMP WHERE id=?2",params![next,app_id]).map_err(db_error)?;
                    tx.execute("INSERT INTO activities(application_id,activity_type,occurred_at,from_status,to_status,notes) VALUES(?1,'Status Change',CURRENT_TIMESTAMP,?2,?3,'Approved Gmail status suggestion')",params![app_id,previous,next]).map_err(db_error)?;
                    tx.execute(
                        "UPDATE email_messages SET suggestion_state='applied' WHERE id=?1",
                        [id],
                    )
                    .map_err(db_error)?;
                }
                tx.commit().map_err(db_error)?;
            }
            _ => return Err("Unknown Gmail action".into()),
        }
        Ok(Value::Null)
    })();
    progress(None);
    BUSY.store(false, Ordering::SeqCst);
    if let Ok(mut error) = ERROR.lock() {
        *error = result.as_ref().err().cloned();
    }
    let _ = app.emit("gmail-changed", ());
    result
}
#[tauri::command]
pub async fn gmail_action(
    app: tauri::AppHandle,
    action: String,
    id: Option<i64>,
    application_id: Option<i64>,
    enabled: Option<bool>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_action(&app, &action, id, application_id, enabled)
    })
    .await
    .map_err(|_| "Email worker stopped".to_string())?
}
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;
    let open = MenuItem::with_id(app, "gmail-open", "Open JobTracker", true, None::<&str>)?;
    let sync_item = MenuItem::with_id(app, "gmail-sync", "Sync now", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "gmail-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &sync_item, &quit])?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("JobTracker")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "gmail-open" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "gmail-sync" => {
                let a = app.clone();
                std::thread::spawn(move || {
                    let _ = run_action(&a, "sync", None, None, None);
                });
            }
            "gmail-quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    if let Some(w) = app.get_webview_window("main") {
        let handle = w.clone();
        w.on_window_event(move |e| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = handle.hide();
            }
        });
        if std::env::args().any(|a| a == "--background") {
            w.hide()?;
        }
    }
    let a = app.handle().clone();
    std::thread::spawn(move || loop {
        let _ = run_action(&a, "sync", None, None, None);
        std::thread::sleep(Duration::from_secs(300));
    });
    Ok(())
}

#[cfg(test)]
mod error_tests {
    use super::*;
    #[test]
    fn explains_disabled_api_and_google_project_message() {
        let body = json!({"error":{"message":"Gmail API has not been used in project 123 before or it is disabled.","errors":[{"reason":"accessNotConfigured"}],"details":[{"reason":"SERVICE_DISABLED"}]}});
        let text = google_error(403, &body);
        assert!(text.contains("same project"));
        assert!(text.contains("project 123"));
        assert!(text.contains("SERVICE_DISABLED"));
    }
    #[test]
    fn distinguishes_scope_policy_and_quota() {
        for (reason, expected) in [
            ("ACCESS_TOKEN_SCOPE_INSUFFICIENT", "consent screen"),
            ("domainPolicy", "administrator"),
            ("rateLimitExceeded", "reconnecting will not fix"),
        ] {
            assert!(
                google_error(403, &json!({"error":{"details":[{"reason":reason}]}}))
                    .contains(expected)
            );
        }
    }
    #[test]
    fn bounds_unknown_errors_and_never_echoes_other_response_fields() {
        let text = google_error(
            403,
            &json!({"access_token":"SECRET","error":{"message":"x".repeat(1000)}}),
        );
        assert!(!text.contains("SECRET"));
        assert!(text.len() < 800);
        assert!(google_error(403, &Value::Null).contains("HTTP 403"));
        assert!(google_error(401, &Value::Null).contains("Reconnect Gmail"));
    }
}

#[cfg(test)]
mod pacing_tests {
    use super::*;
    #[test]
    fn retries_only_transient_google_failures() {
        for reason in [
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "RATE_LIMIT_EXCEEDED",
        ] {
            assert!(retryable(
                403,
                &json!({"error":{"details":[{"reason":reason}]}})
            ));
        }
        for reason in [
            "SERVICE_DISABLED",
            "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
            "domainPolicy",
            "dailyLimitExceeded",
        ] {
            assert!(!retryable(
                403,
                &json!({"error":{"errors":[{"reason":reason}]}})
            ));
        }
        assert!(retryable(429, &Value::Null));
        assert!(retryable(503, &Value::Null));
        assert!(!retryable(401, &Value::Null));
    }
    #[test]
    fn backoff_increases_and_honors_server_delay() {
        assert_eq!(
            (0..4)
                .map(|n| retry_delay(n, None).as_secs())
                .collect::<Vec<_>>(),
            vec![15, 30, 60, 120]
        );
        assert_eq!(retry_delay(0, Some("90")).as_secs(), 90);
        assert_eq!(retry_delay(0, Some("600")).as_secs(), 600);
        assert_eq!(retry_delay(1, Some("invalid")).as_secs(), 30);
    }
}
