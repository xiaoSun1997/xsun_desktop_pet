import { useRef, useState, useEffect } from "react";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import bubblesConfig from "../../public/config/bubbles.json";
import "./PetComponent.css";

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
    const [isDormant, setIsDormant] = useState(false); // 新增：是否处于休眠状态
    const downPos = useRef<{ x: number; y: number } | null>(null);
    const dragged = useRef(false);
    const DRAG_THRESHOLD = 6;
    const hideTimer = useRef<number | null>(null);
    const dormantTimer = useRef<number | null>(null); // 新增：休眠定时器

    const bubbles: Bubble[] = bubblesConfig as Bubble[];

    // 设置点击穿透状态
    const setClickThrough = async (enabled: boolean) => {
        if (enabled === isClickThrough) return;

        try {
            await invoke("set_click_through", { enabled });
            setIsClickThrough(enabled);
            console.log(`点击穿透: ${enabled ? '启用' : '禁用'}`);
        } catch (error) {
            console.error("设置点击穿透失败:", error);
        }
    };

    // 新增：唤醒桌宠
    const wakeUpPet = async () => {
        console.log("桌宠被唤醒");
        setIsDormant(false);
        setClickThrough(false);
        if (dormantTimer.current) {
            clearTimeout(dormantTimer.current);
            dormantTimer.current = null;
        }
    };

    // 新增：设置桌宠进入休眠状态
    const setDormant = () => {
        console.log("桌宠进入休眠状态");
        setIsDormant(true);
        setClickThrough(true);
        setShowBubbles(false);
    };

    // 鼠标进入时的处理
    const onMouseEnter = () => {
        if (!isDormant && isClickThrough) {
            setClickThrough(false);
        }
        // 清除休眠定时器
        if (dormantTimer.current) {
            clearTimeout(dormantTimer.current);
            dormantTimer.current = null;
        }
    };

    // 鼠标离开时的处理
    const onMouseLeave = () => {
        if (!showBubbles && !isDormant) {
            // 设置休眠定时器
            dormantTimer.current = window.setTimeout(() => {
                setDormant();
            }, 5000); // 5秒后进入休眠状态
        }
    };

    const onPointerDown: React.PointerEventHandler<HTMLImageElement> = (e) => {
        if (isDormant) return; // 休眠状态下不响应
        downPos.current = { x: e.clientX, y: e.clientY };
        dragged.current = false;
        (e.target as Element).setPointerCapture?.(e.pointerId);
    };

    const onPointerMove: React.PointerEventHandler<HTMLImageElement> = async (e) => {
        if (isDormant || !downPos.current || dragged.current) return; // 休眠状态下不响应
        const dx = e.clientX - downPos.current.x;
        const dy = e.clientY - downPos.current.y;
        if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
            dragged.current = true;
            await getCurrentWindow().startDragging();
        }
    };

    const onPointerUp: React.PointerEventHandler<HTMLImageElement> = () => {
        if (isDormant) return; // 休眠状态下不响应
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
            // 清除休眠定时器
            if (dormantTimer.current) {
                clearTimeout(dormantTimer.current);
                dormantTimer.current = null;
            }
        }
    }, [showBubbles]);

    // 监听唤醒事件
    useEffect(() => {
        const setupListeners = async () => {
            // 监听桌宠唤醒事件
            await listen("pet://wake-up", () => {
                wakeUpPet();
            });

            // 设置全局鼠标钩子
            try {
                await invoke("setup_global_mouse_hook");
            } catch (error) {
                console.error("设置全局鼠标钩子失败:", error);
            }
        };

        setupListeners();

        return () => {
            // 清理钩子
            invoke("remove_global_mouse_hook").catch(console.error);
            if (dormantTimer.current) {
                clearTimeout(dormantTimer.current);
            }
        };
    }, []);

    // 初始化时启用穿透
    useEffect(() => {
        setClickThrough(true);
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

    const handleBubbleClick = async (bubble: Bubble) => {
        if (bubble.action === "open-main") {
            const windows = await getAllWindows();
            const main = windows.find((w) => w.label === "main");
            if (main) {
                await main.show();
                await main.setFocus();
            }
        }
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
            className={`pet-container ${isDormant ? 'dormant' : ''}`}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <img
                src={actions[index].src}
                alt={actions[index].name}
                className="pet-image"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            />
            {showBubbles && !isDormant && (
                <div className="bubbles">{renderBubbles()}</div>
            )}
            {isDormant && (
                <div className="wake-up-hint">双击唤醒</div>
            )}
        </div>
    );
}
