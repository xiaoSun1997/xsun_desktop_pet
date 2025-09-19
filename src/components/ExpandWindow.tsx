import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "./ExpandWindow.css";

export default function ExpandWindow() {
    const [content, setContent] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved" | "error">("");
    const [originalContent, setOriginalContent] = useState("");

    useEffect(() => {
        // 从全局变量获取内容
        const initialContent = (window as any).__EXPAND_CONTENT__ || "";
        setContent(initialContent);
        setOriginalContent(initialContent);
    }, []);

    const handleClose = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.close();
        } catch (error) {
            console.error('关闭窗口失败:', error);
        }
    };

    const handleCopy = async () => {
        try {
            await invoke("copy_to_clipboard", { content });
            setSaveStatus("saved");
            setTimeout(() => setSaveStatus(""), 2000);
        } catch (error) {
            console.error('复制失败:', error);
            setSaveStatus("error");
            setTimeout(() => setSaveStatus(""), 2000);
        }
    };

    const handleSave = async () => {
        try {
            setSaveStatus("saving");
            // 将编辑后的内容添加到剪贴板历史
            await invoke("add_to_clipboard_history", { content });
            // 同时复制到系统剪贴板
            await invoke("copy_to_clipboard", { content });
            setOriginalContent(content);
            setSaveStatus("saved");
            setTimeout(() => setSaveStatus(""), 2000);
        } catch (error) {
            console.error('保存失败:', error);
            setSaveStatus("error");
            setTimeout(() => setSaveStatus(""), 2000);
        }
    };

    const handleCancel = () => {
        setContent(originalContent);
        setIsEditing(false);
    };

    const hasChanges = content !== originalContent;
    const contentSize = new Blob([content]).size;
    const formatSize = (size: number): string => {
        if (size < 1024) return `${size}B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
        return `${(size / (1024 * 1024)).toFixed(1)}MB`;
    };

    return (
        <div className="expand-container">
            <div className="expand-header">
                <div className="header-left">
                    <h1 className="expand-title">剪贴板内容编辑</h1>
                    <div className="content-info">
                        <span className="content-size">{formatSize(contentSize)}</span>
                        <span className="content-length">{content.length} 字符</span>
                    </div>
                </div>
                <div className="header-actions">
                    {isEditing ? (
                        <>
                            <button
                                className="cancel-button"
                                onClick={handleCancel}
                                title="取消编辑"
                            >
                                取消
                            </button>
                            <button
                                className={`save-button ${!hasChanges ? 'disabled' : ''} ${saveStatus}`}
                                onClick={handleSave}
                                disabled={!hasChanges || saveStatus === "saving"}
                                title="保存到剪贴板"
                            >
                                {saveStatus === "saving" ? "保存中..." :
                                    saveStatus === "saved" ? "已保存" :
                                        saveStatus === "error" ? "保存失败" : "保存"}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                className={`copy-button ${saveStatus}`}
                                onClick={handleCopy}
                                title="复制全部内容"
                            >
                                <div className="copy-icon"></div>
                                <span>{saveStatus === "saved" ? "已复制" : "复制"}</span>
                            </button>
                            <button
                                className="edit-button"
                                onClick={() => setIsEditing(true)}
                                title="编辑内容"
                            >
                                <div className="edit-icon"></div>
                                <span>编辑</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className="expand-content">
                {isEditing ? (
                    <textarea
                        className="content-editor"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="在此编辑内容..."
                        autoFocus
                    />
                ) : (
                    <div className="content-display">
                        <pre className="content-text">{content || "暂无内容"}</pre>
                    </div>
                )}
            </div>

            <div className="expand-close-container">
                <button
                    className="expand-close-button"
                    onClick={handleClose}
                    title="关闭窗口"
                >
                    <div className="close-icon"></div>
                </button>
            </div>
        </div>
    );
}
