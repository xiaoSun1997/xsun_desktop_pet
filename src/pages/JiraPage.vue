<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

interface DateWorklogSummary {
  date: string;
  worklogs: WorklogEntry[];
  total_hours: number;
}

interface JiraConfig { jiraUrl: string; username: string; apiToken: string; }
interface GitRepository { url: string; token: string; alias: string; }
interface GitConfig { repositories: GitRepository[]; username: string; }
interface AIConfig { apiKey: string; model: string; baseUrl: string; }
interface AISuggestion { issueKey: string; timeSpent: number; comment: string; }

const formatDateStr = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const jiraConfig = ref<JiraConfig>({ jiraUrl: "", username: "", apiToken: "" });
const gitConfig = ref<GitConfig>({ repositories: [{ url: "", token: "", alias: "" }], username: "" });
const aiConfig = ref<AIConfig>({ apiKey: "", model: "deepseek-chat", baseUrl: "https://api.deepseek.com" });
const unfinishedIssues = ref<JiraIssue[]>([]);
const todayWorklogs = ref<WorklogEntry[]>([]);
const todayCommits = ref<GitCommit[]>([]);
const requiredWorkHours = ref(0);
const loading = ref(false);
const aiSuggestion = ref("");
const aiSuggestions = ref<AISuggestion[]>([]);
const selectedIssueKeys = ref<Set<string>>(new Set());
const selectedCommitIds = ref<Set<string>>(new Set());
const aiTotalHours = ref(8);
const aiGenerating = ref(false);
const applyingSuggestions = ref(false);
const editingWorklogId = ref<string | null>(null);
const editingWorklog = ref<{ timeSpent: number; comment: string }>({ timeSpent: 0, comment: "" });
const deletingWorklogId = ref<string | null>(null);
const savingEditId = ref<string | null>(null);
const activeTab = ref<"dashboard" | "history" | "config" | "manual">("dashboard");
const selectedHistoryDates = ref<Set<string>>(new Set());
const dateRangeSummaries = ref<DateWorklogSummary[]>([]);
const historyLoading = ref(false);
const newWorklog = ref({ issueKey: "", timeSpent: 1.0, comment: "" });

const today = new Date();
today.setHours(0, 0, 0, 0);
const selectedDate = ref<Date>(new Date(today));

const dateList = computed(() => {
  const dates: { date: Date; isToday: boolean; formatted: string; dateStr: string }[] = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  for (let i = -15; i <= 15; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push({
      date: d,
      isToday: d.toDateString() === now.toDateString(),
      formatted: `${month}-${day} ${weekdays[d.getDay()]}`,
      dateStr: formatDateStr(d),
    });
  }
  return dates;
});

const totalWorkedHours = computed(() =>
  todayWorklogs.value.reduce((sum: number, w: WorklogEntry) => sum + w.time_spent_hours, 0)
);

const closeWindow = async () => {
  try { await getCurrentWindow().close(); }
  catch (error) { console.error('关闭窗口失败:', error); }
};

const headerDragHandler = async (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (target.closest('.jira-close-btn') || target.closest('button')) return;
  try { await getCurrentWindow().startDragging(); }
  catch (error) { console.error('拖动失败:', error); }
};

const loadConfigs = async () => {
  try {
    const jc = await invoke("load_jira_config");
    if (jc) jiraConfig.value = jc as JiraConfig;
    const gc = await invoke("load_git_config");
    if (gc) gitConfig.value = gc as GitConfig;
    try {
      const ac = await invoke("load_local_deepseek_config");
      if (ac) aiConfig.value = ac as AIConfig;
    } catch { /* ignore */ }
  } catch (e) { console.error("加载配置失败:", e); }
};

const loadTodayData = async () => {
  loading.value = true;
  try {
    const dateStr = formatDateStr(selectedDate.value);
    requiredWorkHours.value = await invoke("get_required_work_hours") as number;
    unfinishedIssues.value = await invoke("get_my_unfinished_issues") as JiraIssue[];
    todayWorklogs.value = await invoke("get_my_today_worklogs", { dateStr }) as WorklogEntry[];
    todayCommits.value = await invoke("get_commits_by_date", { dateStr }) as GitCommit[];
  } catch (e) { console.error("加载数据失败:", e); }
  finally { loading.value = false; }
};

const selectDate = (d: Date) => { selectedDate.value = d; };

const handleSaveJiraConfig = async () => {
  try {
    await invoke("save_jira_config", { config: jiraConfig.value });
    alert("JIRA配置保存成功！");
    loadTodayData();
  } catch (e) { alert("保存JIRA配置失败：" + e); }
};

const testJiraConnection = async () => {
  try {
    await invoke("save_jira_config", { config: jiraConfig.value });
    const issues = await invoke("get_my_unfinished_issues");
    if (Array.isArray(issues)) alert(`JIRA连接测试成功！当前用户有 ${issues.length} 个未完成的问题。`);
    else alert("JIRA连接测试成功！");
  } catch (e) { alert("JIRA连接测试失败：" + e); }
};

const handleSaveGitConfig = async () => {
  try {
    await invoke("save_git_config", { config: gitConfig.value });
    alert("Git配置保存成功！");
    loadTodayData();
  } catch (e) { alert("保存Git配置失败：" + e); }
};

const testGitConnection = async () => {
  try {
    await invoke("save_git_config", { config: gitConfig.value });
    const result = await invoke<string>("test_git_connection");
    alert("Git连接测试结果：\n" + result);
  } catch (e) { alert("Git连接测试失败：" + e); }
};

