import { useRef, useState, useEffect } from "react";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
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
    const downPos = useRef<{ x: number; y: number } | null>(null);
    const dragged = useRef(false);
    const DRAG_THRESHOLD = 6;
    const hideTimer = useRef<number | null>(null);

    const bubbles: Bubble[] = bubblesConfig as Bubble[];

    // 设置点击穿透状态
    const setClickThrough = async (enabled: boolean) => {
        if (enabled === isClickThrough) return; // 避免重复设置

        try {
            await invoke("set_click_through", { enabled });
            setIsClickThrough(enabled);
            console.log(`点击穿透: ${enabled ? '启用' : '禁用'}`);
        } catch (error) {
            console.error("设置点击穿透失败:", error);
        }
    };

    // 鼠标进入时禁用穿透
    const onMouseEnter = () => {
        if (isClickThrough) {
            setClickThrough(false);
        }
    };

    // 鼠标离开时启用穿透（如果没有气泡）
    const onMouseLeave = () => {
        if (!showBubbles) {
            setTimeout(() => {
                if (!showBubbles) {
                    setClickThrough(true);
                }
            }, 1000);
        }
    };

    const onPointerDown: React.PointerEventHandler<HTMLImageElement> = (e) => {
        downPos.current = { x: e.clientX, y: e.clientY };
        dragged.current = false;
        (e.target as Element).setPointerCapture?.(e.pointerId);
    };

    const onPointerMove: React.PointerEventHandler<HTMLImageElement> = async (e) => {
        if (!downPos.current || dragged.current) return;
        const dx = e.clientX - downPos.current.x;
        const dy = e.clientY - downPos.current.y;
        if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
            dragged.current = true;
            await getCurrentWindow().startDragging();
        }
    };

    const onPointerUp: React.PointerEventHandler<HTMLImageElement> = () => {
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
        }
    }, [showBubbles]);

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
            className="pet-container"
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
            {showBubbles && <div className="bubbles">{renderBubbles()}</div>}
        </div>
    );
}
