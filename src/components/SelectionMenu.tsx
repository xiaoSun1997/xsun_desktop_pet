import { useEffect, useState, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./SelectionMenu.css";

type SelectionPayload = {
    text: string;
    x: number;
    y: number;
};

export default function SelectionMenu() {
    const [payload, setPayload] = useState<SelectionPayload | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // 设置窗口背景色为菜单颜色，消除 CSS 圆角裁剪处的白边
        (async () => {
            try {
                await getCurrentWindow().setBackgroundColor({ red: 28, green: 28, blue: 38, alpha: 0.95 });
            } catch (e) {
                console.warn("设置窗口背景色失败:", e);
            }
        })();

        // 监听选中文本事件
        const unlisten = listen<SelectionPayload>("selection://show", (event) => {
            setPayload(event.payload);
        });

        // 如果点击窗口外部或失去焦点，自动关闭
        const handleBlur = () => {
            closeMenu();
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                closeMenu();
            }
        };

        window.addEventListener("blur", handleBlur);
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            unlisten.then(fn => fn());
            window.removeEventListener("blur", handleBlur);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    // 点击菜单外部关闭
    useEffect(() => {
        if (!payload) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                closeMenu();
            }
        };

        // 延迟添加，避免触发创建时的事件
        const timer = setTimeout(() => {
            document.addEventListener("mousedown", handleClickOutside);
        }, 100);

        return () => {
            clearTimeout(timer);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [payload]);

    const closeMenu = async () => {
        try {
            const win = getCurrentWindow();
            await win.close();
        } catch (e) {
            console.error("关闭菜单窗口失败:", e);
        }
    };

    const handleTranslate = async () => {
        if (!payload?.text) return;
        try {
            await invoke("open_translator_with_text", { text: payload.text });
        } catch (e) {
            console.error("打开翻译窗口失败:", e);
        }
        await closeMenu();
    };

    const handleOpenUrl = async () => {
        if (!payload?.text) {
            console.error("打开URL失败: payload.text 为空");
            return;
        }
        try {
            // 如果URL未包含协议前缀，自动添加 https://
            let url = payload.text.trim();
            console.log("[打开URL] 原始文本:", url);
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://" + url;
                console.log("[打开URL] 添加协议前缀后:", url);
            }
            console.log("[打开URL] 即将调用 openUrl:", url);
            await openUrl(url);
            console.log("[打开URL] openUrl 调用成功");
        } catch (e) {
            console.error("[打开URL] 打开URL失败:", e);
            console.error("[打开URL] 错误详情:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
        }
        await closeMenu();
    };

    const handleJsonFormat = async () => {
        if (!payload?.text) return;
        try {
            await invoke("open_json_compare_with_text", { text: payload.text });
        } catch (e) {
            console.error("打开JSON比较窗口失败:", e);
        }
        await closeMenu();
    };

    return (
        <div className="selection-menu-container" ref={menuRef} data-tauri-drag-region>
            <div className="menu-header">
                <div className="menu-title">快速操作</div>
            </div>
            <div className="menu-actions">
                <button className="menu-action-btn" onClick={handleTranslate}>
                    <span className="action-icon">📝</span>
                    <span className="action-label">翻译</span>
                </button>
                <button className="menu-action-btn" onClick={handleOpenUrl}>
                    <span className="action-icon">🔗</span>
                    <span className="action-label">打开URL</span>
                </button>
                <button className="menu-action-btn" onClick={handleJsonFormat}>
                    <span className="action-icon">📋</span>
                    <span className="action-label">JSON格式化</span>
                </button>
            </div>
            {payload?.text && (
                <div className="menu-preview">
                    <div className="preview-label">选中内容预览:</div>
                    <div className="preview-text">
                        {payload.text.length > 50
                            ? payload.text.substring(0, 50) + "..."
                            : payload.text}
                    </div>
                </div>
            )}
        </div>
    );
}
