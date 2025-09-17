import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./SystemInfoComponent.css";

type SystemInfo = {
    cpu_usage: number;
    total_memory: number;
    used_memory: number;
};

export default function SystemInfoComponent() {
    const [info, setInfo] = useState<SystemInfo | null>(null);

    useEffect(() => {
        invoke<SystemInfo>("get_system_info").then(setInfo);

        const unlistenPromise = listen<SystemInfo>("system://stats", (event) => {
            setInfo(event.payload);
        });

        return () => {
            unlistenPromise.then((unlistenFn) => unlistenFn());
        };
    }, []);

    const formatBytes = (bytes: number): string => {
        return (bytes / 1024 / 1024 / 1024).toFixed(1);
    };

    const getMemoryPercentage = (): number => {
        if (!info || info.total_memory === 0) return 0;
        return (info.used_memory / info.total_memory) * 100;
    };

    return (
        <div className="system-info-container">
            <div className="system-info-header">
                <h1 className="system-info-title">系统监控</h1>
                <div className="system-info-badge">实时监控</div>
            </div>

            {info ? (
                <div className="metrics-container">
                    {/* CPU 使用率 */}
                    <div className="metric-item">
                        <div className="metric-header">
                            <span className="metric-label">CPU 使用率</span>
                            <span className="metric-value">{info.cpu_usage.toFixed(1)}%</span>
                        </div>
                        <div className="progress-container">
                            <div
                                className="progress-bar cpu-progress"
                                style={{ width: `${Math.min(info.cpu_usage, 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* 内存使用 */}
                    <div className="metric-item">
                        <div className="metric-header">
                            <span className="metric-label">内存使用</span>
                            <span className="metric-value">
                                {formatBytes(info.used_memory)}GB / {formatBytes(info.total_memory)}GB
                            </span>
                        </div>
                        <div className="progress-container">
                            <div
                                className="progress-bar memory-progress"
                                style={{ width: `${getMemoryPercentage()}%` }}
                            />
                        </div>
                    </div>

                    {/* 可用内存 */}
                    <div className="metric-item">
                        <div className="metric-header">
                            <span className="metric-label">可用内存</span>
                            <span className="metric-value">
                                {formatBytes(info.total_memory - info.used_memory)}GB
                            </span>
                        </div>
                        <div className="progress-container">
                            <div
                                className="progress-bar"
                                style={{
                                    width: `${100 - getMemoryPercentage()}%`,
                                    background: 'linear-gradient(90deg, #10b981, #059669)'
                                }}
                            />
                        </div>
                    </div>

                    {/* 内存使用率 */}
                    <div className="metric-item">
                        <div className="metric-header">
                            <span className="metric-label">内存使用率</span>
                            <span className="metric-value">{getMemoryPercentage().toFixed(1)}%</span>
                        </div>
                        <div className="progress-container">
                            <div
                                className="progress-bar"
                                style={{
                                    width: `${getMemoryPercentage()}%`,
                                    background: getMemoryPercentage() > 80 ?
                                        'linear-gradient(90deg, #f59e0b, #d97706)' :
                                        'linear-gradient(90deg, #8b5cf6, #7c3aed)'
                                }}
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p className="loading-text">正在获取系统信息...</p>
                </div>
            )}
        </div>
    );
}
