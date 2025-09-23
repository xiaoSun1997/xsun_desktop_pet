import {useEffect, useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {getCurrentWindow, getAllWindows} from "@tauri-apps/api/window";
import {open} from "@tauri-apps/plugin-dialog";
import {readFile} from "@tauri-apps/plugin-fs";
import "./CalendarComponent.css";
import {WebviewWindow} from "@tauri-apps/api/webviewWindow";
import {listen} from "@tauri-apps/api/event";
import {LunarCalendar} from "../utils/lunarUtils";
import {currentMonitor} from "@tauri-apps/api/window";
import {PhysicalSize, PhysicalPosition} from "@tauri-apps/api/window";

type CalendarSettings = {
    backgroundImages: string[];
    rotationInterval: number;
};

type TodoItem = {
    id: string;
    content: string;
    completed: boolean;
    created_at: number;
};

export default function CalendarComponent() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [settings, setSettings] = useState<CalendarSettings>({
        backgroundImages: ["data/img.jpeg"],
        rotationInterval: 30
    });
    const [showSettings, setShowSettings] = useState(false);
    const [currentBgIndex, setCurrentBgIndex] = useState(0);
    const [isCardMode, setIsCardMode] = useState(false);
    const [monthTodos, setMonthTodos] = useState<{ [date: string]: TodoItem[] }>({});
    const [tempSettings, setTempSettings] = useState<CalendarSettings>({
        backgroundImages: ["data/img.jpeg"],
        rotationInterval: 30
    });

    useEffect(() => {
        const unlisten = listen('refresh-calendar', () => {
            refreshCalendarData();
        });
        return () => {
            unlisten.then(fn => fn());
        };
    }, []);

    useEffect(() => {
        loadSettings();
        loadMonthTodos();
    }, [currentDate]);

    useEffect(() => {
        if (settings.backgroundImages.length > 1) {
            const interval = setInterval(() => {
                setCurrentBgIndex(prev => (prev + 1) % settings.backgroundImages.length);
            }, settings.rotationInterval * 60 * 1000);
            return () => clearInterval(interval);
        }
    }, [settings]);

    const loadSettings = async () => {
        try {
            const loadedSettings = await invoke<CalendarSettings>('load_calendar_settings');
            setSettings(loadedSettings);
            setTempSettings(loadedSettings);
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    };

    const saveSettings = async () => {
        try {
            await invoke('save_calendar_settings', {settings: tempSettings});
            setSettings(tempSettings);
            setShowSettings(false);
        } catch (error) {
            console.error('保存设置失败:', error);
        }
    };

    const loadMonthTodos = async () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        const todos: { [date: string]: TodoItem[] } = {};
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // 加载一周的待办（用于卡片模式显示）
        const today = new Date();
        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() - today.getDay() + i);
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            try {
                const dayTodos = await invoke<TodoItem[]>('get_todos_for_date', {date: dateStr});
                if (dayTodos.length > 0) {
                    todos[dateStr] = dayTodos;
                }
            } catch (error) {
                console.error(`加载${dateStr}的待办失败:`, error);
            }
        }

        // 加载当前月份的待办
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            if (!todos[dateStr]) {
                try {
                    const dayTodos = await invoke<TodoItem[]>('get_todos_for_date', {date: dateStr});
                    if (dayTodos.length > 0) {
                        todos[dateStr] = dayTodos;
                    }
                } catch (error) {
                    console.error(`加载${dateStr}的待办失败:`, error);
                }
            }
        }

        setMonthTodos(todos);
    };

    const createOrShowTodoWindow = async (date: Date) => {
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const windowLabel = `todo_${dateStr}`;

        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === windowLabel);

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn("已有待办窗口，但 show/setFocus 失败，尝试重新创建：", e);
            }
        }

        const baseUrl = import.meta.env.DEV ? "http://localhost:1420" : "index.html";
        const url = `${baseUrl}?date=${dateStr}&type=todo`;

        try {
            const webview = new WebviewWindow(windowLabel, {
                url,
                title: `${dateStr} - 待办事项`,
                width: 500,
                height: 600,
                visible: false,
                transparent: true,
                decorations: false,
                resizable: true,
                minWidth: 400,
                minHeight: 500,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待待办窗口创建超时"));
                }, 5000);

                webview.once("tauri://created", async () => {
                    clearTimeout(timeout);
                    setTimeout(async () => {
                        try {
                            await webview.emit('set-todo-date', {date: dateStr});
                            await webview.show();
                            await webview.setFocus();
                            resolve();
                        } catch (error) {
                            console.error('发送日期数据失败:', error);
                            reject(error);
                        }
                    }, 1000);
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建待办窗口时出错: ${JSON.stringify(e)}`));
                });
            });
        } catch (err) {
            console.error("创建待办窗口失败：", err);
        }
    };

    const refreshCalendarData = async () => {
        await loadMonthTodos();
    };

    const handleDateDoubleClick = async (date: Date) => {
        await createOrShowTodoWindow(date);
    };

    const uploadImage = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{
                    name: '图片文件',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
                }]
            });

            if (selected && typeof selected === 'string') {
                const imageData = await readFile(selected);
                const filename = `bg_${Date.now()}.${selected.split('.').pop()}`;

                const imagePath = await invoke<string>('upload_background_image', {
                    imageData: Array.from(imageData),
                    filename
                });

                setTempSettings(prev => ({
                    ...prev,
                    backgroundImages: [...prev.backgroundImages, imagePath]
                }));
            }
        } catch (error) {
            console.error('上传图片失败:', error);
            alert(`上传图片失败: ${error}`);
        }
    };

    const deleteImage = async (imagePath: string, index: number) => {
        if (tempSettings.backgroundImages.length <= 1) {
            alert('至少需要保留一张背景图片');
            return;
        }

        try {
            await invoke('delete_background_image', {imagePath});
            setTempSettings(prev => ({
                ...prev,
                backgroundImages: prev.backgroundImages.filter((_, i) => i !== index)
            }));
        } catch (error) {
            console.error('删除图片失败:', error);
        }
    };

    const toggleCardMode = async () => {
        const window = getCurrentWindow();

        if (!isCardMode) {
            // 进入卡片模式 - 获取屏幕尺寸并定位窗口到右侧
            try {
                // 获取当前显示器信息
                const monitor = await currentMonitor();
                if (!monitor) {
                    throw new Error('无法获取显示器信息');
                }

                const screenSize = monitor.size;
                const cardWidth = 300; // 卡片宽度

                // 设置窗口大小 - 使用 PhysicalSize
                await window.setSize(new PhysicalSize(cardWidth, screenSize.height+10));

                // 定位到屏幕最右侧 - 使用 PhysicalPosition
                await window.setPosition(new PhysicalPosition(
                    screenSize.width - cardWidth,
                    0
                ));

                await window.setAlwaysOnTop(false);
                await invoke('set_click_through', {enabled: false});

            } catch (error) {
                console.error('设置卡片模式失败:', error);
                // 如果无法获取显示器信息，使用默认值
                try {
                    const cardWidth = 250;
                    await window.setSize(new PhysicalSize(cardWidth, 1080));
                    await window.setPosition(new PhysicalPosition(1920 - cardWidth, 0));
                    await window.setAlwaysOnTop(true);
                    await invoke('set_click_through', {enabled: true});
                } catch (fallbackError) {
                    console.error('使用默认值设置卡片模式也失败:', fallbackError);
                }
            }
        } else {
            // 退出卡片模式 - 恢复原始窗口大小和位置
            try {
                const monitor = await currentMonitor();
                const originalWidth = 900;
                const originalHeight = 700;

                await window.setSize(new PhysicalSize(originalWidth, originalHeight));

                if (monitor) {
                    // 居中显示
                    const centerX = (monitor.size.width - originalWidth) / 2;
                    const centerY = (monitor.size.height - originalHeight) / 2;
                    await window.setPosition(new PhysicalPosition(centerX, centerY));
                } else {
                    // 默认居中位置
                    await window.setPosition(new PhysicalPosition(510, 190));
                }

                await window.setAlwaysOnTop(false);
                await invoke('set_click_through', {enabled: false});

            } catch (error) {
                console.error('退出卡片模式失败:', error);
            }
        }

        setIsCardMode(!isCardMode);
    };


    const handleClose = async () => {
        const window = getCurrentWindow();
        await window.close();
    };

    const renderCalendar = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const days = [];

        // 上个月的日期（透明显示）
        const prevMonthDays = new Date(year, month, 0).getDate();
        for (let i = firstDay - 1; i >= 0; i--) {
            const day = prevMonthDays - i;
            const date = new Date(year, month - 1, day);
            days.push(
                <div key={`prev-${day}`} className="calendar-day prev-month">
                    <div className="day-number">{day}</div>
                    <div className="lunar-info">
                        {getLunarInfo(date)}
                    </div>
                </div>
            );
        }

        // 当月日期
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = date.toDateString() === new Date().toDateString();
            const dayTodos = monthTodos[dateStr] || [];
            const completedCount = dayTodos.filter(t => t.completed).length;
            const pendingCount = dayTodos.filter(t => !t.completed).length;
            const solarTerm = LunarCalendar.getSolarTerm(date);

            days.push(
                <div
                    key={day}
                    className={`calendar-day ${isToday ? 'today' : ''}`}
                    onDoubleClick={() => handleDateDoubleClick(date)}
                >
                    <div className="day-number">{day}</div>
                    <div className="lunar-info">
                        {getLunarInfo(date)}
                        {solarTerm && <div className="solar-term">{solarTerm}</div>}
                    </div>
                    {(pendingCount > 0 || completedCount > 0) && (
                        <div className="todo-indicator">
                            {pendingCount > 0 && <span className="pending">{pendingCount}</span>}
                            {completedCount > 0 && <span className="completed">{completedCount}</span>}
                        </div>
                    )}
                </div>
            );
        }

        // 下个月的日期（透明显示）
        const totalCells = 42;
        const remainingCells = totalCells - days.length;
        for (let day = 1; day <= remainingCells; day++) {
            const date = new Date(year, month + 1, day);
            days.push(
                <div key={`next-${day}`} className="calendar-day next-month">
                    <div className="day-number">{day}</div>
                    <div className="lunar-info">
                        {getLunarInfo(date)}
                    </div>
                </div>
            );
        }

        return days;
    };

    const renderCardModeCalendar = () => {
        const today = new Date();
        const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

        return (
            <div className="card-mode-fullscreen">
                <div className="card-mode-calendar">
                    {weekDays.map((weekDay, index) => {
                        const date = new Date(today);
                        date.setDate(today.getDate() - today.getDay() + index);
                        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                        const dayTodos = monthTodos[dateStr] || [];
                        const isToday = date.toDateString() === today.toDateString();
                        const solarTerm = LunarCalendar.getSolarTerm(date);

                        return (
                            <div
                                key={index}
                                className={`card-mode-day ${isToday ? 'today-special' : ''}`}
                                onDoubleClick={() => handleDateDoubleClick(date)}
                            >
                                <div className="weekday-header">{weekDay}</div>
                                <div className="date-section">
                                    <div className="date-number">{date.getDate()}</div>
                                    <div className="date-info">
                                        <div className="lunar-small">{getLunarInfo(date)}</div>
                                        {solarTerm && <div className="solar-term-small">{solarTerm}</div>}
                                    </div>
                                </div>
                                <div className="card-mode-todos">
                                    {dayTodos.slice(0, 3).map((todo, todoIndex) => (
                                        <div
                                            key={todoIndex}
                                            className={`card-mode-todo ${todo.completed ? 'completed' : ''}`}
                                            title={todo.content}
                                        >
                                            {todo.content.length > 15 ? todo.content.substring(0, 15) + '...' : todo.content}
                                        </div>
                                    ))}
                                    {dayTodos.length > 3 && (
                                        <div className="more-todos">还有{dayTodos.length - 3}项</div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const getLunarInfo = (date: Date): string => {
        return LunarCalendar.formatLunarDate(date);
    };

    const currentBgImage = settings.backgroundImages[currentBgIndex] || "data/img.jpeg";

    // 如果是卡片模式，只显示右侧卡片
    if (isCardMode) {
        return renderCardModeCalendar();
    }

    return (
        <div
            className="calendar-container"
            style={{
                backgroundImage: `url(${currentBgImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
            }}
        >
            <div className="calendar-header" data-tauri-drag-region>
                <div className="header-left" data-tauri-drag-region>
                    <h1 className="calendar-title" data-tauri-drag-region>智能日历</h1>
                    <div className="current-month" data-tauri-drag-region>
                        {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月
                    </div>
                </div>
                <div className="header-actions">
                    <button className="nav-button"
                            onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))}>
                        &lt;
                    </button>
                    <button className="today-button" onClick={() => setCurrentDate(new Date())}>
                        今天
                    </button>
                    <button className="nav-button"
                            onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))}>
                        &gt;
                    </button>
                    <button className="settings-button" onClick={() => setShowSettings(true)}>
                        ⚙️
                    </button>
                    <button className="expand-button" onClick={toggleCardMode}>
                        &gt;&gt;
                    </button>
                    <button className="close-button" onClick={handleClose}>
                        <div className="close-icon"></div>
                    </button>
                </div>
            </div>

            <div className="calendar-grid">
                <div className="weekday-headers">
                    {['日', '一', '二', '三', '四', '五', '六'].map(day => (
                        <div key={day} className="weekday-header">{day}</div>
                    ))}
                </div>
                <div className="calendar-days">
                    {renderCalendar()}
                </div>
            </div>

            {showSettings && (
                <div className="settings-overlay">
                    <div className="settings-modal">
                        <div className="settings-header">
                            <h3>日历设置</h3>
                            <button className="settings-close" onClick={() => setShowSettings(false)}>
                                <div className="close-icon"></div>
                            </button>
                        </div>
                        <div className="settings-content">
                            <div className="setting-item">
                                <label>背景图片管理:</label>
                                <div className="image-list">
                                    {tempSettings.backgroundImages.map((img, index) => (
                                        <div key={index} className="image-item">
                                            <img src={img} alt={`背景${index + 1}`}/>
                                            <button onClick={() => deleteImage(img, index)}>删除</button>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={uploadImage}>添加图片</button>
                            </div>
                            <div className="setting-item">
                                <label>轮播间隔 ({tempSettings.rotationInterval}分钟):</label>
                                <input
                                    type="range"
                                    min="5"
                                    max="1440"
                                    value={tempSettings.rotationInterval}
                                    onChange={(e) => setTempSettings(prev => ({
                                        ...prev,
                                        rotationInterval: parseInt(e.target.value)
                                    }))}
                                />
                                <div className="interval-labels">
                                    <span>5分钟</span>
                                    <span>12小时</span>
                                    <span>24小时</span>
                                </div>
                            </div>
                        </div>
                        <div className="settings-actions">
                            <button className="cancel-button" onClick={() => setShowSettings(false)}>取消</button>
                            <button className="save-button" onClick={saveSettings}>保存</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
