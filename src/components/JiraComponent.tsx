import {useState, useEffect, useRef} from "react";
import {invoke} from "@tauri-apps/api/core";
import {getCurrentWindow} from "@tauri-apps/api/window";
import "./JiraComponent.css";

// 定义数据类型
interface GitCommit {
    commit_id: string;
    author: string;
    message: string;
    commit_time: string;
    repository: string;
    files_changed: number;
    additions: number;
    deletions: number;
}

interface JiraIssue {
    key: string;
    summary: string;
    description: string;
    status: string;
    created: string;
    updated: string;
}

interface WorklogEntry {
    issue_key: string;
    time_spent_hours: number;
    comment: string;
    started: string;
    similarity_score: number;
}

interface JiraConfig {
    jiraUrl: string;
    username: string;
    apiToken: string;
}

interface GitConfig {
    repositories: GitRepository[];
    username: string;
}

interface GitRepository {
    url: string;
    token: string;
    branch: string;
    alias: string;  // ✅ 新增：仓库别名
}

interface AIConfig {
    apiKey: string;
    model: string;
    baseUrl: string;
}

// AI建议数据结构
interface AISuggestion {
    issueKey: string;
    timeSpent: number;
    comment: string;
}

export default function JiraComponent() {
    const [jiraConfig, setJiraConfig] = useState<JiraConfig>({
        jiraUrl: "",
        username: "",
        apiToken: "",
    });

    const [gitConfig, setGitConfig] = useState<GitConfig>({
        repositories: [{url: "", token: "", branch: "main", alias: ""}],  // ✅ 添加 alias
        username: "",
    });

    const [unfinishedIssues, setUnfinishedIssues] = useState<JiraIssue[]>([]);
    const [todayWorklogs, setTodayWorklogs] = useState<WorklogEntry[]>([]);
    const [todayCommits, setTodayCommits] = useState<GitCommit[]>([]);
    // const [currentDate, setCurrentDate] = useState<string>("");
    const [requiredWorkHours, setRequiredWorkHours] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<string>("dashboard");
    const [aiSuggestion, setAiSuggestion] = useState<string>("");
    const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
    const [newWorklog, setNewWorklog] = useState({
        issueKey: "",
        timeSpent: 1.0,
        comment: "",
    });
    
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
    });
    const [selectedDateString, setSelectedDateString] = useState<string>('');

    const [aiConfig, setAiConfig] = useState<AIConfig>({
        apiKey: "",
        model: "gpt-4",
        baseUrl: "https://api.openai.com/v1",
    });

    const headerRef = useRef<HTMLDivElement>(null);
    
    // 生成日期数组的函数
    const generateDateButtons = (): {date: Date, isToday: boolean, formatted: string}[] => {
        const dates = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // 生成前后7天的日期
        for (let i = -7; i <= 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            
            const isToday = date.toDateString() === today.toDateString();
            
            // 格式化日期：MM-DD (周几)
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            const weekday = weekdays[date.getDay()];
            
            dates.push({
                date,
                isToday,
                formatted: `${month}-${day} (${weekday})`
            });
        }
        
        return dates;
    };

    // 关闭窗口函数
    const closeWindow = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.close();
        } catch (error) {
            console.error('关闭窗口失败:', error);
        }
    };

    // 处理拖动功能 - Tauri 2 版本
    useEffect(() => {
        const header = headerRef.current;
        if (!header) return;

        const mouseDownHandler = async (e: MouseEvent) => {
            // 如果点击的是关闭按钮或其他交互元素，则不触发拖动
            if ((e.target as HTMLElement).closest('.close-btn') ||
                (e.target as HTMLElement).closest('button')) {
                return;
            }

            try {
                const appWindow = getCurrentWindow();
                await appWindow.startDragging();
            } catch (error) {
                console.error('拖动失败:', error);
            }
        };

        header.addEventListener('mousedown', mouseDownHandler);

        return () => {
            header.removeEventListener('mousedown', mouseDownHandler);
        };
    }, []);

    // 初始化选中的日期字符串
    useEffect(() => {
        const formatDate = (date: Date): string => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const formattedDate = `${year}-${month}-${day}`;
            console.log("初始化日期字符串:", formattedDate);
            return formattedDate;
        };
        
        setSelectedDateString(formatDate(selectedDate));
    }, [selectedDate]);

    // 加载配置
    useEffect(() => {
        loadConfigs();
        loadTodayData();
    }, []);

    const loadConfigs = async () => {
        try {
            const jiraConf = await invoke("load_jira_config");
            if (jiraConf) {
                setJiraConfig(jiraConf as JiraConfig);
            }

            const gitConf = await invoke("load_git_config");
            if (gitConf) {
                setGitConfig(gitConf as GitConfig);
            }
            
            // 尝试加载AI配置
            try {
                const aiConf = await invoke("load_ai_config");
                if (aiConf) {
                    setAiConfig(aiConf as AIConfig);
                }
            } catch (aiError) {
                console.log("AI配置不存在，使用默认值");
            }
        } catch (error) {
            console.error("加载配置失败:", error);
        }
    };

    const loadTodayData = async () => {
        setLoading(true);
        try {
            // 获取当前日期和应工作时间
            // const dateInfo = await invoke("get_current_date");
            // setCurrentDate(dateInfo as string);

            const workHours = await invoke("get_required_work_hours");
            setRequiredWorkHours(workHours as number);

            // 获取JIRA数据
            const issues = await invoke("get_my_unfinished_issues");
            setUnfinishedIssues(issues as JiraIssue[]);

            const worklogs = await invoke("get_my_today_worklogs");
            setTodayWorklogs(worklogs as WorklogEntry[]);
            
            // 确保获取正确的日期字符串
            const currentDateStr = selectedDateString || (() => {
                const date = selectedDate;
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            })();
            
            console.log("query data is :" + currentDateStr);
            const commits = await invoke("get_commits_by_date", { dateStr: currentDateStr });
            setTodayCommits(commits as GitCommit[]);
        } catch (error) {
            console.error("加载今日数据失败:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveJiraConfig = async () => {
        try {
            await invoke("save_jira_config", {config: jiraConfig});
            alert("JIRA配置保存成功！");
            loadTodayData();
        } catch (error) {
            console.error("保存JIRA配置失败:", error);
            alert("保存JIRA配置失败：" + error);
        }
    };
    
    const testJiraConnection = async () => {
        try {
            // 临时保存当前配置
            await invoke("save_jira_config", {config: jiraConfig});
            
            // 尝试获取当前用户未完成的问题列表来测试连接
            const issues = await invoke("get_my_unfinished_issues");
            
            if (Array.isArray(issues)) {
                alert(`JIRA连接测试成功！当前用户有 ${issues.length} 个未完成的问题。`);
            } else {
                alert("JIRA连接测试成功！");
            }
        } catch (error) {
            console.error("JIRA连接测试失败:", error);
            let errorMessage = "JIRA连接测试失败";
            if (error instanceof Error) {
                errorMessage += ": " + error.message;
            } else {
                errorMessage += ": " + String(error);
            }
            alert(errorMessage);
        }
    };

    const handleSaveGitConfig = async () => {
        try {
            await invoke("save_git_config", {config: gitConfig});
            alert("Git配置保存成功！");
            loadTodayData();
        } catch (error) {
            console.error("保存Git配置失败:", error);
            alert("保存Git配置失败：" + error);
        }
    };

    const handleLogWork = async (issueKey: string, timeSpent: number, comment: string) => {
        try {
            const result = await invoke("log_work", {
                issueKey,
                timeSpentHours: timeSpent,
                comment,
            });

            if (result) {
                alert("工作时间记录成功！");
                loadTodayData();
                setNewWorklog({issueKey: "", timeSpent: 1.0, comment: ""});
            } else {
                alert("工作时间记录失败！");
            }
        } catch (error) {
            console.error("记录工作时间失败:", error);
            // 更好地处理错误信息
            let errorMessage = "记录工作时间失败";
            if (error instanceof Error) {
                errorMessage += ": " + error.message;
            } else {
                errorMessage += ": " + String(error);
            }
            alert(errorMessage);
        }
    };

// 修改 addGitRepository 函数
    const addGitRepository = () => {
        setGitConfig({
            ...gitConfig,
            repositories: [...gitConfig.repositories, {url: "", token: "", branch: "main", alias: ""}],  // ✅ 添加 alias
        });
    };

    const updateGitRepository = (index: number, field: string, value: string) => {
        const newRepositories = [...gitConfig.repositories];
        (newRepositories[index] as any)[field] = value;
        setGitConfig({...gitConfig, repositories: newRepositories});
    };

    const removeGitRepository = (index: number) => {
        const newRepositories = gitConfig.repositories.filter((_, i) => i !== index);
        setGitConfig({...gitConfig, repositories: newRepositories});
    };

    const handleSaveAiConfig = async () => {
        try {
            await invoke("save_ai_config", {config: aiConfig});
            alert("AI配置保存成功！");
        } catch (error) {
            console.error("保存AI配置失败:", error);
            alert("保存AI配置失败：" + error);
        }
    };

    const totalWorkedHours = todayWorklogs.reduce((sum, worklog) => sum + worklog.time_spent_hours, 0);
    const remainingHours = Math.max(0, requiredWorkHours - totalWorkedHours);

    const processWorklogWithAI = async () => {
        try {
            setLoading(true);
            const suggestion = await invoke("process_worklog_with_ai");
            setAiSuggestion(suggestion as string);
            
            // 解析AI建议，提取其中的工时记录
            parseAISuggestions(suggestion as string);
        } catch (error) {
            console.error("AI处理失败:", error);
            alert("AI处理失败：" + error);
        } finally {
            setLoading(false);
        }
    };

    // 解析AI建议，提取工时记录信息
    const parseAISuggestions = (suggestion: string) => {
        const suggestions: AISuggestion[] = [];
        
        // 使用正则表达式匹配AI建议中的工时记录
        const regex = /JIRA问题:\s*([A-Z0-9]+-?\d+)[\s\S]*?记录工时:\s*([\d.]+)小时[\s\S]*?工作说明:\s*([^\n\r]+)/g;
        let match;
        
        while ((match = regex.exec(suggestion)) !== null) {
            suggestions.push({
                issueKey: match[1],
                timeSpent: parseFloat(match[2]),
                comment: match[3].trim()
            });
        }
        
        setAiSuggestions(suggestions);
    };

    const applyAISuggestions = async () => {
        if (aiSuggestions.length === 0) {
            alert("没有可应用的AI建议");
            return;
        }
        
        // 逐个记录工作日志
        for (const suggestion of aiSuggestions) {
            try {
                await handleLogWork(suggestion.issueKey, suggestion.timeSpent, suggestion.comment);
                // 添加短暂延迟，避免请求过于频繁
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`记录工时失败 ${suggestion.issueKey}:`, error);
                alert(`记录工时失败 ${suggestion.issueKey}: ${error}`);
                return;
            }
        }
        
        alert("AI建议已应用完成！");
        setAiSuggestions([]);
        setAiSuggestion("");
    };

    const handleNewWorklogChange = (field: string, value: any) => {
        setNewWorklog({
            ...newWorklog,
            [field]: value
        });
    };

    const handleNewWorklogSubmit = () => {
        if (!newWorklog.issueKey || newWorklog.timeSpent <= 0 || !newWorklog.comment) {
            alert("请填写完整的工作日志信息");
            return;
        }

        handleLogWork(newWorklog.issueKey, newWorklog.timeSpent, newWorklog.comment);
    };

    return (
        <div className="jira-container">
            <div className="jira-header" ref={headerRef} data-tauri-drag-region>
                <div>
                    <h1>JIRA工作流助手</h1>
                    <div className="date-buttons">
                        {generateDateButtons().map((dateInfo, index) => {
                            // 判断是否为选中状态
                            const isSelected = dateInfo.date.toDateString() === selectedDate.toDateString();
                            
                            return (
                                <button
                                    key={index}
                                    className={`date-btn ${dateInfo.isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                                    onClick={() => setSelectedDate(dateInfo.date)}
                                >
                                    {dateInfo.formatted}
                                </button>
                            );
                        })}
                    </div>
                    <div className="tabs">
                        <button
                            className={activeTab === "dashboard" ? "active" : ""}
                            onClick={() => setActiveTab("dashboard")}
                        >
                            仪表板
                        </button>
                        <button
                            className={activeTab === "config" ? "active" : ""}
                            onClick={() => setActiveTab("config")}
                        >
                            配置
                        </button>
                        <button
                            className={activeTab === "issues" ? "active" : ""}
                            onClick={() => setActiveTab("issues")}
                        >
                            问题列表
                        </button>
                        <button
                            className={activeTab === "worklogs" ? "active" : ""}
                            onClick={() => setActiveTab("worklogs")}
                        >
                            工作日志
                        </button>
                    </div>
                </div>
                <button className="close-btn" onClick={closeWindow}>×</button>
            </div>

            <div className="jira-content">
                {loading && <div className="loading">加载中...</div>}

                {activeTab === "dashboard" && !loading && (
                    <div className="dashboard">
                        <div className="summary-cards">
                            <div className="card">
                                <h3>选中日期信息</h3>
                                <p>选中日期: {selectedDateString}</p>
                                <p>应工作: {requiredWorkHours} 小时</p>
                                <p>已工作: {totalWorkedHours.toFixed(1)} 小时</p>
                                <p>剩余: {remainingHours.toFixed(1)} 小时</p>
                            </div>

                            <div className="card">
                                <h3>未完成问题</h3>
                                <p>{unfinishedIssues.length} 个</p>
                            </div>

                            <div className="card">
                                <h3>今日提交</h3>
                                <p>{todayCommits.length} 次</p>
                            </div>
                        </div>

                        <div className="section">
                            <h3>今日工作日志</h3>
                            {todayWorklogs.length > 0 ? (
                                <table className="worklogs-table">
                                    <thead>
                                    <tr>
                                        <th>问题编号</th>
                                        <th>工作时长</th>
                                        <th>说明</th>
                                        <th>开始时间</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {todayWorklogs.map((worklog, index) => (
                                        <tr key={index}>
                                            <td>{worklog.issue_key}</td>
                                            <td>{worklog.time_spent_hours} 小时</td>
                                            <td>{worklog.comment}</td>
                                            <td>{new Date(worklog.started).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            ) : (
                                <p>今日暂无工作日志</p>
                            )}
                        </div>

                        <div className="section">
                            <h3>今日Git提交</h3>
                            {todayCommits.length > 0 ? (
                                <table className="commits-table">
                                    <thead>
                                    <tr>
                                        <th>提交ID</th>
                                        <th>信息</th>
                                        <th>时间</th>
                                        <th>仓库</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {todayCommits.map((commit, index) => (
                                        <tr key={index}>
                                            <td>{commit.commit_id.substring(0, 8)}</td>
                                            <td>{commit.message}</td>
                                            <td>{new Date(commit.commit_time).toLocaleString()}</td>
                                            <td>{commit.repository}</td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            ) : (
                                <p>今日暂无Git提交</p>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === "config" && (
                    <div className="config-section">
                        <div className="config-form">
                            <h3>JIRA配置</h3>
                            <div className="form-group">
                                <label>JIRA URL:</label>
                                <input
                                    type="text"
                                    value={jiraConfig.jiraUrl}
                                    onChange={(e) => setJiraConfig({...jiraConfig, jiraUrl: e.target.value})}
                                    placeholder="例如: https://your-domain.atlassian.net"
                                />
                            </div>
                            <div className="form-group">
                                <label>用户名:</label>
                                <input
                                    type="text"
                                    value={jiraConfig.username}
                                    onChange={(e) => setJiraConfig({...jiraConfig, username: e.target.value})}
                                />
                            </div>
                            <div className="form-group">
                                <label>API令牌:</label>
                                <input
                                    type="password"
                                    value={jiraConfig.apiToken}
                                    onChange={(e) => setJiraConfig({...jiraConfig, apiToken: e.target.value})}
                                />
                            </div>
                            <button onClick={handleSaveJiraConfig} className="save-btn">保存JIRA配置</button>
                            <button onClick={testJiraConnection} className="test-btn">测试JIRA连接</button>
                        </div>

                        <div className="config-form">
                            <h3>Git配置</h3>
                            <div className="form-group">
                                <label>Git用户名:</label>
                                <input
                                    type="text"
                                    value={gitConfig.username}
                                    onChange={(e) => setGitConfig({...gitConfig, username: e.target.value})}
                                />
                            </div>

                            <h4>仓库配置:</h4>
                            {gitConfig.repositories.map((repo, index) => (
                                <div key={index} className="repo-config">
                                    <div className="form-group">
                                        <label>仓库URL:</label>
                                        <input
                                            type="text"
                                            value={repo.url}
                                            onChange={(e) => updateGitRepository(index, "url", e.target.value)}
                                            placeholder="例如: https://github.com/user/repo.git"
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>访问令牌:</label>
                                        <input
                                            type="password"
                                            value={repo.token}
                                            onChange={(e) => updateGitRepository(index, "token", e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>分支:</label>
                                        <input
                                            type="text"
                                            value={repo.branch}
                                            onChange={(e) => updateGitRepository(index, "branch", e.target.value)}
                                            placeholder="例如: main"
                                        />
                                    </div>
                                    {/* ✅ 新增：别名输入框 */}
                                    <div className="form-group">
                                        <label>仓库别名:</label>
                                        <input
                                            type="text"
                                            value={repo.alias}
                                            onChange={(e) => updateGitRepository(index, "alias", e.target.value)}
                                            placeholder="例如: 主项目"
                                        />
                                    </div>
                                    {gitConfig.repositories.length > 1 && (
                                        <button onClick={() => removeGitRepository(index)} className="remove-btn">
                                            删除
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button onClick={addGitRepository} className="add-btn">添加仓库</button>
                            <button onClick={handleSaveGitConfig} className="save-btn">保存Git配置</button>
                        </div>
                        
                        <div className="config-form">
                            <h3>AI配置</h3>
                            <div className="form-group">
                                <label>API密钥:</label>
                                <input
                                    type="password"
                                    value={aiConfig.apiKey}
                                    onChange={(e) => setAiConfig({...aiConfig, apiKey: e.target.value})}
                                    placeholder="输入AI服务API密钥"
                                />
                            </div>
                            <div className="form-group">
                                <label>模型:</label>
                                <input
                                    type="text"
                                    value={aiConfig.model}
                                    onChange={(e) => setAiConfig({...aiConfig, model: e.target.value})}
                                    placeholder="例如: gpt-4"
                                />
                            </div>
                            <div className="form-group">
                                <label>基础URL:</label>
                                <input
                                    type="text"
                                    value={aiConfig.baseUrl}
                                    onChange={(e) => setAiConfig({...aiConfig, baseUrl: e.target.value})}
                                    placeholder="例如: https://api.openai.com/v1"
                                />
                            </div>
                            <button onClick={handleSaveAiConfig} className="save-btn">保存AI配置</button>
                        </div>
                    </div>
                )}

                {activeTab === "issues" && (
                    <div className="issues-section">
                        <h3>未完成的JIRA问题</h3>
                        {unfinishedIssues.length > 0 ? (
                            <table className="issues-table">
                                <thead>
                                <tr>
                                    <th>问题编号</th>
                                    <th>摘要</th>
                                    <th>状态</th>
                                    <th>创建时间</th>
                                    <th>更新时间</th>
                                </tr>
                                </thead>
                                <tbody>
                                {unfinishedIssues.map((issue, index) => (
                                    <tr key={index}>
                                        <td>{issue.key}</td>
                                        <td>{issue.summary}</td>
                                        <td>{issue.status}</td>
                                        <td>{new Date(issue.created).toLocaleString()}</td>
                                        <td>{new Date(issue.updated).toLocaleString()}</td>
                                    </tr>
                                ))}
                                </tbody>
                            </table>
                        ) : (
                            <p>暂无未完成的问题</p>
                        )}
                    </div>
                )}

                {activeTab === "worklogs" && (
                    <div className="worklogs-section">
                        <h3>记录工作日志</h3>
                        <div className="log-work-form">
                            <div className="form-group">
                                <label>问题编号:</label>
                                <select
                                    value={newWorklog.issueKey}
                                    onChange={(e) => handleNewWorklogChange('issueKey', e.target.value)}
                                >
                                    <option value="">选择问题...</option>
                                    {unfinishedIssues.map((issue, index) => (
                                        <option key={index} value={issue.key}>{issue.key} - {issue.summary}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>工作时长(小时):</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0.5"
                                    max="24"
                                    value={newWorklog.timeSpent}
                                    onChange={(e) => handleNewWorklogChange('timeSpent', parseFloat(e.target.value) || 0)}
                                />
                            </div>
                            <div className="form-group">
                                <label>工作说明:</label>
                                <textarea
                                    value={newWorklog.comment}
                                    onChange={(e) => handleNewWorklogChange('comment', e.target.value)}
                                    placeholder="描述今天的工作内容..."
                                ></textarea>
                            </div>
                            <button onClick={handleNewWorklogSubmit} className="log-btn">记录工作时间</button>
                        </div>

                        <div className="section">
                            <h3>今日工作日志</h3>
                            {todayWorklogs.length > 0 ? (
                                <table className="worklogs-table">
                                    <thead>
                                    <tr>
                                        <th>问题编号</th>
                                        <th>工作时长</th>
                                        <th>说明</th>
                                        <th>开始时间</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {todayWorklogs.map((worklog, index) => (
                                        <tr key={index}>
                                            <td>{worklog.issue_key}</td>
                                            <td>{worklog.time_spent_hours} 小时</td>
                                            <td>{worklog.comment}</td>
                                            <td>{new Date(worklog.started).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            ) : (
                                <p>今日暂无工作日志</p>
                            )}
                        </div>
                    </div>
                )}

                <div className="ai-assistant-section">
                    <h3>AI助手</h3>
                    <button onClick={processWorklogWithAI} className="ai-btn">智能生成工作日志</button>
                    {aiSuggestion && (
                        <div className="ai-suggestion">
                            <h4>AI建议:</h4>
                            <pre>{aiSuggestion}</pre>
                            {aiSuggestions.length > 0 && (
                                <div className="ai-suggestions-info">
                                    <p>检测到 {aiSuggestions.length} 条工作日志建议:</p>
                                    <ul>
                                        {aiSuggestions.map((suggestion, index) => (
                                            <li key={index}>
                                                <strong>{suggestion.issueKey}</strong>: {suggestion.timeSpent}小时 - {suggestion.comment}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <button onClick={applyAISuggestions} className="apply-btn">应用建议</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}