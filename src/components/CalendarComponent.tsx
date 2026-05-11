import {useState, useEffect, useRef, useCallback} from "react";
import {invoke} from "@tauri-apps/api/core";
import {getCurrentWindow} from "@tauri-apps/api/window";
import {listen} from "@tauri-apps/api/event";
import {LunarCalendar} from "../utils/lunarUtils";
import "./CalendarComponent.css";

// ===== 类型定义 =====
interface HealthRecord {
    date: string;
    morningWeight?: number;
    eveningWeight?: number;
    note?: string;
}

interface TrainingItem {
    id: string;
    name: string;
    completed: boolean;
    sets?: number;
    reps?: number;
    weight?: number;
    notes?: string;
    created_at: number;
}

interface Subtask {
    id: string;
    content: string;
    completed: boolean;
}

interface LearningItem {
    id: string;
    title: string;
    subtasks: Subtask[];
    completed: boolean;
    created_at: number;
}

interface LongTermPlan {
    id: string;
    planType: "Health" | "Learning";
    startDate: string;
    endDate: string;
    targetDesc: string;
    planContent: string;
    createdAt: number;
    applied: boolean;
}

interface AIMessage {
    role: "user" | "assistant";
    content: string;
}

// 工具函数：日期格式化
const formatDateStr = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const generateUUID = (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// 中国法定节假日（简化版）
const CHINA_HOLIDAYS: Record<string, string> = {
    '01-01': '元旦',
    '02-14': '情人节',
    '03-08': '妇女节',
    '04-05': '清明节',
    '05-01': '劳动节',
    '06-01': '儿童节',
    '07-01': '建党节',
    '08-01': '建军节',
    '09-10': '教师节',
    '10-01': '国庆节',
    '12-25': '圣诞节',
};

export default function CalendarComponent() {
    // ===== 核心状态 =====
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
    });
    const [activeTab, setActiveTab] = useState<string>("calendar");

    // ===== 健康数据 =====
    const [weightInput, setWeightInput] = useState({morning: "", evening: ""});
    const [trainingItems, setTrainingItems] = useState<TrainingItem[]>([]);
    const [showAddTraining, setShowAddTraining] = useState(false);
    const [newTraining, setNewTraining] = useState({name: "", sets: "", reps: "", weight: ""});

    // ===== 学习数据 =====
    const [learningItems, setLearningItems] = useState<LearningItem[]>([]);
    const [showAddLearning, setShowAddLearning] = useState(false);
    const [newLearning, setNewLearning] = useState({title: "", subtaskInput: "", subtasks: [] as string[]});

    // ===== 长期规划 =====
    const [longTermPlans, setLongTermPlans] = useState<LongTermPlan[]>([]);
    const [showCreatePlan, setShowCreatePlan] = useState(false);
    const [newPlan, setNewPlan] = useState({
        planType: "Health" as "Health" | "Learning",
        startDate: "",
        endDate: "",
        targetDesc: "",
    });
    const [planGenerating, setPlanGenerating] = useState(false);
    const [planApplying, setPlanApplying] = useState<string | null>(null);

    // ===== AI 对话 =====
    const [aiOpen, setAiOpen] = useState(false);
    const [aiType, setAiType] = useState<"health" | "learning">("health");
    const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiInput, setAiInput] = useState("");
    const aiMessagesRef = useRef<HTMLDivElement>(null);

    const headerRef = useRef<HTMLDivElement>(null);

    // ===== 生成日期列表（前后各15天） =====
    const generateDateList = useCallback((): {date: Date; isToday: boolean; formatted: string; dateStr: string; weekday: string; festival?: string}[] => {
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
            const mmdd = `${month}-${day}`;
            const festival = CHINA_HOLIDAYS[mmdd] || LunarCalendar.getSolarTerm(date) || undefined;
            dates.push({
                date, isToday,
                formatted: `${month}-${day}`,
                dateStr: formatDateStr(date),
                weekday,
                festival,
            });
        }
        return dates;
    }, []);

    // ===== 初始化 & 数据加载 =====
    useEffect(() => {
        loadAllData();
    }, [selectedDate]);

    useEffect(() => {
        // 拖拽
        const header = headerRef.current;
        if (!header) return;
        const mouseDownHandler = async (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('button') ||
                (e.target as HTMLElement).closest('input') ||
                (e.target as HTMLElement).closest('textarea')) return;
            try {
                await getCurrentWindow().startDragging();
            } catch (error) {
                console.error('拖动失败:', error);
            }
        };
        header.addEventListener('mousedown', mouseDownHandler);
        return () => header.removeEventListener('mousedown', mouseDownHandler);
    }, []);

    // 监听 AI 流式事件
    useEffect(() => {
        const unlistens: (() => void)[] = [];
        listen<{token: string; planType: string}>('calendar-ai://stream-token', (event) => {
            const {token, planType} = event.payload;
            if ((planType === 'health' && aiType === 'health') || (planType === 'learning' && aiType === 'learning')) {
                setAiMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last && last.role === 'assistant') {
                        last.content += token;
                    } else {
                        msgs.push({role: 'assistant', content: token});
                    }
                    return msgs;
                });
            }
        }).then(fn => unlistens.push(fn));

        listen<{content: string; planType: string}>('calendar-ai://stream-done', () => {
            setAiLoading(false);
        }).then(fn => unlistens.push(fn));

        listen<{error: string}>('calendar-ai://stream-error', (event) => {
            setAiLoading(false);
            setAiMessages(prev => [...prev, {role: 'assistant', content: `❌ ${event.payload.error}`}]);
        }).then(fn => unlistens.push(fn));

        return () => { unlistens.forEach(fn => fn()); };
    }, [aiType]);

    const loadAllData = async () => {
        const dateStr = formatDateStr(selectedDate);
        await Promise.all([
            loadHealthData(dateStr),
            loadTrainingData(dateStr),
            loadLearningData(dateStr),
            loadLongTermPlans(),
        ]);
    };

    const loadHealthData = async (dateStr: string) => {
        try {
            const record = await invoke<HealthRecord>('get_daily_health_data', {date: dateStr});
            setWeightInput({
                morning: record.morningWeight?.toString() || "",
                evening: record.eveningWeight?.toString() || "",
            });
        } catch (e) { console.error('加载健康数据失败:', e); }
    };

    const loadTrainingData = async (dateStr: string) => {
        try {
            const items = await invoke<TrainingItem[]>('get_daily_training_data', {date: dateStr});
            setTrainingItems(items || []);
        } catch (e) { console.error('加载训练数据失败:', e); }
    };

    const loadLearningData = async (dateStr: string) => {
        try {
            const items = await invoke<LearningItem[]>('get_daily_learning_data', {date: dateStr});
            setLearningItems(items || []);
        } catch (e) { console.error('加载学习数据失败:', e); }
    };

    const loadLongTermPlans = async () => {
        try {
            const plans = await invoke<LongTermPlan[]>('get_long_term_plans');
            setLongTermPlans(plans || []);
        } catch (e) { console.error('加载长期规划失败:', e); }
    };

    // ===== 健康数据操作 =====
    const saveWeight = async () => {
        const record: HealthRecord = {
            date: formatDateStr(selectedDate),
            morningWeight: weightInput.morning ? parseFloat(weightInput.morning) : undefined,
            eveningWeight: weightInput.evening ? parseFloat(weightInput.evening) : undefined,
        };
        try {
            await invoke('save_health_record', {record});
        } catch (e) { alert('保存体重失败: ' + e); }
    };

    const toggleTrainingComplete = async (item: TrainingItem) => {
        const updated = trainingItems.map(t =>
            t.id === item.id ? {...t, completed: !t.completed} : t
        );
        setTrainingItems(updated);
        await saveTrainingItems(updated);
    };

    const addTrainingItem = async () => {
        if (!newTraining.name.trim()) return;
        const item: TrainingItem = {
            id: generateUUID(),
            name: newTraining.name.trim(),
            completed: false,
            sets: newTraining.sets ? parseInt(newTraining.sets) : undefined,
            reps: newTraining.reps ? parseInt(newTraining.reps) : undefined,
            weight: newTraining.weight ? parseFloat(newTraining.weight) : undefined,
            created_at: Date.now(),
        };
        const updated = [...trainingItems, item];
        setTrainingItems(updated);
        await saveTrainingItems(updated);
        setNewTraining({name: "", sets: "", reps: "", weight: ""});
        setShowAddTraining(false);
    };

    const deleteTrainingItem = async (id: string) => {
        const updated = trainingItems.filter(t => t.id !== id);
        setTrainingItems(updated);
        await saveTrainingItems(updated);
    };

    const saveTrainingItems = async (items: TrainingItem[]) => {
        try {
            await invoke('save_training_items', {date: formatDateStr(selectedDate), items});
        } catch (e) { console.error('保存训练数据失败:', e); }
    };

    // ===== 学习数据操作 =====
    const toggleLearningComplete = async (item: LearningItem) => {
        const updated = learningItems.map(l =>
            l.id === item.id ? {...l, completed: !l.completed} : l
        );
        setLearningItems(updated);
        await saveLearningItems(updated);
    };

    const toggleSubtask = async (itemId: string, subtaskId: string) => {
        const updated = learningItems.map(l => {
            if (l.id !== itemId) return l;
            return {
                ...l,
                subtasks: l.subtasks.map(s =>
                    s.id === subtaskId ? {...s, completed: !s.completed} : s
                ),
            };
        });
        setLearningItems(updated);
        await saveLearningItems(updated);
    };

    const addLearningItem = async () => {
        if (!newLearning.title.trim()) return;
        const subtasks: Subtask[] = newLearning.subtasks
            .filter(s => s.trim())
            .map(s => ({id: generateUUID(), content: s.trim(), completed: false}));
        const item: LearningItem = {
            id: generateUUID(),
            title: newLearning.title.trim(),
            subtasks,
            completed: false,
            created_at: Date.now(),
        };
        const updated = [...learningItems, item];
        setLearningItems(updated);
        await saveLearningItems(updated);
        setNewLearning({title: "", subtaskInput: "", subtasks: []});
        setShowAddLearning(false);
    };

    const deleteLearningItem = async (id: string) => {
        const updated = learningItems.filter(l => l.id !== id);
        setLearningItems(updated);
        await saveLearningItems(updated);
    };

    const saveLearningItems = async (items: LearningItem[]) => {
        try {
            await invoke('save_learning_items', {date: formatDateStr(selectedDate), items});
        } catch (e) { console.error('保存学习数据失败:', e); }
    };

    const addSubtaskToNew = () => {
        if (newLearning.subtaskInput.trim()) {
            setNewLearning({
                ...newLearning,
                subtasks: [...newLearning.subtasks, newLearning.subtaskInput.trim()],
                subtaskInput: "",
            });
        }
    };

    // ===== AI 对话操作 =====
    const openAiChat = (type: "health" | "learning") => {
        setAiType(type);
        setAiOpen(true);
        const defaultPrompt = type === "health"
            ? "请帮我规划今日锻炼计划，包括具体的训练项目和饮食建议。"
            : "请帮我拆解今日学习任务，制定详细的学习计划。";
        setAiMessages([{role: "user", content: defaultPrompt}]);
        setAiInput("");
        sendAiMessage(defaultPrompt, type);
    };

    const sendAiMessage = async (message?: string, forceType?: string) => {
        const msg = message || aiInput.trim();
        if (!msg) return;
        const type = forceType || aiType;

        if (!message) {
            setAiMessages(prev => [...prev, {role: "user", content: msg}]);
            setAiInput("");
        }
        setAiLoading(true);

        try {
            await invoke('ai_calendar_plan_stream', {
                planType: type,
                userPrompt: msg,
            });
        } catch (e) {
            setAiLoading(false);
            setAiMessages(prev => [...prev, {role: 'assistant', content: `❌ ${e}`}]);
        }
    };

    const closeAiChat = () => {
        setAiOpen(false);
        setAiMessages([]);
        setAiLoading(false);
    };

    // ===== 长期规划操作 =====
    const createLongTermPlan = async () => {
        if (!newPlan.startDate || !newPlan.endDate || !newPlan.targetDesc.trim()) {
            alert('请填写完整的计划信息');
            return;
        }
        setPlanGenerating(true);
        try {
            // 先让 AI 生成计划内容
            const planContent = await invoke<string>('send_chat_message', {
                messages: [
                    {role: "system", content: `你是一个${newPlan.planType === 'Health' ? '健身教练和营养师' : '学习规划师'}。请根据用户的描述，制定一个从${newPlan.startDate}到${newPlan.endDate}的详细计划。用中文回复。`},
                    {role: "user", content: newPlan.targetDesc},
                ],
            });

            const plan: LongTermPlan = {
                id: generateUUID(),
                planType: newPlan.planType,
                startDate: newPlan.startDate,
                endDate: newPlan.endDate,
                targetDesc: newPlan.targetDesc.trim(),
                planContent,
                createdAt: Date.now(),
                applied: false,
            };

            await invoke('save_long_term_plan', {plan});
            await loadLongTermPlans();
            setShowCreatePlan(false);
            setNewPlan({planType: "Health", startDate: "", endDate: "", targetDesc: ""});
        } catch (e) {
            alert('创建计划失败: ' + e);
        } finally {
            setPlanGenerating(false);
        }
    };

    const applyPlan = async (plan: LongTermPlan) => {
        if (!confirm(`确认将 "${plan.targetDesc}" 拆解并应用到每日计划？\n\nAI将自动分配从 ${plan.startDate} 到 ${plan.endDate} 的每日任务。`)) return;
        setPlanApplying(plan.id);
        try {
            await invoke('ai_apply_long_term_plan', {plan});
            alert('✅ 长期计划已成功拆解到每日！');
            await loadLongTermPlans();
            await loadAllData();
        } catch (e) {
            alert('应用计划失败: ' + e);
        } finally {
            setPlanApplying(null);
        }
    };

    const deletePlan = async (id: string) => {
        if (!confirm('确认删除此计划？')) return;
        try {
            await invoke('delete_long_term_plan', {id});
            await loadLongTermPlans();
        } catch (e) {
            alert('删除失败: ' + e);
        }
    };

    // ===== 关闭窗口 =====
    const closeWindow = async () => {
        try { await getCurrentWindow().close(); }
        catch (error) { console.error('关闭窗口失败:', error); }
    };

    // ===== 选中日期 =====
    const handleDateSelect = (date: Date) => {
        setSelectedDate(date);
    };

    // ===== 渲染 =====
    return (
        <div className="calendar-container">
            {/* ===== 左侧边栏 ===== */}
            <div className="calendar-sidebar">
                <div className="calendar-sidebar-header" ref={headerRef} data-tauri-drag-region>
                    <span className="calendar-sidebar-title">📅 智能日历</span>
                    <button className="calendar-close-btn" onClick={closeWindow}>✕</button>
                </div>

                {/* 日期列表 */}
                <div className="calendar-sidebar-list">
                    {generateDateList().map((dateInfo, index) => {
                        const isSelected = dateInfo.date.toDateString() === selectedDate.toDateString();
                        const isWeekend = dateInfo.date.getDay() === 0 || dateInfo.date.getDay() === 6;
                        return (
                            <button
                                key={index}
                                className={`calendar-date-item ${dateInfo.isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isWeekend ? 'weekend' : ''} ${dateInfo.festival ? 'holiday' : ''}`}
                                onClick={() => handleDateSelect(dateInfo.date)}
                            >
                                <span className="calendar-date-label">
                                    <span className="calendar-date-day">{dateInfo.formatted}</span>
                                    <span className="calendar-date-weekday">{dateInfo.weekday}</span>
                                    {dateInfo.festival && <span className="calendar-date-festival">{dateInfo.festival}</span>}
                                </span>
                                <span className="calendar-date-badges">
                                    {dateInfo.isToday && <span className="calendar-date-today-dot" />}
                                    {dateInfo.festival && <span className="calendar-date-holiday-dot" />}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* 底部导航 */}
                <div className="calendar-sidebar-nav">
                    <button className={`calendar-nav-item ${activeTab === 'calendar' ? 'active' : ''}`} onClick={() => setActiveTab('calendar')}>
                        <span className="calendar-nav-icon">📅</span>
                        <span className="calendar-nav-label">日历</span>
                    </button>
                    <button className={`calendar-nav-item ${activeTab === 'long-term' ? 'active' : ''}`} onClick={() => setActiveTab('long-term')}>
                        <span className="calendar-nav-icon">📋</span>
                        <span className="calendar-nav-label">长期规划</span>
                    </button>
                </div>
            </div>

            {/* ===== 右侧主内容区 ===== */}
            <div className="calendar-main">
                {activeTab === 'calendar' && (
                    <div className="calendar-main-content">
                        {/* 健康看板 */}
                        <div className="calendar-board">
                            <div className="calendar-board-header">
                                <div className="calendar-board-title">
                                    <span className="board-icon">💪</span>
                                    <span>健康 & 锻炼</span>
                                </div>
                                <button className="calendar-board-ai-btn" onClick={() => openAiChat('health')}>
                                    🤖 AI 规划
                                </button>
                            </div>
                            <div className="calendar-board-body">
                                {/* 体重记录 */}
                                <div className="health-weight-card">
                                    <div className="weight-entry">
                                        <span className="weight-label">🌅 晨重</span>
                                        <div className="weight-input-group">
                                            <input
                                                type="number"
                                                value={weightInput.morning}
                                                onChange={e => setWeightInput({...weightInput, morning: e.target.value})}
                                                placeholder="--"
                                                step="0.1"
                                            />
                                            <span className="weight-unit">kg</span>
                                        </div>
                                    </div>
                                    <div className="weight-entry">
                                        <span className="weight-label">🌙 晚重</span>
                                        <div className="weight-input-group">
                                            <input
                                                type="number"
                                                value={weightInput.evening}
                                                onChange={e => setWeightInput({...weightInput, evening: e.target.value})}
                                                placeholder="--"
                                                step="0.1"
                                            />
                                            <span className="weight-unit">kg</span>
                                        </div>
                                    </div>
                                    <button className="weight-save-btn" onClick={saveWeight}>保存</button>
                                </div>

                                {/* 训练项目列表 */}
                                <div className="training-list">
                                    {trainingItems.map(item => (
                                        <div key={item.id} className={`training-item ${item.completed ? 'completed' : ''}`}>
                                            <input
                                                type="checkbox"
                                                className="training-item-checkbox"
                                                checked={item.completed}
                                                onChange={() => toggleTrainingComplete(item)}
                                            />
                                            <div className="training-item-info">
                                                <span className="training-item-name">{item.name}</span>
                                                <span className="training-item-details">
                                                    {item.sets && <span>{item.sets}组</span>}
                                                    {item.reps && <span>{item.reps}次</span>}
                                                    {item.weight && <span>{item.weight}kg</span>}
                                                </span>
                                            </div>
                                            <button className="training-item-delete" onClick={() => deleteTrainingItem(item.id)}>✕</button>
                                        </div>
                                    ))}
                                </div>

                                {/* 添加训练项 */}
                                {showAddTraining ? (
                                    <div className="add-training-form">
                                        <input
                                            type="text"
                                            value={newTraining.name}
                                            onChange={e => setNewTraining({...newTraining, name: e.target.value})}
                                            placeholder="训练项目名称"
                                        />
                                        <div className="add-training-row">
                                            <input type="number" value={newTraining.sets} onChange={e => setNewTraining({...newTraining, sets: e.target.value})} placeholder="组数" />
                                            <input type="number" value={newTraining.reps} onChange={e => setNewTraining({...newTraining, reps: e.target.value})} placeholder="次数" />
                                            <input type="number" value={newTraining.weight} onChange={e => setNewTraining({...newTraining, weight: e.target.value})} placeholder="重量(kg)" step="0.5" />
                                        </div>
                                        <div className="add-training-actions">
                                            <button className="cancel-training-btn" onClick={() => setShowAddTraining(false)}>取消</button>
                                            <button className="add-training-btn" onClick={addTrainingItem}>添加</button>
                                        </div>
                                    </div>
                                ) : (
                                    <button className="show-add-btn" onClick={() => setShowAddTraining(true)}>
                                        + 添加训练项目
                                    </button>
                                )}

                                {trainingItems.length === 0 && !showAddTraining && (
                                    <div className="calendar-empty">暂无训练项目，点击上方添加</div>
                                )}
                            </div>
                        </div>

                        {/* 学习看板 */}
                        <div className="calendar-board">
                            <div className="calendar-board-header">
                                <div className="calendar-board-title">
                                    <span className="board-icon">📚</span>
                                    <span>学习 & 任务</span>
                                </div>
                                <button className="calendar-board-ai-btn" onClick={() => openAiChat('learning')}>
                                    🤖 AI 拆解
                                </button>
                            </div>
                            <div className="calendar-board-body">
                                <div className="learning-list">
                                    {learningItems.map(item => (
                                        <div key={item.id} className={`learning-item ${item.completed ? 'completed' : ''}`}>
                                            <div className="learning-item-header">
                                                <input
                                                    type="checkbox"
                                                    className="learning-item-checkbox"
                                                    checked={item.completed}
                                                    onChange={() => toggleLearningComplete(item)}
                                                />
                                                <span className="learning-item-title">{item.title}</span>
                                                <button className="learning-item-delete" onClick={() => deleteLearningItem(item.id)}>✕</button>
                                            </div>
                                            {item.subtasks.length > 0 && (
                                                <div className="learning-subtasks">
                                                    {item.subtasks.map(sub => (
                                                        <label key={sub.id} className={`learning-subtask ${sub.completed ? 'completed' : ''}`}>
                                                            <input
                                                                type="checkbox"
                                                                checked={sub.completed}
                                                                onChange={() => toggleSubtask(item.id, sub.id)}
                                                            />
                                                            <span>{sub.content}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* 添加学习项 */}
                                {showAddLearning ? (
                                    <div className="add-learning-form">
                                        <input
                                            type="text"
                                            value={newLearning.title}
                                            onChange={e => setNewLearning({...newLearning, title: e.target.value})}
                                            placeholder="学习目标标题"
                                        />
                                        <div style={{display: 'flex', gap: 6}}>
                                            <input
                                                type="text"
                                                value={newLearning.subtaskInput}
                                                onChange={e => setNewLearning({...newLearning, subtaskInput: e.target.value})}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtaskToNew(); }}}
                                                placeholder="添加子任务"
                                                style={{flex: 1}}
                                            />
                                            <button onClick={addSubtaskToNew} className="add-training-btn" style={{padding: '5px 10px'}}>+</button>
                                        </div>
                                        {newLearning.subtasks.length > 0 && (
                                            <div style={{display: 'flex', flexWrap: 'wrap', gap: 4}}>
                                                {newLearning.subtasks.map((s, i) => (
                                                    <span key={i} style={{
                                                        padding: '2px 8px',
                                                        background: '#f3f4f6',
                                                        borderRadius: 4,
                                                        fontSize: 11,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                    }}>
                                                        {s}
                                                        <button
                                                            onClick={() => setNewLearning({...newLearning, subtasks: newLearning.subtasks.filter((_, j) => j !== i)})}
                                                            style={{border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af', padding: 0, fontSize: 12}}
                                                        >✕</button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <div className="add-learning-actions">
                                            <button className="cancel-training-btn" onClick={() => {setShowAddLearning(false); setNewLearning({title: "", subtaskInput: "", subtasks: []});}}>取消</button>
                                            <button className="add-learning-btn" onClick={addLearningItem}>添加</button>
                                        </div>
                                    </div>
                                ) : (
                                    <button className="show-add-btn" onClick={() => setShowAddLearning(true)}>
                                        + 添加学习目标
                                    </button>
                                )}

                                {learningItems.length === 0 && !showAddLearning && (
                                    <div className="calendar-empty">暂无学习目标，点击上方添加</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* AI 对话面板（在日历模式下显示） */}
                {activeTab === 'calendar' && aiOpen && (
                    <div className="ai-chat-panel">
                        <div className="ai-chat-messages" ref={aiMessagesRef}>
                            {aiMessages.map((msg, i) => (
                                <div key={i} className={`ai-chat-msg ${msg.role}`}>
                                    {msg.content}
                                </div>
                            ))}
                            {aiLoading && <div className="ai-generating-hint">🤖 AI 正在生成{aiType === 'health' ? '健康' : '学习'}计划...</div>}
                        </div>
                        <div className="ai-chat-input-row">
                            <input
                                type="text"
                                value={aiInput}
                                onChange={e => setAiInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !aiLoading) { sendAiMessage(); }}}
                                placeholder="输入你的需求，如：帮我制定减脂训练计划..."
                                disabled={aiLoading}
                            />
                            <button className="ai-chat-send-btn" onClick={() => sendAiMessage()} disabled={aiLoading}>发送</button>
                            <button className="ai-chat-close-btn" onClick={closeAiChat}>关闭</button>
                        </div>
                    </div>
                )}

                {/* ===== 长期规划面板 ===== */}
                {activeTab === 'long-term' && (
                    <div className="long-term-panel">
                        <div className="long-term-header">
                            <h3>📋 长期规划</h3>
                            <button className="create-plan-btn" onClick={() => setShowCreatePlan(!showCreatePlan)}>
                                {showCreatePlan ? '取消' : '＋ 新建计划'}
                            </button>
                        </div>

                        {/* 创建计划表单 */}
                        {showCreatePlan && (
                            <div className="create-plan-form">
                                <h4>创建新计划</h4>
                                <div className="plan-type-selector">
                                    <button
                                        className={`plan-type-btn ${newPlan.planType === 'Health' ? 'selected' : ''}`}
                                        onClick={() => setNewPlan({...newPlan, planType: 'Health'})}
                                    >
                                        💪 健康/锻炼
                                    </button>
                                    <button
                                        className={`plan-type-btn ${newPlan.planType === 'Learning' ? 'selected' : ''}`}
                                        onClick={() => setNewPlan({...newPlan, planType: 'Learning'})}
                                    >
                                        📚 学习
                                    </button>
                                </div>
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>开始日期</label>
                                        <input type="date" value={newPlan.startDate} onChange={e => setNewPlan({...newPlan, startDate: e.target.value})} />
                                    </div>
                                    <div className="form-group">
                                        <label>结束日期</label>
                                        <input type="date" value={newPlan.endDate} onChange={e => setNewPlan({...newPlan, endDate: e.target.value})} />
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>目标描述</label>
                                    <textarea
                                        value={newPlan.targetDesc}
                                        onChange={e => setNewPlan({...newPlan, targetDesc: e.target.value})}
                                        placeholder={newPlan.planType === 'Health' ? '例如：减重5kg，每周锻炼4次，每天摄入1800卡路里...' : '例如：3个月内完成《算法导论》学习，每天学习2小时...'}
                                    />
                                </div>
                                <div className="form-actions">
                                    <button className="form-cancel-btn" onClick={() => setShowCreatePlan(false)}>取消</button>
                                    <button className="form-submit-btn" onClick={createLongTermPlan} disabled={planGenerating}>
                                        {planGenerating ? '🤖 AI生成中...' : '🤖 AI 生成计划'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 计划列表 */}
                        <div className="plan-list">
                            {longTermPlans.length === 0 && (
                                <div className="calendar-empty">暂无长期计划，点击上方"新建计划"开始</div>
                            )}
                            {longTermPlans.map(plan => (
                                <div key={plan.id} className="plan-card">
                                    <div className="plan-card-header">
                                        <span className={`plan-card-type ${plan.planType.toLowerCase()}`}>
                                            {plan.planType === 'Health' ? '💪 健康/锻炼' : '📚 学习'}
                                        </span>
                                        {plan.applied && (
                                            <span className="plan-card-applied">✅ 已应用</span>
                                        )}
                                    </div>
                                    <div className="plan-card-date">
                                        📅 {plan.startDate} → {plan.endDate}
                                    </div>
                                    <div className="plan-card-target">{plan.targetDesc}</div>
                                    <div className="plan-card-content">{plan.planContent}</div>
                                    <div className="plan-card-actions">
                                        <button className="plan-delete-btn" onClick={() => deletePlan(plan.id)}>删除</button>
                                        {!plan.applied && (
                                            <button
                                                className="plan-apply-btn"
                                                onClick={() => applyPlan(plan)}
                                                disabled={planApplying === plan.id}
                                            >
                                                {planApplying === plan.id ? '⏳ 拆解中...' : '🚀 应用到每日'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
