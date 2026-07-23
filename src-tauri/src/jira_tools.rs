use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use reqwest;
use serde_json::Value;
use git2::{Repository, Sort, Oid};
use base64;
use chrono::{self, Datelike,Local,DateTime,NaiveDate,TimeZone};
use uuid;
use std::collections::HashSet;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitCommit {
    pub commit_id: String,
    pub author: String,
    pub message: String,
    pub commit_time: String,
    pub repository: String,
    pub files_changed: i32,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct JiraIssue {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub status: String,
    pub created: String,
    pub updated: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorklogEntry {
    pub issue_key: String,
    pub time_spent_hours: f64,
    pub comment: String,
    pub started: String,
    pub similarity_score: f64,
    #[serde(default)]
    pub worklog_id: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct JiraConfig {
    #[serde(rename = "jiraUrl")]
    pub jira_url: String,
    #[serde(rename = "username")]
    pub username: String,
    #[serde(rename = "apiToken")]
    pub api_token: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitConfig {
    pub repositories: Vec<GitRepository>,
    #[serde(rename = "username")]
    pub username: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitRepository {
    pub url: String,
    pub token: String,
    #[serde(default)]
    pub alias: String,
}

// 保存JIRA配置到数据库
#[tauri::command]
pub async fn save_jira_config(app: AppHandle, config: JiraConfig) -> Result<(), String> {
    let db = app.state::<crate::database::Database>();
    let config_json =
        serde_json::to_string(&config).map_err(|e| format!("序列化配置失败: {}", e))?;
    db.set_config("jira_config", &config_json)
}

// 从数据库加载JIRA配置
#[tauri::command]
pub async fn load_jira_config(app: AppHandle) -> Result<Option<JiraConfig>, String> {
    let db = app.state::<crate::database::Database>();
    match db.get_config("jira_config")? {
        Some(json) => {
            let config: JiraConfig = serde_json::from_str(&json)
                .map_err(|e| format!("解析配置失败: {}", e))?;
            Ok(Some(config))
        }
        None => Ok(None),
    }
}

// 保存Git配置到数据库
#[tauri::command]
pub async fn save_git_config(app: AppHandle, config: GitConfig) -> Result<(), String> {
    let db = app.state::<crate::database::Database>();
    let config_json =
        serde_json::to_string(&config).map_err(|e| format!("序列化配置失败: {}", e))?;
    db.set_config("git_config", &config_json)
}

// 从数据库加载Git配置
#[tauri::command]
pub async fn load_git_config(app: AppHandle) -> Result<Option<GitConfig>, String> {
    let db = app.state::<crate::database::Database>();
    match db.get_config("git_config")? {
        Some(json) => {
            let config: GitConfig = serde_json::from_str(&json)
                .map_err(|e| format!("解析配置失败: {}", e))?;
            Ok(Some(config))
        }
        None => Ok(None),
    }
}

// 创建JIRA客户端
async fn create_jira_client(config: &JiraConfig) -> Result<reqwest::Client, String> {
    let client = reqwest::Client::new();
    Ok(client)
}

// 获取JIRA客户端
async fn get_jira_client_with_auth(config: &JiraConfig) -> Result<reqwest::Client, String> {
    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    // 使用基本认证
    let auth_value = format!("Basic {}", base64::encode(&format!("{}:{}", config.username, config.api_token)));

    Ok(client)
}

// 从JIRA获取未完成的问题列表
#[tauri::command]
pub async fn get_my_unfinished_issues(app: AppHandle) -> Result<Vec<JiraIssue>, String> {
    let config = load_jira_config(app.clone()).await?
        .ok_or_else(|| "JIRA配置未设置".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let jql = "assignee = currentUser() AND resolution = Unresolved";
    let url = format!("{}/rest/api/2/search", config.jira_url.trim_end_matches('/'));

    let auth_value = format!("Basic {}", base64::encode(&format!("{}:{}", config.username, config.api_token)));

    let response = client
        .get(&url)
        .header("Authorization", auth_value)
        .query(&[("jql", jql), ("maxResults", "100")])
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("JIRA API请求失败 ({}): {}", status, error_text));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let mut issues = Vec::new();

    if let Some(issues_array) = json["issues"].as_array() {
        for issue_value in issues_array {
            let key = issue_value["key"].as_str().unwrap_or_default().to_string();
            let fields = &issue_value["fields"];

            let jira_issue = JiraIssue {
                key: key.clone(),
                summary: fields["summary"].as_str().unwrap_or_default().to_string(),
                description: fields["description"].as_str().unwrap_or_default().to_string(),
                status: fields["status"]["name"].as_str().unwrap_or_default().to_string(),
                created: fields["created"].as_str().unwrap_or_default().to_string(),
                updated: fields["updated"].as_str().unwrap_or_default().to_string(),
            };

            issues.push(jira_issue);
        }
    }

    Ok(issues)
}
// 解析 JIRA worklog started 字符串：常见是 2025-12-30T09:12:34.000+0800
fn parse_jira_started(started_str: &str) -> Option<DateTime<chrono::FixedOffset>> {
    // 带毫秒
    if let Ok(dt) = DateTime::parse_from_str(started_str, "%Y-%m-%dT%H:%M:%S%.3f%z") {
        return Some(dt);
    }
    // 不带毫秒
    if let Ok(dt) = DateTime::parse_from_str(started_str, "%Y-%m-%dT%H:%M:%S%z") {
        return Some(dt);
    }
    // 兼容少数返回 RFC3339 的情况（+08:00 / Z）
    if let Ok(dt) = DateTime::parse_from_rfc3339(started_str) {
        return Some(dt);
    }
    None
}

#[tauri::command]
pub async fn get_my_today_worklogs(app: AppHandle, date_str: Option<String>) -> Result<Vec<WorklogEntry>, String> {
    let config = load_jira_config(app.clone())
        .await?
        .ok_or_else(|| "JIRA配置未设置".to_string())?;

    // 支持传入日期参数，否则使用当天
    let target_date: NaiveDate = if let Some(ref ds) = date_str {
        NaiveDate::parse_from_str(ds, "%Y-%m-%d")
            .map_err(|e| format!("日期格式错误: {}", e))?
    } else {
        Local::now().date_naive()
    };

    let jql = format!(
        "worklogAuthor = currentUser() AND worklogDate = '{}'",
        target_date.format("%Y-%m-%d")
    );

    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let url = format!("{}/rest/api/2/search", config.jira_url.trim_end_matches('/'));

    let response = client
        .get(&url)
        .basic_auth(&config.username, Some(&config.api_token))
        .query(&[("jql", jql.as_str()), ("maxResults", "100")])
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("JIRA API请求失败 ({}): {}", status, error_text));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let mut worklogs = Vec::new();

    if let Some(issues_array) = json["issues"].as_array() {
        for issue_value in issues_array {
            let issue_key = issue_value["key"].as_str().unwrap_or_default().to_string();

            // 获取问题的工作日志
            let worklog_url = format!(
                "{}/rest/api/2/issue/{}/worklog",
                config.jira_url.trim_end_matches('/'),
                issue_key
            );

            let worklog_response = client
                .get(&worklog_url)
                .basic_auth(&config.username, Some(&config.api_token))
                .send()
                .await
                .map_err(|e| format!("获取工作日志失败: {}", e))?;

            if !worklog_response.status().is_success() {
                // 某个 issue 取不到 worklog 直接跳过（也可以 return Err）
                continue;
            }

            let worklog_json: Value = worklog_response
                .json()
                .await
                .map_err(|e| format!("解析工作日志响应失败: {}", e))?;

            if let Some(worklogs_array) = worklog_json["worklogs"].as_array() {
                for wl in worklogs_array {
                    // 1) 用 started 判断日期（比 updateDate 更准）
                    let started_str = match wl["started"].as_str() {
                        Some(s) => s,
                        None => continue,
                    };

                    let started = match parse_jira_started(started_str) {
                        Some(dt) => dt.with_timezone(&Local),
                        None => continue, // 解析失败就跳过
                    };

                    if started.date_naive() != target_date {
                        continue;
                    }

                    // 2) comment 可能是 null / object（Cloud ADF），做兼容
                    let comment_str = if wl["comment"].is_string() {
                        wl["comment"].as_str().unwrap_or_default().to_string()
                    } else if wl["comment"].is_null() {
                        "".to_string()
                    } else {
                        // ADF 或其它结构，先转成 json 字符串兜底
                        wl["comment"].to_string()
                    };

                    let seconds = wl["timeSpentSeconds"].as_i64().unwrap_or(0);
                    // JIRA API 返回的 id 可能是字符串（云版常见）或整数
                    let worklog_id = wl["id"].as_str()
                        .map(|s| s.to_string())
                        .or_else(|| wl["id"].as_i64().map(|id| id.to_string()))
                        .unwrap_or_default();

                    let worklog_entry = WorklogEntry {
                        issue_key: issue_key.clone(),
                        time_spent_hours: (seconds as f64) / 3600.0,
                        comment: comment_str,
                        started: started_str.to_string(),
                        similarity_score: 0.0,
                        worklog_id,
                    };

                    worklogs.push(worklog_entry);
                }
            }
        }
    }

    Ok(worklogs)
}
// 记录JIRA工作时间
#[tauri::command]
pub async fn log_work(
    app: AppHandle,
    issue_key: String,
    time_spent_hours: f64,
    comment: String,
    date_str: String,
) -> Result<bool, String> {
    let config = load_jira_config(app.clone())
        .await?
        .ok_or_else(|| "JIRA配置未设置".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let worklog_url = format!(
        "{}/rest/api/2/issue/{}/worklog",
        config.jira_url.trim_end_matches('/'),
        issue_key
    );

    // JIRA 更稳的方式：用 seconds
    let mut seconds_spent = (time_spent_hours * 3600.0).round() as i64;
    if seconds_spent < 60 {
        seconds_spent = 60; // 避免 JIRA 最小时间限制（常见 1min）
    }

    // 解析传入的日期，构造指定日期的 started 时间（使用当天的 09:00:00 作为默认时间）
    let target_date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|e| format!("日期格式错误: {}", e))?;
    let local_offset = Local::now().offset().clone();
    let naive_time = chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap();
    let naive_dt = target_date.and_time(naive_time);
    let started = chrono::DateTime::<chrono::Local>::from_naive_utc_and_offset(naive_dt, local_offset)
        .format("%Y-%m-%dT%H:%M:%S.000%z").to_string();

    let worklog_data = serde_json::json!({
        "timeSpentSeconds": seconds_spent,
        "comment": comment,
        "started": started
    });

    let response = client
        .post(&worklog_url)
        .basic_auth(&config.username, Some(&config.api_token))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&worklog_data)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        // 尝试解析JIRA返回的错误信息
        let error_msg = if let Ok(error_json) = serde_json::from_str::<Value>(&response_text) {
            if let Some(errors) = error_json["errors"].as_object() {
                let msgs: Vec<String> = errors
                    .iter()
                    .map(|(k, v)| format!("{}: {}", k, v.as_str().unwrap_or("")))
                    .collect();
                format!("JIRA错误: {}", msgs.join(", "))
            } else if let Some(error_messages) = error_json["errorMessages"].as_array() {
                let msgs: Vec<String> = error_messages
                    .iter()
                    .map(|v| v.as_str().unwrap_or("Unknown error").to_string())
                    .collect();
                format!("JIRA错误: {}", msgs.join(", "))
            } else {
                format!("JIRA错误: {}", response_text)
            }
        } else {
            format!("HTTP错误 {}: {}", status, response_text)
        };

        return Err(error_msg);
    }

    Ok(true)
}

// 删除JIRA工作日志
#[tauri::command]
pub async fn delete_worklog(
    app: AppHandle,
    issue_key: String,
    worklog_id: String,
) -> Result<bool, String> {
    let config = load_jira_config(app.clone())
        .await?
        .ok_or_else(|| "JIRA配置未设置".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let url = format!(
        "{}/rest/api/2/issue/{}/worklog/{}",
        config.jira_url.trim_end_matches('/'),
        issue_key,
        worklog_id
    );

    let response = client
        .delete(&url)
        .basic_auth(&config.username, Some(&config.api_token))
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("删除工作日志失败 ({}): {}", status, error_text));
    }

    Ok(true)
}

// 更新JIRA工作日志
#[tauri::command]
pub async fn update_worklog(
    app: AppHandle,
    issue_key: String,
    worklog_id: String,
    time_spent_hours: f64,
    comment: String,
) -> Result<bool, String> {
    let config = load_jira_config(app.clone())
        .await?
        .ok_or_else(|| "JIRA配置未设置".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let url = format!(
        "{}/rest/api/2/issue/{}/worklog/{}",
        config.jira_url.trim_end_matches('/'),
        issue_key,
        worklog_id
    );

    let mut seconds_spent = (time_spent_hours * 3600.0).round() as i64;
    if seconds_spent < 60 {
        seconds_spent = 60;
    }

    let worklog_data = serde_json::json!({
        "timeSpentSeconds": seconds_spent,
        "comment": comment
    });

    let response = client
        .put(&url)
        .basic_auth(&config.username, Some(&config.api_token))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&worklog_data)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("更新工作日志失败 ({}): {}", status, error_text));
    }

    Ok(true)
}

