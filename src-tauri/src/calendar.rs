use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use chrono::{DateTime, Local, NaiveDate, Datelike};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub completed: bool,
    pub created_at: i64,
    pub priority: Option<TodoPriority>,
    pub category: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum TodoPriority {
    Low,
    Medium,
    High,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub all_day: bool,
    pub color: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DayData {
    pub date: String,
    pub todos: Vec<TodoItem>,
    pub events: Vec<CalendarEvent>,
    pub notes: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CalendarSettings {
    #[serde(rename = "backgroundImages")]
    pub background_images: Vec<String>,
    #[serde(rename = "rotationInterval")]
    pub rotation_interval: u32, // 分钟
    pub theme: Option<String>,
    pub show_lunar: bool,
    pub show_holidays: bool,
    pub default_view: CalendarView,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum CalendarView {
    Month,
    Week,
    Day,
}

impl Default for CalendarSettings {
    fn default() -> Self {
        Self {
            background_images: vec!["data/img0.jpeg".to_string()],
            rotation_interval: 30,
            theme: Some("default".to_string()),
            show_lunar: true,
            show_holidays: true,
            default_view: CalendarView::Month,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LunarInfo {
    pub lunar_month: u32,
    pub lunar_day: u32,
    pub lunar_year: u32,
    pub zodiac: String,
    pub term: Option<String>,
    pub festival: Option<String>,
}

// ===== 健康与锻炼数据模型 =====
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HealthRecord {
    pub date: String,
    #[serde(rename = "morningWeight")]
    pub morning_weight: Option<f64>,
    #[serde(rename = "eveningWeight")]
    pub evening_weight: Option<f64>,
    pub height: Option<f64>,
    pub note: Option<String>,
}

/// 返回体重历史记录用于前端比较
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SaveHealthResult {
    #[serde(rename = "previousMorningWeight")]
    pub previous_morning_weight: Option<f64>,
    #[serde(rename = "previousDate")]
    pub previous_date: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TrainingItem {
    pub id: String,
    pub name: String,
    pub completed: bool,
    pub sets: Option<i32>,
    pub reps: Option<i32>,
    pub weight: Option<f64>,
    pub notes: Option<String>,
    pub created_at: i64,
}

// ===== 学习数据模型 =====
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Subtask {
    pub id: String,
    pub content: String,
    pub completed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LearningItem {
    pub id: String,
    pub title: String,
    pub subtasks: Vec<Subtask>,
    pub completed: bool,
    pub created_at: i64,
}

// ===== 每日汇总 =====
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DailyPlanData {
    pub date: String,
    #[serde(rename = "trainingItems")]
    pub training_items: Vec<TrainingItem>,
    #[serde(rename = "learningItems")]
    pub learning_items: Vec<LearningItem>,
    #[serde(rename = "aiGeneratedPlan")]
    pub ai_generated_plan: Option<String>,
}

// ===== 用户健康档案 =====
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserHealthProfile {
    pub height: Option<f64>,   // cm
    pub age: Option<i32>,
    pub gender: Option<String>, // "male" | "female"
}

// ===== 长期规划 =====
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum PlanType {
    Health,
    Learning,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LongTermPlan {
    pub id: String,
    #[serde(rename = "planType")]
    pub plan_type: PlanType,
    #[serde(rename = "startDate")]
    pub start_date: String,
    #[serde(rename = "endDate")]
    pub end_date: String,
    #[serde(rename = "targetDesc")]
    pub target_desc: String,
    #[serde(rename = "planContent")]
    pub plan_content: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "applied")]
    pub applied: bool,
    #[serde(rename = "weekdayStudyHours")]
    pub weekday_study_hours: Option<f64>,
    #[serde(rename = "weekendStudyHours")]
    pub weekend_study_hours: Option<f64>,
}

pub struct CalendarManager {
    data_dir: std::path::PathBuf,
}

impl CalendarManager {
    pub fn new(data_dir: std::path::PathBuf) -> Self {
        Self { data_dir }
    }

    pub async fn ensure_data_dir(&self) -> Result<(), String> {
        tokio::fs::create_dir_all(&self.data_dir)
            .await
            .map_err(|e| format!("创建数据目录失败: {}", e))
    }

    pub async fn load_todos_for_date(&self, date: &str) -> Result<Vec<TodoItem>, String> {
        let todos_file = self.data_dir.join("todos.json");

        if !tokio::fs::try_exists(&todos_file).await.unwrap_or(false) {
            return Ok(vec![]);
        }

        let content = tokio::fs::read_to_string(&todos_file)
            .await
            .map_err(|e| format!("读取todolist失败: {}", e))?;

        let all_todos: HashMap<String, Vec<TodoItem>> = serde_json::from_str(&content)
            .unwrap_or_default();

        Ok(all_todos.get(date).cloned().unwrap_or_default())
    }

    pub async fn save_todos_for_date(&self, date: &str, todos: Vec<TodoItem>) -> Result<(), String> {
        self.ensure_data_dir().await?;

        let todos_file = self.data_dir.join("todos.json");

        let mut all_todos: HashMap<String, Vec<TodoItem>> = if tokio::fs::try_exists(&todos_file).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&todos_file).await.unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };

        if todos.is_empty() {
            all_todos.remove(date);
        } else {
            all_todos.insert(date.to_string(), todos);
        }

        let content = serde_json::to_string_pretty(&all_todos)
            .map_err(|e| format!("序列化todolist失败: {}", e))?;

        tokio::fs::write(&todos_file, content)
            .await
            .map_err(|e| format!("保存todolist失败: {}", e))?;

        Ok(())
    }

    pub async fn load_events_for_date(&self, date: &str) -> Result<Vec<CalendarEvent>, String> {
        let events_file = self.data_dir.join("events.json");

        if !tokio::fs::try_exists(&events_file).await.unwrap_or(false) {
            return Ok(vec![]);
        }

        let content = tokio::fs::read_to_string(&events_file)
            .await
            .map_err(|e| format!("读取事件失败: {}", e))?;

        let all_events: HashMap<String, Vec<CalendarEvent>> = serde_json::from_str(&content)
            .unwrap_or_default();

        Ok(all_events.get(date).cloned().unwrap_or_default())
    }

    pub async fn save_events_for_date(&self, date: &str, events: Vec<CalendarEvent>) -> Result<(), String> {
        self.ensure_data_dir().await?;

        let events_file = self.data_dir.join("events.json");

        let mut all_events: HashMap<String, Vec<CalendarEvent>> = if tokio::fs::try_exists(&events_file).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&events_file).await.unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };

        if events.is_empty() {
            all_events.remove(date);
        } else {
            all_events.insert(date.to_string(), events);
        }

        let content = serde_json::to_string_pretty(&all_events)
            .map_err(|e| format!("序列化事件失败: {}", e))?;

        tokio::fs::write(&events_file, content)
            .await
            .map_err(|e| format!("保存事件失败: {}", e))?;

        Ok(())
    }

    pub async fn load_settings(&self) -> Result<CalendarSettings, String> {
        let settings_file = self.data_dir.join("calendar_settings.json");

        if !tokio::fs::try_exists(&settings_file).await.unwrap_or(false) {
            return Ok(CalendarSettings::default());
        }

        let content = tokio::fs::read_to_string(&settings_file)
            .await
            .map_err(|e| format!("读取配置文件失败: {}", e))?;

        let settings: CalendarSettings = serde_json::from_str(&content)
            .map_err(|e| format!("解析配置文件失败: {}", e))?;

        Ok(settings)
    }

    pub async fn save_settings(&self, settings: &CalendarSettings) -> Result<(), String> {
        self.ensure_data_dir().await?;

        let settings_file = self.data_dir.join("calendar_settings.json");

        let settings_json = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("序列化配置失败: {}", e))?;

        tokio::fs::write(&settings_file, settings_json)
            .await
            .map_err(|e| format!("保存配置文件失败: {}", e))?;

        Ok(())
    }

    pub async fn upload_background_image(&self, image_data: &[u8], filename: &str) -> Result<String, String> {
        let images_dir = self.data_dir.join("background_images");
        tokio::fs::create_dir_all(&images_dir)
            .await
            .map_err(|e| format!("创建图片目录失败: {}", e))?;

        let file_path = images_dir.join(filename);
        tokio::fs::write(&file_path, image_data)
            .await
            .map_err(|e| format!("保存图片失败: {}", e))?;

        // 返回相对路径
        Ok(format!("background_images/{}", filename))
    }

    pub async fn delete_background_image(&self, image_path: &str) -> Result<(), String> {
        let file_path = self.data_dir.join(image_path);

        if tokio::fs::try_exists(&file_path).await.unwrap_or(false) {
            tokio::fs::remove_file(&file_path)
                .await
                .map_err(|e| format!("删除图片失败: {}", e))?;
        }

        Ok(())
    }

    pub async fn get_month_data(&self, year: i32, month: u32) -> Result<HashMap<String, DayData>, String> {
        let mut month_data = HashMap::new();

        // 计算该月有多少天
        let days_in_month = if month == 12 {
            NaiveDate::from_ymd_opt(year + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(year, month + 1, 1)
        }
            .ok_or("Invalid date")?
            .pred_opt()
            .ok_or("Invalid date")?
            .day();

        for day in 1..=days_in_month {
            let date_str = format!("{:04}-{:02}-{:02}", year, month, day);
            let todos = self.load_todos_for_date(&date_str).await.unwrap_or_default();
            let events = self.load_events_for_date(&date_str).await.unwrap_or_default();

            if !todos.is_empty() || !events.is_empty() {
                month_data.insert(date_str.clone(), DayData {
                    date: date_str,
                    todos,
                    events,
                    notes: None,
                });
            }
        }

        Ok(month_data)
    }

    pub fn get_lunar_info(&self, date: &NaiveDate) -> Option<LunarInfo> {
        // 这里应该使用真正的农历转换库
        // 目前返回简单的示例数据
        let day = date.day();
        let month = date.month();

        Some(LunarInfo {
            lunar_month: month,
            lunar_day: day,
            lunar_year: date.year() as u32,
            zodiac: self.get_zodiac_for_year(date.year()).unwrap_or_default(),
            term: self.get_solar_term(date),
            festival: self.get_traditional_festival(date),
        })
    }

    fn get_zodiac_for_year(&self, year: i32) -> Option<String> {
        let zodiacs = [
            "鼠", "牛", "虎", "兔", "龙", "蛇",
            "马", "羊", "猴", "鸡", "狗", "猪"
        ];

        let index = ((year - 4) % 12) as usize;
        Some(zodiacs[index].to_string())
    }

    fn get_solar_term(&self, _date: &NaiveDate) -> Option<String> {
        // 简化版本，实际应该根据精确的天文计算
        None
    }

    fn get_traditional_festival(&self, date: &NaiveDate) -> Option<String> {
        // 简化版本的传统节日判断
        match (date.month(), date.day()) {
            (1, 1) => Some("元旦".to_string()),
            (2, 14) => Some("情人节".to_string()),
            (3, 8) => Some("妇女节".to_string()),
            (5, 1) => Some("劳动节".to_string()),
            (6, 1) => Some("儿童节".to_string()),
            (10, 1) => Some("国庆节".to_string()),
            (12, 25) => Some("圣诞节".to_string()),
            _ => None,
        }
    }

    // ===== 健康数据 CRUD =====
    pub async fn load_health_record_for_date(&self, date: &str) -> Result<HealthRecord, String> {
        let file = self.data_dir.join("health_records.json");
        if !tokio::fs::try_exists(&file).await.unwrap_or(false) {
            return Ok(HealthRecord { date: date.to_string(), morning_weight: None, evening_weight: None, height: None, note: None });
        }
        let content = tokio::fs::read_to_string(&file).await.map_err(|e| format!("读取健康数据失败: {}", e))?;
        let all: HashMap<String, HealthRecord> = serde_json::from_str(&content).unwrap_or_default();
        Ok(all.get(date).cloned().unwrap_or(HealthRecord { date: date.to_string(), morning_weight: None, evening_weight: None, height: None, note: None }))
    }

    pub async fn save_health_record(&self, record: &HealthRecord) -> Result<SaveHealthResult, String> {
        self.ensure_data_dir().await?;
        let file = self.data_dir.join("health_records.json");
        let mut all: HashMap<String, HealthRecord> = if tokio::fs::try_exists(&file).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&file).await.unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else { HashMap::new() };

        // 查找上一次有晨重的记录
        let mut prev_morning: Option<f64> = None;
        let mut prev_date: Option<String> = None;
        let mut dates: Vec<String> = all.keys().cloned().collect();
        dates.sort();
        dates.reverse();
        for d in &dates {
            if d < &record.date {
                if let Some(r) = all.get(d) {
                    if let Some(w) = r.morning_weight {
                        prev_morning = Some(w);
                        prev_date = Some(d.clone());
                        break;
                    }
                }
            }
        }

        all.insert(record.date.clone(), record.clone());
        let json = serde_json::to_string_pretty(&all).map_err(|e| format!("序列化健康数据失败: {}", e))?;
        tokio::fs::write(&file, json).await.map_err(|e| format!("保存健康数据失败: {}", e))?;

        Ok(SaveHealthResult {
            previous_morning_weight: prev_morning,
            previous_date: prev_date,
        })
    }

    // ===== 用户健康档案 =====
    pub async fn load_user_health_profile(&self) -> Result<UserHealthProfile, String> {
        let file = self.data_dir.join("user_health_profile.json");
        if !tokio::fs::try_exists(&file).await.unwrap_or(false) {
            return Ok(UserHealthProfile { height: None, age: None, gender: None });
        }
        let content = tokio::fs::read_to_string(&file).await
            .map_err(|e| format!("读取用户健康档案失败: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("解析用户健康档案失败: {}", e))
    }

    pub async fn save_user_health_profile(&self, profile: &UserHealthProfile) -> Result<(), String> {
        self.ensure_data_dir().await?;
        let file = self.data_dir.join("user_health_profile.json");
        let json = serde_json::to_string_pretty(profile)
            .map_err(|e| format!("序列化用户健康档案失败: {}", e))?;
        tokio::fs::write(&file, json).await
            .map_err(|e| format!("保存用户健康档案失败: {}", e))
    }

    // ===== 训练数据 CRUD =====
    pub async fn load_training_items_for_date(&self, date: &str) -> Result<Vec<TrainingItem>, String> {
        let file = self.data_dir.join("training_items.json");
        if !tokio::fs::try_exists(&file).await.unwrap_or(false) { return Ok(vec![]); }
        let content = tokio::fs::read_to_string(&file).await.map_err(|e| format!("读取训练数据失败: {}", e))?;
        let all: HashMap<String, Vec<TrainingItem>> = serde_json::from_str(&content).unwrap_or_default();
        Ok(all.get(date).cloned().unwrap_or_default())
    }

    pub async fn save_training_items_for_date(&self, date: &str, items: Vec<TrainingItem>) -> Result<(), String> {
        self.ensure_data_dir().await?;
        let file = self.data_dir.join("training_items.json");
        let mut all: HashMap<String, Vec<TrainingItem>> = if tokio::fs::try_exists(&file).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&file).await.unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else { HashMap::new() };
        if items.is_empty() { all.remove(date); } else { all.insert(date.to_string(), items); }
        let json = serde_json::to_string_pretty(&all).map_err(|e| format!("序列化训练数据失败: {}", e))?;
        tokio::fs::write(&file, json).await.map_err(|e| format!("保存训练数据失败: {}", e))
    }

    // ===== 学习数据 CRUD =====
    pub async fn load_learning_items_for_date(&self, date: &str) -> Result<Vec<LearningItem>, String> {
        let file = self.data_dir.join("learning_items.json");
        if !tokio::fs::try_exists(&file).await.unwrap_or(false) { return Ok(vec![]); }
        let content = tokio::fs::read_to_string(&file).await.map_err(|e| format!("读取学习数据失败: {}", e))?;
        let all: HashMap<String, Vec<LearningItem>> = serde_json::from_str(&content).unwrap_or_default();
        Ok(all.get(date).cloned().unwrap_or_default())
    }

    pub async fn save_learning_items_for_date(&self, date: &str, items: Vec<LearningItem>) -> Result<(), String> {
        self.ensure_data_dir().await?;
        let file = self.data_dir.join("learning_items.json");
        let mut all: HashMap<String, Vec<LearningItem>> = if tokio::fs::try_exists(&file).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&file).await.unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else { HashMap::new() };
        if items.is_empty() { all.remove(date); } else { all.insert(date.to_string(), items); }
        let json = serde_json::to_string_pretty(&all).map_err(|e| format!("序列化学系数据失败: {}", e))?;
        tokio::fs::write(&file, json).await.map_err(|e| format!("保存学习数据失败: {}", e))
    }

    // ===== 长期规划 CRUD =====
    pub async fn load_long_term_plans(&self) -> Result<Vec<LongTermPlan>, String> {
        let file = self.data_dir.join("long_term_plans.json");
        if !tokio::fs::try_exists(&file).await.unwrap_or(false) { return Ok(vec![]); }
        let content = tokio::fs::read_to_string(&file).await.map_err(|e| format!("读取长期规划失败: {}", e))?;
        Ok(serde_json::from_str(&content).unwrap_or_default())
    }

    pub async fn save_long_term_plans(&self, plans: &Vec<LongTermPlan>) -> Result<(), String> {
        self.ensure_data_dir().await?;
        let file = self.data_dir.join("long_term_plans.json");
        let json = serde_json::to_string_pretty(plans).map_err(|e| format!("序列化长期规划失败: {}", e))?;
        tokio::fs::write(&file, json).await.map_err(|e| format!("保存长期规划失败: {}", e))
    }

    // ===== 日期范围批量查询 =====
    pub async fn get_date_range_daily_data(&self, start_date: &str, end_date: &str) -> Result<Vec<DailyPlanData>, String> {
        let start = NaiveDate::parse_from_str(start_date, "%Y-%m-%d").map_err(|e| format!("解析开始日期失败: {}", e))?;
        let end = NaiveDate::parse_from_str(end_date, "%Y-%m-%d").map_err(|e| format!("解析结束日期失败: {}", e))?;
        let mut results = Vec::new();
        let mut current = start;
        while current <= end {
            let date_str = current.format("%Y-%m-%d").to_string();
            let training = self.load_training_items_for_date(&date_str).await.unwrap_or_default();
            let learning = self.load_learning_items_for_date(&date_str).await.unwrap_or_default();
            if !training.is_empty() || !learning.is_empty() {
                results.push(DailyPlanData { date: date_str, training_items: training, learning_items: learning, ai_generated_plan: None });
            }
            current = current.succ_opt().ok_or("日期溢出")?;
        }
        Ok(results)
    }

    pub async fn cleanup_old_data(&self, days_to_keep: u32) -> Result<(), String> {
        let cutoff_date = chrono::Local::now() - chrono::Duration::days(days_to_keep as i64);
        let cutoff_str = cutoff_date.format("%Y-%m-%d").to_string();

        // 清理旧的待办事项
        let todos_file = self.data_dir.join("todos.json");
        if tokio::fs::try_exists(&todos_file).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&todos_file).await.unwrap_or_default();
            if let Ok(mut all_todos) = serde_json::from_str::<HashMap<String, Vec<TodoItem>>>(&content) {
                all_todos.retain(|date, _| date >= &cutoff_str);

                let updated_content = serde_json::to_string_pretty(&all_todos)
                    .map_err(|e| format!("序列化待办数据失败: {}", e))?;

                tokio::fs::write(&todos_file, updated_content)
                    .await
                    .map_err(|e| format!("保存清理后的待办数据失败: {}", e))?;
            }
        }

        // 清理旧的事件
        let events_file = self.data_dir.join("events.json");
        if tokio::fs::try_exists(&events_file).await.unwrap_or(false) {
            let content = tokio::fs::read_to_string(&events_file).await.unwrap_or_default();
            if let Ok(mut all_events) = serde_json::from_str::<HashMap<String, Vec<CalendarEvent>>>(&content) {
                all_events.retain(|date, _| date >= &cutoff_str);

                let updated_content = serde_json::to_string_pretty(&all_events)
                    .map_err(|e| format!("序列化事件数据失败: {}", e))?;

                tokio::fs::write(&events_file, updated_content)
                    .await
                    .map_err(|e| format!("保存清理后的事件数据失败: {}", e))?;
            }
        }

        Ok(())
    }
}