const addGitRepository = () => {
  gitConfig.value.repositories.push({ url: "", token: "", alias: "" });
};

const updateGitRepository = (index: number, field: string, value: string) => {
  (gitConfig.value.repositories[index] as Record<string, string>)[field] = value;
};

const removeGitRepository = (index: number) => {
  gitConfig.value.repositories.splice(index, 1);
};

const handleSaveAiConfig = async () => {
  try {
    await invoke("save_deepseek_config", { config: aiConfig.value });
    alert("AI配置保存成功！");
  } catch (e) { alert("保存AI配置失败：" + e); }
};

const handleLogWork = async (issueKey: string, timeSpent: number, comment: string, dateStr?: string) => {
  try {
    const effective = dateStr || formatDateStr(selectedDate.value);
    const result = await invoke("log_work", { issueKey, timeSpentHours: timeSpent, comment, dateStr: effective });
    if (result) {
      alert("工作时间记录成功！");
      loadTodayData();
      newWorklog.value = { issueKey: "", timeSpent: 1.0, comment: "" };
    } else alert("工作时间记录失败！");
  } catch (e) { alert("记录工作时间失败：" + e); }
};

const toggleIssueSelection = (key: string) => {
  const next = new Set(selectedIssueKeys.value);
  next.has(key) ? next.delete(key) : next.add(key);
  selectedIssueKeys.value = next;
};

const toggleCommitSelection = (id: string) => {
  const next = new Set(selectedCommitIds.value);
  next.has(id) ? next.delete(id) : next.add(id);
  selectedCommitIds.value = next;
};

const toggleAllIssues = () => {
  selectedIssueKeys.value = selectedIssueKeys.value.size === unfinishedIssues.value.length
    ? new Set()
    : new Set(unfinishedIssues.value.map((i: JiraIssue) => i.key));
};

const toggleAllCommits = () => {
  selectedCommitIds.value = selectedCommitIds.value.size === todayCommits.value.length
    ? new Set()
    : new Set(todayCommits.value.map((c: GitCommit) => c.commit_id));
};

const generateWorklogWithSelection = async () => {
  if (selectedIssueKeys.value.size === 0) { alert("请至少选择一个 JIRA 问题"); return; }
  if (aiTotalHours.value <= 0 || aiTotalHours.value > 24) { alert("总时长必须在 0-24 小时之间"); return; }
  aiGenerating.value = true;
  aiSuggestion.value = "";
  aiSuggestions.value = [];
  try {
    const dateStr = formatDateStr(selectedDate.value);
    const suggestion = await invoke<string>("generate_worklog_suggestions", {
      selectedIssueKeys: Array.from(selectedIssueKeys.value),
      selectedCommitIds: Array.from(selectedCommitIds.value),
      totalHours: aiTotalHours.value,
      dateStr,
    });
    aiSuggestion.value = suggestion;
    parseAISuggestions(suggestion);
  } catch (e) { alert("AI生成失败: " + e); }
  finally { aiGenerating.value = false; }
};

const parseAISuggestions = (suggestion: string) => {
  const list: AISuggestion[] = [];
  const regex = /JIRA问题:\s*([A-Z0-9]+-?\d+)[\s\S]*?记录工时:\s*([\d.]+)小时[\s\S]*?工作说明:\s*([^\n\r]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(suggestion)) !== null) {
    list.push({ issueKey: match[1], timeSpent: parseFloat(match[2]), comment: match[3].trim() });
  }
  aiSuggestions.value = list;
};

const applyAISuggestions = async () => {
  if (aiSuggestions.value.length === 0) { alert("没有可应用的AI建议"); return; }
  const issuesList = aiSuggestions.value.map((s: AISuggestion) => `${s.issueKey} (${s.timeSpent}h)`).join("\n");
  if (!confirm(`确认将以下工作日志记录到 JIRA？\n\n${issuesList}\n\n请确认日期、工时和说明无误。`)) return;
  applyingSuggestions.value = true;
  const dateStr = formatDateStr(selectedDate.value);
  for (const s of aiSuggestions.value) {
    try {
      await handleLogWork(s.issueKey, s.timeSpent, s.comment, dateStr);
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      alert(`记录工时失败 ${s.issueKey}: ${e}`);
      applyingSuggestions.value = false;
      return;
    }
  }
  alert("AI建议已应用完成！");
  applyingSuggestions.value = false;
  aiSuggestions.value = [];
  aiSuggestion.value = "";
};

const handleDeleteWorklog = async (issueKey: string, worklogId: string) => {
  if (!worklogId) { alert("缺少工作日志ID"); return; }
  if (!confirm(`确认删除 ${issueKey} 的这条工作日志吗？`)) return;
  deletingWorklogId.value = worklogId;
  try {
    await invoke("delete_worklog", { issueKey, worklogId });
    alert("工作日志已删除！");
    loadTodayData();
  } catch (e) { alert("删除工作日志失败：" + e); }
  finally { deletingWorklogId.value = null; }
};

const handleStartEditWorklog = (wl: WorklogEntry) => {
  editingWorklogId.value = wl.worklog_id;
  editingWorklog.value = { timeSpent: wl.time_spent_hours, comment: wl.comment };
};