// 测试JIRA连接
#[tauri::command]
pub async fn test_jira_connection(app: AppHandle) -> Result<bool, String> {
    let config = load_jira_config(app.clone()).await?
        .ok_or_else(|| "JIRA配置未设置".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    // 使用基本认证测试连接
    let auth_value = format!("Basic {}", base64::encode(&format!("{}:{}", config.username, config.api_token)));

    // 测试获取当前用户信息
    let url = format!("{}/rest/api/2/myself", config.jira_url.trim_end_matches('/'));

    let response = client
        .get(&url)
        .header("Authorization", auth_value)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    let status = response.status();
    let response_text = response.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    
    if !status.is_success() {
        let error_msg = if let Ok(error_json) = serde_json::from_str::<Value>(&response_text) {
            if let Some(errors) = error_json["errors"].as_object() {
                let error_messages: Vec<String> = errors.values().map(|v| v.as_str().unwrap_or("").to_string()).collect();
                format!("JIRA错误: {}", error_messages.join(", "))
            } else if let Some(error_messages) = error_json["errorMessages"].as_array() {
                let error_messages: Vec<String> = error_messages.iter().map(|v| v.as_str().unwrap_or("Unknown error").to_string()).collect();
                format!("JIRA错误: {}", error_messages.join(", "))
            } else {
                format!("JIRA错误: {}", response_text)
            }
        } else {
            format!("HTTP错误 {}: {}", status, response_text)
        };
        
        return Err(error_msg);
    }
    
    Ok(true)
}
fn author_local_date(commit: &git2::Commit) -> NaiveDate {
    let sig = commit.author();
    let when = sig.when(); // git2::Time
    // when.seconds() 是 epoch seconds，when.offset_minutes() 是偏移
    // 这里统一转成本地时间进行“今日”判断
    let dt = chrono::DateTime::<chrono::Local>::from(
        chrono::DateTime::<chrono::Utc>::from_timestamp(when.seconds(), 0)
            .unwrap_or_else(|| chrono::Utc::now())
    );
    dt.date_naive()
}

// 是否匹配当前用户（建议：name 或 email 任一匹配）
fn is_me(commit: &git2::Commit, username: &str, email: Option<&str>) -> bool {
    let author = commit.author();
    let name_ok = author.name().unwrap_or("") == username;
    let email_ok = email.map(|e| author.email().unwrap_or("") == e).unwrap_or(false);
    name_ok || email_ok
}

#[tauri::command]
pub async fn get_commits_by_date(app: AppHandle, date_str: String) -> Result<Vec<GitCommit>, String> {
    eprintln!("[get_commits_by_date] ===== 开始查询日期: {} =====", date_str);
    let git_config = match load_git_config(app.clone()).await? {
        Some(cfg) => cfg,
        None => {
            eprintln!("[get_commits_by_date] Git配置未设置，返回空");
            return Ok(Vec::new());
        }
    };

    eprintln!("[get_commits_by_date] 仓库数量: {}, 配置用户名: '{}'",
        git_config.repositories.len(), git_config.username);

    // 解析传入的日期字符串
    let target_date = NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
        .map_err(|e| format!("日期格式错误: {}", e))?;
    let mut all_commits: Vec<GitCommit> = Vec::new();

    for (repo_idx, repo_config) in git_config.repositories.iter().enumerate() {
        eprintln!("[get_commits_by_date] ---- 仓库[{}]: url='{}', alias='{}' ----",
            repo_idx, repo_config.url, repo_config.alias);

        let temp_dir = std::env::temp_dir()
            .join(format!("jira_git_repo_{}", uuid::Uuid::new_v4()));

        // 确保用户名不为空：如果未配置用户名，使用常见默认值
        let effective_username = if git_config.username.trim().is_empty() {
            "oauth2"  // GitHub/GitLab token 认证通用默认用户名
        } else {
            &git_config.username
        };
        eprintln!("[get_commits_by_date] 有效用户名(effective_username): '{}'", effective_username);

        // 尝试将 http:// URL 转为 https://（大多数 Git 服务已不兼容纯 HTTP）
        let repo_url = if repo_config.url.starts_with("http://") {
            let https_url = repo_config.url.replacen("http://", "https://", 1);
            eprintln!("[get_commits_by_date] URL HTTP->HTTPS: {} -> {}", repo_config.url, https_url);
            https_url
        } else {
            repo_config.url.clone()
        };

        // 1) clone（先 clone 默认分支也行，后面我们会 fetch 全分支）
        eprintln!("[get_commits_by_date] 开始 clone: {}", repo_url);
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::userpass_plaintext(
                username_from_url.unwrap_or(effective_username),
                &repo_config.token
            )
        });

        let mut fetch_options = git2::FetchOptions::new();
        fetch_options.remote_callbacks(callbacks);

        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch_options);

        let repo = builder.clone(&repo_url, &temp_dir)
            .map_err(|e| format!("克隆仓库失败 ({}): {}", repo_config.url, e))?;
        eprintln!("[get_commits_by_date] clone 成功 -> {}", temp_dir.display());

        // 2) fetch 所有远端分支到 refs/remotes/origin/*
        {
            let mut remote = repo.find_remote("origin")
                .or_else(|_| repo.remote_anonymous(&repo_url))
                .map_err(|e| format!("查找remote失败 ({}): {}", repo_config.url, e))?;

            let mut callbacks = git2::RemoteCallbacks::new();
            callbacks.credentials(|_url, username_from_url, _allowed_types| {
                git2::Cred::userpass_plaintext(
                    username_from_url.unwrap_or(effective_username),
                    &repo_config.token
                )
            });

            let mut fo = git2::FetchOptions::new();
            fo.remote_callbacks(callbacks);

            eprintln!("[get_commits_by_date] 开始 fetch 所有远端分支...");
            remote.fetch(
                &["refs/heads/*:refs/remotes/origin/*"],
                Some(&mut fo),
                None
            ).map_err(|e| format!("fetch分支失败: {}", e))?;
            eprintln!("[get_commits_by_date] fetch 完成");
        }

        // 3) revwalk：从所有远端分支 tip 开始走
        let mut revwalk = repo.revwalk()
            .map_err(|e| format!("创建revwalk失败: {}", e))?;

        revwalk.set_sorting(Sort::TIME | Sort::REVERSE);

        // 推入所有远端分支引用
        let refs = repo.references()
            .map_err(|e| format!("读取refs失败: {}", e))?;

        let mut branch_count = 0u32;
        for r in refs {
            let r = r.map_err(|e| format!("读取ref失败: {}", e))?;
            let name = match r.name() {
                Some(n) => n,
                None => continue,
            };
            // 只扫 origin 远端分支（你也可以加上 tags / 本地分支）
            if !name.starts_with("refs/remotes/origin/") {
                continue;
            }
            if let Some(oid) = r.target() {
                // push 起点
                let _ = revwalk.push(oid);
                branch_count += 1;
            }
        }
        eprintln!("[get_commits_by_date] 远端分支数: {}, 目标日期: {}", branch_count, target_date);

        // 4) 去重：同一个 commit 可能被多个分支包含
        let mut seen: HashSet<Oid> = HashSet::new();
        let mut walked_count = 0u32;
        let mut date_match_count = 0u32;
        let mut author_match_count = 0u32;
        let mut author_skip_count = 0u32;

        for oid_res in revwalk {
            let oid = oid_res.map_err(|e| format!("获取提交OID失败: {}", e))?;
            if !seen.insert(oid) {
                continue;
            }

            walked_count += 1;
            let commit = repo.find_commit(oid)
                .map_err(|e| format!("查找提交失败: {}", e))?;

            // 用 author date 对齐 Java
            let commit_date = author_local_date(&commit);
            if commit_date != target_date {
                // 因为我们 TIME 排序 + REVERSE(新->旧)，一旦日期小于 target_date 可考虑 break
                // 但严格来说不同分支可能有乱序，保守不 break
                continue;
            }
            date_match_count += 1;

            // 匹配作者（可选加 email 匹配）
            let sig = commit.author();
            let author_name = sig.name().unwrap_or("");
            let author_email = sig.email().unwrap_or("");
            if !is_me(&commit, &git_config.username, None) {
                author_skip_count += 1;
                // 只对前10个跳过的打印详情，避免刷屏
                if author_skip_count <= 10 {
                    eprintln!("[get_commits_by_date] SKIP作者不匹配: 期望='{}', 实际作者='{}', 邮箱='{}', 提交='{}'",
                        git_config.username, author_name, author_email,
                        commit.message().unwrap_or("").lines().next().unwrap_or(""));
                }
                continue;
            }
            author_match_count += 1;

            let sig = commit.author();
            let when = sig.when();
            let utc = chrono::DateTime::<chrono::Utc>::from_timestamp(when.seconds(), 0)
                .unwrap_or_else(|| chrono::Utc::now());
            let local = utc.with_timezone(&Local);

            all_commits.push(GitCommit {
                commit_id: oid.to_string(),
                author: sig.name().unwrap_or("").to_string(),
                message: commit.message().unwrap_or("").to_string(),
                commit_time: local.to_rfc3339(),
                repository: repo_config.url.clone(),
                files_changed: 0,
                additions: 0,
                deletions: 0,
            });
        }

        // 超过10条时补一条总数
        if author_skip_count > 10 {
            eprintln!("[get_commits_by_date] ... 共跳过 {} 条作者不匹配的提交 (期望='{}')",
                author_skip_count, git_config.username);
        }

        eprintln!("[get_commits_by_date] 仓库[{}] 统计: walked={}, date_match={}, author_match={}, author_skip={}",
            repo_idx, walked_count, date_match_count, author_match_count, author_skip_count);

        // 5) 清理
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    eprintln!("[get_commits_by_date] ===== 查询完成，共找到 {} 条提交 =====", all_commits.len());
    Ok(all_commits)
}
// 测试Git连接
#[tauri::command]
pub async fn test_git_connection(app: AppHandle) -> Result<String, String> {
    let git_config = match load_git_config(app.clone()).await? {
        Some(cfg) => cfg,
        None => return Err("Git配置未设置".to_string()),
    };

    if git_config.repositories.is_empty() {
        return Err("未配置任何Git仓库".to_string());
    }

    let effective_username = if git_config.username.trim().is_empty() {
        "oauth2"
    } else {
        &git_config.username
    };

    let mut results = Vec::new();

    for repo_config in &git_config.repositories {
        let repo_url = if repo_config.url.starts_with("http://") {
            repo_config.url.replacen("http://", "https://", 1)
        } else {
            repo_config.url.clone()
        };

        let temp_dir = std::env::temp_dir()
            .join(format!("jira_git_test_{}", uuid::Uuid::new_v4()));

        // 尝试 ls-remote 来测试连接（不需要完整 clone）
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::userpass_plaintext(
                username_from_url.unwrap_or(effective_username),
                &repo_config.token
            )
        });

        let mut fo = git2::FetchOptions::new();
        fo.remote_callbacks(callbacks);

        // 先用 init 创建空仓库再配置 remote 来 ls-remote
        let repo = git2::Repository::init(&temp_dir)
            .map_err(|e| format!("初始化临时仓库失败: {}", e))?;

        let mut remote = repo.remote("origin", &repo_url)
            .map_err(|e| format!("配置remote失败 ({}): {}", repo_config.url, e))?;

        match remote.connect(git2::Direction::Fetch) {
            Ok(()) => {
                let refs = remote.list()
                    .map_err(|e| format!("列出远端引用失败 ({}): {}", repo_config.url, e))?;
                let branch_count = refs.iter().filter(|r| {
                    r.name().starts_with("refs/heads/")
                }).count();
                let tag_count = refs.iter().filter(|r| {
                    r.name().starts_with("refs/tags/")
                }).count();
                results.push(format!(
                    "✅ {}: 连接成功 ({} 分支, {} 标签)",
                    repo_config.url, branch_count, tag_count
                ));
            }
            Err(e) => {
                // 尝试用 clone 测试
                let _ = std::fs::remove_dir_all(&temp_dir);
                let mut builder = git2::build::RepoBuilder::new();
                let mut cb2 = git2::RemoteCallbacks::new();
                cb2.credentials(|_url, username_from_url, _allowed_types| {
                    git2::Cred::userpass_plaintext(
                        username_from_url.unwrap_or(effective_username),
                        &repo_config.token
                    )
                });
                let mut fo2 = git2::FetchOptions::new();
                fo2.remote_callbacks(cb2);
                builder.fetch_options(fo2);

                match builder.clone(&repo_url, &temp_dir) {
                    Ok(_) => {
                        results.push(format!("✅ {}: 克隆成功", repo_config.url));
                    }
                    Err(e2) => {
                        results.push(format!(
                            "❌ {}: 连接失败 - {}",
                            repo_config.url, e2
                        ));
                    }
                }
            }
        }

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    Ok(results.join("\n"))
}

