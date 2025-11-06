import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./PomodoroNotification.css";

interface NotificationData {
    message: string;
    isWorkTime: boolean;
}

export default function PomodoroNotification() {
    const [data, setData] = useState<NotificationData>({
        message: "",
        isWorkTime: true
    });

    useEffect(() => {
        // 从 URL 参数获取初始数据
        const params = new URLSearchParams(window.location.hash.split('?')[1]);
        const message = params.get('message') || '';
        const isWorkTime = params.get('isWorkTime') === 'true';

        setData({ message, isWorkTime });

        // 监听更新事件
        const setupListener = async () => {
            const unlisten = await listen<NotificationData>('pomodoro-update', (event) => {
                setData(event.payload);
            });
            return unlisten;
        };

        let unlisten: (() => void) | null = null;
        setupListener().then(fn => { unlisten = fn; });

        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    const handleContinue = async () => {
        try {
            await invoke('close_pomodoro_notification');
        } catch (error) {
            console.error('关闭通知失败:', error);
        }
    };

    return (
        <div className={`notification-container ${data.isWorkTime ? 'work-time' : 'break-time'}`}>
            <div className="notification-content">
                <div className="notification-icon">
                    {data.isWorkTime ? '☕' : '🎯'}
                </div>
                <div className="notification-message">
                    {data.message}
                </div>
                <button className="notification-button" onClick={handleContinue}>
                    知道了，继续
                </button>
            </div>
        </div>
    );
}
