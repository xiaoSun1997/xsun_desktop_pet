import { useEffect, useState, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import "./JsonCompareComponent.css";

type JsonPanel = {
    id: string;
    rawText: string;
    formattedText: string;
    timestamp: string;
    isValid: boolean;
};

type DiffLine = {
    lineNumber: number;
    isDifferent: boolean;
    content: string;
};

export default function JsonCompareComponent() {
    const [leftPanel, setLeftPanel] = useState<JsonPanel>({
        id: 'left',
        rawText: '',
        formattedText: '',
        timestamp: '',
        isValid: false
    });

    const [rightPanel, setRightPanel] = useState<JsonPanel>({
        id: 'right',
        rawText: '',
        formattedText: '',
        timestamp: '',
        isValid: false
    });

    const [leftDiff, setLeftDiff] = useState<DiffLine[]>([]);
    const [rightDiff, setRightDiff] = useState<DiffLine[]>([]);
    const [isComparing, setIsComparing] = useState(false);

    const leftTextareaRef = useRef<HTMLTextAreaElement>(null);
    const rightTextareaRef = useRef<HTMLTextAreaElement>(null);
    const leftDiffRef = useRef<HTMLDivElement>(null);
    const rightDiffRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        leftTextareaRef.current?.focus();
    
        // 检查是否为通过初始化脚本注入的文本（从快捷菜单创建新窗口时）
        const globalText = (window as any).__JSON_TEXT__;
        if (globalText) {
            const { formatted, isValid } = formatJson(globalText);
            const timestamp = globalText.trim() ? updateTimestamp() : '';
            setLeftPanel({
                id: 'left',
                rawText: globalText,
                formattedText: formatted,
                timestamp,
                isValid
            });
            delete (window as any).__JSON_TEXT__;
        }
    
        // 监听外部填充文本事件（从快捷菜单注入到已有窗口）
        const unlisten = listen<string>("json://fill-text", (event) => {
            const text = event.payload;
            const { formatted, isValid } = formatJson(text);
            const timestamp = text.trim() ? updateTimestamp() : '';
            setLeftPanel({
                id: 'left',
                rawText: text,
                formattedText: formatted,
                timestamp,
                isValid
            });
        });
    
        return () => {
            unlisten.then(fn => fn());
        };
    }, []);

    // 自动对比效果
    useEffect(() => {
        if (leftPanel.isValid && rightPanel.isValid && leftPanel.formattedText && rightPanel.formattedText) {
            compareJson();
        }
    }, [leftPanel.formattedText, rightPanel.formattedText]);

    const handleClose = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.close();
        } catch (error) {
            console.error('关闭窗口失败:', error);
        }
    };

    const formatJson = (text: string): { formatted: string; isValid: boolean } => {
        try {
            if (!text.trim()) return { formatted: '', isValid: false };
            const parsed = JSON.parse(text);
            return {
                formatted: JSON.stringify(parsed, null, 2),
                isValid: true
            };
        } catch (error) {
            return { formatted: text, isValid: false };
        }
    };

    const updateTimestamp = (): string => {
        const now = new Date();
        return `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    };

    const handleFormat = (panelId: string) => {
        if (panelId === 'left') {
            const { formatted, isValid } = formatJson(leftPanel.rawText);
            setLeftPanel({
                ...leftPanel,
                rawText: formatted,
                formattedText: formatted,
                timestamp: updateTimestamp(),
                isValid
            });
        } else {
            const { formatted, isValid } = formatJson(rightPanel.rawText);
            setRightPanel({
                ...rightPanel,
                rawText: formatted,
                formattedText: formatted,
                timestamp: updateTimestamp(),
                isValid
            });
        }
    };

    const handleTextChange = (panelId: string, text: string) => {
        const timestamp = text.trim() ? updateTimestamp() : '';

        if (panelId === 'left') {
            const { formatted, isValid } = formatJson(text);
            setLeftPanel({
                ...leftPanel,
                rawText: text,
                formattedText: formatted,
                timestamp,
                isValid
            });
        } else {
            const { formatted, isValid } = formatJson(text);
            setRightPanel({
                ...rightPanel,
                rawText: text,
                formattedText: formatted,
                timestamp,
                isValid
            });
        }
    };

    // 按照左侧JSON的key顺序重排序右侧JSON
    const sortRightByLeft = () => {
        try {
            if (!leftPanel.isValid || !rightPanel.isValid) {
                alert('请确保两侧都是有效的JSON格式');
                return;
            }

            const leftObj = JSON.parse(leftPanel.formattedText);
            const rightObj = JSON.parse(rightPanel.formattedText);

            // 递归排序函数
            const sortObjectByReference = (reference: any, target: any): any => {
                if (typeof reference !== 'object' || reference === null ||
                    typeof target !== 'object' || target === null) {
                    return target;
                }

                if (Array.isArray(reference) && Array.isArray(target)) {
                    return target;
                }

                const sortedObj: Record<string, any> = {};

                // 首先按照参考对象的键顺序添加
                Object.keys(reference).forEach(key => {
                    if (key in target) {
                        // 如果值是对象，递归排序
                        if (typeof reference[key] === 'object' && reference[key] !== null &&
                            typeof target[key] === 'object' && target[key] !== null) {
                            sortedObj[key] = sortObjectByReference(reference[key], target[key]);
                        } else {
                            sortedObj[key] = target[key];
                        }
                    }
                });

                // 然后添加目标对象中独有的键
                Object.keys(target).forEach(key => {
                    if (!(key in sortedObj)) {
                        sortedObj[key] = target[key];
                    }
                });

                return sortedObj;
            };

            const sortedObj = sortObjectByReference(leftObj, rightObj);
            const sortedJson = JSON.stringify(sortedObj, null, 2);

            setRightPanel({
                ...rightPanel,
                rawText: sortedJson,
                formattedText: sortedJson,
                timestamp: updateTimestamp(),
                isValid: true
            });
        } catch (error) {
            console.error('排序时出错:', error);
            alert('排序失败，请检查JSON格式');
        }
    };

    // JSON对比函数 - 逐行比较并标记差异
    const compareJson = () => {
        setIsComparing(true);

        try {
            if (!leftPanel.isValid || !rightPanel.isValid) {
                setLeftDiff([]);
                setRightDiff([]);
                setIsComparing(false);
                return;
            }

            const leftLines = leftPanel.formattedText.split('\n');
            const rightLines = rightPanel.formattedText.split('\n');

            const maxLines = Math.max(leftLines.length, rightLines.length);

            const leftDiffResult: DiffLine[] = [];
            const rightDiffResult: DiffLine[] = [];

            // 逐行比较
            for (let i = 0; i < maxLines; i++) {
                const leftLine = leftLines[i] || '';
                const rightLine = rightLines[i] || '';

                // 去除空白字符后比较
                const leftTrimmed = leftLine.trim();
                const rightTrimmed = rightLine.trim();
                const isDifferent = leftTrimmed !== rightTrimmed;

                leftDiffResult.push({
                    lineNumber: i + 1,
                    isDifferent,
                    content: leftLine
                });

                rightDiffResult.push({
                    lineNumber: i + 1,
                    isDifferent,
                    content: rightLine
                });
            }

            setLeftDiff(leftDiffResult);
            setRightDiff(rightDiffResult);

        } catch (error) {
            console.error('对比JSON时出错:', error);
        }

        setTimeout(() => {
            setIsComparing(false);
        }, 300);
    };

    // 同步滚动
    const handleScroll = (source: 'left' | 'right', e: React.UIEvent<HTMLDivElement>) => {
        const scrollTop = e.currentTarget.scrollTop;
        if (source === 'left' && rightDiffRef.current) {
            rightDiffRef.current.scrollTop = scrollTop;
        } else if (source === 'right' && leftDiffRef.current) {
            leftDiffRef.current.scrollTop = scrollTop;
        }
    };

    return (
        <div className="json-compare-container">
            <div className="json-compare-header" data-tauri-drag-region>
                <div className="header-left">
                    <h1 className="json-compare-title">JSON对比工具</h1>
                </div>
                <div className="header-actions">
                    <button className="close-button" onClick={handleClose}>
                        <div className="close-icon"></div>
                    </button>
                </div>
            </div>

            <div className="json-compare-content">
                {/* 左侧面板 */}
                <div className="json-panel">
                    <div className="panel-header">
                        <h3 className="panel-title">源JSON</h3>
                        {leftPanel.timestamp && (
                            <div className="timestamp">{leftPanel.timestamp}</div>
                        )}
                        {!leftPanel.isValid && leftPanel.rawText && (
                            <span className="error-badge">格式错误</span>
                        )}
                        <div className="panel-actions">
                            <button
                                className="format-button"
                                onClick={() => handleFormat('left')}
                                disabled={!leftPanel.rawText.trim()}
                            >
                                格式化
                            </button>
                        </div>
                    </div>

                    {leftDiff.length === 0 ? (
                        <textarea
                            ref={leftTextareaRef}
                            className="json-textarea"
                            value={leftPanel.rawText}
                            onChange={(e) => handleTextChange('left', e.target.value)}
                            placeholder="在此粘贴JSON数据..."
                        />
                    ) : (
                        <div
                            ref={leftDiffRef}
                            className="json-diff-view"
                            onScroll={(e) => handleScroll('left', e)}
                        >
                            {leftDiff.map((line, idx) => (
                                <div
                                    key={idx}
                                    className={`diff-line ${line.isDifferent ? 'diff-highlight' : ''}`}
                                >
                                    <span className="line-number">{line.lineNumber}</span>
                                    <span className="line-content">{line.content || ' '}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 对比按钮 */}
                <div className="compare-button-container">
                    <button
                        className="compare-button"
                        onClick={compareJson}
                        disabled={!leftPanel.isValid || !rightPanel.isValid || isComparing}
                    >
                        {isComparing ? '对比中...' : leftDiff.length > 0 ? '重新对比' : '开始对比'}
                    </button>
                    {leftDiff.length > 0 && (
                        <button
                            className="reset-button"
                            onClick={() => {
                                setLeftDiff([]);
                                setRightDiff([]);
                            }}
                        >
                            返回编辑
                        </button>
                    )}
                </div>

                {/* 右侧面板 */}
                <div className="json-panel">
                    <div className="panel-header">
                        <h3 className="panel-title">目标JSON</h3>
                        {rightPanel.timestamp && (
                            <div className="timestamp">{rightPanel.timestamp}</div>
                        )}
                        {!rightPanel.isValid && rightPanel.rawText && (
                            <span className="error-badge">格式错误</span>
                        )}
                        <div className="panel-actions">
                            <button
                                className="sort-button"
                                onClick={sortRightByLeft}
                                disabled={!leftPanel.isValid || !rightPanel.isValid}
                            >
                                重排序
                            </button>
                            <button
                                className="format-button"
                                onClick={() => handleFormat('right')}
                                disabled={!rightPanel.rawText.trim()}
                            >
                                格式化
                            </button>
                        </div>
                    </div>

                    {rightDiff.length === 0 ? (
                        <textarea
                            ref={rightTextareaRef}
                            className="json-textarea"
                            value={rightPanel.rawText}
                            onChange={(e) => handleTextChange('right', e.target.value)}
                            placeholder="在此粘贴JSON数据..."
                        />
                    ) : (
                        <div
                            ref={rightDiffRef}
                            className="json-diff-view"
                            onScroll={(e) => handleScroll('right', e)}
                        >
                            {rightDiff.map((line, idx) => (
                                <div
                                    key={idx}
                                    className={`diff-line ${line.isDifferent ? 'diff-highlight' : ''}`}
                                >
                                    <span className="line-number">{line.lineNumber}</span>
                                    <span className="line-content">{line.content || ' '}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
