import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./ClipboardComponent.css";

type ClipboardItem = {
    content: string;
    timestamp: number;
    id: number;
};

export default function ClipboardComponent() {
    const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]);
    const [copyStatus, setCopyStatus] = useState<{ [key: number]: boolean }>({});
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadClipboardHistory();
        const interval = setInterval(loadClipboardHistory, 2000);
        return () => clearInterval(interval);
    }, []);

    const loadClipboardHistory = async () => {
        try {
            const history = await invoke<ClipboardItem[]>("get_clipboard_history");
            setClipboardItems(history);
        } catch (error) {
            console.error("获取剪贴板历史失败:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = async (content: string, id: number) => {
        try {
            await invoke("copy_to_clipboard", { content });
            setCopyStatus(prev => ({ ...prev, [id]: true }));
            setTimeout(() => {
                setCopyStatus(prev => ({ ...prev, [id]: false }));
            }, 2000);
        } catch (error) {
            console.error("复制失败:", error);
        }
    };

    const handleExpand = async (content: string) => {
        try {
            await invoke("open_expand_window", { content });
        } catch (error) {
            console.error("打开详情窗口失败:", error);
        }
    };

    const handleClearHistory = async () => {
        try {
            await invoke("clear_clipboard_history");
            setClipboardItems([]);
        } catch (error) {
            console.error("清空历史失败:", error);
        }
    };

    const handleClose = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.close();
        } catch (error) {
            console.error('关闭窗口失败:', error);
        }
    };

    const formatTime = (timestamp: number): string => {
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        if (diff < 60000) {
            return "刚刚";
        } else if (diff < 3600000) {
            return `${Math.floor(diff / 60000)}分钟前`;
        } else if (diff < 86400000) {
            return `${Math.floor(diff / 3600000)}小时前`;
        } else {
            return date.toLocaleDateString();
        }
    };

    const truncateText = (text: string, maxLength: number = 100): string => {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + "...";
    };

    const formatContentSize = (content: string): string => {
        const size = new Blob([content]).size;
        if (size < 1024) return `${size}B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
        return `${(size / (1024 * 1024)).toFixed(1)}MB`;
    };

    return (
        <div className="clipboard-container">
            <div className="clipboard-header">
                <h1 className="clipboard-title">剪贴板历史</h1>
                <div className="clipboard-badge">最近5条</div>
                {clipboardItems.length > 0 && (
                    <button
                        className="clear-button"
                        onClick={handleClearHistory}
                        title="清空历史"
                    >
                        <div className="clear-icon"></div>
                        <span>清空</span>
                    </button>
                )}
            </div>

            <div className="clipboard-items">
                {isLoading ? (
                    <div className="loading-container">
                        <div className="loading-spinner"></div>
                        <p className="loading-text">加载中...</p>
                    </div>
                ) : clipboardItems.length > 0 ? (
                    clipboardItems.map((item) => (
                        <div key={item.id} className="clipboard-item">
                            <div className="clipboard-content">
                                <div className="content-text">
                                    {truncateText(item.content)}
                                </div>
                                <div className="content-meta">
                                    <span className="content-time">
                                        {formatTime(item.timestamp)}
                                    </span>
                                    <span className="content-size">
                                        {formatContentSize(item.content)}
                                    </span>
                                </div>
                            </div>
                            <div className="action-buttons">
                                <button
                                    className={`action-copy-button ${copyStatus[item.id] ? 'copied' : ''}`}
                                    onClick={() => handleCopy(item.content, item.id)}
                                    title={copyStatus[item.id] ? "已复制!" : "复制"}
                                >
                                    <div className="copy-icon"></div>
                                    <span>{copyStatus[item.id] ? "已复制" : "复制"}</span>
                                </button>

                                <button
                                    className="expand-button"
                                    onClick={() => handleExpand(item.content)}
                                    title="编辑/查看详情"
                                >
                                    <div className="expand-icon"></div>
                                </button>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="empty-state">
                        <p>暂无剪贴板历史</p>
                        <p className="empty-hint">复制一些内容试试吧</p>
                    </div>
                )}
            </div>

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
