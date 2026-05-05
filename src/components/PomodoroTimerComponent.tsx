import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./PomodoroTimerComponent.css";

type PomodoroSettings = {
    workStartTime: string;
    workEndTime: string;
    workDuration: number;
    breakDuration: number;
    enabled: boolean;
};

type TimerState = {
    isRunning: boolean;
    isWorkTime: boolean;
    timeLeft: number;
    cycleStartTime: number | null;
};

export default function PomodoroTimerComponent() {
    const defaultSettings: PomodoroSettings = {
        workStartTime: "09:00",
        workEndTime: "18:00",
        workDuration: 25,
        breakDuration: 5,
        enabled: false
    };

    const [settings, setSettings] = useState<PomodoroSettings>(defaultSettings);
    const [timer, setTimer] = useState<TimerState>({
        isRunning: false,
        isWorkTime: true,
        timeLeft: 25 * 60,
        cycleStartTime: null
    });

    const timerRef = useRef<TimerState>(timer);
    const settingsRef = useRef<PomodoroSettings>(settings);

    useEffect(() => {
        timerRef.current = timer;
    }, [timer]);

    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);

    const isInWorkingHours = (): boolean => {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        return currentTime >= settings.workStartTime && currentTime <= settings.workEndTime;
    };

    const showNotification = async (message: string, isWorkTime: boolean) => {
        try {
            await invoke('show_pomodoro_notification', {
                message,
                isWorkTime
            });
        } catch (error) {
            console.error('Failed to show notification:', error);
        }
    };

    // 初始化：从后端加载设置
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const savedSettings = await invoke<PomodoroSettings | null>('load_pomodoro_settings');

                if (savedSettings) {
                    setSettings({ ...defaultSettings, ...savedSettings });

                    // 如果启用了番茄钟，尝试恢复计时器状态
                    if (savedSettings.enabled) {
                        try {
                            const savedTimer = await invoke<{ isWorkTime: boolean; cycleStartTime: number | null; isRunning: boolean } | null>('load_pomodoro_timer');
                            if (savedTimer && savedTimer.cycleStartTime && savedTimer.isRunning) {
                                const now = Date.now();
                                const elapsed = Math.floor((now - savedTimer.cycleStartTime) / 1000);
                                const maxDuration = savedTimer.isWorkTime
                                    ? savedSettings.workDuration * 60
                                    : savedSettings.breakDuration * 60;

                                const remainingTime = Math.max(0, maxDuration - elapsed);

                                setTimer({
                                    isRunning: remainingTime > 0 && savedSettings.enabled,
                                    isWorkTime: savedTimer.isWorkTime,
                                    timeLeft: remainingTime > 0 ? remainingTime : maxDuration,
                                    cycleStartTime: remainingTime > 0 ? savedTimer.cycleStartTime : null
                                });
                            }
                        } catch (e) {
                            console.error("Failed to load saved timer", e);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to load saved settings", e);
            }
        };

        loadSettings();
    }, []);

    // 设置变化时保存到后端
    useEffect(() => {
        invoke('save_pomodoro_settings', { settings }).catch(e =>
            console.error('保存番茄钟设置失败:', e)
        );
    }, [settings]);

    // 计时器状态变化时保存到后端
    useEffect(() => {
        if (timer.isRunning && timer.cycleStartTime) {
            invoke('save_pomodoro_timer', {
                timerState: { isWorkTime: timer.isWorkTime, cycleStartTime: timer.cycleStartTime, isRunning: timer.isRunning }
            }).catch(e => console.error('保存计时器状态失败:', e));
        }
    }, [timer]);

    const switchCycle = async () => {
        const currentTimer = timerRef.current;
        const currentSettings = settingsRef.current;

        if (currentTimer.isWorkTime) {
            await showNotification("需要走走休息一会儿了", true);
        } else {
            await showNotification("休息好了可以继续工作啦", false);
        }

        const isNowWorkTime = !currentTimer.isWorkTime;
        const newDuration = isNowWorkTime
            ? currentSettings.workDuration * 60
            : currentSettings.breakDuration * 60;

        setTimer({
            isRunning: false,
            isWorkTime: isNowWorkTime,
            timeLeft: newDuration,
            cycleStartTime: null
        });
    };

    useEffect(() => {
        let interval: number | null = null;

        if (timer.isRunning && settings.enabled && isInWorkingHours()) {
            interval = window.setInterval(() => {
                setTimer(prev => {
                    if (prev.timeLeft <= 1) {
                        switchCycle();
                        return prev;
                    }

                    return {
                        ...prev,
                        timeLeft: prev.timeLeft - 1
                    };
                });
            }, 1000);
        } else if (timer.isRunning && (!settings.enabled || !isInWorkingHours())) {
            setTimer(prev => ({
                ...prev,
                isRunning: false
            }));
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [timer.isRunning, settings.enabled]);

    useEffect(() => {
        const setupListener = async () => {
            const unlisten = await listen('pomodoro-continue', () => {
                setTimer(prev => ({
                    ...prev,
                    isRunning: true,
                    cycleStartTime: Date.now()
                }));
            });

            return unlisten;
        };

        let unlisten: (() => void) | null = null;
        setupListener().then(fn => { unlisten = fn; });

        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    const handleClose = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.hide(); // 改用 hide 而不是 close
        } catch (error) {
            console.error('隐藏窗口失败:', error);
        }
    };

    const handleSaveSettings = () => {
        if (settings.enabled) {
            setTimer({
                isRunning: true,
                isWorkTime: true,
                timeLeft: settings.workDuration * 60,
                cycleStartTime: Date.now()
            });
            alert('番茄钟已启动！');
        } else {
            setTimer(prev => ({
                ...prev,
                isRunning: false,
                cycleStartTime: null
            }));
            localStorage.removeItem("pomodoro-timer");
            invoke('save_pomodoro_timer', { timerState: null }).catch(() => {});
            alert('番茄钟已停止！');
        }
    };

    const handleSettingChange = (field: keyof PomodoroSettings, value: string | number | boolean) => {
        setSettings(prev => ({
            ...prev,
            [field]: value
        }));
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleStartPause = () => {
        if (timer.isRunning) {
            setTimer(prev => ({
                ...prev,
                isRunning: false
            }));
        } else {
            setTimer(prev => ({
                ...prev,
                isRunning: true,
                cycleStartTime: prev.cycleStartTime || Date.now()
            }));
        }
    };

    const handleReset = () => {
        setTimer(prev => ({
            isRunning: false,
            isWorkTime: prev.isWorkTime,
            timeLeft: prev.isWorkTime
                ? settings.workDuration * 60
                : settings.breakDuration * 60,
            cycleStartTime: null
        }));
    };

    return (
        <div className="pomodoro-container">
            <div className="pomodoro-header" data-tauri-drag-region>
                <div className="header-left">
                    <h1 className="pomodoro-title">番茄钟</h1>
                    {timer.isRunning && (
                        <span className="status-indicator">运行中</span>
                    )}
                </div>
                <div className="header-actions">
                    <button className="close-button" onClick={handleClose}>
                        <div className="close-icon"></div>
                    </button>
                </div>
            </div>

            <div className="pomodoro-content">
                <div className="pomodoro-panel">
                    <div className="panel-header">
                        <h3 className="panel-title">番茄钟设置</h3>
                    </div>

                    <div className="settings-form">
                        <div className="form-group">
                            <label>启用番茄钟</label>
                            <div className="switch-container">
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        checked={settings.enabled}
                                        onChange={(e) => handleSettingChange('enabled', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                                <span className="switch-label">
                                    {settings.enabled ? '已启用' : '已禁用'}
                                </span>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>工作时段</label>
                            <div className="time-range-inputs">
                                <input
                                    type="time"
                                    value={settings.workStartTime}
                                    onChange={(e) => handleSettingChange('workStartTime', e.target.value)}
                                    disabled={!settings.enabled}
                                    className="time-input"
                                />
                                <span className="time-separator">至</span>
                                <input
                                    type="time"
                                    value={settings.workEndTime}
                                    onChange={(e) => handleSettingChange('workEndTime', e.target.value)}
                                    disabled={!settings.enabled}
                                    className="time-input"
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label>专注时长</label>
                            <div className="duration-input-group">
                                <input
                                    type="number"
                                    min="1"
                                    max="60"
                                    value={settings.workDuration}
                                    onChange={(e) => handleSettingChange('workDuration', parseInt(e.target.value) || 25)}
                                    disabled={!settings.enabled}
                                    className="duration-input"
                                />
                                <span className="duration-unit">分钟</span>
                            </div>
                        </div>

                        <div className="form-group">
                            <label>休息时长</label>
                            <div className="duration-input-group">
                                <input
                                    type="number"
                                    min="1"
                                    max="30"
                                    value={settings.breakDuration}
                                    onChange={(e) => handleSettingChange('breakDuration', parseInt(e.target.value) || 5)}
                                    disabled={!settings.enabled}
                                    className="duration-input"
                                />
                                <span className="duration-unit">分钟</span>
                            </div>
                        </div>

                        <div className="form-actions">
                            <button
                                className="save-button"
                                onClick={handleSaveSettings}
                            >
                                {settings.enabled ? '保存并启动' : '保存设置'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="pomodoro-panel">
                    <div className="panel-header">
                        <h3 className="panel-title">当前计时</h3>
                    </div>

                    <div className="timer-display">
                        <div className={`timer-status ${timer.isWorkTime ? 'work' : 'break'}`}>
                            {timer.isWorkTime ? '🎯 专注时间' : '☕ 休息时间'}
                        </div>
                        <div className="timer-value">
                            {formatTime(timer.timeLeft)}
                        </div>
                        <div className="timer-progress">
                            <div
                                className="progress-bar"
                                style={{
                                    width: `${((timer.isWorkTime ? settings.workDuration * 60 : settings.breakDuration * 60) - timer.timeLeft) / (timer.isWorkTime ? settings.workDuration * 60 : settings.breakDuration * 60) * 100}%`
                                }}
                            />
                        </div>
                        <div className="timer-controls">
                            <button
                                className={`control-button ${timer.isRunning ? 'pause-button' : 'start-button'}`}
                                onClick={handleStartPause}
                                disabled={!settings.enabled}
                            >
                                {timer.isRunning ? '⏸ 暂停' : '▶ 开始'}
                            </button>
                            <button
                                className="control-button reset-button"
                                onClick={handleReset}
                            >
                                🔄 重置
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
