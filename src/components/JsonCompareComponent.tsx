import { useEffect, useState, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./JsonCompareComponent.css";

export default function JsonCompareComponent() {
    const [text, setText] = useState("");
    const [isValidJson, setIsValidJson] = useState(false);
    const [lineCount, setLineCount] = useState(0);
    const [charCount, setCharCount] = useState(0);

    const [showSearch, setShowSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchMatches, setSearchMatches] = useState<number[]>([]);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

    const [showReplace, setShowReplace] = useState(false);
    const [replaceQuery, setReplaceQuery] = useState("");

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const globalText = (window as any).__JSON_TEXT__;
        if (globalText) {
            setText(globalText);
            delete (window as any).__JSON_TEXT__;
        }

        const unlisten = listen<string>("json://fill-text", (event) => {
            setText(event.payload);
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, []);

    useEffect(() => {
        setLineCount(text.length > 0 ? text.split("\n").length : 0);
        setCharCount(text.length);
        try {
            if (text.trim()) {
                JSON.parse(text);
                setIsValidJson(true);
            } else {
                setIsValidJson(false);
            }
        } catch {
            setIsValidJson(false);
        }
    }, [text]);

    const handleClose = async () => {
        try {
            await getCurrentWindow().close();
        } catch (error) {
            console.error("关闭窗口失败:", error);
        }
    };

    const handleFormat = () => {
        try {
            if (!text.trim()) return;
            const parsed = JSON.parse(text);
            setText(JSON.stringify(parsed, null, 2));
        } catch {
            alert("JSON 格式错误，无法格式化");
        }
    };

    const handleCompact = () => {
        try {
            if (!text.trim()) return;
            const parsed = JSON.parse(text);
            setText(JSON.stringify(parsed));
        } catch {
            alert("JSON 格式错误，无法压缩");
        }
    };

    const handleClear = () => {
        if (!text) return;
        if (confirm("确定要清空所有内容吗？")) {
            setText("");
            setSearchMatches([]);
        }
    };

    const handleCopy = async () => {
        if (!text) return;
        try {
            await invoke("copy_to_clipboard", { content: text });
            alert("已复制到剪贴板");
        } catch (e) {
            console.error("复制失败:", e);
        }
    };

    const handleEscape = useCallback((e: KeyboardEvent) => {
        if (e.key === "Escape") {
            setShowSearch(false);
            setShowReplace(false);
            textareaRef.current?.focus();
        }
    }, []);

    useEffect(() => {
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [handleEscape]);

    const findMatches = useCallback((query: string, content: string): number[] => {
        if (!query) return [];
        const indices: number[] = [];
        let idx = content.indexOf(query);
        while (idx !== -1) {
            indices.push(idx);
            idx = content.indexOf(query, idx + 1);
        }
        return indices;
    }, []);

    useEffect(() => {
        if (showSearch && searchQuery) {
            const matches = findMatches(searchQuery, text);
            setSearchMatches(matches);
            setCurrentMatchIndex(matches.length > 0 ? 0 : -1);
        } else {
            setSearchMatches([]);
            setCurrentMatchIndex(-1);
        }
    }, [searchQuery, text, showSearch, findMatches]);

    const goToMatch = (index: number) => {
        if (!textareaRef.current || searchMatches.length === 0) return;
        const matchIndex = searchMatches[index];
        const beforeMatch = text.substring(0, matchIndex);
        const lineNum = beforeMatch.split("\n").length - 1;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(matchIndex, matchIndex + searchQuery.length);
        // Scroll to position roughly
        const lineHeight = 20;
        textareaRef.current.scrollTop = Math.max(0, lineNum * lineHeight - textareaRef.current.clientHeight / 2);
    };

    const handleFindNext = () => {
        if (searchMatches.length === 0) return;
        const next = (currentMatchIndex + 1) % searchMatches.length;
        setCurrentMatchIndex(next);
        goToMatch(next);
    };

    const handleFindPrev = () => {
        if (searchMatches.length === 0) return;
        const prev = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
        setCurrentMatchIndex(prev);
        goToMatch(prev);
    };

    const handleReplaceOne = () => {
        if (!searchQuery || currentMatchIndex < 0 || currentMatchIndex >= searchMatches.length) return;
        const pos = searchMatches[currentMatchIndex];
        const newText = text.substring(0, pos) + replaceQuery + text.substring(pos + searchQuery.length);
        setText(newText);
        // Update matches for new text
        setTimeout(() => {
            const newMatches = findMatches(searchQuery, newText);
            setSearchMatches(newMatches);
            setCurrentMatchIndex(Math.min(currentMatchIndex, newMatches.length - 1));
        }, 0);
    };

    const handleReplaceAll = () => {
        if (!searchQuery) return;
        const newText = text.split(searchQuery).join(replaceQuery);
        const replacedCount = text.split(searchQuery).length - 1;
        setText(newText);
        setSearchMatches([]);
        setCurrentMatchIndex(-1);
        alert(`已替换 ${replacedCount} 处`);
    };

    const handleSearchToggle = () => {
        setShowSearch(prev => !prev);
        setShowReplace(false);
        if (!showSearch) {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    };

    const handleReplaceToggle = () => {
        setShowReplace(prev => !prev);
        setShowSearch(false);
        if (!showReplace) {
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    };

    return (
        <div className="json-formatter-container">
            <div className="json-formatter-header" data-tauri-drag-region>
                <div className="header-left">
                    <h1 className="json-formatter-title">JSON 格式化工具</h1>
                </div>
                <div className="header-actions">
                    <button className="close-button" onClick={handleClose}>
                        <div className="close-icon"></div>
                    </button>
                </div>
            </div>

            <div className="json-toolbar">
                <button className="toolbar-btn" onClick={handleFormat} title="格式化 (Ctrl+Shift+F)">
                    <span>✨</span> 格式化
                </button>
                <button className="toolbar-btn" onClick={handleCompact} title="压缩">
                    <span>🗜️</span> 压缩
                </button>
                <button className="toolbar-btn" onClick={handleClear} title="清空">
                    <span>🗑️</span> 清空
                </button>
                <button className="toolbar-btn" onClick={handleSearchToggle} title="查找">
                    <span>🔍</span> 查找
                </button>
                <button className="toolbar-btn" onClick={handleReplaceToggle} title="替换">
                    <span>🔄</span> 替换
                </button>
                <button className="toolbar-btn" onClick={handleCopy} title="复制全部">
                    <span>📋</span> 复制
                </button>
            </div>

            {showSearch && (
                <div className="search-bar">
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="查找内容..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleFindNext(); }}
                    />
                    <span className="search-count">
                        {searchMatches.length > 0 ? `${currentMatchIndex + 1} / ${searchMatches.length}` : "无匹配"}
                    </span>
                    <button onClick={handleFindPrev} disabled={searchMatches.length === 0}>上一个</button>
                    <button onClick={handleFindNext} disabled={searchMatches.length === 0}>下一个</button>
                    <button onClick={() => setShowSearch(false)}>关闭</button>
                </div>
            )}

            {showReplace && (
                <div className="replace-bar">
                    <input
                        type="text"
                        placeholder="查找内容..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <input
                        type="text"
                        placeholder="替换为..."
                        value={replaceQuery}
                        onChange={(e) => setReplaceQuery(e.target.value)}
                    />
                    <button onClick={handleReplaceOne} disabled={searchMatches.length === 0}>替换</button>
                    <button onClick={handleReplaceAll} disabled={!searchQuery}>全部替换</button>
                    <button onClick={() => setShowReplace(false)}>关闭</button>
                </div>
            )}

            <div className="json-editor-area">
                <textarea
                    ref={textareaRef}
                    className="json-textarea"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="在此粘贴或输入 JSON / 文本数据..."
                    spellCheck={false}
                />
            </div>

            <div className="json-status-bar">
                <div className="status-left">
                    <span className={`json-valid-badge ${isValidJson ? "valid" : text.trim() ? "invalid" : ""}`}>
                        {text.trim() ? (isValidJson ? "✅ 有效 JSON" : "❌ JSON 格式错误") : "等待输入..."}
                    </span>
                </div>
                <div className="status-right">
                    <span>{lineCount} 行</span>
                    <span>{charCount} 字符</span>
                </div>
            </div>
        </div>
    );
}
