//! Local Gmail persistence and conservative matching. No credentials belong here.
use rusqlite::Connection;

pub fn initialize(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch("SAVEPOINT email_schema;
      CREATE TABLE IF NOT EXISTS email_accounts (
        id INTEGER PRIMARY KEY, address TEXT NOT NULL UNIQUE,
        history_id TEXT, last_success_at TEXT, scan_started_at TEXT,
        reconnect_required INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS email_messages (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES email_accounts(id),
        gmail_id TEXT NOT NULL, thread_id TEXT NOT NULL,
        sender TEXT NOT NULL, subject TEXT NOT NULL,
        received_at TEXT NOT NULL, preview TEXT NOT NULL,
        application_id INTEGER REFERENCES applications(id),
        disposition TEXT NOT NULL DEFAULT 'review' CHECK(disposition IN ('review','linked','ignored')),
        suggested_status TEXT CHECK(suggested_status IN ('Interviewing','Offer','Rejected')),
        suggestion_excerpt TEXT,
        suggestion_state TEXT NOT NULL DEFAULT 'pending' CHECK(suggestion_state IN ('pending','applied','dismissed')),
        UNIQUE(account_id,gmail_id)
      );
      CREATE INDEX IF NOT EXISTS email_messages_application ON email_messages(application_id);
      CREATE INDEX IF NOT EXISTS email_messages_thread ON email_messages(account_id,thread_id);
      RELEASE email_schema;")
}

#[derive(Debug)]
pub struct Candidate<'a> {
    pub id: i64,
    pub company: &'a str,
    pub position: &'a str,
    pub contact: Option<&'a str>,
    pub deleted: bool,
}

#[derive(Debug, PartialEq)]
pub enum Match {
    Attach(i64),
    Review(Vec<i64>),
    Irrelevant,
}

fn normalized(value: &str) -> String {
    value
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
fn contains_phrase(text: &str, phrase: &str) -> bool {
    let phrase = normalized(phrase);
    !phrase.is_empty() && format!(" {text} ").contains(&format!(" {phrase} "))
}

/// sender must be the parsed mailbox address, not the display name.
/// linked_thread contains application IDs from this account and thread only.
pub fn match_message(
    sender: &str,
    subject: &str,
    preview: &str,
    linked_thread: &[i64],
    applications: &[Candidate<'_>],
) -> Match {
    let active: Vec<_> = applications.iter().filter(|a| !a.deleted).collect();
    let mut thread: Vec<_> = active
        .iter()
        .filter(|a| linked_thread.contains(&a.id))
        .map(|a| a.id)
        .collect();
    thread.sort_unstable();
    thread.dedup();
    if thread.len() == 1 {
        return Match::Attach(thread[0]);
    }
    if thread.len() > 1 {
        return Match::Review(thread);
    }
    let text = normalized(&format!("{subject} {preview}"));
    let mut confident = Vec::new();
    let mut possible = Vec::new();
    for app in active {
        let contact = app
            .contact
            .is_some_and(|c| !c.trim().is_empty() && c.trim().eq_ignore_ascii_case(sender.trim()));
        let title = contains_phrase(&text, app.position);
        let company = contains_phrase(&text, app.company);
        if contact && title {
            confident.push(app.id);
        }
        if contact || company || title {
            possible.push(app.id);
        }
    }
    if confident.len() == 1 {
        Match::Attach(confident[0])
    } else if !possible.is_empty() {
        Match::Review(possible)
    } else {
        Match::Irrelevant
    }
}

/// Explicit suggestions only. Conflicting statements are left for manual review.
/// This function never writes application status.
pub fn suggest_status(text: &str) -> Option<(&'static str, String)> {
    let rules = [
        (
            "Interviewing",
            [
                "invite you to an interview",
                "schedule an interview",
                "invitation to interview",
            ],
        ),
        (
            "Offer",
            [
                "pleased to offer you",
                "offer of employment",
                "extend an offer to you",
            ],
        ),
        (
            "Rejected",
            [
                "not moving forward with your application",
                "will not be moving forward",
                "decided to pursue other candidates",
            ],
        ),
    ];
    let mut found = Vec::new();
    for (status, phrases) in rules {
        if let Some(sentence) = text.split(['\n', '.', '!', '?']).find(|s| {
            let lower = s.to_lowercase();
            phrases.iter().any(|p| lower.contains(p))
                && !lower.contains("not pleased")
                && !lower.contains("no offer")
        }) {
            found.push((status, sentence.trim().chars().take(400).collect()));
        }
    }
    if found.len() == 1 {
        found.pop()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn app(id: i64) -> Candidate<'static> {
        Candidate {
            id,
            company: "Acme",
            position: "Software Engineer",
            contact: Some("jobs@acme.com"),
            deleted: false,
        }
    }
    #[test]
    fn exact_contact_and_title_match() {
        assert_eq!(
            match_message(
                "JOBS@acme.com",
                "Software Engineer interview",
                "",
                &[],
                &[app(1)]
            ),
            Match::Attach(1)
        );
    }
    #[test]
    fn ambiguous_roles_require_review() {
        assert_eq!(
            match_message(
                "jobs@acme.com",
                "Software Engineer",
                "",
                &[],
                &[app(1), app(2)]
            ),
            Match::Review(vec![1, 2])
        );
    }
    #[test]
    fn thread_is_scoped_and_deleted_applications_are_excluded() {
        let mut deleted = app(2);
        deleted.deleted = true;
        assert_eq!(
            match_message(
                "other@example.com",
                "Re: update",
                "",
                &[1, 2],
                &[app(1), deleted]
            ),
            Match::Attach(1)
        );
    }
    #[test]
    fn recruiting_domain_alone_does_not_match() {
        assert_eq!(
            match_message(
                "mailer@greenhouse.io",
                "News",
                "New jobs available",
                &[],
                &[app(1)]
            ),
            Match::Irrelevant
        );
    }
    #[test]
    fn company_only_requires_review() {
        assert_eq!(
            match_message("someone@example.com", "Acme update", "", &[], &[app(1)]),
            Match::Review(vec![1])
        );
    }
    #[test]
    fn explicit_suggestions_only() {
        assert_eq!(
            suggest_status("We are pleased to offer you this position.")
                .unwrap()
                .0,
            "Offer"
        );
        assert!(suggest_status("Thank you for applying.").is_none());
        assert!(suggest_status(
            "We invite you to an interview. We decided to pursue other candidates."
        )
        .is_none());
    }
    #[test]
    fn schema_is_repeatable_and_deduplicates_per_account() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE applications(id INTEGER PRIMARY KEY);")
            .unwrap();
        initialize(&c).unwrap();
        initialize(&c).unwrap();
        c.execute_batch("INSERT INTO email_accounts(id,address) VALUES(1,'a@example.com'),(2,'b@example.com');
          INSERT INTO email_messages(account_id,gmail_id,thread_id,sender,subject,received_at,preview) VALUES(1,'m1','t1','s','subject','date','preview');").unwrap();
        assert!(c.execute("INSERT INTO email_messages(account_id,gmail_id,thread_id,sender,subject,received_at,preview) VALUES(1,'m1','t1','s','s','d','p')",[]).is_err());
        c.execute("INSERT INTO email_messages(account_id,gmail_id,thread_id,sender,subject,received_at,preview) VALUES(2,'m1','t1','s','s','d','p')",[]).unwrap();
    }
}