// 获取当前日期和星期信息
#[tauri::command]
pub async fn get_current_date() -> Result<String, String> {
    let today = chrono::Local::today();
    let day_of_week = today.weekday();

    let day_names = ["日", "一", "二", "三", "四", "五", "六"];
    let day_name = day_names[day_of_week.num_days_from_sunday() as usize];

    let result = format!("今天是 {}，星期{}", today.format("%Y-%m-%d"), day_name);
    Ok(result)
}

// 判断今天应该工作多少小时
#[tauri::command]
pub async fn get_required_work_hours() -> Result<f64, String> {
    let today = chrono::Local::today();
    let day_of_week = today.weekday();

    let hours = match day_of_week {
        chrono::Weekday::Mon | chrono::Weekday::Wed | chrono::Weekday::Fri => 8.0,
        chrono::Weekday::Tue | chrono::Weekday::Thu => 10.0,
        _ => 0.0, // 周末按照0小时计算（如果被触发）
    };

    Ok(hours)
}

// AI相关的结构体定义
#[derive(Serialize, Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize, Deserialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Serialize, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AIConfig {
    pub apiKey: String,
    pub model: String,
    pub baseUrl: String,
}

// 加载DeepSeek配置（优先数据库，回退到资源文件）
async fn load_deepseek_config(app: &AppHandle) -> Result<Value, String> {
    // 先尝试从数据库加载
    let db = app.state::<crate::database::Database>();
    if let Ok(Some(json)) = db.get_config("ai_config") {
        if let Ok(config) = serde_json::from_str::<Value>(&json) {
            if !config["apiKey"].is_null() && config["apiKey"] != "your_deepseek_api_key_here" {
                return Ok(config);
            }
        }
    }

    // 如果数据库配置不存在或无效，尝试加载资源文件配置
    let resource_path = app
        .path()
        .resolve("config/deepseek.json", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("无法解析资源路径: {}", e))?;

    let config_content = tokio::fs::read_to_string(&resource_path)
        .await
        .map_err(|e| format!("读取配置文件失败: {}。文件路径: {:?}", e, resource_path))?;

    let config: Value = serde_json::from_str(&config_content)
        .map_err(|e| format!("解析配置文件失败: {}", e))?;

    if config["apiKey"].is_null() || config["apiKey"] == "your_deepseek_api_key_here" {
        return Err("请配置有效的API Key".to_string());
    }

    Ok(config)
}

