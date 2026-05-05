import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./SystemInfoComponent.css";

// 进程名称到图标的映射
const processIconMap: Record<string, string> = {
    "chrome": "🌐",
    "msedge": "🌐",
    "firefox": "🦊",
    "opera": "🌐",
    "brave": "🌐",
    "explorer": "📁",
    "code": "💻",
    "cursor": "💻",
    "powershell": "⌨️",
    "pwsh": "⌨️",
    "cmd": "⌨️",
    "windows_terminal": "⌨️",
    "wexplore": "⌨️",
    "notepad": "📝",
    "notepad++": "📝",
    "winword": "📄",
    "excel": "📊",
    "powerpnt": "📽️",
    "outlook": "📧",
    "teams": "💬",
    "discord": "💬",
    "slack": "💬",
    "wechat": "💬",
    "qq": "💬",
    "tim": "💬",
    "spotify": "🎵",
    "obs": "🎬",
    "photoshop": "🎨",
    "vscode": "💻",
    "pycharm": "💻",
    "idea": "💻",
    "goland": "💻",
    "webstorm": "💻",
    "clion": "💻",
    "docker": "🐳",
    "git": "⚙️",
    "node": "🟢",
    "npm": "📦",
    "python": "🐍",
    "java": "☕",
    "rust": "🦀",
    "steam": "🎮",
    "epic": "🎮",
    "xbox": "🎮",
    "calculator": "🧮",
    "mspaint": "🎨",
    "snippingtool": "✂️",
    "taskmgr": "📊",
    "control": "⚙️",
    "regedit": "📋",
    "services": "⚙️",
};

function getProcessIcon(name: string, exePath: string): string {
    const key = name.toLowerCase().replace(/\.exe$/, "").replace(/[^a-z0-9]/g, "");
    // 直接从 exe 文件名匹配
    const exeName = exePath.split("\\").pop()?.toLowerCase().replace(".exe", "") || "";
    return processIconMap[key] || processIconMap[exeName] || "⚙";
}

type SystemInfo = {
    cpu_usage: number;
    total_memory: number;
    used_memory: number;
    total_swap: number;
    used_swap: number;
    uptime: number;
    os_name: string;
    os_version: string;
    host_name: string;
    total_processes: number;
    cpu_cores: number;
    cpu_name: string;
};

type ProcessInfo = {
    pid: number;
    name: string;
    cpu_usage: number;
    memory: number;
    exe_path: string;
    ports: number[];
};

