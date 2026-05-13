<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LunarCalendar } from "../utils/lunarUtils";

interface HealthRecord { date: string; morningWeight?: number; eveningWeight?: number; note?: string; }
interface TrainingItem { id: string; name: string; completed: boolean; sets?: number; reps?: number; weight?: number; notes?: string; created_at: number; }
interface Subtask { id: string; content: string; completed: boolean; }
interface LearningItem { id: string; title: string; subtasks: Subtask[]; completed: boolean; created_at: number; }
interface LongTermPlan { id: string; planType: "Health" | "Learning"; startDate: string; endDate: string; targetDesc: string; planContent: string; createdAt: number; applied: boolean; }
interface AIMessage { role: "user" | "assistant"; content: string; }

const formatDateStr = (date: Date): string => {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const generateUUID = (): string => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); });

const CHINA_HOLIDAYS: Record<string, string> = {
  '01-01': '元旦', '02-14': '情人节', '03-08': '妇女节', '04-05': '清明节', '05-01': '劳动节',
  '06-01': '儿童节', '07-01': '建党节', '08-01': '建军节', '09-10': '教师节', '10-01': '国庆节', '12-25': '圣诞节',
};

const selectedDate = ref(new Date());
const activeTab = ref("calendar");
const weightInput = ref({ morning: "", evening: "" });
const trainingItems = ref<TrainingItem[]>([]);
const showAddTraining = ref(false);
const newTraining = ref({ name: "", sets: "", reps: "", weight: "" });
const learningItems = ref<LearningItem[]>([]);
const showAddLearning = ref(false);
const newLearning = ref({ title: "", subtaskInput: "", subtasks: [] as string[] });
const longTermPlans = ref<LongTermPlan[]>([]);
const showCreatePlan = ref(false);
const newPlan = ref({ planType: "Health" as "Health" | "Learning", startDate: "", endDate: "", targetDesc: "" });
const planGenerating = ref(false);
const planApplying = ref<string | null>(null);
const aiOpen = ref(false);
const aiType = ref<"health" | "learning">("health");
const aiMessages = ref<AIMessage[]>([]);
const aiLoading = ref(false);
const aiInput = ref("");

let unlisteners: UnlistenFn[] = [];

const generateDateList = () => {
  const dates: { date: Date; isToday: boolean; formatted: string; dateStr: string; weekday: string; festival?: string }[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let i = -15; i <= 15; i++) {
    const date = new Date(today); date.setDate(today.getDate() + i);
    const isToday = date.toDateString() === today.toDateString();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const weekday = weekdays[date.getDay()];
    const mmdd = `${month}-${day}`;
    const festival = CHINA_HOLIDAYS[mmdd] || LunarCalendar.getSolarTerm(date) || undefined;
    dates.push({ date, isToday, formatted: `${month}-${day}`, dateStr: formatDateStr(date), weekday, festival });
  }
  return dates;
};

const loadHealthData = async (dateStr: string) => {
  try { const record = await invoke<HealthRecord>('get_daily_health_data', { date: dateStr }); weightInput.value = { morning: record.morningWeight?.toString() || "", evening: record.eveningWeight?.toString() || "" }; }
  catch (e) { console.error('加载健康数据失败:', e); }
};
const loadTrainingData = async (dateStr: string) => {
  try { trainingItems.value = (await invoke<TrainingItem[]>('get_daily_training_data', { date: dateStr })) || []; }
  catch (e) { console.error('加载训练数据失败:', e); }
};
const loadLearningData = async (dateStr: string) => {
  try { learningItems.value = (await invoke<LearningItem[]>('get_daily_learning_data', { date: dateStr })) || []; }
  catch (e) { console.error('加载学习数据失败:', e); }
};
const loadLongTermPlans = async () => {
  try { longTermPlans.value = (await invoke<LongTermPlan[]>('get_long_term_plans')) || []; }
  catch (e) { console.error('加载长期规划失败:', e); }
};
const loadAllData = async () => {
  const dateStr = formatDateStr(selectedDate.value);
  await Promise.all([loadHealthData(dateStr), loadTrainingData(dateStr), loadLearningData(dateStr), loadLongTermPlans()]);
};