// 发送AI请求
async fn send_ai_request(app: &AppHandle, messages: Vec<ChatMessage>) -> Result<String, String> {
    let config = load_deepseek_config(app).await?;

    let client = reqwest::Client::new();
    let chat_request = ChatRequest {
        model: config["model"].as_str().unwrap_or("deepseek-chat").to_string(),
        messages,
        stream: false,
    };

    let response = client
        .post(format!("{}/chat/completions", config["baseUrl"].as_str().unwrap_or("https://api.deepseek.com/v1")))
        .header("Authorization", format!("Bearer {}", config["apiKey"].as_str().unwrap_or_default()))
        .header("Content-Type", "application/json")
        .json(&chat_request)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API请求失败 ({}): {}", status, error_text));
    }

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    chat_response
        .choices
        .first()
        .map(|choice| choice.message.content.clone())
        .ok_or_else(|| "AI响应为空".to_string())
}

// 处理工作日志AI助手 - 增强版本
#[tauri::command]
pub async fn process_worklog_with_ai(app: AppHandle) -> Result<String, String> {
    // 获取当前日期和应工作时间
    let date_info = get_current_date().await?;
    let required_hours = get_required_work_hours().await?;
    
    // 获取今天的工作日志
    let today_worklogs = get_my_today_worklogs(app.clone(), None).await?;
    let total_worked_hours: f64 = today_worklogs.iter().map(|w| w.time_spent_hours).sum();
    
    // 获取未完成的问题
    let unfinished_issues = get_my_unfinished_issues(app.clone()).await?;
    
    // 获取今天的Git提交
    let today_str = Local::now().format("%Y-%m-%d").to_string();
    let today_commits = get_commits_by_date(app.clone(), today_str).await?;
    
    // 计算剩余需要记录的时间
    let remaining_hours = (required_hours - total_worked_hours).max(0.0);
    
    if remaining_hours <= 0.0 {
        return Ok("您已经完成了今天的工时要求，不需要补充工作日志。".to_string());
    }
    
    // 准备AI提示
    let git_commits_info = if today_commits.is_empty() {
        "（今日无Git提交记录，请基于JIRA问题列表直接给出工作日志建议）".to_string()
    } else {
        format!("{:#?}", today_commits)
    };

    let ai_prompt = format!(
        r#"你是一个工作日志助手。你的任务是帮助用户自动记录JIRA工作时间。
        
工作流程：
1. 获取当前日期，判断今天是星期几
2. 根据星期判断需要工作的时间（周一/三/五：8小时，周二/四：10小时）
3. 获取用户今天已经记录的JIRA工作时间
4. 如果工作时间不足，需要：
   - 获取用户今天的Git提交记录（如有）
   - 获取用户未完成的JIRA问题列表
   - 使用这些信息匹配并补充工作时间
5. 确认后记录工作时间
6. 记录JIRA工作时间

注意：
- 时间以0.5小时为最小单位
- 最终的总工作时间必须等于要求的时间（周一/三/五：8小时，周二/四：10小时）
- 如果有Git提交，工作说明要基于Git提交的comment总结
- 如果没有Git提交记录，直接根据JIRA问题列表合理分配剩余工时
- 工作说明不需要明写是根据git总结的，只需要返回具体的总结信息即可
- 如果不需要记录，只需要返回已经填满，不缺时间
- 选择一个你觉得最好的方案进行填写jira，不必找我二次确认，直接填写

今日信息：
{}

今日应工作: {:.1} 小时
已记录: {:.1} 小时
还需补充: {:.1} 小时

今日Git提交记录：
{}

今日未完成JIRA问题：
{:#?}

请根据以上信息，生成合适的工作日志建议，并调用jira_tools工具记录JIRA工作时间。"#,
        date_info, required_hours, total_worked_hours, remaining_hours, git_commits_info, unfinished_issues
    );

    // 创建AI消息
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: r#"你是一个工作日志助手。你的任务是帮助用户自动记录JIRA工作时间。

工作流程：
1. 获取当前日期，判断今天是星期几
2. 根据星期判断需要工作的时间（周一/三/五：8小时，周二/四：10小时）
3. 获取用户今天已经记录的JIRA工作时间
4. 如果工作时间不足，需要：
   - 获取用户今天的Git提交记录
   - 获取用户未完成的JIRA问题列表
   - 使用这些信息匹配并补充工作时间(git提交记录最匹配的jira问题，使用余弦相似度)
5. 确认后记录工作时间
6. 记录JIRA工作时间

注意：
- 时间以0.5小时为最小单位
- 最终的总工作时间必须等于要求的时间（周一/三/五：8小时，周二/四：10小时）
- 工作说明要基于Git提交的comment总结
- 有几条git提交记录，就需要填写几个jira日志，填写jira日志时间总和为要求的时间
- 工作说明不需要明写是根据git总结的，只需要返回具体的总结信息即可
- 如果不需要记录，只需要返回已经填满，不缺时间
- 选择一个你觉得最好的方案进行填写jira，不必找我二次确认，直接填写

示例1 (周二，工时不足)
背景：今天是周二，要求工时10小时。用户已记录6小时。

数据：
Git提交：[(a1b2c3, feat/PROJ-123, "优化用户登录接口响应速度，重构缓存逻辑")]
JIRA问题：[(PROJ-123, "登录性能优化", "需要重构缓存层…")， (PROJ-456, "首页UI改版", "…")]

助手输出：
检测到周二，标准工时为10小时。
您已记录6小时，仍需补充4小时。
根据您今日的Git活动，为您生成以下工作日志：
--------------------------------------
1. JIRA问题: PROJ-123
   记录工时: 4.0小时
   工作说明: 重构用户登录模块的缓存逻辑，优化接口响应速度，并进行相关测试。
*(解释：一条Git提交匹配到PROJ-123，将需补充的4小时全部分配于此，并细化了说明)*
                   
最后调用相关jira工具记录JIRA工作时间

示例2 (周五，工时不足，多条提交)
背景：今天是周五，要求工时8小时。用户已记录2小时。

数据：
Git提交：[
(d4e5f6, fix/PROJ-789, "修复订单列表分页查询总数错误"),
(g7h8i9, main, "合并feature分支，解决冲突")
]

JIRA问题：[(PROJ-789, "订单分页Bug修复", "计算总数有误…")， (PROJ-100, "日常运维", "…")]

助手输出：
检测到周五，标准工时为8小时。
您已记录2小时，仍需补充6小时。
根据您今日的Git活动，为您生成以下工作日志：
--------------------------------------
1. JIRA问题: PROJ-789
   记录工时: 4.0小时
   工作说明: 修复订单列表分页查询中总数计算错误的Bug，包括问题定位、代码修复及单元测试更新。
  
2. JIRA问题: PROJ-100 (日常运维)
   记录工时: 2.0小时
   工作说明: 进行代码仓库的日常集成与维护，处理分支合并冲突，确保主分支稳定性。
   调用相关jira工具记录JIRA工作时间
*(解释：第一条提交完美匹配PROJ-789。第二条提交未直接匹配具体特性，匹配到"日常运维"类任务更合理。工时按任务复杂度分配为4h和2h，总和为需补充的6h)*
最后调用相关jira工具记录JIRA工作时间"#.to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: ai_prompt,
        }
    ];

    // 发送请求给AI
    let ai_response = send_ai_request(&app, messages).await?;
    
    Ok(ai_response)
}

