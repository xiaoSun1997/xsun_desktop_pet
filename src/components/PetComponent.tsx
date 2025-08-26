import { useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./PetComponent.css";

const actions = [
    { name: "move",  src: "/pet/linglan/wave.gif"  }
    // ,
    // { name: "relax", src: "/pet/relax.gif" },
    // { name: "sit",   src: "/pet/sit.gif"   },
    // { name: "jump",  src: "/pet/sleep.gif" }
];

export default function PetComponent() {
    const [index, setIndex] = useState(0);
    const downPos = useRef<{x:number;y:number}|null>(null);
    const dragged = useRef(false);
    const DRAG_THRESHOLD = 6; // 超过6px认定为拖拽

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
            await getCurrentWindow().startDragging(); // 需要 allow-start-dragging 权限
        }
    };

    const onPointerUp: React.PointerEventHandler<HTMLImageElement> = () => {
        if (!dragged.current) {
            setIndex((prev) => (prev + 1) % actions.length); // 作为“点击”处理
        }
        downPos.current = null;
        dragged.current = false;
    };

    return (
        <div className="pet-container">
            <img
                src={actions[index].src}
                alt={actions[index].name}
                className="pet-image"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
            />
        </div>
    );
}
