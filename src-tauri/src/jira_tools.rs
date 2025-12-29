use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use reqwest;
use serde_json::Value;
use git2;
use base64;
use chrono::{self, Datelike};
use uuid;

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
    pub branch: String,
}

// 获取JIRA配置路径
async fn get_jira_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    Ok(app_data_dir.join("jira_config.json"))
}

// 保存JIRA配置
#[tauri::command]
pub async fn save_jira_config(app: AppHandle, config: JiraConfig) -> Result<(), String> {
    let config_path = get_jira_config_path(&app).await?;

    let config_json =
        serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {}", e))?;

    tokio::fs::write(&config_path, config_json)
        .await
        .map_err(|e| format!("保存配置文件失败: {}", e))?;

    Ok(())
}

// 加载JIRA配置
#[tauri::command]
pub async fn load_jira_config(app: AppHandle) -> Result<Option<JiraConfig>, String> {
    let config_path = get_jira_config_path(&app).await?;

    if !tokio::fs::try_exists(&config_path)
        .await
        .map_err(|e| format!("检查配置文件是否存在失败: {}", e))?
    {
        return Ok(None);
    }

    let config_content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    let config: JiraConfig =
        serde_json::from_str(&config_content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(Some(config))
}

// 获取Git配置路径
async fn get_git_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    Ok(app_data_dir.join("git_config.json"))
}

// 保存Git配置
#[tauri::command]
pub async fn save_git_config(app: AppHandle, config: GitConfig) -> Result<(), String> {
    let config_path = get_git_config_path(&app).await?;

    let config_json =
        serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {}", e))?;

    tokio::fs::write(&config_path, config_json)
        .await
        .map_err(|e| format!("保存配置文件失败: {}", e))?;

    Ok(())
}