const saveWeight = async () => {
  try { await invoke('save_health_record', { record: { date: formatDateStr(selectedDate.value), morningWeight: weightInput.value.morning ? parseFloat(weightInput.value.morning) : undefined, eveningWeight: weightInput.value.evening ? parseFloat(weightInput.value.evening) : undefined } }); }
  catch (e) { alert('保存体重失败: ' + e); }
};
const toggleTrainingComplete = async (item: TrainingItem) => {
  trainingItems.value = trainingItems.value.map((t: TrainingItem) => t.id === item.id ? { ...t, completed: !t.completed } : t);
  try { await invoke('save_training_items', { date: formatDateStr(selectedDate.value), items: trainingItems.value }); } catch (e) { console.error(e); }
};
const addTrainingItem = async () => {
  if (!newTraining.value.name.trim()) return;
  const item: TrainingItem = { id: generateUUID(), name: newTraining.value.name.trim(), completed: false, sets: newTraining.value.sets ? parseInt(newTraining.value.sets) : undefined, reps: newTraining.value.reps ? parseInt(newTraining.value.reps) : undefined, weight: newTraining.value.weight ? parseFloat(newTraining.value.weight) : undefined, created_at: Date.now() };
  trainingItems.value = [...trainingItems.value, item];
  try { await invoke('save_training_items', { date: formatDateStr(selectedDate.value), items: trainingItems.value }); } catch (e) { console.error(e); }
  newTraining.value = { name: "", sets: "", reps: "", weight: "" }; showAddTraining.value = false;
};
const deleteTrainingItem = async (id: string) => {
  trainingItems.value = trainingItems.value.filter((t: TrainingItem) => t.id !== id);
  try { await invoke('save_training_items', { date: formatDateStr(selectedDate.value), items: trainingItems.value }); } catch (e) { console.error(e); }
};
const toggleLearningComplete = async (item: LearningItem) => {
  learningItems.value = learningItems.value.map((l: LearningItem) => l.id === item.id ? { ...l, completed: !l.completed } : l);
  try { await invoke('save_learning_items', { date: formatDateStr(selectedDate.value), items: learningItems.value }); } catch (e) { console.error(e); }
};
const toggleSubtask = async (itemId: string, subtaskId: string) => {
  learningItems.value = learningItems.value.map((l: LearningItem) => {
    if (l.id !== itemId) return l;
    return { ...l, subtasks: l.subtasks.map((s: Subtask) => s.id === subtaskId ? { ...s, completed: !s.completed } : s) };
  });
  try { await invoke('save_learning_items', { date: formatDateStr(selectedDate.value), items: learningItems.value }); } catch (e) { console.error(e); }
};
const addLearningItem = async () => {
  if (!newLearning.value.title.trim()) return;
  const subtasks: Subtask[] = newLearning.value.subtasks.filter((s: string) => s.trim()).map((s: string) => ({ id: generateUUID(), content: s.trim(), completed: false }));
  const item: LearningItem = { id: generateUUID(), title: newLearning.value.title.trim(), subtasks, completed: false, created_at: Date.now() };
  learningItems.value = [...learningItems.value, item];
  try { await invoke('save_learning_items', { date: formatDateStr(selectedDate.value), items: learningItems.value }); } catch (e) { console.error(e); }
  newLearning.value = { title: "", subtaskInput: "", subtasks: [] }; showAddLearning.value = false;
};
const deleteLearningItem = async (id: string) => {
  learningItems.value = learningItems.value.filter((l: LearningItem) => l.id !== id);
  try { await invoke('save_learning_items', { date: formatDateStr(selectedDate.value), items: learningItems.value }); } catch (e) { console.error(e); }
};
const addSubtaskToNew = () => {
  if (newLearning.value.subtaskInput.trim()) { newLearning.value.subtasks = [...newLearning.value.subtasks, newLearning.value.subtaskInput.trim()]; newLearning.value.subtaskInput = ""; }
};

