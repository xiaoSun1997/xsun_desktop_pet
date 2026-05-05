import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./JsonCompareComponent.css";

// ===== JSON 对比结果类型 =====
interface DiffEntry {
    path: string;
    status: 'unchanged' | 'added' | 'removed' | 'changed';
    leftValue?: string;
    rightValue?: string;
}

export default function JsonCompareComponent() {
    const [text, setText] = useState("");
    const [isValidJson, setIsValidJson] = useState(false);
    const [lineCount, setLineCount] = useState(0);
    const [charCount, setCharCount] = useState(0);
    const [errorLines, setErrorLines] = useState<number[]>([]);
    const [formattedInfo, setFormattedInfo] = useState("");

    const [showSearch, setShowSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchMatches, setSearchMatches] = useState<number[]>([]);
    const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
    const [showReplace, setShowReplace] = useState(false);
    const [replaceQuery, setReplaceQuery] = useState("");

    // ===== JSON 对比模式状态 =====
    const [compareMode, setCompareMode] = useState(false);
    const [leftText, setLeftText] = useState("");
    const [rightText, setRightText] = useState("");
    const [diffResult, setDiffResult] = useState<DiffEntry[] | null>(null);
    const [diffSummary, setDiffSummary] = useState<string>("");

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const highlightRef = useRef<HTMLPreElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const leftTextareaRef = useRef<HTMLTextAreaElement>(null);
    const rightTextareaRef = useRef<HTMLTextAreaElement>(null);

    // 窗口初始化：自动注入选中文本
    useEffect(() => {
        const globalText = (window as any).__JSON_TEXT__;
        if (globalText) {
            setText(globalText);
            delete (window as any).__JSON_TEXT__;
        }
        const unlisten = listen<string>("json://fill-text", (event) => {
            setText(event.payload);
        });
        return () => { unlisten.then(fn => fn()); };
    }, []);

    // 统计和校验
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

    // 同步 textarea 滚动到 pre 高亮层
    const handleScroll = () => {
        if (textareaRef.current && highlightRef.current) {
            highlightRef.current.scrollTop = textareaRef.current.scrollTop;
            highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
        }
    };

    // HTML 转义
    const escapeHtml = (str: string): string => {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    // ===== 渲染高亮层 HTML =====
    const highlightedHtml = useMemo(() => {
        if (!text) return '<div class="hl-line">&nbsp;</div>';

        const lines = text.split("\n");
        const hasSearch = searchQuery.length > 0;

        // 预计算搜索匹配位置
        const matchPositions: { start: number; end: number; isCurrent: boolean }[] = [];
        if (hasSearch) {
            let idx = 0;
            let matchIdx = 0;
            while ((idx = text.indexOf(searchQuery, idx)) !== -1) {
                matchPositions.push({
                    start: idx,
                    end: idx + searchQuery.length,
                    isCurrent: matchIdx === currentMatchIndex,
                });
                idx += searchQuery.length;
                matchIdx++;
            }
        }

        const fragments: string[] = [];
        let globalPos = 0;

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const isError = errorLines.includes(lineIdx);
            const lineStart = globalPos;
            const lineEnd = lineStart + line.length;

            // 找出这一行内的匹配
            const lineMatches = matchPositions.filter(
                m => m.start >= lineStart && m.start < lineEnd
            ).map(m => ({
                localStart: m.start - lineStart,
                localEnd: m.end - lineStart,
                isCurrent: m.isCurrent,
            }));

            // 构建行 HTML
            let lineHtml = isError
                ? '<div class="hl-line error">'
                : '<div class="hl-line">';

            if (lineMatches.length === 0) {
                lineHtml += escapeHtml(line) || '&nbsp;';
            } else {
                lineMatches.sort((a, b) => a.localStart - b.localStart);
                let lastPos = 0;
                for (const lm of lineMatches) {
                    lineHtml += escapeHtml(line.substring(lastPos, lm.localStart));
                    const cls = lm.isCurrent ? 'hl-match current' : 'hl-match';
                    lineHtml += `<mark class="${cls}">${escapeHtml(line.substring(lm.localStart, lm.localEnd))}</mark>`;
                    lastPos = lm.localEnd;
                }
                lineHtml += escapeHtml(line.substring(lastPos));
            }

            lineHtml += '</div>';
            fragments.push(lineHtml);
            globalPos += line.length + 1;
        }

        return fragments.join('\n');
    }, [text, searchQuery, currentMatchIndex, errorLines]);

    // ===== JSON 工具函数：递归排序 key =====
    const sortJsonKeys = (obj: any): any => {
        if (Array.isArray(obj)) {
            return obj.map(sortJsonKeys);
        } else if (obj !== null && typeof obj === 'object') {
            return Object.keys(obj).sort().reduce((acc: any, key: string) => {
                acc[key] = sortJsonKeys(obj[key]);
                return acc;
            }, {} as any);
        }
        return obj;
    };

    // ===== JSON 递归对比 =====
    const diffJson = (left: any, right: any, path: string = ''): DiffEntry[] => {
        const results: DiffEntry[] = [];

        if (typeof left !== typeof right) {
            results.push({
                path: path || '(根)',
                status: 'changed',
                leftValue: JSON.stringify(left),
                rightValue: JSON.stringify(right),
            });
            return results;
        }

        if (left === null || right === null) {
            if (left !== right) {
                results.push({
                    path: path || '(根)',
                    status: 'changed',
                    leftValue: String(left),
                    rightValue: String(right),
                });
            } else {
                results.push({ path: path || '(根)', status: 'unchanged' });
            }
            return results;
        }

        if (Array.isArray(left) && Array.isArray(right)) {
            const maxLen = Math.max(left.length, right.length);
            for (let i = 0; i < maxLen; i++) {
                const itemPath = path ? `${path}[${i}]` : `[${i}]`;
                if (i >= left.length) {
                    results.push({
                        path: itemPath,
                        status: 'added',
                        rightValue: JSON.stringify(right[i]),
                    });
                } else if (i >= right.length) {
                    results.push({
                        path: itemPath,
                        status: 'removed',
                        leftValue: JSON.stringify(left[i]),
                    });
                } else {
                    results.push(...diffJson(left[i], right[i], itemPath));
                }
            }
            return results;
        }

        if (typeof left === 'object' && typeof right === 'object') {
            // 对 key 排序后再对比
            const leftKeys = Object.keys(left).sort();
            const rightKeys = Object.keys(right).sort();
            const allKeys = [...new Set([...leftKeys, ...rightKeys])].sort();

            for (const key of allKeys) {
                const keyPath = path ? `${path}.${key}` : key;
                const leftHas = key in left;
                const rightHas = key in right;

                if (!leftHas && rightHas) {
                    results.push({
                        path: keyPath,
                        status: 'added',
                        rightValue: JSON.stringify(right[key], null, 2),
                    });
                } else if (leftHas && !rightHas) {
                    results.push({
                        path: keyPath,
                        status: 'removed',
                        leftValue: JSON.stringify(left[key], null, 2),
                    });
                } else {
                    results.push(...diffJson(left[key], right[key], keyPath));
                }
            }
            return results;
        }

        // 原始值比较
        if (left !== right) {
            results.push({
                path: path || '(根)',
                status: 'changed',
                leftValue: JSON.stringify(left),
                rightValue: JSON.stringify(right),
            });
        } else {
            results.push({ path: path || '(根)', status: 'unchanged' });
        }

        return results;
    };

    // ===== 关闭 =====
    const handleClose = async () => {
        try {
            await getCurrentWindow().close();
        } catch (error) {
            console.error("关闭窗口失败:", error);
        }
    };

    // ===== 格式化（完整 + 部分） =====
    const handleFormat = () => {
        if (!text.trim()) return;
        setErrorLines([]);
        setFormattedInfo("");

        try {
            const parsed = JSON.parse(text);
            setText(JSON.stringify(parsed, null, 2));
        } catch (e) {
            tryPartialFormat(e as Error);
        }
    };

    // 部分格式化：逐行积累，第一个错误行之前的内容格式化，后续原样追加
    const tryPartialFormat = (_err: Error) => {
        const lines = text.split('\n');

        // 逐行累加，找到第一个错误行
        let accumulated = '';
        let lastValidJson = '';
        let firstErrorIdx = -1;

        for (let i = 0; i < lines.length; i++) {
            const testJson = accumulated + (accumulated ? '\n' : '') + lines[i];
            try {
                JSON.parse(testJson);
                accumulated = testJson;
                lastValidJson = testJson;
            } catch {
                firstErrorIdx = i;
                break;
            }
        }

        if (firstErrorIdx === -1) return;

        // 格式化有效部分
        let formattedValid = '';
        let formattedLineCount = 0;
        if (lastValidJson) {
            try {
                const parsed = JSON.parse(lastValidJson);
                formattedValid = JSON.stringify(parsed, null, 2);
                formattedLineCount = formattedValid.split('\n').length;
            } catch {
                formattedValid = lastValidJson;
                formattedLineCount = formattedValid.split('\n').length;
            }
        }

        // 构建结果：格式化有效部分 + 剩余原始内容
        const resultLines: string[] = formattedValid ? formattedValid.split('\n') : [];
        const errorLinesInResult: number[] = [];

        const remainingLines = lines.slice(firstErrorIdx);
        for (let i = 0; i < remainingLines.length; i++) {
            resultLines.push(remainingLines[i]);
            errorLinesInResult.push(formattedLineCount + i);
        }

        setText(resultLines.join('\n'));
        setErrorLines(errorLinesInResult);
        setFormattedInfo(
            `⚠️ 已部分格式化，第 ${firstErrorIdx + 1} 行存在语法错误（共 ${errorLinesInResult.length} 行标记红色）`
        );
    };

    // ===== 压缩 =====
    const handleCompact = () => {
        if (!text.trim()) return;
        setErrorLines([]);
        setFormattedInfo("");
        try {
            const parsed = JSON.parse(text);
            setText(JSON.stringify(parsed));
        } catch {
            alert("JSON 格式错误，无法压缩");
        }
    };

    // ===== 清空 =====
    const handleClear = () => {
        if (!text) return;
        if (confirm("确定要清空所有内容吗？")) {
            setText("");
            setSearchMatches([]);
            setErrorLines([]);
            setFormattedInfo("");
        }
    };

    // ===== 复制 =====
    const handleCopy = async () => {
        if (!text) return;
        try {
            await invoke("copy_to_clipboard", { content: text });
            alert("已复制到剪贴板");
        } catch (e) {
            console.error("复制失败:", e);
        }
    };

    // ===== Escape 关闭搜索/替换面板 =====
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

    // ===== 查找 =====
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

    // 定位到指定匹配项（滚动 + 选中）
    const goToMatch = (index: number) => {
        if (!textareaRef.current || searchMatches.length === 0) return;
        const matchIndex = searchMatches[index];
        const beforeMatch = text.substring(0, matchIndex);
        const lineNum = beforeMatch.split("\n").length - 1;
        const ta = textareaRef.current;
        ta.focus();
        ta.setSelectionRange(matchIndex, matchIndex + searchQuery.length);

        // 使用 scrollHeight 比例滚动，比固定 lineHeight 更准确
        const totalLines = text.split("\n").length;
        const scrollable = ta.scrollHeight - ta.clientHeight;
        const ratio = totalLines > 1 ? lineNum / (totalLines - 1) : 0;
        ta.scrollTop = Math.max(0, Math.round(scrollable * ratio - ta.clientHeight / 4));

        // 手动同步高亮层滚动（编程设置 scrollTop 不触发 onScroll）
        if (highlightRef.current) {
            highlightRef.current.scrollTop = ta.scrollTop;
            highlightRef.current.scrollLeft = ta.scrollLeft;
        }
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

    // ===== 替换 =====
    const handleReplaceOne = () => {
        if (!searchQuery || currentMatchIndex < 0 || currentMatchIndex >= searchMatches.length) return;
        const pos = searchMatches[currentMatchIndex];
        const newText = text.substring(0, pos) + replaceQuery + text.substring(pos + searchQuery.length);
        setText(newText);
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

    // ===== 概览标尺标记 =====
    const rulerMarks = useMemo(() => {
        const marks: { type: 'match' | 'error'; percent: number; matchIdx?: number }[] = [];
        const totalLines = lineCount || 1;

        for (const lineNum of errorLines) {
            marks.push({ type: 'error', percent: (lineNum / totalLines) * 100 });
        }

        if (searchQuery) {
            let idx = 0;
            let matchIdx = 0;
            while ((idx = text.indexOf(searchQuery, idx)) !== -1) {
                const beforeMatch = text.substring(0, idx);
                const lineNum = beforeMatch.split('\n').length - 1;
                marks.push({ type: 'match', percent: (lineNum / totalLines) * 100, matchIdx });
                idx += searchQuery.length;
                matchIdx++;
            }
        }

        return marks;
    }, [text, searchQuery, errorLines, lineCount]);

    const handleRulerClick = (matchIdx: number) => {
        setCurrentMatchIndex(matchIdx);
        goToMatch(matchIdx);
    };

    // ===== JSON 对比 =====
    const handleEnterCompare = () => {
        // 进入对比模式：将当前文本复制到左右两侧
        setLeftText(text);
        setRightText(text);
        setDiffResult(null);
        setDiffSummary("");
        setCompareMode(true);
    };

    const handleExitCompare = () => {
        // 退出对比模式：保留左侧文本为主文本
        setText(leftText);
        setCompareMode(false);
        setDiffResult(null);
        setDiffSummary("");
    };

    const handleRunCompare = () => {
        try {
            // 解析左右 JSON
            const leftParsed = JSON.parse(leftText);
            const rightParsed = JSON.parse(rightText);

            // 按键名排序
            const sortedLeft = sortJsonKeys(leftParsed);
            const sortedRight = sortJsonKeys(rightParsed);

            // 格式化显示排序后的 JSON
            const formattedLeft = JSON.stringify(sortedLeft, null, 2);
            const formattedRight = JSON.stringify(sortedRight, null, 2);
            setLeftText(formattedLeft);
            setRightText(formattedRight);

            // 递归对比
            const diffs = diffJson(sortedLeft, sortedRight);
            setDiffResult(diffs);

            // 统计摘要
            const unchanged = diffs.filter(d => d.status === 'unchanged').length;
            const added = diffs.filter(d => d.status === 'added').length;
            const removed = diffs.filter(d => d.status === 'removed').length;
            const changed = diffs.filter(d => d.status === 'changed').length;
            setDiffSummary(`✅ 相同: ${unchanged}  |  ➕ 右侧新增: ${added}  |  ❌ 左侧独有: ${removed}  |  🔄 值不同: ${changed}`);
        } catch (e: any) {
            setDiffSummary(`❌ 对比失败: ${e.message || 'JSON 格式错误，请检查两侧输入'}`);
        }
    };

    const handleCopyLeft = () => {
        invoke("copy_to_clipboard", { content: leftText });
    };

    const handleCopyRight = () => {
        invoke("copy_to_clipboard", { content: rightText });
    };

    // ===== 渲染 =====
    return (
        <div className="json-formatter-container">
            {/* 头部 */}
            <div className="json-formatter-header" data-tauri-drag-region>
                <div className="header-left">
                    <h1 className="json-formatter-title">
                        {compareMode ? 'JSON 对比工具' : 'JSON 格式化工具'}
                    </h1>
                </div>
                <div className="header-actions">
                    <button className="close-button" onClick={handleClose}>
                        <div className="close-icon"></div>
                    </button>
                </div>
            </div>

            {/* 工具栏 */}
            <div className="json-toolbar">
                {!compareMode ? (
                    <>
                        <button className="toolbar-btn" onClick={handleFormat} title="格式化">
                            <span>✨</span> 格式化
                        </button>
                        <button className="toolbar-btn" onClick={handleCompact} title="压缩">
                            <span>🗜️</span> 压缩
                        </button>
                        <button className="toolbar-btn" onClick={handleClear} title="清空">
                            <span>🗑️</span> 清空
                        </button>
                        <button className="toolbar-btn" onClick={handleSearchToggle} title="查找 (Ctrl+F)">
                            <span>🔍</span> 查找
                        </button>
                        <button className="toolbar-btn" onClick={handleReplaceToggle} title="替换 (Ctrl+H)">
                            <span>🔄</span> 替换
                        </button>
                        <button className="toolbar-btn" onClick={handleCopy} title="复制全部">
                            <span>📋</span> 复制
                        </button>
                    </>
                ) : (
                    <>
                        <span className="compare-mode-label">🔍 对比模式</span>
                        <button className="toolbar-btn compare-btn" onClick={handleRunCompare} title="开始对比">
                            <span>⚡</span> 开始对比
                        </button>
                        <button className="toolbar-btn exit-compare-btn" onClick={handleExitCompare} title="退出对比">
                            <span>🚪</span> 退出对比
                        </button>
                    </>
                )}
                {/* JSON对比按钮始终显示 */}
                <span className="toolbar-separator"></span>
                <button
                    className={`toolbar-btn ${compareMode ? 'active' : ''}`}
                    onClick={compareMode ? handleExitCompare : handleEnterCompare}
                    title={compareMode ? "退出对比模式" : "进入 JSON 对比模式"}
                >
                    <span>📊</span> {compareMode ? '退出对比' : 'JSON对比'}
                </button>
            </div>

            {/* 查找栏（非对比模式） */}
            {!compareMode && showSearch && (
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
                        {searchMatches.length > 0
                            ? `${currentMatchIndex + 1} / ${searchMatches.length}`
                            : "无匹配"}
                    </span>
                    <button onClick={handleFindPrev} disabled={searchMatches.length === 0}>上一个</button>
                    <button onClick={handleFindNext} disabled={searchMatches.length === 0}>下一个</button>
                    <button onClick={() => setShowSearch(false)}>关闭</button>
                </div>
            )}

            {/* 替换栏（非对比模式） */}
            {!compareMode && showReplace && (
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

            {/* 编辑器区域 */}
            {!compareMode ? (
                /* ===== 单面板模式 ===== */
                <div className="json-editor-area">
                    <div className="editor-body">
                        <div className="editor-wrapper">
                            <pre
                                ref={highlightRef}
                                className="highlight-layer"
                                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                                aria-hidden="true"
                            />
                            <textarea
                                ref={textareaRef}
                                className="json-textarea"
                                value={text}
                                onChange={(e) => {
                                    setText(e.target.value);
                                    setFormattedInfo("");
                                }}
                                onScroll={handleScroll}
                                placeholder="在此粘贴或输入 JSON / 文本数据..."
                                spellCheck={false}
                            />
                        </div>
                        <div className="editor-overview-ruler">
                            {rulerMarks.map((mark, idx) => {
                                const matchIdx = mark.matchIdx;
                                return (
                                    <div
                                        key={`${mark.type}-${idx}`}
                                        className={
                                            `ruler-mark ${mark.type}` +
                                            (mark.type === 'match' && mark.matchIdx === currentMatchIndex
                                                ? ' active'
                                                : '')
                                        }
                                        style={{ top: `${mark.percent}%` }}
                                        title={
                                            mark.type === 'error'
                                                ? `语法错误`
                                                : `匹配 ${(matchIdx ?? 0) + 1}`
                                        }
                                        onClick={() => {
                                            if (mark.type === 'match' && mark.matchIdx !== undefined) {
                                                handleRulerClick(mark.matchIdx);
                                            }
                                        }}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : (
                /* ===== 双面板对比模式 ===== */
                <div className="json-compare-area">
                    <div className="compare-panels">
                        {/* 左侧面板 */}
                        <div className="compare-panel">
                            <div className="compare-panel-header left-header">
                                <span className="panel-label">左侧 JSON</span>
                                <button className="panel-copy-btn" onClick={handleCopyLeft} title="复制左侧">📋</button>
                            </div>
                            <textarea
                                ref={leftTextareaRef}
                                className="compare-textarea"
                                value={leftText}
                                onChange={(e) => {
                                    setLeftText(e.target.value);
                                    setDiffResult(null);
                                    setDiffSummary("");
                                }}
                                placeholder="粘贴左侧 JSON..."
                                spellCheck={false}
                            />
                        </div>

                        {/* 中间的对比状态指示 */}
                        <div className="compare-divider">
                            <div className="divider-icon">⇄</div>
                        </div>

                        {/* 右侧面板 */}
                        <div className="compare-panel">
                            <div className="compare-panel-header right-header">
                                <span className="panel-label">右侧 JSON</span>
                                <button className="panel-copy-btn" onClick={handleCopyRight} title="复制右侧">📋</button>
                            </div>
                            <textarea
                                ref={rightTextareaRef}
                                className="compare-textarea"
                                value={rightText}
                                onChange={(e) => {
                                    setRightText(e.target.value);
                                    setDiffResult(null);
                                    setDiffSummary("");
                                }}
                                placeholder="粘贴右侧 JSON..."
                                spellCheck={false}
                            />
                        </div>
                    </div>

                    {/* 对比结果 */}
                    {diffSummary && (
                        <div className="diff-result-panel">
                            <div className="diff-summary">
                                <span className="diff-summary-text">{diffSummary}</span>
                            </div>
                            {diffResult && diffResult.length > 0 && (
                                <div className="diff-details">
                                    <div className="diff-details-header">
                                        <span>📝 对比详情（按键名字母序排列）</span>
                                        <span className="diff-total">{diffResult.filter(d => d.status !== 'unchanged').length} 处差异</span>
                                    </div>
                                    <div className="diff-details-body">
                                        {diffResult
                                            .filter(d => d.status !== 'unchanged')
                                            .sort((a, b) => a.path.localeCompare(b.path))
                                            .map((entry, idx) => {
                                                let icon = '';
                                                let rowClass = '';
                                                switch (entry.status) {
                                                    case 'added':
                                                        icon = '➕';
                                                        rowClass = 'diff-row-added';
                                                        break;
                                                    case 'removed':
                                                        icon = '❌';
                                                        rowClass = 'diff-row-removed';
                                                        break;
                                                    case 'changed':
                                                        icon = '🔄';
                                                        rowClass = 'diff-row-changed';
                                                        break;
                                                }
                                                return (
                                                    <div key={idx} className={`diff-row ${rowClass}`}>
                                                        <span className="diff-row-icon">{icon}</span>
                                                        <span className="diff-row-path">{entry.path}</span>
                                                        <span className="diff-row-values">
                                                            {entry.status === 'added' && (
                                                                <span className="diff-value-right">→ {entry.rightValue}</span>
                                                            )}
                                                            {entry.status === 'removed' && (
                                                                <span className="diff-value-left">{entry.leftValue} →</span>
                                                            )}
                                                            {entry.status === 'changed' && (
                                                                <>
                                                                    <span className="diff-value-left">{entry.leftValue}</span>
                                                                    <span className="diff-arrow"> → </span>
                                                                    <span className="diff-value-right">{entry.rightValue}</span>
                                                                </>
                                                            )}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>
                            )}
                            {diffResult && diffResult.filter(d => d.status === 'unchanged').length > 0 && (
                                <div className="diff-same-count">
                                    ✅ {diffResult.filter(d => d.status === 'unchanged').length} 个字段完全相同
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* 状态栏 */}
            <div className="json-status-bar">
                <div className="status-left">
                    {compareMode ? (
                        <span className="json-valid-badge">
                            📊 对比模式
                        </span>
                    ) : (
                        formattedInfo ? (
                            <span className="json-valid-badge partial">
                                {formattedInfo}
                            </span>
                        ) : (
                            <span
                                className={
                                    `json-valid-badge` +
                                    (isValidJson ? ' valid' : text.trim() ? ' invalid' : '')
                                }
                            >
                                {text.trim()
                                    ? (isValidJson ? '✅ 有效 JSON' : '❌ JSON 格式错误')
                                    : '等待输入...'}
                            </span>
                        )
                    )}
                </div>
                <div className="status-right">
                    {!compareMode && errorLines.length > 0 && (
                        <span className="error-count" title="语法错误行">
                            🚨 {errorLines.length} 处
                        </span>
                    )}
                    {!compareMode && (
                        <>
                            <span>{lineCount} 行</span>
                            <span>{charCount} 字符</span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