/// 根据用户选择的 Jira 问题、Git 提交和总时长，通过 AI 生成工作日志建议
#[tauri::command]
pub async fn generate_worklog_suggestions(
    app: AppHandle,
    selected_issue_keys: Vec<String>,
    selected_commit_ids: Vec<String>,
    total_hours: f64,
    date_str: String,
) -> Result<String, String> {
    if selected_issue_keys.is_empty() {
        return Err("请至少选择一个JIRA问题".to_string());
    }
    if total_hours <= 0.0 || total_hours > 24.0 {
        return Err("总时长必须在 0-24 小时之间".to_string());
    }

    // 获取所有未完成的问题
    let all_issues = get_my_unfinished_issues(app.clone()).await?;
    
    // 筛选出选中的问题
    let selected_issues: Vec<&JiraIssue> = all_issues
        .iter()
        .filter(|i| selected_issue_keys.contains(&i.key))
        .collect();

    if selected_issues.is_empty() {
        return Err("没有找到选中的JIRA问题（可能已被完成或不存在）".to_string());
    }

    // 尝试获取 Git 提交（使用传入的日期而非当天）
    let all_commits = get_commits_by_date(app.clone(), date_str).await?;
    
    let selected_commits: Vec<&GitCommit> = if selected_commit_ids.is_empty() {
        Vec::new()
    } else {
        all_commits
            .iter()
            .filter(|c| selected_commit_ids.contains(&c.commit_id))
            .collect()
    };

    // 准备选中的问题信息
    let issues_info: Vec<String> = selected_issues.iter().map(|i| {
        format!("- {}: {}", i.key, i.summary)
    }).collect();

    // 准备选中的提交信息
    let commits_info = if selected_commits.is_empty() {
        "（未选择Git提交记录）".to_string()
    } else {
        selected_commits.iter().map(|c| {
            format!("- [{}] {} (仓库: {})", 
                &c.commit_id[..8.min(c.commit_id.len())], 
                c.message.trim(),
                c.repository.rsplit('/').next().unwrap_or(&c.repository))
        }).collect::<Vec<_>>().join("\n")
    };

    let ai_prompt = format!(
        r#"你是一个工作日志助手。请根据用户选择的JIRA问题和Git提交记录，生成工作日志建议。

要求：
1. 将总时长 {} 小时合理分配到选中的JIRA问题上
2. 如果有Git提交记录，优先将匹配的提交对应的工时分配到相关JIRA问题上
3. 每个JIRA问题的工时以0.5小时为单位
4. 工作说明要简洁，基于Git提交信息总结（如有）或根据JIRA问题摘要生成
5. 所有工时总和必须等于 {:.1} 小时

请按以下格式输出（每条一行，不要其他解释）：
JIRA问题: XXX-123
记录工时: 4.0小时
工作说明: 具体的说明内容
---
JIRA问题: XXX-456
记录工时: 2.0小时
工作说明: 具体的说明内容

选中的JIRA问题：
{}

选中的Git提交记录：
{}"#,
        total_hours, total_hours,
        issues_info.join("\n"),
        commits_info
    );

    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: "你是一个工作日志助手，帮助用户合理分配工时到JIRA问题上。只输出工作日志条目，不要输出其他内容。".to_string(),
        },
        ChatMessage {
            role: "user".to_string(),
            content: ai_prompt,
        },
    ];

    let ai_response = send_ai_request(&app, messages).await?;
    Ok(ai_response)
}