const openAiChat = (type: "health" | "learning") => {
  aiType.value = type; aiOpen.value = true;
  const defaultPrompt = type === "health" ? "请帮我规划今日锻炼计划，包括具体的训练项目和饮食建议。" : "请帮我拆解今日学习任务，制定详细的学习计划。";
  aiMessages.value = [{ role: "user", content: defaultPrompt }]; aiInput.value = "";
  sendAiMessage(defaultPrompt, type);
};
const sendAiMessage = async (message?: string, forceType?: string) => {
  const msg = message || aiInput.value.trim();
  if (!msg) return;
  const type = forceType || aiType.value;
  if (!message) { aiMessages.value = [...aiMessages.value, { role: "user", content: msg }]; aiInput.value = ""; }
  aiLoading.value = true;
  try { await invoke('ai_calendar_plan_stream', { planType: type, userPrompt: msg }); }
  catch (e) { aiLoading.value = false; aiMessages.value = [...aiMessages.value, { role: 'assistant', content: `❌ ${e}` }]; }
};
const closeAiChat = () => { aiOpen.value = false; aiMessages.value = []; aiLoading.value = false; };

const createLongTermPlan = async () => {
  if (!newPlan.value.startDate || !newPlan.value.endDate || !newPlan.value.targetDesc.trim()) { alert('请填写完整的计划信息'); return; }
  planGenerating.value = true;
  try {
    const planContent = await invoke<string>('send_chat_message', {
      messages: [
        { role: "system", content: `你是一个${newPlan.value.planType === 'Health' ? '健身教练和营养师' : '学习规划师'}。请根据用户的描述，制定一个从${newPlan.value.startDate}到${newPlan.value.endDate}的详细计划。用中文回复。` },
        { role: "user", content: newPlan.value.targetDesc },
      ],
    });
    await invoke('save_long_term_plan', { plan: { id: generateUUID(), planType: newPlan.value.planType, startDate: newPlan.value.startDate, endDate: newPlan.value.endDate, targetDesc: newPlan.value.targetDesc.trim(), planContent, createdAt: Date.now(), applied: false } });
    await loadLongTermPlans();
    showCreatePlan.value = false;
    newPlan.value = { planType: "Health", startDate: "", endDate: "", targetDesc: "" };
  } catch (e) { alert('创建计划失败: ' + e); }
  finally { planGenerating.value = false; }
};
const applyPlan = async (plan: LongTermPlan) => {
  if (!confirm(`确认将 "${plan.targetDesc}" 拆解并应用到每日计划？\n\nAI将自动分配从 ${plan.startDate} 到 ${plan.endDate} 的每日任务。`)) return;
  planApplying.value = plan.id;
  try { await invoke('ai_apply_long_term_plan', { plan }); alert('✅ 长期计划已成功拆解到每日！'); await loadLongTermPlans(); await loadAllData(); }
  catch (e) { alert('应用计划失败: ' + e); }
  finally { planApplying.value = null; }
};
const deletePlan = async (id: string) => {
  if (!confirm('确认删除此计划？')) return;
  try { await invoke('delete_long_term_plan', { id }); await loadLongTermPlans(); }
  catch (e) { alert('删除失败: ' + e); }
};
const closeWindow = async () => { try { await getCurrentWindow().close(); } catch (error) { console.error('关闭窗口失败:', error); } };
const handleDateSelect = (date: Date) => { selectedDate.value = date; };

onMounted(async () => {
  await loadAllData();

  // AI stream listeners
  const t = await listen<{ token: string; planType: string }>('calendar-ai://stream-token', (event) => {
    const { token, planType } = event.payload;
    if ((planType === 'health' && aiType.value === 'health') || (planType === 'learning' && aiType.value === 'learning')) {
      const msgs = [...aiMessages.value];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') { last.content += token; aiMessages.value = msgs; }
      else { aiMessages.value = [...msgs, { role: 'assistant', content: token }]; }
    }
  });
  unlisteners.push(t);
  const d = await listen<{ content: string; planType: string }>('calendar-ai://stream-done', () => { aiLoading.value = false; });
  unlisteners.push(d);
  const err = await listen<{ error: string }>('calendar-ai://stream-error', (event) => { aiLoading.value = false; aiMessages.value = [...aiMessages.value, { role: 'assistant', content: `❌ ${event.payload.error}` }]; });
  unlisteners.push(err);
});

