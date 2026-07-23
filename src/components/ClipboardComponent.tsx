import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./ClipboardComponent.css";

type ClipboardItem = {
    content: string;
    content_type: string; // "text" 或 "image"
    timestamp: number;
    id: number;
};

const MAX_COLLAPSE_LENGTH = 500;
const PREVIEW_LENGTH = 200;
const PAGE_SIZE = 10;

export default function ClipboardComponent() {
    const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]);
    const [copyStatus, setCopyStatus] = useState<{ [key: number]: boolean }>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [enlargeImage, setEnlargeImage] = useState<string | null>(null);
    const [enlargeSize, setEnlargeSize] = useState<{width: number; height: number} | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        loadClipboardHistory(1);
        // 每1.5秒检查是否有新的剪贴板内容，有则追加到前面，不替换整个列表
        const interval = setInterval(async () => {
            try {
                const history = await invoke<ClipboardItem[]>("get_clipboard_history");
                if (history.length === 0) return;
                setClipboardItems(prev => {
                    if (prev.length === 0) return history;
                    // 比较最新的时间戳，只在有新内容时才追加
                    const latestTimestamp = prev[0].timestamp;
                    const newItems = history.filter(item => item.timestamp > latestTimestamp);
                    if (newItems.length > 0) {
                        return [...newItems, ...prev];
                    }
                    return prev;
                });
                setHasMore(history.length >= PAGE_SIZE);
            } catch (error) {
                console.error("自动刷新剪贴板失败:", error);
            }
        }, 1500);
        return () => clearInterval(interval);
    }, []);

    const loadClipboardHistory = async (page: number = 1, silent: boolean = false) => {
        try {
            if (page === 1) {
                if (!silent) setIsLoading(true);
                const history = await invoke<ClipboardItem[]>("get_clipboard_history");
                setClipboardItems(history);
                setHasMore(history.length >= PAGE_SIZE);
                setCurrentPage(1);
            } else {
                setIsLoadingMore(true);
                const history = await invoke<ClipboardItem[]>("get_clipboard_history_paginated", {
                    page,
                    pageSize: PAGE_SIZE,
                });
                if (history.length < PAGE_SIZE) {
                    setHasMore(false);
                }
                setClipboardItems(prev => [...prev, ...history]);
                setCurrentPage(page);
                setIsLoadingMore(false);
            }
        } catch (error) {
            console.error("获取剪贴板历史失败:", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadMore = () => {
        if (!isLoadingMore && hasMore) {
            loadClipboardHistory(currentPage + 1);
        }
    };

    const handleDelete = async (id: number) => {
        try {
            await invoke("delete_clipboard_item", { id });
            setClipboardItems(prev => prev.filter(item => item.id !== id));
            setConfirmDelete(null);
        } catch (error) {
            console.error("删除失败:", error);
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
            setHasMore(false);
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

    const handleImageDblClick = (content: string) => {
        setEnlargeImage(content);
        setEnlargeSize(null);
        // 计算 2.5 倍原始尺寸
        const img = new Image();
        img.onload = () => {
            setEnlargeSize({
                width: Math.round(img.naturalWidth * 2.5),
                height: Math.round(img.naturalHeight * 2.5),
            });
        };
        img.onerror = () => {
            // 加载失败时使用默认尺寸
            setEnlargeSize({ width: 800, height: 600 });
        };
        img.src = content;
    };

    const handleCloseEnlarge = () => {
        setEnlargeImage(null);
        setEnlargeSize(null);
    };

    const toggleExpand = (id: number) => {
        setExpandedItems(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
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

    const formatContentSize = (content: string): string => {
        const size = new Blob([content]).size;
        if (size < 1024) return `${size}B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
        return `${(size / (1024 * 1024)).toFixed(1)}MB`;
    };

    const getContentTypeLabel = (type: string): string => {
        return type === "image" ? "图片" : "文本";
    };

    const getContentTypeIcon = (type: string): string => {
        return type === "image" ? "🖼️" : "📄";
    };

    const truncateText = (text: string, isExpanded: boolean): string => {
        if (!isExpanded && text.length > MAX_COLLAPSE_LENGTH) {
            return text.substring(0, PREVIEW_LENGTH) + "...";
        }
        return text;
    };

    const shouldShowExpandToggle = (content: string): boolean => {
        return content.length > MAX_COLLAPSE_LENGTH;
    };

    const JSON_FORMAT_LIMIT = 200 * 1024;

    const isLikelyJson = (content: string): boolean => {
        if (content.length > JSON_FORMAT_LIMIT) return false;
        const trimmed = content.trim();
        return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
               (trimmed.startsWith("[") && trimmed.endsWith("]"));
    };

    const formatJsonForDisplay = (content: string): string => {
        try {
            const parsed = JSON.parse(content);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return content;
        }
    };

    return (
        <div className="clipboard-container">
            <div className="clipboard-header" data-tauri-drag-region>
                <div className="clipboard-header-top">
                    <h1 className="clipboard-title">剪贴板</h1>
                    <div className="clipboard-badge">{clipboardItems.length} 项</div>
                </div>
                <div className="clipboard-header-actions">
                    {clipboardItems.length > 0 && (
                        <button
                            className="clipboard-action-btn clear-btn"
                            onClick={handleClearHistory}
                            title="清空历史"
                        >
                            🗑️ 清空
                        </button>
                    )}
                </div>
            </div>

            <div className="clipboard-items" ref={scrollRef}>
                {isLoading ? (
                    <div className="cb-loading-container">
                        <div className="cb-loading-spinner"></div>
                        <p className="cb-loading-text">加载中...</p>
                    </div>
                ) : clipboardItems.length > 0 ? (
                    <>
                        {clipboardItems.map((item) => {
                            const isExpanded = expandedItems.has(item.id);
                            const needsToggle = shouldShowExpandToggle(item.content);
                            const displayContent = truncateText(
                                item.content_type === "text" && isLikelyJson(item.content)
                                    ? formatJsonForDisplay(item.content)
                                    : item.content,
                                isExpanded
                            );

                            return (
                                <div
                                    key={item.id}
                                    className={`cb-item ${item.content_type === "image" ? "cb-item-image" : "cb-item-text"}`}
                                >
                                    <div className="cb-item-header">
                                        <span className="cb-type-badge" data-type={item.content_type}>
                                            {getContentTypeIcon(item.content_type)} {getContentTypeLabel(item.content_type)}
                                        </span>
                                        <span className="cb-time">{formatTime(item.timestamp)}</span>
                                        <span className="cb-size">{formatContentSize(item.content)}</span>
                                    </div>

                                    <div className="cb-item-body">
                                        {item.content_type === "image" ? (
                                            <div className="cb-image-container">
                                                <img
                                                    src={item.content}
                                                    alt="剪贴板图片"
                                                    className="cb-image"
                                                    onDoubleClick={() => handleImageDblClick(item.content)}
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).style.display = "none";
                                                    }}
                                                />
                                                <div className="cb-image-hint">双击放大</div>
                                            </div>
                                        ) : (
                                            <div className="cb-text-container">
                                                <pre className={`cb-text ${isExpanded ? "cb-text-expanded" : ""}`}>
                                                    {displayContent || "（空内容）"}
                                                </pre>
                                                {needsToggle && (
                                                    <button
                                                        className="cb-expand-toggle"
                                                        onClick={() => toggleExpand(item.id)}
                                                    >
                                                        {isExpanded ? "▲ 收起" : `▼ 展开全部 (${(item.content.length / 1024).toFixed(1)}KB)`}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="cb-item-actions">
                                        <button
                                            className={`cb-action-btn cb-copy-btn ${copyStatus[item.id] ? 'copied' : ''}`}
                                            onClick={() => handleCopy(item.content, item.id)}
                                            title={copyStatus[item.id] ? "已复制!" : "复制到剪贴板"}
                                        >
                                            <span className="cb-action-icon">
                                                {copyStatus[item.id] ? "✓" : "📋"}
                                            </span>
                                            <span>{copyStatus[item.id] ? "已复制" : "复制"}</span>
                                        </button>
                                        {item.content_type === "text" && (
                                            <button
                                                className="cb-action-btn cb-edit-btn"
                                                onClick={() => handleExpand(item.content)}
                                                title="编辑/查看详情"
                                            >
                                                <span className="cb-action-icon">✏️</span>
                                                <span>编辑</span>
                                            </button>
                                        )}
                                        <button
                                            className="cb-action-btn cb-delete-btn"
                                            onClick={() => setConfirmDelete(item.id)}
                                            title="删除"
                                        >
                                            <span className="cb-action-icon">🗑️</span>
                                            <span>删除</span>
                                        </button>
                                    </div>

                                    {confirmDelete === item.id && (
                                        <div className="cb-delete-confirm">
                                            <span>确认删除？</span>
                                            <button
                                                className="cb-confirm-yes"
                                                onClick={() => handleDelete(item.id)}
                                            >
                                                确认
                                            </button>
                                            <button
                                                className="cb-confirm-no"
                                                onClick={() => setConfirmDelete(null)}
                                            >
                                                取消
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {hasMore && (
                            <div className="cb-load-more-container">
                                <button
                                    className="cb-load-more-btn"
                                    onClick={handleLoadMore}
                                    disabled={isLoadingMore}
                                >
                                    {isLoadingMore ? (
                                        <>
                                            <div className="cb-loading-spinner-small"></div>
                                            加载中...
                                        </>
                                    ) : (
                                        "加载更多"
                                    )}
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="cb-empty-state">
                        <div className="cb-empty-icon">📋</div>
                        <p className="cb-empty-title">暂无剪贴板历史</p>
                        <p className="cb-empty-hint">复制一些内容试试吧</p>
                    </div>
                )}
            </div>

            <div className="clipboard-footer">
                <button
                    className="cb-close-btn"
                    onClick={handleClose}
                    title="关闭窗口"
                >
                    <div className="cb-close-icon"></div>
                </button>
            </div>


            {/* 图片放大弹窗 */}
            {enlargeImage && (
                <div className="cb-image-overlay" onClick={handleCloseEnlarge}>
                    <div className="cb-image-enlarge-container">
                        <button className="cb-image-enlarge-close" onClick={handleCloseEnlarge}>
                            ✕
                        </button>
                        <img
                            src={enlargeImage}
                            alt="放大的图片"
                            className="cb-image-enlarge"
                            onClick={(e) => e.stopPropagation()}
                            style={enlargeSize ? {
                                width: enlargeSize.width,
                                height: enlargeSize.height,
                                maxWidth: '90vw',
                                maxHeight: '90vh',
                            } : undefined}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