const handleSaveEditWorklog = async (issueKey: string, worklogId: string) => {
  if (editingWorklog.value.timeSpent <= 0 || editingWorklog.value.timeSpent > 24) {
    alert("工时必须在 0.5-24 小时之间"); return;
  }
  if (!editingWorklog.value.comment.trim()) { alert("工作说明不能为空"); return; }
  savingEditId.value = worklogId;
  try {
    await invoke("update_worklog", {
      issueKey, worklogId,
      timeSpentHours: editingWorklog.value.timeSpent,
      comment: editingWorklog.value.comment,
    });
    alert("工作日志已更新！");
    editingWorklogId.value = null;
    loadTodayData();
  } catch (e) { alert("更新工作日志失败：" + e); }
  finally { savingEditId.value = null; }
};

const handleCancelEdit = () => { editingWorklogId.value = null; };

const loadDateRangeSummaries = async () => {
  if (selectedHistoryDates.value.size === 0) { alert("请至少选择一个日期"); return; }
  const dates = Array.from(selectedHistoryDates.value).sort();
  historyLoading.value = true;
  try {
    dateRangeSummaries.value = await invoke("get_worklogs_by_date_range", {
      startDate: dates[0], endDate: dates[dates.length - 1],
    }) as DateWorklogSummary[];
  } catch (e) { alert("加载汇总失败：" + e); }
  finally { historyLoading.value = false; }
};

const toggleHistoryDate = (dateStr: string) => {
  const next = new Set(selectedHistoryDates.value);
  next.has(dateStr) ? next.delete(dateStr) : next.add(dateStr);
  selectedHistoryDates.value = next;
};

const toggleAllHistoryDates = () => {
  const allDates = dateList.value.map((d: { dateStr: string }) => d.dateStr);
  selectedHistoryDates.value = selectedHistoryDates.value.size === allDates.length
    ? new Set()
    : new Set(allDates);
};

const handleNewWorklogSubmit = () => {
  const wl = newWorklog.value;
  if (!wl.issueKey || wl.timeSpent <= 0 || !wl.comment) { alert("请填写完整的工作日志信息"); return; }
  handleLogWork(wl.issueKey, wl.timeSpent, wl.comment);
};

const renderRepoName = (repo: string): string => {
  return repo.split('/').pop()?.replace('.git', '') || repo;
};

const formatRepoIndex = (i: number): string => `仓库 ${i + 1}`;

onMounted(() => {
  loadConfigs();
});

onMounted(() => {
  loadTodayData();
});
</script>

