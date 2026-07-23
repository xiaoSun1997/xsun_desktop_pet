import {useState, useEffect, useRef, useCallback} from "react";
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
    worklog_id: string;
}

// 多日工单汇总
interface DateWorklogSummary {
    date: string;
    worklogs: WorklogEntry[];
    total_hours: number;
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
    alias: string;
}

interface AIConfig {
    apiKey: string;
    model: string;
    baseUrl: string;
}

interface AISuggestion {
    issueKey: string;
    timeSpent: number;
    comment: string;
}

// 工具函数：格式化日期为 YYYY-MM-DD
const formatDateStr = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export default function JiraComponent() {
    // === 配置状态 ===
    const [jiraConfig, setJiraConfig] = useState<JiraConfig>({
        jiraUrl: "", username: "", apiToken: "",
    });
    const [gitConfig, setGitConfig] = useState<GitConfig>({
        repositories: [{url: "", token: "", alias: ""}], username: "",
    });
    const [aiConfig, setAiConfig] = useState<AIConfig>({
        apiKey: "", model: "deepseek-chat", baseUrl: "https://api.deepseek.com",
    });

    // === 数据状态 ===
    const [unfinishedIssues, setUnfinishedIssues] = useState<JiraIssue[]>([]);
    const [todayWorklogs, setTodayWorklogs] = useState<WorklogEntry[]>([]);
    const [todayCommits, setTodayCommits] = useState<GitCommit[]>([]);
    const [requiredWorkHours, setRequiredWorkHours] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(false);

    // === AI 相关 ===
    const [aiSuggestion, setAiSuggestion] = useState<string>("");
    const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
    const [selectedIssueKeys, setSelectedIssueKeys] = useState<Set<string>>(new Set());
    const [selectedCommitIds, setSelectedCommitIds] = useState<Set<string>>(new Set());
    const [aiTotalHours, setAiTotalHours] = useState<number>(8);
    const [newWorklog, setNewWorklog] = useState({
        issueKey: "", timeSpent: 1.0, comment: "",
    });
    const [aiGenerating, setAiGenerating] = useState<boolean>(false);
    const [applyingSuggestions, setApplyingSuggestions] = useState<boolean>(false);
    const [editingWorklogId, setEditingWorklogId] = useState<string | null>(null);
    const [editingWorklog, setEditingWorklog] = useState<{timeSpent: number; comment: string}>({timeSpent: 0, comment: ""});
    const [deletingWorklogId, setDeletingWorklogId] = useState<string | null>(null);
    const [savingEditId, setSavingEditId] = useState<string | null>(null);

    // === UI 状态 ===
    const [activeTab, setActiveTab] = useState<string>("dashboard");
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
    });

    // === 历史总结状态 ===
    const [selectedHistoryDates, setSelectedHistoryDates] = useState<Set<string>>(new Set());
    const [dateRangeSummaries, setDateRangeSummaries] = useState<DateWorklogSummary[]>([]);
    const [historyLoading, setHistoryLoading] = useState<boolean>(false);

    // === 周报/月报状态 ===
    const [reportType, setReportType] = useState<'weekly' | 'monthly' | null>(null);
    const [generatedReport, setGeneratedReport] = useState<string>('');
    const [reportGenerating, setReportGenerating] = useState<boolean>(false);
    const [reportStartDate, setReportStartDate] = useState<string>('');
    const [reportEndDate, setReportEndDate] = useState<string>('');
    const [reportError, setReportError] = useState<string>('');

    const headerRef = useRef<HTMLDivElement>(null);

    // 生成日期列表（前后各15天，共31天）
    const generateDateList = useCallback((): {date: Date; isToday: boolean; formatted: string; dateStr: string}[] => {
        const dates = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = -15; i <= 15; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const isToday = date.toDateString() === today.toDateString();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            const weekday = weekdays[date.getDay()];
            dates.push({
                date, isToday,
                formatted: `${month}-${day} ${weekday}`,
                dateStr: formatDateStr(date),
            });
        }
        return dates;
    }, []);

    // 关闭窗口
    const closeWindow = async () => {
        try {
            await getCurrentWindow().close();
        } catch (error) {
            console.error('关闭窗口失败:', error);
        }
    };

    const minimizeWindow = async () => {
        try {
            await getCurrentWindow().minimize();
        } catch (error) {
            console.error('最小化失败:', error);
        }
    };

    const [isMaximized, setIsMaximized] = useState(false);
    const toggleMaximize = async () => {
        try {
            await getCurrentWindow().toggleMaximize();
            setIsMaximized(!isMaximized);
        } catch (error) {
            console.error('最大化切换失败:', error);
        }
    };

    // 监听窗口 resize 更新最大化状态
    useEffect(() => {
        let unlisten: (() => void) | undefined;
        getCurrentWindow().onResized(() => {
            getCurrentWindow().isMaximized().then(setIsMaximized);
        }).then(fn => { unlisten = fn; });
        return () => { if (unlisten) unlisten(); };
    }, []);

    // 拖拽支持
    useEffect(() => {
        const header = headerRef.current;
        if (!header) return;
        const mouseDownHandler = async (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('.jira-close-btn') ||
                (e.target as HTMLElement).closest('button')) return;
            try {
                await getCurrentWindow().startDragging();
            } catch (error) {
                console.error('拖动失败:', error);
            }
        };
        header.addEventListener('mousedown', mouseDownHandler);
        return () => header.removeEventListener('mousedown', mouseDownHandler);
    }, []);

    // 初始化加载
    useEffect(() => {
        loadConfigs();
    }, []);

    // 🔧 Bug修复：监听 selectedDate 变化，重新加载数据
    useEffect(() => {
        loadTodayData();
    }, [selectedDate]);

    const loadConfigs = async () => {
        try {
            const jiraConf = await invoke("load_jira_config");
            if (jiraConf) setJiraConfig(jiraConf as JiraConfig);
            const gitConf = await invoke("load_git_config");
            if (gitConf) setGitConfig(gitConf as GitConfig);
            try {
                const aiConf = await invoke("load_local_deepseek_config");
                if (aiConf) setAiConfig(aiConf as AIConfig);
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
            const dateStr = formatDateStr(selectedDate);
            const workHours = await invoke("get_required_work_hours");
            setRequiredWorkHours(workHours as number);

            const issues = await invoke("get_my_unfinished_issues");
            setUnfinishedIssues(issues as JiraIssue[]);

            // 🔧 Bug修复：传入日期参数查询指定日期的工单
            const worklogs = await invoke("get_my_today_worklogs", { dateStr });
            setTodayWorklogs(worklogs as WorklogEntry[]);

            const commits = await invoke("get_commits_by_date", { dateStr });
            setTodayCommits(commits as GitCommit[]);
        } catch (error) {
            console.error("加载今日数据失败:", error);
        } finally {
            setLoading(false);
        }
    };

    // === 配置保存 ===
    const handleSaveJiraConfig = async () => {
        try {
            await invoke("save_jira_config", {config: jiraConfig});
            alert("JIRA配置保存成功！");
            loadTodayData();
        } catch (error) {
            alert("保存JIRA配置失败：" + error);
        }
    };

    const testJiraConnection = async () => {
        try {
            await invoke("save_jira_config", {config: jiraConfig});
            const issues = await invoke("get_my_unfinished_issues");
            if (Array.isArray(issues)) {
                alert(`JIRA连接测试成功！当前用户有 ${issues.length} 个未完成的问题。`);
            } else {
                alert("JIRA连接测试成功！");
            }
        } catch (error) {
            alert("JIRA连接测试失败：" + error);
        }
    };

    const handleSaveGitConfig = async () => {
        try {
            await invoke("save_git_config", {config: gitConfig});
            alert("Git配置保存成功！");
            loadTodayData();
        } catch (error) {
            alert("保存Git配置失败：" + error);
        }
    };

    const testGitConnection = async () => {
        try {
            await invoke("save_git_config", {config: gitConfig});
            const result = await invoke<string>("test_git_connection");
            alert("Git连接测试结果：\n" + result);
        } catch (error) {
            alert("Git连接测试失败：" + error);
        }
    };

    const addGitRepository = () => {
        setGitConfig({
            ...gitConfig,
            repositories: [...gitConfig.repositories, {url: "", token: "", alias: ""}],
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
            await invoke("save_deepseek_config", { config: aiConfig });
            alert("AI配置保存成功！");
        } catch (error) {
            alert("保存AI配置失败：" + error);
        }
    };

    // === 工作日志记录 ===
    const handleLogWork = async (issueKey: string, timeSpent: number, comment: string, dateStr?: string) => {
        try {
            const effectiveDateStr = dateStr || formatDateStr(selectedDate);
            const result = await invoke("log_work", { issueKey, timeSpentHours: timeSpent, comment, dateStr: effectiveDateStr });
            if (result) {
                alert("工作时间记录成功！");
                loadTodayData();
                setNewWorklog({issueKey: "", timeSpent: 1.0, comment: ""});
            } else {
                alert("工作时间记录失败！");
            }
        } catch (error) {
            alert("记录工作时间失败：" + error);
        }
    };

    const handleNewWorklogChange = (field: string, value: any) => {
        setNewWorklog({ ...newWorklog, [field]: value });
    };

    const handleNewWorklogSubmit = () => {
        if (!newWorklog.issueKey || newWorklog.timeSpent <= 0 || !newWorklog.comment) {
            alert("请填写完整的工作日志信息");
            return;
        }
        handleLogWork(newWorklog.issueKey, newWorklog.timeSpent, newWorklog.comment);
    };

    // === AI 生成相关 ===
    const toggleIssueSelection = (key: string) => {
        setSelectedIssueKeys(prev => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
    };

    const toggleCommitSelection = (id: string) => {
        setSelectedCommitIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const toggleAllIssues = () => {
        if (selectedIssueKeys.size === unfinishedIssues.length) {
            setSelectedIssueKeys(new Set());
        } else {
            setSelectedIssueKeys(new Set(unfinishedIssues.map(i => i.key)));
        }
    };

    const toggleAllCommits = () => {
        if (selectedCommitIds.size === todayCommits.length) {
            setSelectedCommitIds(new Set());
        } else {
            setSelectedCommitIds(new Set(todayCommits.map(c => c.commit_id)));
        }
    };

    const generateWorklogWithSelection = async () => {
        if (selectedIssueKeys.size === 0) {
            alert("请至少选择一个 JIRA 问题");
            return;
        }
        if (aiTotalHours <= 0 || aiTotalHours > 24) {
            alert("总时长必须在 0-24 小时之间");
            return;
        }
        setAiGenerating(true);
        setAiSuggestion("");
        setAiSuggestions([]);
        try {
            const dateStr = formatDateStr(selectedDate);
            const suggestion = await invoke<string>("generate_worklog_suggestions", {
                selectedIssueKeys: Array.from(selectedIssueKeys),
                selectedCommitIds: Array.from(selectedCommitIds),
                totalHours: aiTotalHours,
                dateStr,
            });
            setAiSuggestion(suggestion);
            parseAISuggestions(suggestion);
        } catch (error) {
            alert("AI生成失败: " + error);
        } finally {
            setAiGenerating(false);
        }
    };

    const parseAISuggestions = (suggestion: string) => {
        const suggestions: AISuggestion[] = [];
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
        const issuesList = aiSuggestions.map(s => `${s.issueKey} (${s.timeSpent}h)`).join("\n");
        if (!confirm(`确认将以下工作日志记录到 JIRA？\n\n${issuesList}\n\n请确认日期、工时和说明无误。`)) return;
        setApplyingSuggestions(true);
        const dateStr = formatDateStr(selectedDate);
        for (const suggestion of aiSuggestions) {
            try {
                await handleLogWork(suggestion.issueKey, suggestion.timeSpent, suggestion.comment, dateStr);
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                alert(`记录工时失败 ${suggestion.issueKey}: ${error}`);
                setApplyingSuggestions(false);
                return;
            }
        }
        alert("AI建议已应用完成！");
        setApplyingSuggestions(false);
        setAiSuggestions([]);
        setAiSuggestion("");
    };

    // === 删除/编辑工作日志 ===
    const handleDeleteWorklog = async (issueKey: string, worklogId: string) => {
        // 防止重复点击
        if (deletingWorklogId) return;
        if (!worklogId) {
            alert("缺少工作日志ID，无法删除");
            return;
        }
        if (!confirm(`确认删除 ${issueKey} 的这条工作日志吗？`)) return;
        setDeletingWorklogId(worklogId);
        try {
            await invoke("delete_worklog", { issueKey, worklogId });
            alert("工作日志已删除！");
            loadTodayData();
        } catch (error) {
            alert("删除工作日志失败：" + error);
        } finally {
            setDeletingWorklogId(null);
        }
    };

    const handleStartEditWorklog = (wl: WorklogEntry) => {
        setEditingWorklogId(wl.worklog_id);
        setEditingWorklog({ timeSpent: wl.time_spent_hours, comment: wl.comment });
    };

    const handleSaveEditWorklog = async (issueKey: string, worklogId: string) => {
        if (savingEditId) return;
        if (editingWorklog.timeSpent <= 0 || editingWorklog.timeSpent > 24) {
            alert("工时必须在 0.5-24 小时之间");
            return;
        }
        if (!editingWorklog.comment.trim()) {
            alert("工作说明不能为空");
            return;
        }
        setSavingEditId(worklogId);
        try {
            await invoke("update_worklog", {
                issueKey,
                worklogId,
                timeSpentHours: editingWorklog.timeSpent,
                comment: editingWorklog.comment,
            });
            alert("工作日志已更新！");
            setEditingWorklogId(null);
            loadTodayData();
        } catch (error) {
            alert("更新工作日志失败：" + error);
        } finally {
            setSavingEditId(null);
        }
    };

    const handleCancelEdit = () => {
        setEditingWorklogId(null);
    };

    // === 历史总结：多日工单汇总 ===
    const loadDateRangeSummaries = async () => {
        if (selectedHistoryDates.size === 0) {
            alert("请至少选择一个日期");
            return;
        }
        const dates = Array.from(selectedHistoryDates).sort();
        setHistoryLoading(true);
        try {
            const summaries = await invoke("get_worklogs_by_date_range", {
                startDate: dates[0],
                endDate: dates[dates.length - 1],
            });
            setDateRangeSummaries(summaries as DateWorklogSummary[]);
        } catch (error) {
            alert("加载汇总失败：" + error);
        } finally {
            setHistoryLoading(false);
        }
    };

    const toggleHistoryDate = (dateStr: string) => {
        setSelectedHistoryDates(prev => {
            const next = new Set(prev);
            next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
            return next;
        });
    };

    const toggleAllHistoryDates = () => {
        const allDates = generateDateList().map(d => d.dateStr);
        if (selectedHistoryDates.size === allDates.length) {
            setSelectedHistoryDates(new Set());
        } else {
            setSelectedHistoryDates(new Set(allDates));
        }
    };

    // === 日期范围快捷选择 ===
    const getDateRange = (type: 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth'): { start: string; end: string } => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let start: Date, end: Date;

        switch (type) {
            case 'thisWeek': {
                const day = today.getDay();
                const diff = day === 0 ? 6 : day - 1; // 周一为一周开始
                start = new Date(today);
                start.setDate(today.getDate() - diff);
                end = new Date(start);
                end.setDate(start.getDate() + 6);
                break;
            }
            case 'lastWeek': {
                const day = today.getDay();
                const diff = day === 0 ? 6 : day - 1;
                end = new Date(today);
                end.setDate(today.getDate() - diff - 1);
                start = new Date(end);
                start.setDate(end.getDate() - 6);
                break;
            }
            case 'thisMonth': {
                start = new Date(today.getFullYear(), today.getMonth(), 1);
                end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                break;
            }
            case 'lastMonth': {
                start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                end = new Date(today.getFullYear(), today.getMonth(), 0);
                break;
            }
        }

        return { start: formatDateStr(start), end: formatDateStr(end) };
    };

    const selectDateRange = (type: 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth') => {
        const range = getDateRange(type);
        setReportStartDate(range.start);
        setReportEndDate(range.end);
        // 自动选中该范围内的所有日期
        const dates: string[] = [];
        const current = new Date(range.start);
        const end = new Date(range.end);
        while (current <= end) {
            dates.push(formatDateStr(current));
            current.setDate(current.getDate() + 1);
        }
        setSelectedHistoryDates(new Set(dates));
    };

    // === 周报/月报生成 ===
    const generateReport = async (type: 'weekly' | 'monthly') => {
        const range = reportStartDate && reportEndDate
            ? { start: reportStartDate, end: reportEndDate }
            : getDateRange(type === 'weekly' ? 'thisWeek' : 'thisMonth');

        setReportType(type);
        setReportGenerating(true);
        setGeneratedReport('');
        setReportError('');
        try {
            // 添加 30 秒超时控制，避免月报大量请求时永久卡住
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('报告生成超时（30秒），数据量较大请稍后重试')), 30000)
            );
            const summaries = await Promise.race([
                invoke<DateWorklogSummary[]>('get_worklogs_by_date_range', {
                    startDate: range.start,
                    endDate: range.end,
                }),
                timeoutPromise,
            ]);

            if (!summaries || summaries.length === 0) {
                setGeneratedReport(`# ${type === 'weekly' ? '周报' : '月报'}\n\n> 该时间段内没有工作记录。`);
                return;
            }

            // 汇总统计
            const totalHours = summaries.reduce((s, d) => s + d.total_hours, 0);
            const issueMap = new Map<string, { hours: number; comments: string[] }>();
            for (const day of summaries) {
                for (const wl of day.worklogs) {
                    const existing = issueMap.get(wl.issue_key) || { hours: 0, comments: [] };
                    existing.hours += wl.time_spent_hours;
                    if (wl.comment && !existing.comments.includes(wl.comment)) {
                        existing.comments.push(wl.comment);
                    }
                    issueMap.set(wl.issue_key, existing);
                }
            }

            // 生成Markdown报告
            let md = '';
            if (type === 'weekly') {
                md += `# 工作周报 (${range.start} ~ ${range.end})\n\n`;
                md += `## 总览\n\n`;
                md += `| 指标 | 数值 |\n|---|---|\n`;
                md += `| 工作天数 | ${summaries.length} 天 |\n`;
                md += `| 总工时 | ${totalHours.toFixed(1)} 小时 |\n`;
                md += `| 涉及问题 | ${issueMap.size} 个 |\n`;
                md += `| 日均工时 | ${(totalHours / summaries.length).toFixed(1)} 小时 |\n\n`;

                md += `## 按问题汇总\n\n`;
                for (const [key, data] of issueMap) {
                    md += `### ${key}\n`;
                    md += `- 工时: ${data.hours.toFixed(1)}h\n`;
                    if (data.comments.length > 0) {
                        md += `- 工作内容:\n`;
                        for (const c of data.comments) {
                            md += `  - ${c}\n`;
                        }
                    }
                    md += '\n';
                }

                md += `## 每日明细\n\n`;
                for (const day of summaries) {
                    md += `### ${day.date} (${day.total_hours.toFixed(1)}h)\n`;
                    for (const wl of day.worklogs) {
                        md += `- **${wl.issue_key}** ${wl.time_spent_hours}h — ${wl.comment}\n`;
                    }
                    md += '\n';
                }
            } else {
                // 月报
                md += `# 工作月报 (${range.start} ~ ${range.end})\n\n`;
                md += `## 总览\n\n`;
                md += `| 指标 | 数值 |\n|---|---|\n`;
                md += `| 工作天数 | ${summaries.length} 天 |\n`;
                md += `| 总工时 | ${totalHours.toFixed(1)} 小时 |\n`;
                md += `| 涉及问题 | ${issueMap.size} 个 |\n`;
                md += `| 日均工时 | ${(totalHours / summaries.length).toFixed(1)} 小时 |\n\n`;

                // 按周分组
                const weeks = new Map<string, DateWorklogSummary[]>();
                for (const day of summaries) {
                    const d = new Date(day.date);
                    const dayOfWeek = d.getDay();
                    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
                    const monday = new Date(d);
                    monday.setDate(d.getDate() - mondayOffset);
                    const weekKey = formatDateStr(monday);
                    const arr = weeks.get(weekKey) || [];
                    arr.push(day);
                    weeks.set(weekKey, arr);
                }

                md += `## 按周汇总\n\n`;
                let weekNum = 1;
                for (const [weekStart, days] of weeks) {
                    const weekHours = days.reduce((s, d) => s + d.total_hours, 0);
                    const weekEnd = new Date(weekStart);
                    weekEnd.setDate(weekEnd.getDate() + 6);
                    md += `### 第${weekNum}周 (${weekStart} ~ ${formatDateStr(weekEnd)}) — ${weekHours.toFixed(1)}h\n`;
                    for (const day of days) {
                        md += `- ${day.date}: ${day.total_hours.toFixed(1)}h\n`;
                        for (const wl of day.worklogs) {
                            md += `  - **${wl.issue_key}** ${wl.time_spent_hours}h — ${wl.comment}\n`;
                        }
                    }
                    md += '\n';
                    weekNum++;
                }

                md += `## 按问题汇总\n\n`;
                for (const [key, data] of issueMap) {
                    md += `### ${key}\n`;
                    md += `- 总工时: ${data.hours.toFixed(1)}h\n`;
                    if (data.comments.length > 0) {
                        md += `- 工作内容:\n`;
                        for (const c of data.comments) {
                            md += `  - ${c}\n`;
                        }
                    }
                    md += '\n';
                }
            }

            setGeneratedReport(md);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            setReportError(errorMsg);
        } finally {
            setReportGenerating(false);
        }
    };

    const copyReportToClipboard = async () => {
        if (!generatedReport) return;
        try {
            await navigator.clipboard.writeText(generatedReport);
            alert('报告已复制到剪贴板！');
        } catch {
            // fallback
            const textarea = document.createElement('textarea');
            textarea.value = generatedReport;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert('报告已复制到剪贴板！');
        }
    };

    const exportReportAsFile = () => {
        if (!generatedReport) return;
        const blob = new Blob([generatedReport], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${reportType === 'weekly' ? '周报' : '月报'}_${reportStartDate}_${reportEndDate}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // === 计算统计 ===
    const totalWorkedHours = todayWorklogs.reduce((sum, w) => sum + w.time_spent_hours, 0);

    // ========== 渲染 ==========
    return (
        <div className="jira-container">
            {/* ===== 左侧边栏：日期选择器 ===== */}
            <div className="jira-sidebar">
                <div className="jira-sidebar-header" ref={headerRef} data-tauri-drag-region>
                    <span className="jira-sidebar-title">📋 JIRA 助手</span>
                </div>

                <div className="jira-sidebar-list">
                    {generateDateList().map((dateInfo, index) => {
                        const isSelected = dateInfo.date.toDateString() === selectedDate.toDateString();
                        const isWeekend = dateInfo.date.getDay() === 0 || dateInfo.date.getDay() === 6;
                        return (
                            <button
                                key={index}
                                className={`jira-date-item ${dateInfo.isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isWeekend ? 'weekend' : ''}`}
                                onClick={() => setSelectedDate(dateInfo.date)}
                            >
                                <span className="jira-date-label">{dateInfo.formatted}</span>
                                {dateInfo.isToday && <span className="jira-date-today-dot" />}
                            </button>
                        );
                    })}
                </div>

                {/* 底部导航 */}
                <div className="jira-sidebar-nav">
                    <button className={`jira-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
                        <span className="jira-nav-icon">📊</span>
                        <span className="jira-nav-label">仪表板</span>
                    </button>
                    <button className={`jira-nav-item ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
                        <span className="jira-nav-icon">📋</span>
                        <span className="jira-nav-label">历史总结</span>
                    </button>
                    <button className={`jira-nav-item ${activeTab === 'config' ? 'active' : ''}`} onClick={() => setActiveTab('config')}>
                        <span className="jira-nav-icon">⚙️</span>
                        <span className="jira-nav-label">配置</span>
                    </button>
                    <button className={`jira-nav-item ${activeTab === 'manual' ? 'active' : ''}`} onClick={() => setActiveTab('manual')}>
                        <span className="jira-nav-icon">✍️</span>
                        <span className="jira-nav-label">手动填写</span>
                    </button>
                </div>
            </div>

            {/* ===== 右侧主内容区 ===== */}
            <div className="jira-main">
                <div className="window-controls">
                    <button className="window-ctrl-btn window-ctrl-min" onClick={minimizeWindow} title="最小化">−</button>
                    <button className="window-ctrl-btn window-ctrl-max" onClick={toggleMaximize} title={isMaximized ? '还原' : '最大化'}>{isMaximized ? '❐' : '□'}</button>
                    <button className="window-ctrl-btn window-ctrl-close" onClick={closeWindow} title="关闭">✕</button>
                </div>
                {loading && <div className="jira-loading-overlay"><div className="jira-spinner" /> 加载中...</div>}

                {/* --- 仪表板 Tab --- */}
                {activeTab === 'dashboard' && (
                    <div className="jira-dashboard">
                        {/* 摘要卡片 */}
                        <div className="jira-summary-cards">
                            <div className="jira-summary-card">
                                <span className="jira-card-icon">📅</span>
                                <div className="jira-card-body">
                                    <span className="jira-card-label">选中日期</span>
                                    <span className="jira-card-value">{formatDateStr(selectedDate)}</span>
                                </div>
                            </div>
                            <div className="jira-summary-card">
                                <span className="jira-card-icon">⏱️</span>
                                <div className="jira-card-body">
                                    <span className="jira-card-label">工时进度</span>
                                    <span className="jira-card-value">{totalWorkedHours.toFixed(1)}/{requiredWorkHours}h</span>
                                    <div className="jira-progress-bar">
                                        <div className="jira-progress-fill" style={{width: `${Math.min(100, (totalWorkedHours / requiredWorkHours) * 100)}%`}} />
                                    </div>
                                </div>
                            </div>
                            <div className="jira-summary-card">
                                <span className="jira-card-icon">📝</span>
                                <div className="jira-card-body">
                                    <span className="jira-card-label">未完成问题</span>
                                    <span className="jira-card-value">{unfinishedIssues.length} 个</span>
                                </div>
                            </div>
                            <div className="jira-summary-card">
                                <span className="jira-card-icon">💻</span>
                                <div className="jira-card-body">
                                    <span className="jira-card-label">Git 提交</span>
                                    <span className="jira-card-value">{todayCommits.length} 次</span>
                                </div>
                            </div>
                        </div>

                        {/* 当日工作日志 */}
                        <div className="jira-section">
                            <h3 className="jira-section-title">⏱️ 当日工作日志</h3>
                            {todayWorklogs.length > 0 ? (
                                <table className="jira-table">
                                    <thead>
                                    <tr><th>问题编号</th><th>工时</th><th>说明</th><th>开始时间</th><th>操作</th></tr>
                                    </thead>
                                    <tbody>
                                    {todayWorklogs.map((wl, i) => (
                                        editingWorklogId === wl.worklog_id ? (
                                            <tr key={i} className="jira-editing-row">
                                                <td><span className="jira-issue-key">{wl.issue_key}</span></td>
                                                <td>
                                                    <input
                                                        type="number"
                                                        min="0.5" max="24" step="0.5"
                                                        value={editingWorklog.timeSpent}
                                                        onChange={(e) => setEditingWorklog({...editingWorklog, timeSpent: parseFloat(e.target.value) || 0})}
                                                        className="jira-edit-input jira-edit-hours"
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        value={editingWorklog.comment}
                                                        onChange={(e) => setEditingWorklog({...editingWorklog, comment: e.target.value})}
                                                        className="jira-edit-input jira-edit-comment"
                                                    />
                                                </td>
                                                <td className="jira-table-time">{new Date(wl.started).toLocaleString()}</td>
                                                <td className="jira-table-actions">
                                                    <button onClick={() => handleSaveEditWorklog(wl.issue_key, wl.worklog_id)} className="jira-btn-icon jira-btn-save" title="保存" disabled={savingEditId === wl.worklog_id}>{savingEditId === wl.worklog_id ? '⏳' : '💾'}</button>
                                                    <button onClick={handleCancelEdit} className="jira-btn-icon jira-btn-cancel" title="取消" disabled={savingEditId === wl.worklog_id}>✕</button>
                                                </td>
                                            </tr>
                                        ) : (
                                            <tr key={i}>
                                                <td><span className="jira-issue-key">{wl.issue_key}</span></td>
                                                <td><span className="jira-time-badge">{wl.time_spent_hours}h</span></td>
                                                <td className="jira-table-comment">{wl.comment}</td>
                                                <td className="jira-table-time">{new Date(wl.started).toLocaleString()}</td>
                                                <td className="jira-table-actions">
                                                    <button onClick={() => handleStartEditWorklog(wl)} className="jira-btn-icon jira-btn-edit" title="编辑" disabled={!!deletingWorklogId || !!savingEditId}>✏️</button>
                                                    <button onClick={() => handleDeleteWorklog(wl.issue_key, wl.worklog_id)} className="jira-btn-icon jira-btn-delete" title="删除" disabled={deletingWorklogId === wl.worklog_id || !!savingEditId}>{deletingWorklogId === wl.worklog_id ? '⏳' : '🗑️'}</button>
                                                </td>
                                            </tr>
                                        )
                                    ))}
                                    </tbody>
                                </table>
                            ) : (
                                <p className="jira-empty-text">暂无工作日志</p>
                            )}
                        </div>

                        {/* 当日 Git 提交 */}
                        <div className="jira-section">
                            <h3 className="jira-section-title">💻 当日 Git 提交</h3>
                            {todayCommits.length > 0 ? (
                                <table className="jira-table">
                                    <thead>
                                    <tr><th>提交ID</th><th>信息</th><th>时间</th><th>仓库</th></tr>
                                    </thead>
                                    <tbody>
                                    {todayCommits.map((c, i) => (
                                        <tr key={i}>
                                            <td><span className="jira-commit-id">{c.commit_id.substring(0, 8)}</span></td>
                                            <td className="jira-table-comment">{c.message}</td>
                                            <td className="jira-table-time">{new Date(c.commit_time).toLocaleString()}</td>
                                            <td className="jira-table-repo">{c.repository.split('/').pop()?.replace('.git', '') || c.repository}</td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            ) : (
                                <p className="jira-empty-text">暂无 Git 提交</p>
                            )}
                        </div>

                        {/* AI 智能生成区域 */}
                        <div className="jira-section jira-ai-section">
                            <h3 className="jira-section-title">🤖 AI 智能生成工作日志</h3>

                            <div className="jira-ai-select">
                                <div className="jira-ai-select-header">
                                    <span>📋 选择 JIRA 问题</span>
                                    <button onClick={toggleAllIssues} className="jira-btn-sm">
                                        {selectedIssueKeys.size === unfinishedIssues.length ? '取消全选' : '全选'}
                                    </button>
                                </div>
                                <div className="jira-checkbox-list">
                                    {unfinishedIssues.map((issue, i) => (
                                        <label key={i} className="jira-checkbox-item">
                                            <input type="checkbox" checked={selectedIssueKeys.has(issue.key)} onChange={() => toggleIssueSelection(issue.key)} />
                                            <span className="jira-issue-key">{issue.key}</span>
                                            <span>{issue.summary}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="jira-ai-select">
                                <div className="jira-ai-select-header">
                                    <span>💻 选择 Git 提交（可选）</span>
                                    {todayCommits.length > 0 && (
                                        <button onClick={toggleAllCommits} className="jira-btn-sm">
                                            {selectedCommitIds.size === todayCommits.length ? '取消全选' : '全选'}
                                        </button>
                                    )}
                                </div>
                                <div className="jira-checkbox-list">
                                    {todayCommits.map((c, i) => (
                                        <label key={i} className="jira-checkbox-item">
                                            <input type="checkbox" checked={selectedCommitIds.has(c.commit_id)} onChange={() => toggleCommitSelection(c.commit_id)} />
                                            <span className="jira-commit-id">{c.commit_id.substring(0, 8)}</span>
                                            <span>{c.message}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="jira-ai-hours">
                                <span>⏱️ 总工作时长</span>
                                <div className="jira-ai-hours-input">
                                    <input type="range" min="0" max="24" step="0.5" value={aiTotalHours} onChange={(e) => setAiTotalHours(parseFloat(e.target.value))} />
                                    <input type="number" min="0" max="24" step="0.5" value={aiTotalHours} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 24) setAiTotalHours(v); }} className="jira-hours-num" />
                                    <span>小时</span>
                                </div>
                            </div>

                            <button onClick={generateWorklogWithSelection} className="jira-btn jira-btn-primary" disabled={selectedIssueKeys.size === 0 || aiGenerating}>
                                {aiGenerating ? (
                                    <><span className="jira-spinner jira-spinner-inline" /> AI 生成中...</>
                                ) : (
                                    '✨ 生成工作日志'
                                )}
                            </button>

                            {aiGenerating && (
                                <div className="jira-ai-generating-hint">🤖 正在调用 AI 分析提交记录和工作日志，请耐心等待...</div>
                            )}

                            {aiSuggestion && (
                                <div className="jira-ai-result">
                                    <h4>AI 建议：</h4>
                                    <pre>{aiSuggestion}</pre>
                                    {aiSuggestions.length > 0 && (
                                        <div className="jira-ai-suggestions">
                                            <p>检测到 {aiSuggestions.length} 条工作日志建议：</p>
                                            <ul>
                                                {aiSuggestions.map((s, i) => (
                                                    <li key={i}><strong>{s.issueKey}</strong> — {s.timeSpent}h · {s.comment}</li>
                                                ))}
                                            </ul>
                                            <button onClick={applyAISuggestions} className="jira-btn jira-btn-success" disabled={applyingSuggestions}>
                                                {applyingSuggestions ? '⏳ 应用建议中...' : '✅ 应用全部建议'}
                                            </button>
                                            {applyingSuggestions && (
                                                <div className="jira-ai-generating-hint" style={{marginTop: 8}}>
                                                    ⏱️ 正在逐条记录工作日志，请勿关闭窗口...
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* --- 历史总结 Tab --- */}
                {activeTab === 'history' && (
                    <div className="jira-history">
                        {/* 快捷日期范围选择 */}
                        <div className="jira-section">
                            <h3 className="jira-section-title">📅 快捷选择</h3>
                            <div className="jira-report-quick-btns">
                                <button onClick={() => selectDateRange('thisWeek')} className="jira-btn jira-btn-outline">本周</button>
                                <button onClick={() => selectDateRange('lastWeek')} className="jira-btn jira-btn-outline">上周</button>
                                <button onClick={() => selectDateRange('thisMonth')} className="jira-btn jira-btn-outline">本月</button>
                                <button onClick={() => selectDateRange('lastMonth')} className="jira-btn jira-btn-outline">上月</button>
                            </div>
                            <div className="jira-report-custom-range">
                                <label className="jira-report-range-label">自定义范围：</label>
                                <input
                                    type="date"
                                    value={reportStartDate}
                                    onChange={(e) => {
                                        setReportStartDate(e.target.value);
                                        if (e.target.value && reportEndDate) {
                                            const dates: string[] = [];
                                            const current = new Date(e.target.value);
                                            const end = new Date(reportEndDate);
                                            while (current <= end) {
                                                dates.push(formatDateStr(current));
                                                current.setDate(current.getDate() + 1);
                                            }
                                            setSelectedHistoryDates(new Set(dates));
                                        }
                                    }}
                                    className="jira-report-date-input"
                                />
                                <span className="jira-report-range-sep">~</span>
                                <input
                                    type="date"
                                    value={reportEndDate}
                                    onChange={(e) => {
                                        setReportEndDate(e.target.value);
                                        if (reportStartDate && e.target.value) {
                                            const dates: string[] = [];
                                            const current = new Date(reportStartDate);
                                            const end = new Date(e.target.value);
                                            while (current <= end) {
                                                dates.push(formatDateStr(current));
                                                current.setDate(current.getDate() + 1);
                                            }
                                            setSelectedHistoryDates(new Set(dates));
                                        }
                                    }}
                                    className="jira-report-date-input"
                                />
                            </div>
                            {reportStartDate && reportEndDate && (
                                <div className="jira-report-date-range">
                                    📆 {reportStartDate} ~ {reportEndDate}
                                </div>
                            )}
                        </div>

                        <div className="jira-section">
                            <h3 className="jira-section-title">📋 多日工单汇总</h3>
                            <p className="jira-section-desc">选择多个日期，查看汇总的工作日志</p>

                            <div className="jira-history-date-select">
                                <div className="jira-history-date-header">
                                    <span>已选 {selectedHistoryDates.size} 天</span>
                                    <button onClick={toggleAllHistoryDates} className="jira-btn-sm">
                                        {selectedHistoryDates.size === generateDateList().length ? '取消全选' : '全选'}
                                    </button>
                                </div>
                                <div className="jira-checkbox-list jira-history-checkboxes">
                                    {generateDateList().map((d, i) => (
                                        <label key={i} className="jira-checkbox-item">
                                            <input type="checkbox" checked={selectedHistoryDates.has(d.dateStr)} onChange={() => toggleHistoryDate(d.dateStr)} />
                                            <span>{d.formatted}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <button onClick={loadDateRangeSummaries} className="jira-btn jira-btn-primary" disabled={selectedHistoryDates.size === 0}>
                                🔍 查询汇总
                            </button>

                            {historyLoading && <div className="jira-loading-inline">加载中...</div>}

                            {dateRangeSummaries.length > 0 && !historyLoading && (
                                <div className="jira-history-results">
                                    <div className="jira-history-summary-bar">
                                        {dateRangeSummaries.length} 天有工单记录 · 总计 {dateRangeSummaries.reduce((s, d) => s + d.total_hours, 0).toFixed(1)}h
                                    </div>
                                    {dateRangeSummaries.map((summary, si) => (
                                        <div key={si} className="jira-history-day">
                                            <h4 className="jira-history-day-title">
                                                📅 {summary.date} — {summary.total_hours.toFixed(1)}h
                                            </h4>
                                            <table className="jira-table">
                                                <thead>
                                                <tr><th>问题编号</th><th>工时</th><th>说明</th></tr>
                                                </thead>
                                                <tbody>
                                                {summary.worklogs.map((wl, wi) => (
                                                    <tr key={wi}>
                                                        <td><span className="jira-issue-key">{wl.issue_key}</span></td>
                                                        <td><span className="jira-time-badge">{wl.time_spent_hours}h</span></td>
                                                        <td className="jira-table-comment">{wl.comment}</td>
                                                    </tr>
                                                ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* 周报/月报生成 */}
                        <div className="jira-section">
                            <h3 className="jira-section-title">📊 报告生成</h3>
                            <div className="jira-report-btns">
                                <button
                                    onClick={() => generateReport('weekly')}
                                    className="jira-btn jira-btn-primary"
                                    disabled={reportGenerating}
                                >
                                    {reportGenerating && reportType === 'weekly' ? '⏳ 生成中...' : '📝 生成周报'}
                                </button>
                                <button
                                    onClick={() => generateReport('monthly')}
                                    className="jira-btn jira-btn-success"
                                    disabled={reportGenerating}
                                >
                                    {reportGenerating && reportType === 'monthly' ? '⏳ 生成中...' : '📊 生成月报'}
                                </button>
                            </div>

                            {reportGenerating && (
                                <div className="jira-loading-inline">正在生成报告...</div>
                            )}

                            {reportError && !reportGenerating && (
                                <div className="jira-report-preview" style={{borderColor: '#e74c3c'}}>
                                    <pre className="jira-report-content" style={{color: '#e74c3c'}}>{`# 报告生成失败\n\n> ${reportError}\n\n请检查：\n1. JIRA 配置是否正确\n2. 网络连接是否正常\n3. 日期范围是否有效`}</pre>
                                </div>
                            )}

                            {generatedReport && !reportGenerating && !reportError && (
                                <div className="jira-report-preview">
                                    <div className="jira-report-toolbar">
                                        <span className="jira-report-type-badge">
                                            {reportType === 'weekly' ? '周报' : '月报'}
                                        </span>
                                        <div className="jira-report-actions">
                                            <button onClick={copyReportToClipboard} className="jira-btn jira-btn-outline jira-btn-sm">
                                                📋 复制Markdown
                                            </button>
                                            <button onClick={exportReportAsFile} className="jira-btn jira-btn-outline jira-btn-sm">
                                                💾 导出文件
                                            </button>
                                        </div>
                                    </div>
                                    <pre className="jira-report-content">{generatedReport}</pre>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* --- 配置 Tab --- */}
                {activeTab === 'config' && (
                    <div className="jira-config-panel">
                        {/* JIRA 配置卡片 */}
                        <div className="jira-config-card">
                            <h3>🔗 JIRA 配置</h3>
                            <div className="jira-form-group">
                                <label>JIRA URL</label>
                                <input type="text" value={jiraConfig.jiraUrl} onChange={(e) => setJiraConfig({...jiraConfig, jiraUrl: e.target.value})} placeholder="https://your-domain.atlassian.net" />
                            </div>
                            <div className="jira-form-group">
                                <label>用户名 (邮箱)</label>
                                <input type="text" value={jiraConfig.username} onChange={(e) => setJiraConfig({...jiraConfig, username: e.target.value})} placeholder="your-email@example.com" />
                            </div>
                            <div className="jira-form-group">
                                <label>API 令牌</label>
                                <input type="password" value={jiraConfig.apiToken} onChange={(e) => setJiraConfig({...jiraConfig, apiToken: e.target.value})} placeholder="JIRA API Token" />
                            </div>
                            <div className="jira-btn-row">
                                <button onClick={handleSaveJiraConfig} className="jira-btn jira-btn-primary">💾 保存</button>
                                <button onClick={testJiraConnection} className="jira-btn jira-btn-outline">🔍 测试连接</button>
                            </div>
                        </div>

                        {/* Git 配置卡片 */}
                        <div className="jira-config-card">
                            <h3>📦 Git 配置</h3>
                            <div className="jira-form-group">
                                <label>Git 用户名</label>
                                <input type="text" value={gitConfig.username} onChange={(e) => setGitConfig({...gitConfig, username: e.target.value})} placeholder="你的 Git 用户名" />
                            </div>
                            <h4>仓库列表</h4>
                            {gitConfig.repositories.map((repo, index) => (
                                <div key={index} className="jira-repo-config">
                                    <span className="jira-repo-index">仓库 {index + 1}</span>
                                    <div className="jira-form-group">
                                        <label>仓库 URL</label>
                                        <input type="text" value={repo.url} onChange={(e) => updateGitRepository(index, "url", e.target.value)} placeholder="https://github.com/user/repo.git" />
                                    </div>
                                    <div className="jira-form-group">
                                        <label>访问令牌</label>
                                        <input type="password" value={repo.token} onChange={(e) => updateGitRepository(index, "token", e.target.value)} placeholder="Personal Access Token" />
                                    </div>
                                    <div className="jira-form-group">
                                        <label>仓库别名</label>
                                        <input type="text" value={repo.alias} onChange={(e) => updateGitRepository(index, "alias", e.target.value)} placeholder="例如: 主项目" />
                                    </div>
                                    {gitConfig.repositories.length > 1 && (
                                        <button onClick={() => removeGitRepository(index)} className="jira-btn jira-btn-danger jira-btn-sm">🗑️ 删除</button>
                                    )}
                                </div>
                            ))}
                            <div className="jira-btn-row">
                                <button onClick={addGitRepository} className="jira-btn jira-btn-outline">➕ 添加仓库</button>
                                <button onClick={handleSaveGitConfig} className="jira-btn jira-btn-primary">💾 保存</button>
                                <button onClick={testGitConnection} className="jira-btn jira-btn-outline">🔍 测试连接</button>
                            </div>
                        </div>

                        {/* AI 配置卡片 */}
                        <div className="jira-config-card">
                            <h3>🤖 AI 配置（与 AI 对话共享）</h3>
                            <div className="jira-form-group">
                                <label>API 密钥</label>
                                <input type="password" value={aiConfig.apiKey} onChange={(e) => setAiConfig({...aiConfig, apiKey: e.target.value})} placeholder="输入 AI 服务 API 密钥" />
                            </div>
                            <div className="jira-form-group">
                                <label>模型</label>
                                <input type="text" value={aiConfig.model} onChange={(e) => setAiConfig({...aiConfig, model: e.target.value})} placeholder="deepseek-chat" />
                            </div>
                            <div className="jira-form-group">
                                <label>Base URL</label>
                                <input type="text" value={aiConfig.baseUrl} onChange={(e) => setAiConfig({...aiConfig, baseUrl: e.target.value})} placeholder="https://api.deepseek.com" />
                            </div>
                            <button onClick={handleSaveAiConfig} className="jira-btn jira-btn-primary">💾 保存 AI 配置</button>
                        </div>
                    </div>
                )}

                {/* --- 手动填写 Tab --- */}
                {activeTab === 'manual' && (
                    <div className="jira-manual">
                        <div className="jira-section">
                            <h3 className="jira-section-title">✍️ 记录工作日志</h3>
                            <div className="jira-form-group">
                                <label>问题编号</label>
                                <select value={newWorklog.issueKey} onChange={(e) => handleNewWorklogChange('issueKey', e.target.value)}>
                                    <option value="">选择问题...</option>
                                    {unfinishedIssues.map((issue, i) => (
                                        <option key={i} value={issue.key}>{issue.key} - {issue.summary}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="jira-form-group">
                                <label>工作时长（小时）</label>
                                <input type="number" step="0.5" min="0.5" max="24" value={newWorklog.timeSpent} onChange={(e) => handleNewWorklogChange('timeSpent', parseFloat(e.target.value) || 0)} />
                            </div>
                            <div className="jira-form-group">
                                <label>工作说明</label>
                                <textarea value={newWorklog.comment} onChange={(e) => handleNewWorklogChange('comment', e.target.value)} placeholder="描述今天的工作内容..." />
                            </div>
                            <button onClick={handleNewWorklogSubmit} className="jira-btn jira-btn-primary">📝 记录工作时间</button>
                        </div>

                        <div className="jira-section">
                            <h3 className="jira-section-title">📋 当日工作日志列表</h3>
                            {todayWorklogs.length > 0 ? (
                                <table className="jira-table">
                                    <thead>
                                    <tr><th>问题编号</th><th>工时</th><th>说明</th><th>开始时间</th></tr>
                                    </thead>
                                    <tbody>
                                    {todayWorklogs.map((wl, i) => (
                                        <tr key={i}>
                                            <td><span className="jira-issue-key">{wl.issue_key}</span></td>
                                            <td><span className="jira-time-badge">{wl.time_spent_hours}h</span></td>
                                            <td className="jira-table-comment">{wl.comment}</td>
                                            <td className="jira-table-time">{new Date(wl.started).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            ) : (
                                <p className="jira-empty-text">今日暂无工作日志</p>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