// 加载Git配置
#[tauri::command]
pub async fn load_git_config(app: AppHandle) -> Result<Option<GitConfig>, String> {
    let config_path = get_git_config_path(&app).await?;

    if !tokio::fs::try_exists(&config_path)
        .await
        .map_err(|e| format!("检查配置文件是否存在失败: {}", e))?
    {
        return Ok(None);
    }

    let config_content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    let config: GitConfig =
        serde_json::from_str(&config_content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(Some(config))
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

// 从JIRA获取今天的工作记录
#[tauri::command]
pub async fn get_my_today_worklogs(app: AppHandle) -> Result<Vec<WorklogEntry>, String> {
    let config = load_jira_config(app.clone()).await?
        .ok_or_else(|| "JIRA配置未设置".to_string())?;

    let today = chrono::Local::today().naive_local();
    let jql = format!("worklogAuthor = currentUser() AND worklogDate = '{}'", today.format("%Y-%m-%d"));

    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let url = format!("{}/rest/api/2/search", config.jira_url.trim_end_matches('/'));

    let auth_value = format!("Basic {}", base64::encode(&format!("{}:{}", config.username, config.api_token)));

    let response = client
        .get(&url)
        .header("Authorization", auth_value.clone())
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
            let worklog_url = format!("{}/rest/api/2/issue/{}/worklog", config.jira_url.trim_end_matches('/'), issue_key);
            let worklog_response = client
                .get(&worklog_url)
                .header("Authorization", auth_value.clone())
                .send()
                .await
                .map_err(|e| format!("获取工作日志失败: {}", e))?;

            if worklog_response.status().is_success() {
                let worklog_json: Value = worklog_response
                    .json()
                    .await
                    .map_err(|e| format!("解析工作日志响应失败: {}", e))?;

                if let Some(worklogs_array) = worklog_json["worklogs"].as_array() {
                    for worklog in worklogs_array {
                        // 检查是否是今天的工作日志
                        if let Some(started_str) = worklog["started"].as_str() {
                            if let Ok(started) = chrono::DateTime::parse_from_rfc3339(started_str) {
                                let worklog_date = started.with_timezone(&chrono::Local).date().naive_local();
                                if worklog_date == today {
                                    let worklog_entry = WorklogEntry {
                                        issue_key: issue_key.clone(),
                                        time_spent_hours: (worklog["timeSpentSeconds"].as_i64().unwrap_or(0) as f64) / 3600.0,
                                        comment: worklog["comment"].as_str().unwrap_or_default().to_string(),
                                        started: started_str.to_string(),
                                        similarity_score: 0.0,
                                    };
                                    worklogs.push(worklog_entry);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(worklogs)
}

// 记录JIRA工作时间
#[tauri::command]
pub async fn log_work(app: AppHandle, issue_key: String, time_spent_hours: f64, comment: String) -> Result<bool, String> {
    let config = load_jira_config(app.clone()).await?
        .ok_or_else(|| "JIRA配置未设置".to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("xsun-desktop-pet/1.0")
        .build()
        .map_err(|e| format!("创建HTTP客户端失败: {}", e))?;

    let worklog_url = format!("{}/rest/api/2/issue/{}/worklog", config.jira_url.trim_end_matches('/'), issue_key);

    let time_spent_seconds = (time_spent_hours * 3600.0) as i64;
    let worklog_data = serde_json::json!({
        "timeSpentSeconds": time_spent_seconds,
        "comment": comment,
        "started": chrono::Utc::now().to_rfc3339()
    });

    let auth_value = format!("Basic {}", base64::encode(&format!("{}:{}", config.username, config.api_token)));

    let response = client
        .post(&worklog_url)
        .header("Authorization", auth_value)
        .header("Content-Type", "application/json")
        .json(&worklog_data)
        .send()
        .await
        .map_err(|e| format!("发送请求失败: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("记录工作时间失败 ({}): {}", status, error_text));
    }

    Ok(true)
}

// 从Git仓库获取指定用户今天的提交记录
#[tauri::command]
pub async fn get_today_commits_by_user(app: AppHandle) -> Result<Vec<GitCommit>, String> {
    let git_config = load_git_config(app.clone()).await?
        .ok_or_else(|| "Git配置未设置".to_string())?;

    let today = chrono::Local::today().naive_local();
    let mut all_commits = Vec::new();

    for repo_config in &git_config.repositories {
        // 创建临时目录来克隆仓库
        let temp_dir = std::env::temp_dir().join(format!("jira_git_repo_{}", uuid::Uuid::new_v4()));
        
        // 设置认证回调
        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(|_url, username_from_url, _allowed_types| {
            git2::Cred::userpass_plaintext(
                username_from_url.unwrap_or(&git_config.username), 
                &repo_config.token
            )
        });
        
        let mut fetch_options = git2::FetchOptions::new();
        fetch_options.remote_callbacks(callbacks);
        
        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch_options);
        let repo = builder.clone(&repo_config.url, &temp_dir)
            .map_err(|e| format!("克隆仓库失败: {}", e))?;

        // 获取提交历史
        let mut revwalk = repo.revwalk().map_err(|e| format!("创建revwalk失败: {}", e))?;
        revwalk.push_head().map_err(|e| format!("获取HEAD失败: {}", e))?;

        for oid in revwalk {
            let oid = oid.map_err(|e| format!("获取提交OID失败: {}", e))?;
            let commit = repo.find_commit(oid).map_err(|e| format!("查找提交失败: {}", e))?;
            
            // 获取提交时间
            let commit_time = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                .unwrap_or_else(|| chrono::Utc::now());
            let commit_date = commit_time.with_timezone(&chrono::Local).date().naive_local();
            
            // 检查是否是今天的提交，并且是当前用户
            if commit_date == today && commit.author().name().unwrap_or("") == git_config.username.as_str() {
                let git_commit = GitCommit {
                    commit_id: oid.to_string(),
                    author: commit.author().name().unwrap_or("").to_string(),
                    message: commit.message().unwrap_or("").to_string(),
                    commit_time: commit_time.to_rfc3339(),
                    repository: repo_config.url.clone(),
                    files_changed: 0, // 需要额外计算文件变更数
                    additions: 0,
                    deletions: 0,
                };
                all_commits.push(git_commit);
            }
        }

        // 清理临时目录
        std::fs::remove_dir_all(&temp_dir).ok();
    }

    Ok(all_commits)
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
        _ => 0.0, // 周末不需要工作
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
    pub api_key: String,
    pub model: String,
    pub base_url: String,
}

// 获取DeepSeek配置路径
async fn get_deepseek_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    Ok(app_data_dir.join("deepseek_config.json"))
}

// 加载DeepSeek配置
async fn load_deepseek_config(app: &AppHandle) -> Result<Value, String> {
    // 先尝试加载本地配置
    let local_config_path = get_deepseek_config_path(app).await?;
    
    if tokio::fs::try_exists(&local_config_path)
        .await
        .map_err(|e| format!("检查配置文件是否存在失败: {}", e))?
    {
        let config_content = tokio::fs::read_to_string(&local_config_path)
            .await
            .map_err(|e| format!("读取本地配置文件失败: {}", e))?;
        
        let config: Value = serde_json::from_str(&config_content)
            .map_err(|e| format!("解析本地配置文件失败: {}", e))?;
        
        if !config["apiKey"].is_null() && config["apiKey"] != "your_deepseek_api_key_here" {
            return Ok(config);
        }
    }

    // 如果本地配置不存在或无效，尝试加载资源文件配置
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
    let today_worklogs = get_my_today_worklogs(app.clone()).await?;
    let total_worked_hours: f64 = today_worklogs.iter().map(|w| w.time_spent_hours).sum();
    
    // 获取未完成的问题
    let unfinished_issues = get_my_unfinished_issues(app.clone()).await?;
    
    // 获取今天的Git提交
    let today_commits = get_today_commits_by_user(app.clone()).await?;
    
    // 计算剩余需要记录的时间
    let remaining_hours = (required_hours - total_worked_hours).max(0.0);
    
    if remaining_hours <= 0.0 {
        return Ok("您已经完成了今天的工时要求，不需要补充工作日志。".to_string());
    }
    
    // 准备AI提示
    let ai_prompt = format!(
        r#"你是一个工作日志助手。你的任务是帮助用户自动记录JIRA工作时间。
        
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

今日信息：
{}

今日应工作: {:.1} 小时
已记录: {:.1} 小时
还需补充: {:.1} 小时

今日Git提交记录：
{:#?}

今日未完成JIRA问题：
{:#?}

请根据以上信息，生成合适的工作日志建议，并调用jira_tools工具记录JIRA工作时间。"#,
        date_info, required_hours, total_worked_hours, remaining_hours, today_commits, unfinished_issues
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

// 获取AI配置路径
async fn get_ai_config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;

    tokio::fs::create_dir_all(&app_data_dir)
        .await
        .map_err(|e| format!("创建配置目录失败: {}", e))?;

    Ok(app_data_dir.join("ai_config.json"))
}

// 保存AI配置
#[tauri::command]
pub async fn save_ai_config(app: AppHandle, config: AIConfig) -> Result<(), String> {
    let config_path = get_ai_config_path(&app).await?;

    let config_json =
        serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {}", e))?;

    tokio::fs::write(&config_path, config_json)
        .await
        .map_err(|e| format!("保存配置文件失败: {}", e))?;

    Ok(())
}

// 加载AI配置
#[tauri::command]
pub async fn load_ai_config(app: AppHandle) -> Result<Option<AIConfig>, String> {
    let config_path = get_ai_config_path(&app).await?;

    if !tokio::fs::try_exists(&config_path)
        .await
        .map_err(|e| format!("检查配置文件是否存在失败: {}", e))?
    {
        return Ok(None);
    }

    let config_content = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("读取配置文件失败: {}", e))?;

    let config: AIConfig =
        serde_json::from_str(&config_content).map_err(|e| format!("解析配置文件失败: {}", e))?;

    Ok(Some(config))
}

// 辅助函数：从提交信息中查找匹配的JIRA问题
fn find_matching_issue(commit_message: &str, issues: &[JiraIssue]) -> Option<JiraIssue> {
    for issue in issues {
        if commit_message.contains(&issue.key) {
            return Some(issue.clone());
        }
    }
    None
}

// 辅助函数：从提交信息生成工作说明
fn generate_work_comment(commit_message: &str) -> String {
    // 简单地截取提交信息的前几个词作为工作说明
    let words: Vec<&str> = commit_message.split_whitespace().take(10).collect();
    let comment = words.join(" ");
    
    if comment.is_empty() {
        "执行开发任务".to_string()
    } else {
        comment
    }
}