<template>
  <div class="jira-container">
    <!-- 左侧边栏 -->
    <div class="jira-sidebar">
      <div class="jira-sidebar-header" @mousedown="headerDragHandler">
        <span class="jira-sidebar-title">📋 JIRA 助手</span>
        <button class="jira-close-btn" @click="closeWindow">✕</button>
      </div>

      <div class="jira-sidebar-list">
        <button
          v-for="(di, idx) in dateList"
          :key="idx"
          :class="[
            'jira-date-item',
            { today: di.isToday, selected: di.date.toDateString() === selectedDate.toDateString(), weekend: di.date.getDay() === 0 || di.date.getDay() === 6 }
          ]"
          @click="selectDate(di.date)"
        >
          <span class="jira-date-label">{{ di.formatted }}</span>
          <span v-if="di.isToday" class="jira-date-today-dot" />
        </button>
      </div>

      <div class="jira-sidebar-nav">
        <button v-for="tab in ([{k:'dashboard',i:'📊',l:'仪表板'},{k:'history',i:'📋',l:'历史总结'},{k:'config',i:'⚙️',l:'配置'},{k:'manual',i:'✍️',l:'手动填写'}] as const)"
          :key="tab.k"
          :class="['jira-nav-item', { active: activeTab === tab.k }]"
          @click="activeTab = tab.k"
        >
          <span class="jira-nav-icon">{{ tab.i }}</span>
          <span class="jira-nav-label">{{ tab.l }}</span>
        </button>
      </div>
    </div>

    <!-- 右侧主内容 -->
    <div class="jira-main">
      <div v-if="loading" class="jira-loading-overlay"><div class="jira-spinner" /> 加载中...</div>

      <!-- 仪表板 -->
      <div v-if="activeTab === 'dashboard'" class="jira-dashboard">
        <div class="jira-summary-cards">
          <div class="jira-summary-card">
            <span class="jira-card-icon">📅</span>
            <div class="jira-card-body">
              <span class="jira-card-label">选中日期</span>
              <span class="jira-card-value">{{ formatDateStr(selectedDate) }}</span>
            </div>
          </div>
          <div class="jira-summary-card">
            <span class="jira-card-icon">⏱️</span>
            <div class="jira-card-body">
              <span class="jira-card-label">工时进度</span>
              <span class="jira-card-value">{{ totalWorkedHours.toFixed(1) }}/{{ requiredWorkHours }}h</span>
              <div class="jira-progress-bar">
                <div class="jira-progress-fill" :style="{ width: Math.min(100, (totalWorkedHours / (requiredWorkHours || 1)) * 100) + '%' }" />
              </div>
            </div>
          </div>
          <div class="jira-summary-card">
            <span class="jira-card-icon">📝</span>
            <div class="jira-card-body">
              <span class="jira-card-label">未完成问题</span>
              <span class="jira-card-value">{{ unfinishedIssues.length }} 个</span>
            </div>
          </div>
          <div class="jira-summary-card">
            <span class="jira-card-icon">💻</span>
            <div class="jira-card-body">
              <span class="jira-card-label">Git 提交</span>
              <span class="jira-card-value">{{ todayCommits.length }} 次</span>
            </div>
          </div>
        </div>

        <div class="jira-section">
          <h3 class="jira-section-title">⏱️ 当日工作日志</h3>
          <table v-if="todayWorklogs.length > 0" class="jira-table">
            <thead><tr><th>问题编号</th><th>工时</th><th>说明</th><th>开始时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="(wl, i) in todayWorklogs" :key="i" :class="{ 'jira-editing-row': editingWorklogId === wl.worklog_id }">
                <template v-if="editingWorklogId === wl.worklog_id">
                  <td><span class="jira-issue-key">{{ wl.issue_key }}</span></td>
                  <td><input type="number" min="0.5" max="24" step="0.5" v-model.number="editingWorklog.timeSpent" class="jira-edit-input jira-edit-hours" /></td>
                  <td><input type="text" v-model="editingWorklog.comment" class="jira-edit-input jira-edit-comment" /></td>
                  <td class="jira-table-time">{{ new Date(wl.started).toLocaleString() }}</td>
                  <td class="jira-table-actions">
                    <button @click="handleSaveEditWorklog(wl.issue_key, wl.worklog_id)" class="jira-btn-icon jira-btn-save" title="保存" :disabled="savingEditId === wl.worklog_id">{{ savingEditId === wl.worklog_id ? '⏳' : '💾' }}</button>
                    <button @click="handleCancelEdit" class="jira-btn-icon jira-btn-cancel" title="取消" :disabled="!!savingEditId">✕</button>
                  </td>
                </template>
                <template v-else>
                  <td><span class="jira-issue-key">{{ wl.issue_key }}</span></td>
                  <td><span class="jira-time-badge">{{ wl.time_spent_hours }}h</span></td>
                  <td class="jira-table-comment">{{ wl.comment }}</td>
                  <td class="jira-table-time">{{ new Date(wl.started).toLocaleString() }}</td>
                  <td class="jira-table-actions">
                    <button @click="handleStartEditWorklog(wl)" class="jira-btn-icon jira-btn-edit" title="编辑" :disabled="!!deletingWorklogId || !!savingEditId">✏️</button>
                    <button @click="handleDeleteWorklog(wl.issue_key, wl.worklog_id)" class="jira-btn-icon jira-btn-delete" title="删除" :disabled="deletingWorklogId === wl.worklog_id || !!savingEditId">{{ deletingWorklogId === wl.worklog_id ? '⏳' : '🗑️' }}</button>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
          <p v-else class="jira-empty-text">暂无工作日志</p>
        </div>

        <div class="jira-section">
          <h3 class="jira-section-title">💻 当日 Git 提交</h3>
          <table v-if="todayCommits.length > 0" class="jira-table">
            <thead><tr><th>提交ID</th><th>信息</th><th>时间</th><th>仓库</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in todayCommits" :key="i">
                <td><span class="jira-commit-id">{{ c.commit_id.substring(0, 8) }}</span></td>
                <td class="jira-table-comment">{{ c.message }}</td>
                <td class="jira-table-time">{{ new Date(c.commit_time).toLocaleString() }}</td>
                <td class="jira-table-repo">{{ renderRepoName(c.repository) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="jira-empty-text">暂无 Git 提交</p>
        </div>

        <div class="jira-section jira-ai-section">
          <h3 class="jira-section-title">🤖 AI 智能生成工作日志</h3>

          <div class="jira-ai-select">
            <div class="jira-ai-select-header">
              <span>📋 选择 JIRA 问题</span>
              <button @click="toggleAllIssues" class="jira-btn-sm">{{ selectedIssueKeys.size === unfinishedIssues.length ? '取消全选' : '全选' }}</button>
            </div>
            <div class="jira-checkbox-list">
              <label v-for="(issue, i) in unfinishedIssues" :key="i" class="jira-checkbox-item">
                <input type="checkbox" :checked="selectedIssueKeys.has(issue.key)" @change="toggleIssueSelection(issue.key)" />
                <span class="jira-issue-key">{{ issue.key }}</span>
                <span>{{ issue.summary }}</span>
              </label>
            </div>
          </div>

          <div class="jira-ai-select">
            <div class="jira-ai-select-header">
              <span>💻 选择 Git 提交（可选）</span>
              <button v-if="todayCommits.length > 0" @click="toggleAllCommits" class="jira-btn-sm">{{ selectedCommitIds.size === todayCommits.length ? '取消全选' : '全选' }}</button>
            </div>
            <div class="jira-checkbox-list">
              <label v-for="(c, i) in todayCommits" :key="i" class="jira-checkbox-item">
                <input type="checkbox" :checked="selectedCommitIds.has(c.commit_id)" @change="toggleCommitSelection(c.commit_id)" />
                <span class="jira-commit-id">{{ c.commit_id.substring(0, 8) }}</span>
                <span>{{ c.message }}</span>
              </label>
            </div>
          </div>

          <div class="jira-ai-hours">
            <span>⏱️ 总工作时长</span>
            <div class="jira-ai-hours-input">
              <input type="range" min="0" max="24" step="0.5" v-model.number="aiTotalHours" />
              <input type="number" min="0" max="24" step="0.5" v-model.number="aiTotalHours" class="jira-hours-num" />
              <span>小时</span>
            </div>
          </div>

          <button @click="generateWorklogWithSelection" class="jira-btn jira-btn-primary" :disabled="selectedIssueKeys.size === 0 || aiGenerating">
            <template v-if="aiGenerating"><span class="jira-spinner jira-spinner-inline" /> AI 生成中...</template>
            <template v-else>✨ 生成工作日志</template>
          </button>

          <div v-if="aiGenerating" class="jira-ai-generating-hint">🤖 正在调用 AI 分析提交记录和工作日志，请耐心等待...</div>

          <div v-if="aiSuggestion" class="jira-ai-result">
            <h4>AI 建议：</h4>
            <pre>{{ aiSuggestion }}</pre>
            <div v-if="aiSuggestions.length > 0" class="jira-ai-suggestions">
              <p>检测到 {{ aiSuggestions.length }} 条工作日志建议：</p>
              <ul>
                <li v-for="(s, i) in aiSuggestions" :key="i"><strong>{{ s.issueKey }}</strong> — {{ s.timeSpent }}h · {{ s.comment }}</li>
              </ul>
              <button @click="applyAISuggestions" class="jira-btn jira-btn-success" :disabled="applyingSuggestions">
                {{ applyingSuggestions ? '⏳ 应用建议中...' : '✅ 应用全部建议' }}
              </button>
              <div v-if="applyingSuggestions" class="jira-ai-generating-hint" style="margin-top:8px">⏱️ 正在逐条记录工作日志，请勿关闭窗口...</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 历史总结 -->
      <div v-if="activeTab === 'history'" class="jira-history">
        <div class="jira-section">
          <h3 class="jira-section-title">📋 多日工单汇总</h3>
          <p class="jira-section-desc">选择多个日期，查看汇总的工作日志</p>

          <div class="jira-history-date-select">
            <div class="jira-history-date-header">
              <span>已选 {{ selectedHistoryDates.size }} 天</span>
              <button @click="toggleAllHistoryDates" class="jira-btn-sm">{{ selectedHistoryDates.size === dateList.length ? '取消全选' : '全选' }}</button>
            </div>
            <div class="jira-checkbox-list jira-history-checkboxes">
              <label v-for="(d, i) in dateList" :key="i" class="jira-checkbox-item">
                <input type="checkbox" :checked="selectedHistoryDates.has(d.dateStr)" @change="toggleHistoryDate(d.dateStr)" />
                <span>{{ d.formatted }}</span>
              </label>
            </div>
          </div>

          <button @click="loadDateRangeSummaries" class="jira-btn jira-btn-primary" :disabled="selectedHistoryDates.size === 0">🔍 查询汇总</button>

          <div v-if="historyLoading" class="jira-loading-inline">加载中...</div>

          <div v-if="dateRangeSummaries.length > 0 && !historyLoading" class="jira-history-results">
            <div class="jira-history-summary-bar">
              {{ dateRangeSummaries.length }} 天有工单记录 · 总计 {{ dateRangeSummaries.reduce((s: number, d: DateWorklogSummary) => s + d.total_hours, 0).toFixed(1) }}h
            </div>
            <div v-for="(summary, si) in dateRangeSummaries" :key="si" class="jira-history-day">
              <h4 class="jira-history-day-title">📅 {{ summary.date }} — {{ summary.total_hours.toFixed(1) }}h</h4>
              <table class="jira-table">
                <thead><tr><th>问题编号</th><th>工时</th><th>说明</th></tr></thead>
                <tbody>
                  <tr v-for="(wl, wi) in summary.worklogs" :key="wi">
                    <td><span class="jira-issue-key">{{ wl.issue_key }}</span></td>
                    <td><span class="jira-time-badge">{{ wl.time_spent_hours }}h</span></td>
                    <td class="jira-table-comment">{{ wl.comment }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- 配置 -->
      <div v-if="activeTab === 'config'" class="jira-config-panel">
        <div class="jira-config-card">
          <h3>🔗 JIRA 配置</h3>
          <div class="jira-form-group">
            <label>JIRA URL</label>
            <input type="text" v-model="jiraConfig.jiraUrl" placeholder="https://your-domain.atlassian.net" />
          </div>
          <div class="jira-form-group">
            <label>用户名 (邮箱)</label>
            <input type="text" v-model="jiraConfig.username" placeholder="your-email@example.com" />
          </div>
          <div class="jira-form-group">
            <label>API 令牌</label>
            <input type="password" v-model="jiraConfig.apiToken" placeholder="JIRA API Token" />
          </div>
          <div class="jira-btn-row">
            <button @click="handleSaveJiraConfig" class="jira-btn jira-btn-primary">💾 保存</button>
            <button @click="testJiraConnection" class="jira-btn jira-btn-outline">🔍 测试连接</button>
          </div>
        </div>

        <div class="jira-config-card">
          <h3>📦 Git 配置</h3>
          <div class="jira-form-group">
            <label>Git 用户名</label>
            <input type="text" v-model="gitConfig.username" placeholder="你的 Git 用户名" />
          </div>
          <h4>仓库列表</h4>
          <div v-for="(repo, index) in gitConfig.repositories" :key="index" class="jira-repo-config">
            <span class="jira-repo-index">{{ formatRepoIndex(index) }}</span>
            <div class="jira-form-group">
              <label>仓库 URL</label>
              <input type="text" :value="repo.url" @input="updateGitRepository(index, 'url', ($event.target as HTMLInputElement).value)" placeholder="https://github.com/user/repo.git" />
            </div>
            <div class="jira-form-group">
              <label>访问令牌</label>
              <input type="password" :value="repo.token" @input="updateGitRepository(index, 'token', ($event.target as HTMLInputElement).value)" placeholder="Personal Access Token" />
            </div>
            <div class="jira-form-group">
              <label>仓库别名</label>
              <input type="text" :value="repo.alias" @input="updateGitRepository(index, 'alias', ($event.target as HTMLInputElement).value)" placeholder="例如: 主项目" />
            </div>
            <button v-if="gitConfig.repositories.length > 1" @click="removeGitRepository(index)" class="jira-btn jira-btn-danger jira-btn-sm">🗑️ 删除</button>
          </div>
          <div class="jira-btn-row">
            <button @click="addGitRepository" class="jira-btn jira-btn-outline">➕ 添加仓库</button>
            <button @click="handleSaveGitConfig" class="jira-btn jira-btn-primary">💾 保存</button>
            <button @click="testGitConnection" class="jira-btn jira-btn-outline">🔍 测试连接</button>
          </div>
        </div>

        <div class="jira-config-card">
          <h3>🤖 AI 配置（与 AI 对话共享）</h3>
          <div class="jira-form-group">
            <label>API 密钥</label>
            <input type="password" v-model="aiConfig.apiKey" placeholder="输入 AI 服务 API 密钥" />
          </div>
          <div class="jira-form-group">
            <label>模型</label>
            <input type="text" v-model="aiConfig.model" placeholder="deepseek-chat" />
          </div>
          <div class="jira-form-group">
            <label>Base URL</label>
            <input type="text" v-model="aiConfig.baseUrl" placeholder="https://api.deepseek.com" />
          </div>
          <button @click="handleSaveAiConfig" class="jira-btn jira-btn-primary">💾 保存 AI 配置</button>
        </div>
      </div>

      <!-- 手动填写 -->
      <div v-if="activeTab === 'manual'" class="jira-manual">
        <div class="jira-section">
          <h3 class="jira-section-title">✍️ 记录工作日志</h3>
          <div class="jira-form-group">
            <label>问题编号</label>
            <select v-model="newWorklog.issueKey">
              <option value="">选择问题...</option>
              <option v-for="(issue, i) in unfinishedIssues" :key="i" :value="issue.key">{{ issue.key }} - {{ issue.summary }}</option>
            </select>
          </div>
          <div class="jira-form-group">
            <label>工作时长（小时）</label>
            <input type="number" step="0.5" min="0.5" max="24" v-model.number="newWorklog.timeSpent" />
          </div>
          <div class="jira-form-group">
            <label>工作说明</label>
            <textarea v-model="newWorklog.comment" placeholder="描述今天的工作内容..." />
          </div>
          <button @click="handleNewWorklogSubmit" class="jira-btn jira-btn-primary">📝 记录工作时间</button>
        </div>

        <div class="jira-section">
          <h3 class="jira-section-title">📋 当日工作日志列表</h3>
          <table v-if="todayWorklogs.length > 0" class="jira-table">
            <thead><tr><th>问题编号</th><th>工时</th><th>说明</th><th>开始时间</th></tr></thead>
            <tbody>
              <tr v-for="(wl, i) in todayWorklogs" :key="i">
                <td><span class="jira-issue-key">{{ wl.issue_key }}</span></td>
                <td><span class="jira-time-badge">{{ wl.time_spent_hours }}h</span></td>
                <td class="jira-table-comment">{{ wl.comment }}</td>
                <td class="jira-table-time">{{ new Date(wl.started).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="jira-empty-text">今日暂无工作日志</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jira-container {
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: row;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
  overflow: hidden;
  background: #f0f2f5;
}
.jira-sidebar {
  width: 210px;
  min-width: 210px;
  background: rgba(26, 32, 44, 0.92);
  backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
}
.jira-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: move;
  flex-shrink: 0;
}
.jira-sidebar-title {
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.5px;
}
.jira-close-btn {
  width: 28px; height: 28px;
  border: none; border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}
.jira-close-btn:hover {
  background: rgba(239, 68, 68, 0.3);
  color: rgba(255, 255, 255, 0.9);
}
.jira-sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.jira-sidebar-list::-webkit-scrollbar { width: 4px; }
.jira-sidebar-list::-webkit-scrollbar-track { background: transparent; }
.jira-sidebar-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 2px; }
.jira-date-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 10px;
  margin-bottom: 2px;
  border: none; border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  position: relative;
}
.jira-date-item:hover { background: rgba(255, 255, 255, 0.06); color: rgba(255, 255, 255, 0.85); }
.jira-date-item.selected { background: rgba(102, 126, 234, 0.25); color: #a5b4fc; font-weight: 600; }
.jira-date-item.today { color: rgba(255, 255, 255, 0.85); }
.jira-date-item.today.selected { color: #c7d2fe; }
.jira-date-item.weekend { opacity: 0.5; }
.jira-date-item.weekend:hover { opacity: 0.7; }
.jira-date-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jira-date-today-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #667eea;
  flex-shrink: 0;
}
.jira-sidebar-nav {
  display: flex;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.2);
  flex-shrink: 0;
}
.jira-nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}
.jira-nav-item:hover { color: rgba(255, 255, 255, 0.75); background: rgba(255, 255, 255, 0.05); }
.jira-nav-item.active { color: #667eea; }
.jira-nav-item.active::after {
  content: '';
  position: absolute;
  top: 0; left: 20%; right: 20%;
  height: 2px;
  background: #667eea;
  border-radius: 0 0 2px 2px;
}
.jira-nav-icon { font-size: 15px; line-height: 1; }
.jira-nav-label { font-size: 10px; font-weight: 500; letter-spacing: 0.3px; }
.jira-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-y: auto;
  background: #f0f2f5;
}
.jira-main::-webkit-scrollbar { width: 6px; }
.jira-main::-webkit-scrollbar-track { background: transparent; }
.jira-main::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.12); border-radius: 3px; }
.jira-dashboard, .jira-history, .jira-config-panel, .jira-manual { padding: 20px 24px; flex: 1; }
.jira-loading-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  background: rgba(102, 126, 234, 0.08);
  color: #667eea;
  font-size: 13px;
  font-weight: 500;
  border-bottom: 1px solid rgba(102, 126, 234, 0.15);
}
.jira-spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(102, 126, 234, 0.2);
  border-top-color: #667eea;
  border-radius: 50%;
  animation: jira-spin 0.8s linear infinite;
}
@keyframes jira-spin { to { transform: rotate(360deg); } }
.jira-loading-inline { text-align: center; padding: 20px; color: #667eea; font-size: 14px; }
.jira-summary-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.jira-summary-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
  transition: box-shadow 0.2s;
}
.jira-summary-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.jira-card-icon { font-size: 28px; flex-shrink: 0; }
.jira-card-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.jira-card-label { font-size: 11px; color: #8b8fa3; font-weight: 500; }
.jira-card-value { font-size: 16px; font-weight: 700; color: #1a1f36; }
.jira-progress-bar { width: 100%; height: 5px; background: #e8eaf0; border-radius: 3px; margin-top: 4px; overflow: hidden; }
.jira-progress-fill { height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); border-radius: 3px; transition: width 0.4s; }
.jira-section {
  background: #fff;
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
}
.jira-section-title {
  font-size: 15px;
  font-weight: 700;
  color: #1a1f36;
  margin: 0 0 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f0f1f5;
}
.jira-section-desc { font-size: 12px; color: #8b8fa3; margin: -8px 0 14px; }
.jira-empty-text { color: #b0b4c0; font-size: 13px; text-align: center; padding: 24px 0; }
.jira-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.jira-table thead th {
  text-align: left; padding: 8px 10px;
  background: #f8f9fc; color: #6b7085;
  font-weight: 600; font-size: 11px;
  text-transform: uppercase; letter-spacing: 0.5px;
  border-bottom: 1px solid #e8eaf0;
}
.jira-table tbody td { padding: 8px 10px; border-bottom: 1px solid #f0f1f5; color: #3c3f51; vertical-align: middle; }
.jira-table tbody tr:hover { background: #f8f9fc; }
.jira-table tbody tr:last-child td { border-bottom: none; }
.jira-table-comment { max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jira-table-time { color: #8b8fa3; font-size: 11px; white-space: nowrap; }
.jira-table-repo { color: #8b8fa3; font-size: 11px; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jira-table-actions { white-space: nowrap; display: flex; gap: 4px; }
.jira-issue-key {
  display: inline-block; padding: 2px 7px;
  background: #eef2ff; color: #4f46e5;
  border-radius: 4px; font-size: 11px; font-weight: 600;
  font-family: 'SF Mono', 'Consolas', monospace;
}
.jira-time-badge {
  display: inline-block; padding: 2px 7px;
  background: #fef3c7; color: #b45309;
  border-radius: 4px; font-size: 11px; font-weight: 600;
}
.jira-commit-id {
  display: inline-block; padding: 2px 7px;
  background: #f0fdf4; color: #166534;
  border-radius: 4px; font-size: 11px; font-weight: 600;
  font-family: 'SF Mono', 'Consolas', monospace;
}
.jira-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 8px 16px; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all 0.2s;
}
.jira-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.jira-btn-primary { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; }
.jira-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102,126,234,0.35); }
.jira-btn-outline { background: #fff; color: #667eea; border: 1px solid #d4d8e8; }
.jira-btn-outline:hover { background: #f8f9fc; border-color: #667eea; }
.jira-btn-success { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; }
.jira-btn-success:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(34,197,94,0.35); }
.jira-btn-danger { background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; }
.jira-btn-danger:hover { background: #fef2f2; border-color: #ef4444; }
.jira-btn-sm {
  padding: 4px 10px; font-size: 11px; border-radius: 6px;
  border: 1px solid #d4d8e8; background: #fff;
  color: #6b7085; cursor: pointer; transition: all 0.15s;
}
.jira-btn-sm:hover { background: #f0f1f5; border-color: #667eea; color: #667eea; }
.jira-btn-row { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.jira-config-card {
  background: #fff; border-radius: 12px;
  padding: 20px 22px; margin-bottom: 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  border: 1px solid rgba(0,0,0,0.04);
}
.jira-config-card h3 {
  font-size: 15px; font-weight: 700; color: #1a1f36;
  margin: 0 0 14px; padding-bottom: 10px;
  border-bottom: 1px solid #f0f1f5;
}
.jira-config-card h4 { font-size: 13px; font-weight: 600; color: #3c3f51; margin: 16px 0 10px; }
.jira-form-group { margin-bottom: 12px; }
.jira-form-group label { display: block; font-size: 12px; font-weight: 600; color: #6b7085; margin-bottom: 4px; }
.jira-form-group input, .jira-form-group select, .jira-form-group textarea {
  width: 100%; padding: 8px 12px;
  border: 1px solid #d4d8e8; border-radius: 8px;
  font-size: 13px; color: #1a1f36; background: #fff;
  transition: border-color 0.2s; box-sizing: border-box; font-family: inherit;
}
.jira-form-group input:focus, .jira-form-group select:focus, .jira-form-group textarea:focus {
  outline: none; border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102,126,234,0.1);
}
.jira-form-group textarea { min-height: 80px; resize: vertical; }
.jira-repo-config {
  background: #f8f9fc; border-radius: 10px;
  padding: 14px; margin-bottom: 10px;
  border: 1px solid #e8eaf0;
}
.jira-repo-index { font-size: 12px; font-weight: 700; color: #667eea; display: block; margin-bottom: 8px; }
.jira-ai-select { margin-bottom: 14px; }
.jira-ai-select-header {
  display: flex; align-items: center;
  justify-content: space-between; margin-bottom: 8px;
}
.jira-ai-select-header span { font-size: 13px; font-weight: 600; color: #3c3f51; }
.jira-checkbox-list {
  display: flex; flex-direction: column; gap: 4px;
  max-height: 180px; overflow-y: auto; padding: 4px 0;
  background: #f8f9fc; border-radius: 8px;
  border: 1px solid #e8eaf0;
}
.jira-checkbox-list::-webkit-scrollbar { width: 4px; }
.jira-checkbox-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 2px; }
.jira-checkbox-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer; font-size: 12px;
  color: #3c3f51; transition: background 0.1s;
}
.jira-checkbox-item:hover { background: rgba(102,126,234,0.06); }
.jira-checkbox-item input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; accent-color: #667eea; flex-shrink: 0; }
.jira-checkbox-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.jira-ai-hours { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; font-size: 13px; font-weight: 600; color: #3c3f51; }
.jira-ai-hours-input { display: flex; align-items: center; gap: 8px; }
.jira-ai-hours-input input[type="range"] { width: 120px; accent-color: #667eea; }
.jira-hours-num { width: 55px; padding: 4px 8px; border: 1px solid #d4d8e8; border-radius: 6px; text-align: center; font-size: 13px; font-weight: 600; color: #1a1f36; }
.jira-hours-num:focus { outline: none; border-color: #667eea; }
.jira-ai-result { margin-top: 14px; padding: 16px; background: #f8f9fc; border-radius: 10px; border: 1px solid #e8eaf0; }
.jira-ai-result h4 { font-size: 13px; font-weight: 700; color: #1a1f36; margin: 0 0 8px; }
.jira-ai-result pre { font-size: 12px; color: #3c3f51; white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; }
.jira-ai-suggestions { margin-top: 12px; padding-top: 12px; border-top: 1px solid #e8eaf0; }
.jira-ai-suggestions p { font-size: 12px; color: #6b7085; margin: 0 0 8px; }
.jira-ai-suggestions ul { list-style: none; padding: 0; margin: 0 0 12px; }
.jira-ai-suggestions li { font-size: 12px; color: #3c3f51; padding: 4px 0; }
.jira-history-date-select { margin-bottom: 14px; }
.jira-history-date-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: #3c3f51; }
.jira-history-checkboxes { max-height: 200px; }
.jira-history-results { margin-top: 16px; }
.jira-history-summary-bar {
  padding: 10px 14px;
  background: linear-gradient(135deg, #eef2ff, #faf5ff);
  border-radius: 8px; font-size: 13px; font-weight: 600;
  color: #4f46e5; margin-bottom: 14px;
}
.jira-history-day { margin-bottom: 14px; }
.jira-history-day-title { font-size: 13px; font-weight: 700; color: #1a1f36; margin: 0 0 8px; }
.jira-ai-section { border: 1px solid rgba(102,126,234,0.12); }
.jira-spinner-inline {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff; border-radius: 50%;
  animation: jira-spin 0.8s linear infinite;
  vertical-align: middle; margin-right: 4px;
}
.jira-ai-generating-hint {
  margin-top: 10px; padding: 8px 14px;
  background: #fffbeb; border: 1px solid #fde68a;
  border-radius: 8px; color: #92400e; font-size: 12px;
  text-align: center; animation: jira-pulse 1.5s ease-in-out infinite;
}
@keyframes jira-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
.jira-btn-icon {
  width: 26px; height: 26px; border: none; border-radius: 5px;
  background: transparent; cursor: pointer; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.jira-btn-icon:hover { background: #f0f1f5; transform: scale(1.1); }
.jira-btn-delete:hover { background: #fef2f2; }
.jira-btn-edit:hover { background: #eff6ff; }
.jira-btn-save:hover { background: #ecfdf5; }
.jira-btn-cancel:hover { background: #fef2f2; }
.jira-editing-row { background: #fffbeb !important; }
.jira-edit-input {
  padding: 4px 8px; border: 1px solid #d4d8e8; border-radius: 6px;
  font-size: 12px; color: #1a1f36; background: #fff;
  font-family: inherit; transition: border-color 0.2s;
}
.jira-edit-input:focus { outline: none; border-color: #667eea; box-shadow: 0 0 0 2px rgba(102,126,234,0.1); }
.jira-edit-hours { width: 60px; text-align: center; }
.jira-edit-comment { width: 180px; }
</style>
