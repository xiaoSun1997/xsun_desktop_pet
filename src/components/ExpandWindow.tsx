import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import "./ExpandWindow.css";

export default function ExpandWindow() {
    const [content, setContent] = useState("");
    const [isEditing, setIsEditing] = useState(false);
    const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved" | "error">("");
    const [originalContent, setOriginalContent] = useState("");

    const autoFormat = (text: string): string => {
        try {
            const parsed = JSON.parse(text);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return text;
        }
    };

    useEffect(() => {
        const initialContent = (window as any).__EXPAND_CONTENT__ || "";
        const formattedContent = autoFormat(initialContent);
        setContent(formattedContent);
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
            await invoke("add_to_clipboard_history", { content });
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
        const formattedOriginal = autoFormat(originalContent);
        setContent(formattedOriginal);
        setIsEditing(false);
    };

    const handleFormat = () => {
        setContent(autoFormat(content));
    };

    const hasChanges = content !== autoFormat(originalContent);
    const contentSizeByte = new Blob([content]).size;
    const formatSize = (size: number): string => {
        if (size < 1024) return `${size}B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
        return `${(size / (1024 * 1024)).toFixed(1)}MB`;
    };
    const lineCount = content.split('\n').length;
    const wordCount = content.replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 0).length;

    return (
        <div className="expand-container">
            <div className="expand-header" data-tauri-drag-region>
                <div className="header-left">
                    <h1 className="expand-title">📝 剪贴板内容</h1>
                    <div className="content-info">
                        <span className="content-size">{formatSize(contentSizeByte)}</span>
                        <span className="content-length">{content.length} 字符</span>
                    </div>
                </div>
                <div className="header-actions">
                    {isEditing ? (
                        <>
                            {content.length <= 200000 && (
                                <button
                                    className="edit-button"
                                    onClick={handleFormat}
                                    title="格式化内容"
                                    style={{ background: 'linear-gradient(135deg, #9b59b6, #8e44ad)' }}
                                >
                                    🔧 格式化
                                </button>
                            )}
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
                                    saveStatus === "saved" ? "✓ 已保存" :
                                        saveStatus === "error" ? "✗ 保存失败" : "💾 保存"}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                className={`action-copy-button ${saveStatus}`}
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
                                <span>✏️ 编辑</span>
                            </button>
                            <div className="expand-action-divider"></div>
                            <button
                                className="expand-close-button"
                                onClick={handleClose}
                                title="关闭窗口"
                            >
                                <span>✕ 关闭</span>
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
                        spellCheck={false}
                    />
                ) : (
                    <div className="content-display">
                        <pre className="content-text">{content || "暂无内容"}</pre>
                    </div>
                )}
            </div>

            <div className="expand-footer">
                <div className="expand-footer-info">
                    <span>📄 {lineCount} 行</span>
                    <span>📝 {wordCount} 词</span>
                    <span>📏 {content.length} 字符</span>
                </div>
            </div>

        </div>
    );
}
