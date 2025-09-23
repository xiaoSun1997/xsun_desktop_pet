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
            background_images: vec!["data/img.jpeg".to_string()],
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
