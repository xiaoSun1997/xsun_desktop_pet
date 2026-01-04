use chrono::{Datelike, Local, Timelike, Weekday};
use tauri::{AppHandle, Manager};
use tokio_cron_scheduler::{Job, JobScheduler};
use std::sync::Arc;

// 导入需要的类型
use crate::jira_tools::{process_worklog_with_ai};

pub struct TaskScheduler {
    scheduler: Arc<JobScheduler>,
}

impl TaskScheduler {
    pub async fn new() -> Result<Self, String> {
        let scheduler = JobScheduler::new().await.map_err(|e| e.to_string())?;
        Ok(TaskScheduler {
            scheduler: Arc::new(scheduler),
        })
    }

    pub async fn start_worklog_scheduler(&self, app_handle: AppHandle) -> Result<(), String> {
        // 创建一个每分钟检查一次的定时任务
        let app_handle_for_job = app_handle.clone();

        let job = Job::new_async("*/1 * * * * * *", move |uuid, mut _sender| {
            let app_handle = app_handle_for_job.clone();
            Box::pin(async move {
                let now = Local::now();
                
                // 检查是否是周一到周五且时间是17:00左右
                let is_weekday = match now.weekday() {
                    Weekday::Mon | Weekday::Tue | Weekday::Wed | Weekday::Thu | Weekday::Fri => true,
                    _ => false,
                };
                
                // 检查是否接近17:00（17:00到17:05之间，确保任务在17:00的几分钟内执行）
                let is_time = now.hour() == 17 && now.minute() >= 0 && now.minute() < 5;
                
                if is_weekday && is_time {
                    println!("执行定时任务: process_worklog_with_ai");
                    
                    // 调用AI处理工作日志的方法
                    match process_worklog_with_ai(app_handle).await {
                        Ok(result) => {
                            println!("定时AI任务执行成功: {}", result);
                        }
                        Err(e) => {
                            eprintln!("定时AI任务执行失败: {}", e);
                        }
                    }
                }
            })
        }).map_err(|e| format!("创建定时任务失败: {}", e))?;

        self.scheduler.add(job).await.map_err(|e| format!("添加定时任务失败: {}", e))?;
        
        // 启动调度器
        self.scheduler.start().await.map_err(|e| format!("启动调度器失败: {}", e))?;
        
        Ok(())
    }

    pub async fn add_cron_job<F>(&self, cron_expression: &str, handler: F) -> Result<(), String> 
    where 
        F: Fn() -> Box<dyn std::future::Future<Output = ()> + Send + Unpin> + Send + Sync + 'static,
    {
        let handler = Arc::new(handler);
        let job = Job::new_async(cron_expression, move |uuid, mut _sender| {
            let handler = handler.clone();
            Box::pin(async move {
                handler().await;
            })
        }).map_err(|e| format!("创建定时任务失败: {}", e))?;

        self.scheduler.add(job).await.map_err(|e| format!("添加定时任务失败: {}", e))?;
        
        Ok(())
    }
}

// 初始化定时任务调度器
pub async fn init_scheduler(app_handle: AppHandle) -> Result<(), String> {
    let scheduler = TaskScheduler::new().await
        .map_err(|e| format!("初始化调度器失败: {}", e))?;
    let app_handle_for_job = app_handle.clone();
    // 启动工作日志AI定时任务
    scheduler.start_worklog_scheduler(app_handle).await?;
    
    // 将调度器存储在app state中，以便后续使用
    app_handle_for_job.manage(scheduler);
    
    Ok(())
}