import { useRef, useState, useEffect } from "react";
import { getCurrentWindow, getAllWindows, PhysicalPosition, currentMonitor } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import bubblesConfig from "../../public/config/bubbles.json";
import "./PetComponent.css";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const actions = [
    // { name: "move", src: "/pet/linglan/wave.gif" }
    { name: "move", src: "/pet/rich_cat.gif" }
];

type Bubble = {
    label: string;
    action: string;
};

export default function PetComponent() {
    const [index, setIndex] = useState(0);
    const [showBubbles, setShowBubbles] = useState(false);
    const [isClickThrough, setIsClickThrough] = useState(true);
    const [isSleeping, setIsSleeping] = useState(false);
    const downPos = useRef<{ x: number; y: number } | null>( null);
    const dragged = useRef(false);
    const DRAG_THRESHOLD = 3; // 降低阈值，提升响应速度
    const hideTimer = useRef<number | null>(null);
    const sleepTimer = useRef<number | null>(null);
    const doubleClickTimer = useRef<number | null>(null);
    const clickCount = useRef(0);

    const bubbles: Bubble[] = [
        ...bubblesConfig as Bubble[],
    ];
    // 设置点击穿透状态
    const setClickThrough = async (enabled: boolean) => {
        if (enabled === isClickThrough) return;

        try {
            await invoke("set_click_through", { enabled });
            setIsClickThrough(enabled);
            setIsSleeping(enabled);
            console.log(`桌宠状态: ${enabled ? '休眠' : '活跃'}`);
        } catch (error) {
            console.error("设置点击穿透失败:", error);
        }
    };

    // 唤醒桌宠
    const wakeUpPet = () => {
        setClickThrough(false);
        setIsSleeping(false);
        console.log("桌宠已唤醒");
    };

    // 让桌宠休眠
    const putPetToSleep = () => {
        setClickThrough(false);
        setIsSleeping(true);
        setShowBubbles(false);
        console.log("桌宠进入休眠");
    };

    // 处理双击检测（在休眠状态下通过透明覆盖层检测）
    const handleDoubleClick = async () => {
        await wakeUpPet();
    };

    // 鼠标进入时唤醒
    const onMouseEnter = () => {
        if (isSleeping) {
            wakeUpPet();
        }
        if (sleepTimer.current) {
            clearTimeout(sleepTimer.current);
            sleepTimer.current = null;
        }
    };

    // 鼠标离开时设置延迟休眠
    const onMouseLeave = () => {
        if (!showBubbles) {
            sleepTimer.current = window.setTimeout(() => {
                putPetToSleep();
            }, 3000);
        }
    };

    // 修改为支持整个容器的拖拽
    const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
        if (isSleeping) {
            // 休眠时检测双击 - 只在图片上响应
            if ((e.target as HTMLElement).classList.contains('pet-image')) {
                clickCount.current++;
                if (clickCount.current === 1) {
                    doubleClickTimer.current = window.setTimeout(() => {
                        clickCount.current = 0;
                    }, 300);
                } else if (clickCount.current === 2) {
                    if (doubleClickTimer.current) {
                        clearTimeout(doubleClickTimer.current);
                    }
                    clickCount.current = 0;
                    handleDoubleClick();
                }
            }
            // 阻止事件穿透
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        downPos.current = { x: e.clientX, y: e.clientY };
        dragged.current = false;
        (e.target as Element).setPointerCapture?.(e.pointerId);
    };

    const onPointerMove: React.PointerEventHandler<HTMLImageElement> = async (e) => {
        if (isSleeping || !downPos.current || dragged.current) return;

        const dx = e.clientX - downPos.current.x;
        const dy = e.clientY - downPos.current.y;
        if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
            dragged.current = true;
            await getCurrentWindow().startDragging();
        }
    };

    // 修改 onPointerUp，点击桌宠时打开菜单面板
    const onPointerUp: React.PointerEventHandler<HTMLImageElement> = () => {
        if (isSleeping) return;

        if (!dragged.current) {
            setIndex((prev) => (prev + 1) % actions.length);
            openMenuPanel(); // 替换原来的 setShowBubbles
        }
        downPos.current = null;
        dragged.current = false;
    };

    // 气泡状态变化时的处理
    useEffect(() => {
        if (showBubbles) {
            setClickThrough(false);
            if (sleepTimer.current) {
                clearTimeout(sleepTimer.current);
                sleepTimer.current = null;
            }
        }
    }, [showBubbles]);

    // 初始化
    useEffect(() => {
        setClickThrough(true);

        // 监听唤醒事件
        const unlistenWakeUp = listen("pet://wake-up", () => {
            wakeUpPet();
        });

        // 监听托盘事件
        const unlistenTrayClipboard = listen("tray://open-clipboard", () => {
            createOrShowClipboard();
        });

        const unlistenTraySystem = listen("tray://open-system", () => {
            createOrShowMain();
        });

        const unlistenTrayAI = listen("tray://open-ai", () => {
            createOrShowAIChat();
        });

        const unlistenTrayTranslator = listen("tray://open-translator", () => {
            createOrShowTranslator();
        });

        const unlistenTrayCalendar = listen("tray://open-calendar", () => {
            createOrShowCalendar();
        });

        const unlistenTrayJira = listen("tray://open-jira", () => {
            createOrShowJira();
        });

        const unlistenTrayFileSearch = listen("tray://open-file-search", () => {
            createOrShowFileSearch();
        });

        // 监听全局鼠标中键选中文本事件
        const unlistenSelection = listen<{ text: string; x: number; y: number }>("selection://popup", (event) => {
            createSelectionMenu(event.payload);
        });

        return () => {
            unlistenWakeUp.then(fn => fn());
            unlistenTrayClipboard.then(fn => fn());
            unlistenTraySystem.then(fn => fn());
            unlistenTrayAI.then(fn => fn());
            unlistenTrayTranslator.then(fn => fn());
            unlistenTrayCalendar.then(fn => fn());
            unlistenTrayJira.then(fn => fn());
            unlistenTrayFileSearch.then(fn => fn());
            unlistenSelection.then(fn => fn());
            if (doubleClickTimer.current) clearTimeout(doubleClickTimer.current);
        };
    }, []);

    // 窗口定位到屏幕右下角
    useEffect(() => {
        const positionAtBottomRight = async () => {
            try {
                const appWindow = getCurrentWindow();
                const monitor = await currentMonitor();
                if (monitor) {
                    const { width: screenWidth, height: screenHeight } = monitor.size;
                    // 窗口尺寸 60x60，距右下角各 40px
                    await appWindow.setPosition(new PhysicalPosition(
                        Math.round(screenWidth - 100),
                        Math.round(screenHeight - 100)
                    ));
                }
            } catch (error) {
                console.error("定位桌宠窗口失败:", error);
            }
        };

        positionAtBottomRight();
    }, []);

    // 鼠标离开后隐藏气泡
    useEffect(() => {
        if (!showBubbles) return;

        const handler = (e: MouseEvent) => {
            const pet = document.querySelector(".pet-container");
            if (pet && !pet.contains(e.target as Node)) {
                if (hideTimer.current) clearTimeout(hideTimer.current);
                hideTimer.current = window.setTimeout(() => {
                    setShowBubbles(false);
                }, 3000);
            } else {
                if (hideTimer.current) {
                    clearTimeout(hideTimer.current);
                    hideTimer.current = null;
                }
            }
        };

        document.addEventListener("mousemove", handler);
        return () => {
            document.removeEventListener("mousemove", handler);
            if (hideTimer.current) clearTimeout(hideTimer.current);
        };
    }, [showBubbles]);

    // 创建或显示系统信息窗口
    const createOrShowMain = async () => {
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "main");

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn("已有主窗口，但 show/setFocus 失败，尝试重新创建：", e);
            }
        }

        const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

        try {
            const webview = new WebviewWindow("main", {
                url,
                title: "系统信息",
                width: 400,
                height: 600,
                visible: true,
                transparent: true,
                decorations: false,
                center: true,
                skipTaskbar: true,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待窗口创建超时"));
                }, 5000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            try {
                await webview.show();
                await webview.setFocus();
                console.log("主窗口已创建并显示");
            } catch (e) {
                console.warn("创建后 show/setFocus 失败：", e);
            }
        } catch (err) {
            console.error("创建主窗口失败：", err);
        }
    };

    // 创建或显示剪贴板窗口
    const createOrShowClipboard = async () => {
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "clipboard");

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn("已有剪贴板窗口，但 show/setFocus 失败，尝试重新创建：", e);
            }
        }

        const url = import.meta.env.DEV
            ? "http://localhost:1420/clipboard"
            : "clipboard.html";

        try {
            const webview = new WebviewWindow("clipboard", {
                url,
                title: "剪贴板历史",
                width: 400,
                height: 500,
                visible: true,
                transparent: true,
                decorations: false,
                center: true,
                skipTaskbar: true,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待剪贴板窗口创建超时"));
                }, 5000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建剪贴板窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            try {
                await webview.show();
                await webview.setFocus();
                console.log("剪贴板窗口已创建并显示");
            } catch (e) {
                console.warn("创建后 show/setFocus 失败：", e);
            }
        } catch (err) {
            console.error("创建剪贴板窗口失败：", err);
        }
    };
    const createOrShowAIChat = async () => {
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "ai-chat");

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn("已有AI对话窗口，但 show/setFocus 失败，尝试重新创建：", e);
            }
        }

        const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

        try {
            const webview = new WebviewWindow("ai-chat", {
                url,
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
                skipTaskbar: true,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待AI对话窗口创建超时"));
                }, 5000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建AI对话窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            await webview.show();
            await webview.setFocus();
            console.log("AI对话窗口已创建并显示");
        } catch (err) {
            console.error("创建AI对话窗口失败：", err);
        }
    };

    // 创建或显示翻译器窗口 (新增)
    const createOrShowTranslator = async () => {
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "translator");

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn("已有翻译器窗口，但 show/setFocus 失败，尝试重新创建：", e);
            }
        }

        const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

        try {
            const webview = new WebviewWindow("translator", {
                url,
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
                skipTaskbar: true,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待翻译器窗口创建超时"));
                }, 5000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建翻译器窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            await webview.show();
            await webview.setFocus();
            console.log("翻译器窗口已创建并显示");
        } catch (err) {
            console.error("创建翻译器窗口失败：", err);
        }
    };

