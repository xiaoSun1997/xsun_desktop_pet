import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import "./CalendarComponent.css";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {listen} from "@tauri-apps/api/event";

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
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [monthTodos, setMonthTodos] = useState<{[date: string]: TodoItem[]}>({});
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
            await invoke('save_calendar_settings', { settings: tempSettings });
            setSettings(tempSettings);
            setShowSettings(false);
        } catch (error) {
            console.error('保存设置失败:', error);
        }
    };

    const loadMonthTodos = async () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const todos: {[date: string]: TodoItem[]} = {};

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            try {
                const dayTodos = await invoke<TodoItem[]>('get_todos_for_date', { date: dateStr });
                if (dayTodos.length > 0) {
                    todos[dateStr] = dayTodos;
                }
            } catch (error) {
                console.error(`加载${dateStr}的待办失败:`, error);
            }
        }

        setMonthTodos(todos);
    };

    // 沿用现有格式创建待办窗口
    // 修复窗口创建和数据传递
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

        // 修复URL传参方式
        const baseUrl = import.meta.env.DEV ? "http://localhost:1420" : "index.html";
        const url = `${baseUrl}?date=${dateStr}&type=todo`;

        try {
            const webview = new WebviewWindow(windowLabel, {
                url,
                title: `${dateStr} - 待办事项`,
                width: 500,
                height: 600,
                visible: false, // 先隐藏，等数据传递完成后再显示
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

                    // 等待窗口加载完成后发送数据
                    setTimeout(async () => {
                        try {
                            await webview.emit('set-todo-date', { date: dateStr });
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

            console.log("待办窗口已创建并显示");
        } catch (err) {
            console.error("创建待办窗口失败：", err);
        }
    };
// 添加刷新数据的方法
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
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp']
                }]
            });

            if (selected) {
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
        }
    };

    const deleteImage = async (imagePath: string, index: number) => {
        if (tempSettings.backgroundImages.length <= 1) {
            alert('至少需要保留一张背景图片');
            return;
        }

        try {
            await invoke('delete_background_image', { imagePath });
            setTempSettings(prev => ({
                ...prev,
                backgroundImages: prev.backgroundImages.filter((_, i) => i !== index)
            }));
        } catch (error) {
            console.error('删除图片失败:', error);
        }
    };

    const toggleFullscreen = async () => {
        const window = getCurrentWindow();
        if (!isFullscreen) {
            await window.setFullscreen(true);
            await window.setAlwaysOnTop(true);
            // 设置点击穿透
            await invoke('set_click_through', { enabled: true });
        } else {
            await window.setFullscreen(false);
            await window.setAlwaysOnTop(false);
            await invoke('set_click_through', { enabled: false });
        }
        setIsFullscreen(!isFullscreen);
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

        // 空白格子
        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
        }

        // 日期格子
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = date.toDateString() === new Date().toDateString();
            const dayTodos = monthTodos[dateStr] || [];
            const completedCount = dayTodos.filter(t => t.completed).length;
            const pendingCount = dayTodos.filter(t => !t.completed).length;

            days.push(
                <div
                    key={day}
                    className={`calendar-day ${isToday ? 'today' : ''}`}
                    onDoubleClick={() => handleDateDoubleClick(date)}
                >
                    <div className="day-number">{day}</div>
                    <div className="lunar-info">
                        {getLunarInfo(date)}
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

        return days;
    };

    const renderFullscreenCalendar = () => {
        const today = new Date();
        const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

        return (
            <div className="fullscreen-calendar">
                {weekDays.map((weekDay, index) => {
                    const date = new Date(today);
                    date.setDate(today.getDate() - today.getDay() + index);
                    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    const dayTodos = monthTodos[dateStr] || [];
                    const isToday = date.toDateString() === today.toDateString();

                    return (
                        <div key={index} className={`fullscreen-day ${isToday ? 'today' : ''}`}>
                            <div className="weekday-header">{weekDay}</div>
                            <div className="date-number">{date.getDate()}</div>
                            <div className="lunar-small">{getLunarInfo(date)}</div>
                            <div className="fullscreen-todos">
                                {dayTodos.slice(0, 5).map((todo, todoIndex) => (
                                    <div
                                        key={todoIndex}
                                        className={`fullscreen-todo ${todo.completed ? 'completed' : ''}`}
                                    >
                                        {todo.content.length > 10 ? todo.content.substring(0, 10) + '...' : todo.content}
                                    </div>
                                ))}
                                {dayTodos.length > 5 && (
                                    <div className="more-todos">+{dayTodos.length - 5}</div>
                                )}
                            </div>
                        </div>
                    );
                })}
                <button className="fullscreen-close" onClick={toggleFullscreen}>
                    <div className="close-icon"></div>
                </button>
            </div>
        );
    };

    // 简化的农历信息获取
    const getLunarInfo = (date: Date): string => {
        // 这里应该使用真正的农历转换库，这里只是示例
        const day = date.getDate();
        if (day === 1) return "初一";
        if (day === 15) return "十五";
        return "";
    };

    const currentBgImage = settings.backgroundImages[currentBgIndex] || "data/img.jpeg";

    if (isFullscreen) {
        return (
            <div
                className="calendar-fullscreen"
                style={{
                    backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.9), rgba(255,255,255,0.1)), url(${currentBgImage})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                }}
            >
                {renderFullscreenCalendar()}
            </div>
        );
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
                <div className="header-left">
                    <h1 className="calendar-title">智能日历</h1>
                    <div className="current-month">
                        {currentDate.getFullYear()}年{currentDate.getMonth() + 1}月
                    </div>
                </div>
                <div className="header-actions">
                    <button className="nav-button" onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))}>
                        ←
                    </button>
                    <button className="today-button" onClick={() => setCurrentDate(new Date())}>
                        今天
                    </button>
                    <button className="nav-button" onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))}>
                        →
                    </button>
                    <button className="settings-button" onClick={() => setShowSettings(true)}>
                        ⚙️
                    </button>
                    <button className="fullscreen-button" onClick={toggleFullscreen}>
                        ⛶
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
                                            <img src={img} alt={`背景${index + 1}`} />
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
