import { useEffect, useRef, useState, useCallback } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import defaultMenuItems from "../../public/config/bubbles.json";
import "./MenuPanel.css";

type MenuItem = {
    label: string;
    action: string;
    icon?: string;
};

const STORAGE_KEY = "menu-panel-order";

function loadMenuOrder(): MenuItem[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const savedOrder: MenuItem[] = JSON.parse(stored);
            const defaultItems = defaultMenuItems as MenuItem[];
            const savedActions = new Set(savedOrder.map(i => i.action));
            const newItems = defaultItems.filter(i => !savedActions.has(i.action));
            return [...savedOrder.filter(i => savedActions.has(i.action)), ...newItems];
        }
    } catch { /* ignore */ }
    return defaultMenuItems as MenuItem[];
}

function saveMenuOrder(items: MenuItem[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch { /* ignore */ }
}

export default function MenuPanel() {
    const [items, setItems] = useState<MenuItem[]>(loadMenuOrder);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const clickThrottleRef = useRef<boolean>(false);
    const throttleTimerRef = useRef<number | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                closePanel();
            }
        };

        // 延迟添加事件监听，避免创建时立即触发
        const timer = setTimeout(() => {
            document.addEventListener("mousedown", handleClickOutside);
        }, 100);

        return () => {
            clearTimeout(timer);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const closePanel = async () => {
        try {
            const currentWindow = getCurrentWindow();
            await currentWindow.close();
        } catch (error) {
            console.error("关闭面板失败:", error);
        }
    };

    // ===== 拖动排序 =====
    const handleDragStart = useCallback((index: number) => {
        setDragIndex(index);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverIndex(index);
    }, []);

    const handleDragLeave = useCallback(() => {
        setDragOverIndex(null);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        setDragOverIndex(null);
        if (dragIndex === null || dragIndex === dropIndex) {
            setDragIndex(null);
            return;
        }
        setItems(prev => {
            const next = [...prev];
            const [moved] = next.splice(dragIndex, 1);
            next.splice(dropIndex, 0, moved);
            saveMenuOrder(next);
            return next;
        });
        setDragIndex(null);
    }, [dragIndex]);

    const handleDragEnd = useCallback(() => {
        setDragIndex(null);
        setDragOverIndex(null);
    }, []);

    // 清理函数
    useEffect(() => {
        return () => {
            if (throttleTimerRef.current) {
                clearTimeout(throttleTimerRef.current);
            }
        };
    }, []);

    const createOrShowWindow = async (label: string, config: any) => {
        // 防重复点击节流
        if (clickThrottleRef.current) {
            console.log(`[MenuPanel] 节流中，跳过 ${label}`);
            return;
        }
        clickThrottleRef.current = true;
        throttleTimerRef.current = window.setTimeout(() => {
            clickThrottleRef.current = false;
        }, 250);

        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === label);

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn(`已有${label}窗口，但 show/setFocus 失败，尝试关闭并重建：`, e);
                // 关闭僵尸窗口，等待释放后再创建新的
                try {
                    await existing.close();
                } catch (closeErr) {
                    console.warn(`关闭僵尸${label}窗口失败:`, closeErr);
                }
                // 增加等待时间，确保窗口资源完全释放
                await new Promise(r => setTimeout(r, 500));
            }
        }

        const url = import.meta.env.DEV ? config.devUrl : config.prodUrl;

        try {
            const webview = new WebviewWindow(label, {
                url,
                ...config.options,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`等待${label}窗口创建超时`));
                }, 8000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建${label}窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            await webview.show();
            await webview.setFocus();
        } catch (err) {
            console.error(`创建${label}窗口失败：`, err);
        }
    };

    const handleItemClick = async (item: MenuItem) => {
        switch (item.action) {
            case "open-main":
                await createOrShowWindow("main", {
                    devUrl: "http://localhost:1420",
                    prodUrl: "index.html",
                    options: {
                        title: "系统信息",
                        width: 600,
                        height: 600,
                        visible: false,
                        transparent: true,
                        decorations: false,
                        center: true,
                        skipTaskbar: true, // 不在任务栏显示
                        focus: true,
                        shadow: false,
                    }
                });
                break;

            case "open-clipboard":
                await createOrShowWindow("clipboard", {
                    devUrl: "http://localhost:1420/clipboard",
                    prodUrl: "clipboard.html",
                    options: {
                        title: "剪贴板历史",
                        width: 400,
                        height: 500,
                        visible: true,
                        transparent: true,
                        decorations: false,
                        center: true,
                    }
                });
                break;

            case "open-ai":
                await createOrShowWindow("ai-chat", {
                    devUrl: "http://localhost:1420",
                    prodUrl: "index.html",
                    options: {
                        title: "AI对话助手",
                        width: 800,
                        height: 600,
                        visible: true,
                        transparent: true,
                        decorations: false,
                        resizable: true,
                        minWidth: 600,
                        minHeight: 500,
                        center: true,
                    }
                });
                break;

            case "translator":
                await createOrShowWindow("translator", {
                    devUrl: "http://localhost:1420",
                    prodUrl: "index.html",
                    options: {
                        title: "有道翻译",
                        width: 1000,
                        height: 700,
                        visible: true,
                        transparent: true,
                        decorations: false,
                        resizable: true,
                        minWidth: 800,
                        minHeight: 600,
                        center: true,
                    }
                });
                break;

            case "calendar":
                await createOrShowWindow("calendar", {
                    devUrl: "http://localhost:1420",
                    prodUrl: "index.html",
                    options: {
                        title: "智能日历",
                        width: 800,
                        height: 600,
                        visible: true,
                        transparent: true,
                        decorations: false,
                        resizable: true,
                        minWidth: 900,
                        minHeight: 950,
                        center: true,
                    }
                });
                break;

            case "json-compare":
                await createOrShowWindow("json-compare", {
                    devUrl: "http://localhost:1420",
                    prodUrl: "index.html",
                    options: {
                        title: "JSON对比工具",
                        width: 1200,
                        height: 800,
                        visible: true,
                        transparent: true,
                        decorations: false,
                        resizable: true,
                        minWidth: 800,
                        minHeight: 600,
                        center: true,
                    }
                });
                break;

            case "pomodoro-timer":
                await createOrShowWindow("pomodoro-timer", {
                    devUrl: "http://localhost:1420",
                    prodUrl: "index.html",
                    options: {
                        title: "番茄钟",
                        width: 800,
                        height: 600,
                        visible: true,
                        transparent: true,
                        decorations: false,
                        resizable: true,
                        minWidth: 600,
                        minHeight: 500,
                        center: true,
                    }
                });
                break;
                
            case "jira":
                await createOrShowWindow("jira", {
                    devUrl: "http://localhost:1420",
                    prodUrl: "index.html",
                    options: {
                        title: "JIRA工作流助手",
                        width: 1000,
                        height: 1000,
                        visible: true,
                        transparent: true,
                        decorations: false,
                        resizable: true,
                        minWidth: 800,
                        minHeight: 600,
                        center: true,
                    }
                });
                break;

            case "minimize-to-tray":
                await invoke("hide_to_tray");
                break;

            case "close-pet":
                const petWindow = getAllWindows().then(windows =>
                    windows.find(w => w.label === "pet")
                );
                if (petWindow) {
                    (await petWindow)?.close();
                }
                break;

            case "notepad":
                await createOrShowWindow("notepad", {
                    devUrl: "http://localhost:1420",
                    prodUrl: "index.html",
                    options: {
                        title: "记事本",
                        width: 1100,
                        height: 750,
                        center: true,
                        resizable: true,
                    }
                });
                break;

            case "file-search":
                await createOrShowWindow("quick-file-search", {
                    devUrl: "http://localhost:1420",
                    prodUrl: "index.html",
                    options: {
                        title: "快速搜索",
                        width: 680,
                        height: 460,
                        center: true,
                        resizable: false,
                        skipTaskbar: true,
                        transparent: true,
                        decorations: false,
                        shadow: false,
                        focus: true,
                    }
                });
                break;

            default:
                console.warn(`未知的动作: ${item.action}`);
        }

        // 关闭当前九宫格面板
        await closePanel();
    };

    return (
        <div className="menu-panel-container">
            <div className="menu-panel" ref={panelRef}>
                <div className="menu-header">
                    <h2>功能菜单</h2>
                    <button className="close-btn" onClick={closePanel}>
                        <span>×</span>
                    </button>
                </div>
                <div className="menu-grid">
                    {items.map((item, index) => (
                        <div
                            key={item.action}
                            className={`menu-item${dragIndex === index ? ' dragging' : ''}${dragOverIndex === index ? ' drag-over' : ''}`}
                            draggable
                            onDragStart={() => handleDragStart(index)}
                            onDragOver={(e) => handleDragOver(e, index)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, index)}
                            onDragEnd={handleDragEnd}
                            onClick={() => handleItemClick(item)}
                        >
                            <div className="menu-item-icon">
                                <img
                                    src={item.icon || `/pet/component/${item.action}.png`}
                                    alt={item.label}
                                    onError={(e) => {
                                        // 如果图片加载失败，使用默认图标
                                        (e.target as HTMLImageElement).src = "/pet/component/default.png";
                                    }}
                                />
                            </div>
                            <div className="menu-item-label">{item.label}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