// 创建或显示日历窗口
    const createOrShowCalendar = async () => {
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "calendar");

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn("已有日历窗口，但 show/setFocus 失败，尝试重新创建：", e);
            }
        }

        const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

        try {
            const webview = new WebviewWindow("calendar", {
                url,
                title: "智能日历",
                width: 800,
                height: 600,
                visible: true,
                transparent: true,
                decorations: false,
                resizable: true,
                minWidth: 900,
                minHeight: 950,
                shadow: false,
                center: true,
                skipTaskbar: true, // 不在任务栏显示

            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待日历窗口创建超时"));
                }, 5000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建日历窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            await webview.show();
            await webview.setFocus();
            console.log("日历窗口已创建并显示");
        } catch (err) {
            console.error("创建日历窗口失败：", err);
        }
    };
    
    // 创建或显示JIRA窗口
    const createOrShowJira = async () => {
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "jira");

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn("已有JIRA窗口，但 show/setFocus 失败，尝试重新创建：", e);
            }
        }

        const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

        try {
            const webview = new WebviewWindow("jira", {
                url,
                title: "JIRA工作流助手",
                width: 1000,
                height: 600,
                visible: false,
                transparent: true,
                decorations: false,
                resizable: true,
                alwaysOnTop: false,
                center: true,
                skipTaskbar: true,
                shadow: false,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待JIRA窗口创建超时"));
                }, 5000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建JIRA窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            await webview.show();
            await webview.setFocus();
            console.log("JIRA窗口已创建并显示");
        } catch (err) {
            console.error("创建JIRA窗口失败：", err);
        }
    };

    const createOrShowFileSearch = async () => {
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "quick-file-search");

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn("已有快速搜索窗口，但 show/setFocus 失败，尝试重新创建：", e);
            }
        }

        const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

        try {
            const webview = new WebviewWindow("quick-file-search", {
                url,
                title: "快速搜索",
                width: 680,
                height: 460,
                visible: false,
                transparent: true,
                decorations: false,
                resizable: false,
                alwaysOnTop: false,
                center: true,
                skipTaskbar: true,
                shadow: false,
                focus: true,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待快速搜索窗口创建超时"));
                }, 5000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建快速搜索窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            await webview.show();
            await webview.setFocus();
            console.log("快速搜索窗口已创建并显示");
        } catch (err) {
            console.error("创建快速搜索窗口失败：", err);
        }
    };
    
    // 添加最小化到托盘的函数
    const minimizeToTray = async () => {
        try {
            await invoke("hide_to_tray");
            console.log("已最小化到托盘");
        } catch (error) {
            console.error("最小化到托盘失败:", error);
        }
    };

    // 创建选中文本快捷菜单窗口
    const createSelectionMenu = async (payload: { text: string; x: number; y: number }) => {
        // 检查是否已有菜单窗口，有则关闭
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "selection-menu");
        if (existing) {
            try {
                await existing.close();
            } catch (e) {
                console.warn("关闭旧菜单窗口失败:", e);
            }
            // 等待窗口关闭
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

        try {
            const webview = new WebviewWindow("selection-menu", {
                url,
                title: "快速操作",
                width: 220,
                height: 210,
                x: Math.min(payload.x, window.screen.availWidth - 240),
                y: Math.min(payload.y, window.screen.availHeight - 230),
                visible: false,
                transparent: true,
                decorations: false,
                resizable: false,
                alwaysOnTop: true,
                skipTaskbar: true,
                focus: true,
            });

            // 等待窗口创建
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待菜单窗口创建超时"));
                }, 5000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建菜单窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            // 等待窗口加载完成，然后通过事件发送数据
            await webview.show();
            await webview.setFocus();
            // 延迟一下确保窗口已加载完毕
            await new Promise((resolve) => setTimeout(resolve, 300));
            // 通过事件发送选中文本数据
            await webview.emit("selection://show", payload);
            console.log("选中文本快捷菜单已显示");
        } catch (err) {
            console.error("创建选中文本快捷菜单失败:", err);
        }
    };

    // 添加打开菜单面板的函数
    const openMenuPanel = async () => {
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "menu-panel");

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
                return;
            } catch (e) {
                console.warn("关闭旧窗口失败：", e);
            }
        }

        const url = import.meta.env.DEV
            ? "http://localhost:1420/menu"
            : "menu.html";

        try {
            const webview = new WebviewWindow("menu-panel", {
                url,
                title: "功能菜单",
                width: 600,
                height: 600,
                visible: false, // 先隐藏，等加载完再显示
                transparent: true, // ⚠️ 改为不透明
                decorations: false,
                resizable: false,
                alwaysOnTop: false,
                center: true,
                skipTaskbar: true, // 不在任务栏显示
                focus: true,
                shadow: false,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("等待菜单面板创建超时"));
                }, 5000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建菜单面板时出错: ${JSON.stringify(e)}`));
                });
            });

            // 等待内容加载
            await new Promise(resolve => setTimeout(resolve, 100));

            await webview.show();
            await webview.setFocus();
            console.log("菜单面板已创建并显示");
        } catch (err) {
            console.error("创建菜单面板失败：", err);
        }
    };

    // 处理气泡点击事件
    const handleBubbleClick = async (bubble: Bubble) => {
        switch (bubble.action) {
            case "open-main":
                await createOrShowMain();
                break;
            case "open-clipboard":
                await createOrShowClipboard();
                break;
            case "open-ai":
                await createOrShowAIChat();
                break;
            case "translator":  // 添加这个
                await createOrShowTranslator();
                break;
            case "close-pet":
                await handleClosePet();
                break;
            case "calendar":  // 新增
                await createOrShowCalendar();
                break;
            case "minimize-to-tray":  // 添加这个处理
                await minimizeToTray();
                break;
            case "jira":  // 添加JIRA处理
                await createOrShowJira();
                break;
            default:
                console.warn(`未知的气泡动作: ${bubble.action}`);
        }

        // 关闭气泡
        setShowBubbles(false);
    };



// 添加关闭桌宠的函数
    const handleClosePet = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.close();
            console.log("桌宠已关闭");
        } catch (error) {
            console.error("关闭桌宠失败:", error);
        }
    };
    // 修改气泡渲染函数，添加更平滑的位置计算
    const renderBubbles = () => {
        const radius = 120;
        const count = bubbles.length;
        return bubbles.map((bubble, i) => {
            const angle = (360 / count) * i - 90; // 从-90度开始，确保第一个气泡在上方
            const rad = (angle * Math.PI) / 180;
            const x = radius * Math.cos(rad);
            const y = radius * Math.sin(rad);

            return (
                <div
                    key={i}
                    className="bubble"
                    style={{
                        // 保持原来的定位方式
                        transform: `translate(${x}px, ${y}px)`,
                        left: '50%',
                        top: '50%',
                        marginLeft: '-50px',
                        marginTop: '-25px'
                    }}
                    onClick={() => handleBubbleClick(bubble)}
                >
                    <img src="/pet/bubble/bubble.png" className="bubble-bg" />
                    <span className="bubble-text">{bubble.label}</span>
                </div>
            );
        });
    };

    return (
        <div
            className={`pet-container ${isSleeping ? 'sleeping' : ''}`}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <img
                src={actions[index].src}
                alt={actions[index].name}
                className={`pet-image ${isSleeping ? 'sleeping' : ''}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            />

            {/* 添加透明的关闭按钮 */}
            {!isSleeping && !showBubbles && (
                <button
                    className="pet-close-button"
                    onClick={handleClosePet}
                    title="关闭桌宠"
                >
                    <div className="pet-close-icon"></div>
                </button>
            )}
            {showBubbles && !isSleeping && <div className="bubbles">{renderBubbles()}</div>}
        </div>
    );
}
