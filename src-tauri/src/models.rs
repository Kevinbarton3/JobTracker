use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct JobApplication {
    pub(super) id: i64,
    pub(super) company: String,
    pub(super) position: String,
    pub(super) status: String,
    pub(super) location: Option<String>,
    pub(super) work_arrangement: Option<String>,
    pub(super) employment_type: Option<String>,
    pub(super) job_url: Option<String>,
    pub(super) salary_range: Option<String>,
    pub(super) contact_name: Option<String>,
    pub(super) contact_email: Option<String>,
    pub(super) date_applied: Option<String>,
    pub(super) follow_up_date: Option<String>,
    pub(super) follow_up_completed: bool,
    pub(super) interview_date: Option<String>,
    pub(super) source: Option<String>,
    pub(super) notes: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) resume_id: Option<i64>,
    pub(super) resume_name: Option<String>,
    pub(super) resume_deleted: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ApplicationInput {
    pub(super) company: String,
    pub(super) position: String,
    pub(super) status: String,
    pub(super) location: Option<String>,
    pub(super) work_arrangement: Option<String>,
    pub(super) employment_type: Option<String>,
    pub(super) job_url: Option<String>,
    pub(super) salary_range: Option<String>,
    pub(super) contact_name: Option<String>,
    pub(super) contact_email: Option<String>,
    pub(super) date_applied: Option<String>,
    pub(super) follow_up_date: Option<String>,
    pub(super) follow_up_completed: bool,
    pub(super) interview_date: Option<String>,
    pub(super) source: Option<String>,
    pub(super) notes: Option<String>,
    pub(super) resume_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UpdateApplicationInput {
    pub(super) id: i64,
    #[serde(flatten)]
    pub(super) application: ApplicationInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ApplicationFilters {
    pub(super) search: String,
    pub(super) status: String,
    pub(super) work_arrangement: String,
    pub(super) employment_type: String,
    pub(super) sort_by: String,
    pub(super) sort_direction: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DashboardStatistics {
    pub(super) total: i64,
    pub(super) submitted_this_week: i64,
    pub(super) active_interviews: i64,
    pub(super) offers: i64,
    pub(super) requiring_follow_up: i64,
    pub(super) rejections: i64,
    pub(super) status_breakdown: HashMap<String, i64>,
    pub(super) response_rate: f64,
    pub(super) interview_rate: f64,
    pub(super) offer_rate: f64,
    pub(super) rejection_rate: f64,
    pub(super) average_days_to_first_response: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Activity {
    pub(super) id: i64,
    pub(super) application_id: i64,
    pub(super) activity_type: String,
    pub(super) occurred_at: String,
    pub(super) participants: Option<String>,
    pub(super) notes: Option<String>,
    pub(super) meeting_url: Option<String>,
    pub(super) outcome: Option<String>,
    pub(super) from_status: Option<String>,
    pub(super) to_status: Option<String>,
    pub(super) created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ActivityInput {
    pub(super) application_id: i64,
    pub(super) activity_type: String,
    pub(super) occurred_at: String,
    pub(super) participants: Option<String>,
    pub(super) notes: Option<String>,
    pub(super) meeting_url: Option<String>,
    pub(super) outcome: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskItem {
    pub(super) id: i64,
    pub(super) application_id: i64,
    pub(super) title: String,
    pub(super) due_at: String,
    pub(super) completed: bool,
    pub(super) priority: String,
    pub(super) recurrence: Option<String>,
    pub(super) snoozed_until: Option<String>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
    pub(super) company: String,
    pub(super) position: String,
    pub(super) status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskInput {
    pub(super) application_id: i64,
    pub(super) title: String,
    pub(super) due_at: String,
    pub(super) priority: String,
    pub(super) recurrence: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TaskGroups {
    pub(super) overdue: Vec<TaskItem>,
    pub(super) due_today: Vec<TaskItem>,
    pub(super) upcoming: Vec<TaskItem>,
    pub(super) completed: Vec<TaskItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Attachment {
    pub(super) id: i64,
    pub(super) application_id: i64,
    pub(super) kind: String,
    pub(super) name: String,
    pub(super) file_path: String,
    pub(super) created_at: String,
    pub(super) file_exists: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AttachmentInput {
    pub(super) application_id: i64,
    pub(super) kind: String,
    pub(super) name: String,
    pub(super) file_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Resume {
    pub(super) id: i64,
    pub(super) name: String,
    pub(super) notes: Option<String>,
    pub(super) original_file_name: String,
    pub(super) stored_file_name: String,
    pub(super) created_at: String,
    pub(super) is_current: bool,
    pub(super) usage_count: i64,
    pub(super) file_exists: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ResumeUpdateInput {
    pub(super) id: i64,
    pub(super) name: String,
    pub(super) notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CsvApplication {
    pub(super) company: String,
    pub(super) position: String,
    pub(super) status: String,
    pub(super) location: String,
    pub(super) work_arrangement: String,
    pub(super) employment_type: String,
    pub(super) job_url: String,
    pub(super) salary_range: String,
    pub(super) contact_name: String,
    pub(super) contact_email: String,
    pub(super) date_applied: String,
    pub(super) follow_up_date: String,
    pub(super) interview_date: String,
    pub(super) source: String,
    pub(super) notes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ImportPreview {
    pub(super) total: usize,
    pub(super) valid: usize,
    pub(super) duplicates: usize,
    pub(super) errors: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DuplicateMatch {
    pub(super) id: i64,
    pub(super) company: String,
    pub(super) position: String,
    pub(super) reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OutcomeBreakdown {
    pub(super) label: String,
    pub(super) total: i64,
    pub(super) interviews: i64,
    pub(super) offers: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Analytics {
    pub(super) by_source: Vec<OutcomeBreakdown>,
    pub(super) by_work_arrangement: Vec<OutcomeBreakdown>,
    pub(super) average_stage_days: HashMap<String, f64>,
}
