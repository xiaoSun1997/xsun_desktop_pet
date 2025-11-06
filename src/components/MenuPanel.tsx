import { useEffect, useRef, useState } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import menuItems from "../../public/config/bubbles.json";
import "./MenuPanel.css";

type MenuItem = {
    label: string;
    action: string;
    icon?: string;
};

export default function MenuPanel() {
    const [items] = useState<MenuItem[]>(menuItems as MenuItem[]);
    const panelRef = useRef<HTMLDivElement>(null);

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

    const createOrShowWindow = async (label: string, config: any) => {
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === label);

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn(`已有${label}窗口，但 show/setFocus 失败，尝试重新创建：`, e);
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
                }, 5000);

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
                            key={index}
                            className="menu-item"
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