onUnmounted(() => { unlisteners.forEach(fn => fn()); });
</script>

<template>
  <div class="calendar-container">
    <!-- Sidebar -->
    <div class="calendar-sidebar">
      <div class="calendar-sidebar-header" data-tauri-drag-region>
        <span class="calendar-sidebar-title">📅 智能日历</span>
        <button class="calendar-close-btn" @click="closeWindow">✕</button>
      </div>
      <div class="calendar-sidebar-list">
        <button v-for="(dateInfo, index) in generateDateList()" :key="index"
          :class="['calendar-date-item', { today: dateInfo.isToday, selected: dateInfo.date.toDateString() === selectedDate.toDateString(), weekend: dateInfo.date.getDay() === 0 || dateInfo.date.getDay() === 6, holiday: !!dateInfo.festival }]"
          @click="handleDateSelect(dateInfo.date)">
          <span class="calendar-date-label">
            <span class="calendar-date-day">{{ dateInfo.formatted }}</span>
            <span class="calendar-date-weekday">{{ dateInfo.weekday }}</span>
            <span v-if="dateInfo.festival" class="calendar-date-festival">{{ dateInfo.festival }}</span>
          </span>
          <span class="calendar-date-badges">
            <span v-if="dateInfo.isToday" class="calendar-date-today-dot"></span>
            <span v-if="dateInfo.festival" class="calendar-date-holiday-dot"></span>
          </span>
        </button>
      </div>
      <div class="calendar-sidebar-nav">
        <button :class="['calendar-nav-item', { active: activeTab === 'calendar' }]" @click="activeTab = 'calendar'">
          <span class="calendar-nav-icon">📅</span><span class="calendar-nav-label">日历</span>
        </button>
        <button :class="['calendar-nav-item', { active: activeTab === 'long-term' }]" @click="activeTab = 'long-term'">
          <span class="calendar-nav-icon">📋</span><span class="calendar-nav-label">长期规划</span>
        </button>
      </div>
    </div>

    <!-- Main -->
    <div class="calendar-main">
      <!-- Calendar Tab -->
      <div v-if="activeTab === 'calendar'" class="calendar-main-content">
        <!-- Health Board -->
        <div class="calendar-board">
          <div class="calendar-board-header">
            <div class="calendar-board-title"><span class="board-icon">💪</span><span>健康 & 锻炼</span></div>
            <button class="calendar-board-ai-btn" @click="openAiChat('health')">🤖 AI 规划</button>
          </div>
          <div class="calendar-board-body">
            <div class="health-weight-card">
              <div class="weight-entry">
                <span class="weight-label">🌅 晨重</span>
                <div class="weight-input-group">
                  <input type="number" v-model.number="weightInput.morning" placeholder="--" step="0.1" />
                  <span class="weight-unit">kg</span>
                </div>
              </div>
              <div class="weight-entry">
                <span class="weight-label">🌙 晚重</span>
                <div class="weight-input-group">
                  <input type="number" v-model.number="weightInput.evening" placeholder="--" step="0.1" />
                  <span class="weight-unit">kg</span>
                </div>
              </div>
              <button class="weight-save-btn" @click="saveWeight">保存</button>
            </div>
            <div class="training-list">
              <div v-for="item in trainingItems" :key="item.id" :class="['training-item', { completed: item.completed }]">
                <input type="checkbox" :checked="item.completed" @change="toggleTrainingComplete(item)" />
                <div class="training-item-info">
                  <span class="training-item-name">{{ item.name }}</span>
                  <span class="training-item-details">
                    <span v-if="item.sets">{{ item.sets }}组</span>
                    <span v-if="item.reps">{{ item.reps }}次</span>
                    <span v-if="item.weight">{{ item.weight }}kg</span>
                  </span>
                </div>
                <button class="training-item-delete" @click="deleteTrainingItem(item.id)">✕</button>
              </div>
            </div>
            <div v-if="showAddTraining" class="add-training-form">
              <input type="text" v-model="newTraining.name" placeholder="训练项目名称" />
              <div class="add-training-row">
                <input type="number" v-model="newTraining.sets" placeholder="组数" />
                <input type="number" v-model="newTraining.reps" placeholder="次数" />
                <input type="number" v-model="newTraining.weight" placeholder="重量(kg)" step="0.5" />
              </div>
              <div class="add-training-actions">
                <button class="cancel-training-btn" @click="showAddTraining = false">取消</button>
                <button class="add-training-btn" @click="addTrainingItem">添加</button>
              </div>
            </div>
            <button v-else class="show-add-btn" @click="showAddTraining = true">+ 添加训练项目</button>
            <div v-if="trainingItems.length === 0 && !showAddTraining" class="calendar-empty">暂无训练项目，点击上方添加</div>
          </div>
        </div>

        <!-- Learning Board -->
        <div class="calendar-board">
          <div class="calendar-board-header">
            <div class="calendar-board-title"><span class="board-icon">📚</span><span>学习 & 任务</span></div>
            <button class="calendar-board-ai-btn" @click="openAiChat('learning')">🤖 AI 拆解</button>
          </div>
          <div class="calendar-board-body">
            <div class="learning-list">
              <div v-for="item in learningItems" :key="item.id" :class="['learning-item', { completed: item.completed }]">
                <div class="learning-item-header">
                  <input type="checkbox" :checked="item.completed" @change="toggleLearningComplete(item)" />
                  <span class="learning-item-title">{{ item.title }}</span>
                  <button class="learning-item-delete" @click="deleteLearningItem(item.id)">✕</button>
                </div>
                <div v-if="item.subtasks.length > 0" class="learning-subtasks">
                  <label v-for="sub in item.subtasks" :key="sub.id" :class="['learning-subtask', { completed: sub.completed }]">
                    <input type="checkbox" :checked="sub.completed" @change="toggleSubtask(item.id, sub.id)" />
                    <span>{{ sub.content }}</span>
                  </label>
                </div>
              </div>
            </div>
            <div v-if="showAddLearning" class="add-learning-form">
              <input type="text" v-model="newLearning.title" placeholder="学习目标标题" />
              <div class="add-learning-row">
                <input type="text" v-model="newLearning.subtaskInput" @keydown.enter.prevent="addSubtaskToNew" placeholder="添加子任务" />
                <button class="add-training-btn" @click="addSubtaskToNew">+</button>
              </div>
              <div v-if="newLearning.subtasks.length > 0" class="subtask-tags">
                <span v-for="(s, i) in newLearning.subtasks" :key="i" class="subtask-tag">
                  {{ s }}
                  <button @click="newLearning.subtasks = newLearning.subtasks.filter((_: string, j: number) => j !== i)">✕</button>
                </span>
              </div>
              <div class="add-learning-actions">
                <button class="cancel-training-btn" @click="showAddLearning = false; newLearning = { title: '', subtaskInput: '', subtasks: [] }">取消</button>
                <button class="add-learning-btn" @click="addLearningItem">添加</button>
              </div>
            </div>
            <button v-else class="show-add-btn" @click="showAddLearning = true">+ 添加学习目标</button>
            <div v-if="learningItems.length === 0 && !showAddLearning" class="calendar-empty">暂无学习目标，点击上方添加</div>
          </div>
        </div>

        <!-- AI Chat Panel -->
        <div v-if="aiOpen" class="ai-chat-panel">
          <div class="ai-chat-messages">
            <div v-for="(msg, i) in aiMessages" :key="i" :class="['ai-chat-msg', msg.role]">{{ msg.content }}</div>
            <div v-if="aiLoading" class="ai-generating-hint">🤖 AI 正在生成{{ aiType === 'health' ? '健康' : '学习' }}计划...</div>
          </div>
          <div class="ai-chat-input-row">
            <input type="text" v-model="aiInput" @keydown.enter.prevent="sendAiMessage()" placeholder="输入你的需求..." :disabled="aiLoading" />
            <button class="ai-chat-send-btn" @click="sendAiMessage()" :disabled="aiLoading">发送</button>
            <button class="ai-chat-close-btn" @click="closeAiChat">关闭</button>
          </div>
        </div>
      </div>

      <!-- Long Term Plans Tab -->
      <div v-if="activeTab === 'long-term'" class="long-term-panel">
        <div class="long-term-header">
          <h3>📋 长期规划</h3>
          <button class="create-plan-btn" @click="showCreatePlan = !showCreatePlan">{{ showCreatePlan ? '取消' : '＋ 新建计划' }}</button>
        </div>

        <div v-if="showCreatePlan" class="create-plan-form">
          <h4>创建新计划</h4>
          <div class="plan-type-selector">
            <button :class="['plan-type-btn', { selected: newPlan.planType === 'Health' }]" @click="newPlan.planType = 'Health'">💪 健康/锻炼</button>
            <button :class="['plan-type-btn', { selected: newPlan.planType === 'Learning' }]" @click="newPlan.planType = 'Learning'">📚 学习</button>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>开始日期</label>
              <input type="date" v-model="newPlan.startDate" />
            </div>
            <div class="form-group">
              <label>结束日期</label>
              <input type="date" v-model="newPlan.endDate" />
            </div>
          </div>
          <div class="form-group">
            <label>目标描述</label>
            <textarea v-model="newPlan.targetDesc"
              :placeholder="newPlan.planType === 'Health' ? '例如：减重5kg，每周锻炼4次，每天摄入1800卡路里...' : '例如：3个月内完成《算法导论》学习，每天学习2小时...'"></textarea>
          </div>
          <div class="form-actions">
            <button class="form-cancel-btn" @click="showCreatePlan = false">取消</button>
            <button class="form-submit-btn" @click="createLongTermPlan" :disabled="planGenerating">{{ planGenerating ? '🤖 AI生成中...' : '🤖 AI 生成计划' }}</button>
          </div>
        </div>

        <div class="plan-list">
          <div v-if="longTermPlans.length === 0" class="calendar-empty">暂无长期计划，点击上方"新建计划"开始</div>
          <div v-for="plan in longTermPlans" :key="plan.id" class="plan-card">
            <div class="plan-card-header">
              <span :class="['plan-card-type', plan.planType.toLowerCase()]">{{ plan.planType === 'Health' ? '💪 健康/锻炼' : '📚 学习' }}</span>
              <span v-if="plan.applied" class="plan-card-applied">✅ 已应用</span>
            </div>
            <div class="plan-card-date">📅 {{ plan.startDate }} → {{ plan.endDate }}</div>
            <div class="plan-card-target">{{ plan.targetDesc }}</div>
            <div class="plan-card-content">{{ plan.planContent }}</div>
            <div class="plan-card-actions">
              <button class="plan-delete-btn" @click="deletePlan(plan.id)">删除</button>
              <button v-if="!plan.applied" class="plan-apply-btn" @click="applyPlan(plan)" :disabled="planApplying === plan.id">
                {{ planApplying === plan.id ? '⏳ 拆解中...' : '🚀 应用到每日' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-container { display: flex; height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; background: #f8f9fa; }
.calendar-sidebar { width: 200px; min-width: 200px; background: white; border-right: 1px solid #e5e7eb; display: flex; flex-direction: column; }
.calendar-sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: move; border-bottom: 1px solid #e5e7eb; }
.calendar-sidebar-title { font-weight: 600; font-size: 14px; }
.calendar-close-btn { background: none; border: none; cursor: pointer; font-size: 16px; color: #9ca3af; }
.calendar-sidebar-list { flex: 1; overflow-y: auto; padding: 8px; }
.calendar-date-item { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 8px 12px; border: none; background: none; border-radius: 8px; cursor: pointer; text-align: left; margin-bottom: 2px; font-size: 13px; }
.calendar-date-item:hover { background: #f3f4f6; }
.calendar-date-item.today { background: #eff6ff; }
.calendar-date-item.selected { background: #dbeafe; outline: 2px solid #3b82f6; }
.calendar-date-item.weekend .calendar-date-weekday { color: #ef4444; }
.calendar-date-item.holiday .calendar-date-festival { color: #ef4444; font-size: 10px; }
.calendar-date-label { display: flex; align-items: center; gap: 6px; }
.calendar-date-day { font-weight: 500; }
.calendar-date-weekday { color: #9ca3af; font-size: 11px; }
.calendar-date-festival { font-size: 10px; color: #ef4444; background: #fef2f2; padding: 1px 4px; border-radius: 3px; }
.calendar-date-badges { display: flex; gap: 4px; }
.calendar-date-today-dot { width: 6px; height: 6px; background: #3b82f6; border-radius: 50%; }
.calendar-date-holiday-dot { width: 6px; height: 6px; background: #ef4444; border-radius: 50%; }
.calendar-sidebar-nav { display: flex; border-top: 1px solid #e5e7eb; }
.calendar-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px; border: none; background: none; cursor: pointer; font-size: 10px; color: #6b7280; }
.calendar-nav-item.active { color: #3b82f6; background: #eff6ff; }
.calendar-nav-icon { font-size: 16px; }
.calendar-main { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
.calendar-main-content { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 12px; overflow-y: auto; }
.calendar-board { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.calendar-board-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #f3f4f6; }
.calendar-board-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; }
.calendar-board-ai-btn { background: #f3f4f6; border: none; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.calendar-board-ai-btn:hover { background: #e5e7eb; }
.calendar-board-body { padding: 12px 16px; }
.health-weight-card { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.weight-entry { display: flex; align-items: center; gap: 6px; }
.weight-label { font-size: 13px; color: #6b7280; }
.weight-input-group { display: flex; align-items: center; gap: 2px; }
.weight-input-group input { width: 60px; padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; text-align: center; }
.weight-unit { font-size: 12px; color: #9ca3af; }
.weight-save-btn { background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 12px; }
.training-list { margin-bottom: 8px; }
.training-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; }
.training-item:hover { background: #f9fafb; }
.training-item.completed .training-item-name { text-decoration: line-through; color: #9ca3af; }
.training-item-info { flex: 1; }
.training-item-name { font-size: 13px; }
.training-item-details { display: flex; gap: 4px; margin-left: 4px; }
.training-item-details span { font-size: 11px; color: #6b7280; background: #f3f4f6; padding: 1px 4px; border-radius: 3px; }
.training-item-delete { background: none; border: none; cursor: pointer; color: #9ca3af; font-size: 12px; }
.training-item-delete:hover { color: #ef4444; }
.add-training-form { background: #f9fafb; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.add-training-form input { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; margin-bottom: 8px; box-sizing: border-box; }
.add-training-row { display: flex; gap: 8px; }
.add-training-row input { flex: 1; }
.add-training-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.cancel-training-btn { background: #f3f4f6; border: none; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
.add-training-btn { background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
.show-add-btn { background: none; border: 1px dashed #d1d5db; border-radius: 6px; padding: 6px; width: 100%; cursor: pointer; font-size: 12px; color: #6b7280; }
.show-add-btn:hover { border-color: #3b82f6; color: #3b82f6; }
.learning-list { margin-bottom: 8px; }
.learning-item { padding: 8px; border-radius: 8px; margin-bottom: 4px; }
.learning-item:hover { background: #f9fafb; }
.learning-item.completed .learning-item-title { text-decoration: line-through; color: #9ca3af; }
.learning-item-header { display: flex; align-items: center; gap: 8px; }
.learning-item-title { flex: 1; font-size: 13px; font-weight: 500; }
.learning-item-delete { background: none; border: none; cursor: pointer; color: #9ca3af; font-size: 12px; }
.learning-subtasks { margin-top: 6px; margin-left: 24px; }
.learning-subtask { display: flex; align-items: center; gap: 6px; font-size: 12px; padding: 2px 0; cursor: pointer; }
.learning-subtask.completed span { text-decoration: line-through; color: #9ca3af; }
.add-learning-form { background: #f9fafb; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
.add-learning-form input { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; margin-bottom: 8px; box-sizing: border-box; }
.add-learning-row { display: flex; gap: 8px; }
.add-learning-row input { flex: 1; }
.subtask-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.subtask-tag { padding: 2px 8px; background: #f3f4f6; border-radius: 4px; font-size: 11px; display: flex; align-items: center; gap: 4px; }
.subtask-tag button { border: none; background: transparent; cursor: pointer; color: #9ca3af; padding: 0; font-size: 12px; }
.add-learning-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
.add-learning-btn { background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
.calendar-empty { text-align: center; padding: 20px; color: #9ca3af; font-size: 13px; }

/* AI Chat Panel */
.ai-chat-panel { position: fixed; bottom: 0; right: 0; width: 380px; background: white; border-radius: 12px 12px 0 0; box-shadow: 0 -4px 20px rgba(0,0,0,0.1); display: flex; flex-direction: column; max-height: 400px; z-index: 50; }
.ai-chat-messages { flex: 1; overflow-y: auto; padding: 12px; }
.ai-chat-msg { padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; font-size: 13px; line-height: 1.5; }
.ai-chat-msg.user { background: #eff6ff; }
.ai-chat-msg.assistant { background: #f3f4f6; }
.ai-generating-hint { text-align: center; padding: 8px; color: #6b7280; font-size: 12px; }
.ai-chat-input-row { display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid #e5e7eb; }
.ai-chat-input-row input { flex: 1; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; }
.ai-chat-send-btn, .ai-chat-close-btn { background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 12px; }
.ai-chat-close-btn { background: #6b7280; }

/* Long Term Plans */
.long-term-panel { padding: 16px; }
.long-term-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.long-term-header h3 { margin: 0; font-size: 16px; }
.create-plan-btn { background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.create-plan-form { background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.create-plan-form h4 { margin: 0 0 12px; font-size: 14px; }
.plan-type-selector { display: flex; gap: 8px; margin-bottom: 12px; }
.plan-type-btn { flex: 1; padding: 8px; border: 2px solid #e5e7eb; border-radius: 8px; background: none; cursor: pointer; font-size: 13px; }
.plan-type-btn.selected { border-color: #3b82f6; background: #eff6ff; }
.form-row { display: flex; gap: 12px; }
.form-group { flex: 1; margin-bottom: 12px; }
.form-group label { display: block; font-size: 12px; color: #6b7280; margin-bottom: 4px; }
.form-group input, .form-group textarea { width: 100%; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; box-sizing: border-box; }
.form-group textarea { min-height: 60px; resize: vertical; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; }
.form-cancel-btn { background: #f3f4f6; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
.form-submit-btn { background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; }
.form-submit-btn:disabled { opacity: 0.6; }
.plan-list { display: flex; flex-direction: column; gap: 8px; }
.plan-card { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.plan-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.plan-card-type { font-size: 12px; padding: 2px 8px; border-radius: 4px; }
.plan-card-type.health { background: #fef2f2; color: #ef4444; }
.plan-card-type.learning { background: #eff6ff; color: #3b82f6; }
.plan-card-applied { font-size: 12px; color: #10b981; }
.plan-card-date { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
.plan-card-target { font-size: 14px; font-weight: 500; margin-bottom: 8px; }
.plan-card-content { font-size: 13px; color: #6b7280; line-height: 1.6; white-space: pre-wrap; margin-bottom: 12px; }
.plan-card-actions { display: flex; gap: 8px; justify-content: flex-end; }
.plan-delete-btn { background: #fef2f2; color: #ef4444; border: none; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
.plan-apply-btn { background: #3b82f6; color: white; border: none; border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
.plan-apply-btn:disabled { opacity: 0.6; }
</style>
