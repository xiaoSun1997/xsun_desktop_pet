import { useEffect, useState, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import "./SelectionMenu.css";

// 🔧 调试模式：禁用自动关闭，方便检查点击问题。调试完成后改回 false
const DEBUG_NO_AUTO_CLOSE = true;

type SelectionPayload = {
    text: string;
    x: number;
    y: number;
};

export default function SelectionMenu() {
    const [payload, setPayload] = useState<SelectionPayload | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const isReadyRef = useRef(false);
    const blurTimerRef = useRef<number>(0);
    const isInteractingRef = useRef(false);

    // 就绪标记：窗口挂载后 300ms 才允许 blur 关闭，避免创建初期的瞬态 blur
    useEffect(() => {
        const timer = setTimeout(() => {
            isReadyRef.current = true;
            console.log('[SelectionMenu] isReadyRef 已设为 true (300ms)');
        }, 300);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        // 设置窗口背景色为菜单颜色，消除 CSS 圆角裁剪处的白边
        (async () => {
            try {
                await getCurrentWindow().setBackgroundColor({ red: 28, green: 28, blue: 38, alpha: 0 });
            } catch (e) {
                console.warn("设置窗口背景色失败:", e);
            }
        })();

        // 监听选中文本事件
        const unlisten = listen<SelectionPayload>("selection://show", (event) => {
            setPayload(event.payload);
        });

        // 失去焦点时延迟关闭：给 click 事件留出时间执行
        const handleBlur = () => {
            if (DEBUG_NO_AUTO_CLOSE) { console.log('[SelectionMenu] DEBUG: blur 事件被禁用'); return; }
            const ready = isReadyRef.current;
            const interacting = isInteractingRef.current;
            console.log(`[SelectionMenu] blur 事件触发 | isReady=${ready} | isInteracting=${interacting}`);
            if (!ready) {
                console.log('[SelectionMenu] blur 忽略：尚未就绪');
                return;
            }
            clearTimeout(blurTimerRef.current);
            blurTimerRef.current = window.setTimeout(() => {
                const stillInteracting = isInteractingRef.current;
                console.log(`[SelectionMenu] blur 200ms 延迟到期 | isInteracting=${stillInteracting}`);
                if (!stillInteracting) {
                    console.log('[SelectionMenu] blur 触发 closeMenu');
                    closeMenu();
                } else {
                    console.log('[SelectionMenu] blur 取消：用户正在交互');
                }
            }, 200);
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (DEBUG_NO_AUTO_CLOSE) return;
            if (e.key === "Escape") {
                closeMenu();
            }
        };

        window.addEventListener("blur", handleBlur);
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            unlisten.then(fn => fn());
            clearTimeout(blurTimerRef.current);
            window.removeEventListener("blur", handleBlur);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    // 点击菜单外部关闭
    useEffect(() => {
        if (!payload || DEBUG_NO_AUTO_CLOSE) {
            if (DEBUG_NO_AUTO_CLOSE) console.log('[SelectionMenu] DEBUG: clickOutside 被禁用');
            return;
        }

        const handleClickOutside = (e: MouseEvent) => {
            console.log(`[SelectionMenu] mousedown 事件 | target=`, e.target, `| menuRef.contains=${menuRef.current?.contains(e.target as Node)}`);
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                console.log('[SelectionMenu] clickOutside 触发 closeMenu');
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
        console.log('[SelectionMenu] closeMenu 被调用');
        try {
            const win = getCurrentWindow();
            await win.close();
        } catch (e) {
            console.error("关闭菜单窗口失败:", e);
        }
    };

    const handleTranslate = async () => {
        console.log('[SelectionMenu] handleTranslate 被调用, text=', payload?.text?.substring(0, 30));
        if (!payload?.text) return;
        try {
            console.log('[SelectionMenu] handleTranslate: 调用 open_translator_with_text');
            await invoke("open_translator_with_text", { text: payload.text });
            console.log('[SelectionMenu] handleTranslate: open_translator_with_text 成功');
        } catch (e) {
            console.error("打开翻译窗口失败:", e);
        }
        if (!DEBUG_NO_AUTO_CLOSE) await closeMenu();
    };

    const handleOpenUrl = async () => {
        console.log('[SelectionMenu] handleOpenUrl 被调用, text=', payload?.text?.substring(0, 50));
        if (!payload?.text) {
            console.error("打开URL失败: payload.text 为空");
            return;
        }
        try {
            let url = payload.text.trim();
            console.log('[SelectionMenu] handleOpenUrl: 原始文本:', url);
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://" + url;
                console.log('[SelectionMenu] handleOpenUrl: 添加协议前缀后:', url);
            }
            console.log('[SelectionMenu] handleOpenUrl: 即将调用 openUrl:', url);
            await openUrl(url);
            console.log('[SelectionMenu] handleOpenUrl: openUrl 调用成功');
        } catch (e) {
            console.error('[SelectionMenu] handleOpenUrl: 打开URL失败:', e);
        }
        if (!DEBUG_NO_AUTO_CLOSE) await closeMenu();
    };

    const handleJsonFormat = async () => {
        console.log('[SelectionMenu] handleJsonFormat 被调用, text=', payload?.text?.substring(0, 30));
        if (!payload?.text) return;
        try {
            console.log('[SelectionMenu] handleJsonFormat: 调用 open_json_compare_with_text');
            await invoke("open_json_compare_with_text", { text: payload.text });
            console.log('[SelectionMenu] handleJsonFormat: open_json_compare_with_text 成功');
        } catch (e) {
            console.error("打开JSON比较窗口失败:", e);
        }
        if (!DEBUG_NO_AUTO_CLOSE) await closeMenu();
    };

    // 按钮交互标记：防止 blur 时按钮 click 还没执行
    const onBtnMouseDown = () => {
        console.log('[SelectionMenu] onBtnMouseDown - 开始交互');
        isInteractingRef.current = true;
    };
    const onBtnMouseUp = () => {
        console.log('[SelectionMenu] onBtnMouseUp - 结束交互延迟 100ms');
        setTimeout(() => { isInteractingRef.current = false; }, 100);
    };

    return (
        <div className="selection-menu-container" ref={menuRef}>
            <div className="menu-header" data-tauri-drag-region>
                <div className="menu-title">快速操作</div>
            </div>
            <div className="menu-actions">
                <button className="menu-action-btn" onClick={handleTranslate} onMouseDown={onBtnMouseDown} onMouseUp={onBtnMouseUp}>
                    <span className="action-icon">📝</span>
                    <span className="action-label">翻译</span>
                </button>
                <button className="menu-action-btn" onClick={handleOpenUrl} onMouseDown={onBtnMouseDown} onMouseUp={onBtnMouseUp}>
                    <span className="action-icon">🔗</span>
                    <span className="action-label">打开URL</span>
                </button>
                <button className="menu-action-btn" onClick={handleJsonFormat} onMouseDown={onBtnMouseDown} onMouseUp={onBtnMouseUp}>
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