// 多日工单汇总的数据结构
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DateWorklogSummary {
    pub date: String,
    pub worklogs: Vec<WorklogEntry>,
    pub total_hours: f64,
}

// 内部辅助函数：拉取指定日期的worklogs（避免重复代码）
async fn fetch_worklogs_for_date(
    config: &JiraConfig,
    target_date: NaiveDate,
) -> Result<Vec<WorklogEntry>, String> {
    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let jql = format!(
        "worklogAuthor = currentUser() AND worklogDate = '{}'",
        target_date.format("%Y-%m-%d")
    );

    let url = format!("{}/rest/api/2/search", config.jira_url.trim_end_matches('/'));

    let response = client
        .get(&url)
        .basic_auth(&config.username, Some(&config.api_token))
        .query(&[("jql", jql.as_str()), ("maxResults", "100")])
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    if !response.status().is_success() {
        println!("[jira_tools] fetch_worklogs_for_date: 日期 {} API 返回错误状态 {}", target_date, response.status());
        return Ok(Vec::new()); // 某天查询失败不阻塞整体
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let mut worklogs = Vec::new();

    if let Some(issues_array) = json["issues"].as_array() {
        for issue_value in issues_array {
            let issue_key = issue_value["key"].as_str().unwrap_or_default().to_string();

            let worklog_url = format!(
                "{}/rest/api/2/issue/{}/worklog",
                config.jira_url.trim_end_matches('/'),
                issue_key
            );

            let worklog_response = client
                .get(&worklog_url)
                .basic_auth(&config.username, Some(&config.api_token))
                .send()
                .await;

            let worklog_response = match worklog_response {
                Ok(r) if r.status().is_success() => r,
                Ok(r) => {
                    println!("[jira_tools] fetch_worklogs_for_date: issue {} worklog 请求返回状态 {}", issue_key, r.status());
                    continue;
                }
                Err(e) => {
                    println!("[jira_tools] fetch_worklogs_for_date: issue {} worklog 请求失败: {}", issue_key, e);
                    continue;
                }
            };

            let worklog_json: Value = worklog_response
                .json()
                .await
                .map_err(|e| format!("解析工作日志响应失败: {}", e))?;

            if let Some(worklogs_array) = worklog_json["worklogs"].as_array() {
                for wl in worklogs_array {
                    let started_str = match wl["started"].as_str() {
                        Some(s) => s,
                        None => continue,
                    };

                    let started = match parse_jira_started(started_str) {
                        Some(dt) => dt.with_timezone(&Local),
                        None => continue,
                    };

                    if started.date_naive() != target_date {
                        continue;
                    }

                    let comment_str = if wl["comment"].is_string() {
                        wl["comment"].as_str().unwrap_or_default().to_string()
                    } else if wl["comment"].is_null() {
                        "".to_string()
                    } else {
                        wl["comment"].to_string()
                    };

                    let seconds = wl["timeSpentSeconds"].as_i64().unwrap_or(0);
                    let worklog_id = wl["id"].as_str()
                        .map(|s| s.to_string())
                        .or_else(|| wl["id"].as_i64().map(|id| id.to_string()))
                        .unwrap_or_default();

                    worklogs.push(WorklogEntry {
                        issue_key: issue_key.clone(),
                        time_spent_hours: (seconds as f64) / 3600.0,
                        comment: comment_str,
                        started: started_str.to_string(),
                        similarity_score: 0.0,
                        worklog_id,
                    });
                }
            }
        }
    }

    Ok(worklogs)
}

// 查询指定日期范围内的所有工作日志（按日期分组）
#[tauri::command]
pub async fn get_worklogs_by_date_range(
    app: AppHandle,
    start_date: String,
    end_date: String,
) -> Result<Vec<DateWorklogSummary>, String> {
    let config = load_jira_config(app.clone())
        .await?
        .ok_or_else(|| "JIRA配置未设置".to_string())?;

    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| format!("开始日期格式错误: {}", e))?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|e| format!("结束日期格式错误: {}", e))?;

    if start > end {
        return Err("开始日期不能晚于结束日期".to_string());
    }

    // 限制最多30天
    let days_diff = (end - start).num_days();
    if days_diff > 30 {
        return Err("查询范围不能超过30天".to_string());
    }

    let total_days = (end - start).num_days() + 1;
    println!("[jira_tools] get_worklogs_by_date_range: 开始查询 {} 至 {} (共 {} 天)", start_date, end_date, total_days);

    let mut summaries: Vec<DateWorklogSummary> = Vec::new();
    let mut current = start;
    let mut day_index = 0;

    while current <= end {
        day_index += 1;
        let date_str = current.format("%Y-%m-%d").to_string();
        println!("[jira_tools] get_worklogs_by_date_range: 正在查询第 {}/{} 天 ({})", day_index, total_days, date_str);
        let worklogs = fetch_worklogs_for_date(&config, current).await?;
        let total_hours: f64 = worklogs.iter().map(|w| w.time_spent_hours).sum();

        if !worklogs.is_empty() {
            summaries.push(DateWorklogSummary {
                date: date_str,
                worklogs,
                total_hours,
            });
        }

        current = current.succ_opt().unwrap_or(current);
        // 防止无限循环
        if current > end {
            break;
        }
    }

    println!("[jira_tools] get_worklogs_by_date_range: 查询完成，共 {} 天有工单记录", summaries.len());
    Ok(summaries)
}