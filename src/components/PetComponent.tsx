import { useRef, useState, useEffect } from "react";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import bubblesConfig from "../../public/config/bubbles.json";
import "./PetComponent.css";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const actions = [
    { name: "move", src: "/pet/linglan/wave.gif" }
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
    const downPos = useRef<{ x: number; y: number } | null>(null);
    const dragged = useRef(false);
    const DRAG_THRESHOLD = 6;
    const hideTimer = useRef<number | null>(null);
    const sleepTimer = useRef<number | null>(null);
    const doubleClickTimer = useRef<number | null>(null);
    const clickCount = useRef(0);

    const bubbles: Bubble[] = bubblesConfig as Bubble[];

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

    const onPointerDown: React.PointerEventHandler<HTMLImageElement> = (e) => {
        if (isSleeping) {
            // 休眠时检测双击
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

    const onPointerUp: React.PointerEventHandler<HTMLImageElement> = () => {
        if (isSleeping) return;

        if (!dragged.current) {
            setIndex((prev) => (prev + 1) % actions.length);
            setShowBubbles((prev) => !prev);
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

        return () => {
            unlistenWakeUp.then(fn => fn());
            if (doubleClickTimer.current) clearTimeout(doubleClickTimer.current);
        };
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
    const createOrShowMain = async () => {
        // 先查是否已有 main 窗口（没有被销毁）
        const windows = await getAllWindows();
        const existing = windows.find((w) => w.label === "main");

        if (existing) {
            try {
                await existing.show();
                await existing.setFocus();
            } catch (e) {
                console.warn("已有主窗口，但 show/setFocus 失败，尝试重新创建：", e);
            }
            return;
        }

        // 如果不存在，则新建窗口
        const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

        try {
            const webview = new WebviewWindow("main", {
                url,
                title: "系统信息",
                width: 200,
                height: 600,
                visible: true,
            });

            // 等待窗口创建完成再操作（必须 await）
            await new Promise<void>((resolve, reject) => {
                // 如果创建成功会触发 tauri://created
                const timeout = setTimeout(() => {
                    // 防止无限等待（可调）
                    reject(new Error("等待窗口创建超时"));
                }, 5_000);

                webview.once("tauri://created", () => {
                    clearTimeout(timeout);
                    resolve();
                });

                webview.once("tauri://error", (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建窗口时出错: ${JSON.stringify(e)}`));
                });
            });

            // 创建成功后再安全地 show / focus（有些 API 返回 Promise，推荐 await）
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
    const handleBubbleClick = async (bubble: Bubble) => {
        if (bubble.action === "open-main") {
            await createOrShowMain();
        }

        // 关闭气泡（原逻辑）
        setShowBubbles(false);
    };

    const renderBubbles = () => {
        const radius = 120;
        const count = bubbles.length;
        return bubbles.map((bubble, i) => {
            const angle = (360 / count) * i - 90;
            const rad = (angle * Math.PI) / 180;
            const x = radius * Math.cos(rad);
            const y = radius * Math.sin(rad);

            return (
                <div
                    key={i}
                    className="bubble"
                    style={{
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
            {showBubbles && !isSleeping && <div className="bubbles">{renderBubbles()}</div>}
        </div>
    );
}