export default function SystemInfoComponent() {
    const [info, setInfo] = useState<SystemInfo | null>(null);
    const [cpuProcesses, setCpuProcesses] = useState<ProcessInfo[]>([]);
    const [memProcesses, setMemProcesses] = useState<ProcessInfo[]>([]);
    const [showCpuProcesses, setShowCpuProcesses] = useState(false);
    const [showMemProcesses, setShowMemProcesses] = useState(false);
    const [loadingProcesses, setLoadingProcesses] = useState({ cpu: false, mem: false });

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

    const formatBytesFull = (bytes: number): string => {
        if (bytes >= 1024 * 1024 * 1024) {
            return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
        } else if (bytes >= 1024 * 1024) {
            return (bytes / 1024 / 1024).toFixed(1) + " MB";
        } else if (bytes >= 1024) {
            return (bytes / 1024).toFixed(1) + " KB";
        }
        return bytes + " B";
    };

    const getMemoryPercentage = (): number => {
        if (!info || info.total_memory === 0) return 0;
        return (info.used_memory / info.total_memory) * 100;
    };

    const getSwapPercentage = (): number => {
        if (!info || info.total_swap === 0) return 0;
        return (info.used_swap / info.total_swap) * 100;
    };

    const formatMemoryValue = (used: number, total: number): string => {
        return `${formatBytes(used)}/${formatBytes(total)}GB`;
    };

    const formatUptime = (seconds: number): string => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (days > 0) return `${days}天 ${hours}小时`;
        if (hours > 0) return `${hours}小时 ${mins}分`;
        return `${mins}分钟`;
    };

    const loadCpuProcesses = async () => {
        if (cpuProcesses.length > 0) {
            setShowCpuProcesses(!showCpuProcesses);
            return;
        }
        setLoadingProcesses(prev => ({ ...prev, cpu: true }));
        try {
            const procs = await invoke<ProcessInfo[]>("get_processes", { sortBy: "cpu" });
            setCpuProcesses(procs);
            setShowCpuProcesses(true);
        } catch (e) {
            console.error("获取CPU进程列表失败:", e);
        } finally {
            setLoadingProcesses(prev => ({ ...prev, cpu: false }));
        }
    };

    const loadMemProcesses = async () => {
        if (memProcesses.length > 0) {
            setShowMemProcesses(!showMemProcesses);
            return;
        }
        setLoadingProcesses(prev => ({ ...prev, mem: true }));
        try {
            const procs = await invoke<ProcessInfo[]>("get_processes", { sortBy: "memory" });
            setMemProcesses(procs);
            setShowMemProcesses(true);
        } catch (e) {
            console.error("获取内存进程列表失败:", e);
        } finally {
            setLoadingProcesses(prev => ({ ...prev, mem: false }));
        }
    };

    const handleKillProcess = async (pid: number) => {
        try {
            await invoke("kill_process", { pid });
            setCpuProcesses(prev => prev.filter(p => p.pid !== pid));
            setMemProcesses(prev => prev.filter(p => p.pid !== pid));
        } catch (e) {
            console.error("杀进程失败:", e);
            alert(`杀进程失败: ${e}`);
        }
    };

    const handleClose = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.close();
        } catch (error) {
            console.error("关闭窗口失败:", error);
        }
    };

    return (
        <div className="system-info-container">
            <div className="system-info-header">
                <h1 className="system-info-title">系统监控</h1>
                <div className="system-info-badge">实时</div>
            </div>

            {info ? (
                <div className="metrics-container">
                    {/* === 系统概览 === */}
                    <div className="metric-section">
                        <div className="section-title">系统概览</div>
                        <div className="overview-grid">
                            <div className="overview-item">
                                <span className="overview-label">主机名</span>
                                <span className="overview-value">{info.host_name}</span>
                            </div>
                            <div className="overview-item">
                                <span className="overview-label">操作系统</span>
                                <span className="overview-value">{info.os_name} {info.os_version}</span>
                            </div>
                            <div className="overview-item">
                                <span className="overview-label">CPU</span>
                                <span className="overview-value">{info.cpu_name} ({info.cpu_cores}核)</span>
                            </div>
                            <div className="overview-item">
                                <span className="overview-label">运行时间</span>
                                <span className="overview-value">{formatUptime(info.uptime)}</span>
                            </div>
                            <div className="overview-item">
                                <span className="overview-label">进程数</span>
                                <span className="overview-value">{info.total_processes}</span>
                            </div>
                        </div>
                    </div>

                    {/* === CPU 使用率 === */}
                    <div
                        className={`metric-item expandable ${showCpuProcesses ? 'expanded' : ''}`}
                        onClick={loadCpuProcesses}
                    >
                        <div className="metric-header">
                            <div className="metric-header-left">
                                <span className={`expand-icon ${showCpuProcesses ? 'rotated' : ''}`}>▶</span>
                                <span className="metric-label">CPU</span>
                            </div>
                            <span className="metric-value">{info.cpu_usage.toFixed(1)}%</span>
                        </div>
                        <div className="progress-container">
                            <div
                                className="progress-bar cpu-progress"
                                style={{ width: `${Math.min(info.cpu_usage, 100)}%` }}
                            />
                        </div>
                        {loadingProcesses.cpu && (
                            <div className="process-loading">加载中...</div>
                        )}
                        {showCpuProcesses && cpuProcesses.length > 0 && (
                            <div className="process-list" onClick={e => e.stopPropagation()}>
                                {cpuProcesses.map(p => (
                                    <div key={p.pid} className="process-item">
                                        <div className="process-info">
                                            <div className="process-name" title={p.exe_path}>
                                                <span className="process-default-icon">{getProcessIcon(p.name, p.exe_path)}</span>
                                                {p.name}
                                            </div>
                                            <div className="process-meta">
                                                <span className="process-pid">PID:{p.pid}</span>
                                                <span className="process-cpu">CPU:{p.cpu_usage.toFixed(1)}%</span>
                                                {p.ports.length > 0 && (
                                                    <span className="process-ports">
                                                        📡{p.ports.slice(0, 3).join(",")}
                                                        {p.ports.length > 3 ? "..." : ""}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            className="kill-button"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                const confirmed = await confirm(`确定结束进程 ${p.name}(PID:${p.pid})？`, { title: "确认", kind: "warning" });
                                                if (confirmed) {
                                                    await handleKillProcess(p.pid);
                                                }
                                            }}
                                            title="结束进程"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* === 内存使用 === */}
                    <div
                        className={`metric-item expandable ${showMemProcesses ? 'expanded' : ''}`}
                        onClick={loadMemProcesses}
                    >
                        <div className="metric-header">
                            <div className="metric-header-left">
                                <span className={`expand-icon ${showMemProcesses ? 'rotated' : ''}`}>▶</span>
                                <span className="metric-label">内存</span>
                            </div>
                            <span className="metric-value">
                                {formatMemoryValue(info.used_memory, info.total_memory)}
                            </span>
                        </div>
                        <div className="progress-container">
                            <div
                                className="progress-bar memory-progress"
                                style={{ width: `${getMemoryPercentage()}%` }}
                            />
                        </div>
                        {loadingProcesses.mem && (
                            <div className="process-loading">加载中...</div>
                        )}
                        {showMemProcesses && memProcesses.length > 0 && (
                            <div className="process-list" onClick={e => e.stopPropagation()}>
                                {memProcesses.map(p => (
                                    <div key={p.pid} className="process-item">
                                        <div className="process-info">
                                            <div className="process-name" title={p.exe_path}>
                                                <span className="process-default-icon">{getProcessIcon(p.name, p.exe_path)}</span>
                                                {p.name}
                                            </div>
                                            <div className="process-meta">
                                                <span className="process-pid">PID:{p.pid}</span>
                                                <span className="process-mem">MEM:{formatBytesFull(p.memory)}</span>
                                                {p.ports.length > 0 && (
                                                    <span className="process-ports">
                                                        📡{p.ports.slice(0, 3).join(",")}
                                                        {p.ports.length > 3 ? "..." : ""}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            className="kill-button"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                const confirmed = await confirm(`确定结束进程 ${p.name}(PID:${p.pid})？`, { title: "确认", kind: "warning" });
                                                if (confirmed) {
                                                    await handleKillProcess(p.pid);
                                                }
                                            }}
                                            title="结束进程"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* === 内存使用率 === */}
                    <div className="metric-item">
                        <div className="metric-header">
                            <span className="metric-label">内存率</span>
                            <span className="metric-value">{getMemoryPercentage().toFixed(1)}%</span>
                        </div>
                        <div className="progress-container">
                            <div
                                className="progress-bar"
                                style={{
                                    width: `${getMemoryPercentage()}%`,
                                    background: getMemoryPercentage() > 80
                                        ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                                        : 'linear-gradient(90deg, #8b5cf6, #7c3aed)'
                                }}
                            />
                        </div>
                    </div>

                    {/* === 可用内存 === */}
                    <div className="metric-item">
                        <div className="metric-header">
                            <span className="metric-label">可用</span>
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

                    {/* === 交换分区 === */}
                    {info.total_swap > 0 && (
                        <div className="metric-item">
                            <div className="metric-header">
                                <span className="metric-label">交换区</span>
                                <span className="metric-value">
                                    {formatMemoryValue(info.used_swap, info.total_swap)}
                                </span>
                            </div>
                            <div className="progress-container">
                                <div
                                    className="progress-bar"
                                    style={{
                                        width: `${getSwapPercentage()}%`,
                                        background: 'linear-gradient(90deg, #f472b6, #ec4899)'
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p className="loading-text">获取中...</p>
                </div>
            )}

            <div className="close-button-container">
                <button
                    className="close-button"
                    onClick={handleClose}
                    title="关闭窗口"
                >
                    <div className="close-icon"></div>
                </button>
            </div>
        </div>
    );
}
