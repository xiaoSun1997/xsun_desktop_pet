import { useEffect, useState, useRef, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { marked } from "marked";
import "./NotepadComponent.css";

type NoteRecord = {
    id: string;
    name: string;
    content: string;
    parent_path: string;
    is_dir: boolean;
    created_at: number;
    updated_at: number;
};

type TreeNode = {
    id: string;
    name: string;
    path: string;
    is_dir: boolean;
    children?: TreeNode[];
    parent_path: string;
    content?: string;
};

type AiMessage = {
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
};

export default function NotepadComponent() {
    // ---- 窗口控制 ----
    const [isFullscreen, setIsFullscreen] = useState(false);

    // ---- 笔记文件树 ----
    const [, setAllNotes] = useState<NoteRecord[]>([]);
    const [noteTree, setNoteTree] = useState<TreeNode[]>([]);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
    const [selectedNoteName, setSelectedNoteName] = useState<string>('');

    // ---- 编辑器 ----
    const [editorContent, setEditorContent] = useState<string>('');
    const [isPreviewMode, setIsPreviewMode] = useState(false);
    const [isLoadingContent, setIsLoadingContent] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // ---- AI 面板 ----
    const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
    const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
    const [aiInputValue, setAiInputValue] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [aiSessionId, setAiSessionId] = useState<string | null>(null);
    const streamingContentRef = useRef("");
    const unlistenRef = useRef<UnlistenFn[]>([]);

    // ---- 添加菜单 ----
    const [addMenuPos, setAddMenuPos] = useState<{ x: number; y: number; parentId: string } | null>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const aiMessagesEndRef = useRef<HTMLDivElement>(null);
    const aiInputRef = useRef<HTMLTextAreaElement>(null);

    // ========== 构建文件树 ==========
    const buildTree = useCallback((notes: NoteRecord[]): TreeNode[] => {
        const map = new Map<string, TreeNode[]>();
        const roots: TreeNode[] = [];

        // 先收集所有节点
        for (const note of notes) {
            const node: TreeNode = {
                id: note.id,
                name: note.name,
                path: note.id,
                is_dir: note.is_dir,
                parent_path: note.parent_path,
                content: note.content,
            };
            if (note.parent_path === '' || note.parent_path === 'root') {
                roots.push(node);
            } else {
                const children = map.get(note.parent_path) || [];
                children.push(node);
                map.set(note.parent_path, children);
            }
        }

        // 递归添加子节点
        const addChildren = (nodes: TreeNode[]) => {
            for (const node of nodes) {
                if (node.is_dir) {
                    const children = map.get(node.id) || [];
                    // 文件夹排在前面
                    children.sort((a, b) => {
                        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
                        return a.name.localeCompare(b.name);
                    });
                    node.children = children;
                    addChildren(children);
                }
            }
        };

        roots.sort((a, b) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        addChildren(roots);
        return roots;
    }, []);

    // ========== 加载数据 ==========
    const loadNotes = useCallback(async () => {
        try {
            const notes = await invoke<NoteRecord[]>('get_all_notes');
            setAllNotes(notes);
            setNoteTree(buildTree(notes));
        } catch (error) {
            console.error('加载笔记失败:', error);
        }
    }, [buildTree]);

    useEffect(() => {
        loadNotes();
    }, [loadNotes]);

    // AI 消息滚动到底部
    useEffect(() => {
        setTimeout(() => {
            aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
    }, [aiMessages]);

    // ========== 文件树操作 ==========
    const toggleFolder = (id: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleSelectNote = async (note: NoteRecord) => {
        if (hasUnsavedChanges) {
            // 先保存当前
            if (selectedNoteId) {
                try {
                    await invoke('update_note_content', { id: selectedNoteId, content: editorContent });
                } catch (e) {
                    console.error('自动保存失败:', e);
                }
            }
        }

        setSelectedNoteId(note.id);
        setSelectedNoteName(note.name);
        setIsPreviewMode(false);
        setIsLoadingContent(true);
        try {
            const content = await invoke<string>('get_note_content', { id: note.id });
            setEditorContent(content || '');
            setHasUnsavedChanges(false);
        } catch (error) {
            console.error('加载笔记内容失败:', error);
            setEditorContent('');
        }
        setIsLoadingContent(false);
    };

    const handleSaveContent = async () => {
        if (!selectedNoteId) return;
        try {
            await invoke('update_note_content', { id: selectedNoteId, content: editorContent });
            setHasUnsavedChanges(false);
        } catch (error) {
            console.error('保存失败:', error);
        }
    };

    // ========== 创建/删除文件/文件夹 ==========
    const handleCreateItem = async (name: string, parentId: string, isDir: boolean) => {
        try {
            await invoke<NoteRecord>('create_note_document', {
                name,
                parentPath: parentId || 'root',
                isDir,
            });
            await loadNotes();
        } catch (error) {
            console.error('创建失败:', error);
        }
    };

    const handleDeleteItem = async (id: string) => {
        try {
            await invoke('delete_note_document', { id });
            if (selectedNoteId === id) {
                setSelectedNoteId(null);
                setSelectedNoteName('');
                setEditorContent('');
                setIsPreviewMode(false);
            }
            await loadNotes();
        } catch (error) {
            console.error('删除失败:', error);
        }
    };

    // ========== 添加菜单 ==========
    const handleAddMenuClick = (parentId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setAddMenuPos({ x: e.clientX, y: e.clientY, parentId });
    };

    const handleAddNewFolder = () => {
        if (!addMenuPos) return;
        const name = prompt('请输入文件夹名称:');
        if (name && name.trim()) {
            handleCreateItem(name.trim(), addMenuPos.parentId, true);
        }
        setAddMenuPos(null);
    };

    const handleAddNewFile = () => {
        if (!addMenuPos) return;
        const name = prompt('请输入文件名称 (例如: 笔记.md):');
        if (name && name.trim()) {
            handleCreateItem(name.trim(), addMenuPos.parentId, false);
        }
        setAddMenuPos(null);
    };

    // ========== 图片粘贴 ==========
    const insertAtCursor = (text: string) => {
        const textarea = textareaRef.current;
        if (!textarea) {
            setEditorContent(prev => prev + text);
            return;
        }
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newContent = editorContent.substring(0, start) + text + editorContent.substring(end);
        setEditorContent(newContent);
        setHasUnsavedChanges(true);
        // 恢复光标位置
        setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + text.length;
            textarea.focus();
        }, 0);
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        let foundImage = false;

        // 方案1: 尝试浏览器 Clipboard API
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                foundImage = true;
                const file = item.getAsFile();
                if (!file || !selectedNoteId) continue;

                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const result = ev.target?.result as string;
                    const base64 = result.split(',')[1];
                    const ext = file.type.split('/')[1] || 'png';
                    const fileName = `img_${Date.now()}.${ext}`;
                    try {
                        const savedPath = await invoke<string>('save_note_image', {
                            noteId: selectedNoteId,
                            fileName,
                            imageDataBase64: base64,
                        });
                        // 转换为 asset protocol URL 以便 WebView 加载
                        const assetUrl = convertFileSrc(savedPath);
                        insertAtCursor(`<div style="text-align:center">\n  <img src="${assetUrl}" alt="paste-image" />\n</div>\n\n`);
                    } catch (error) {
                        console.error('保存图片失败:', error);
                    }
                };
                reader.readAsDataURL(file);
                break;
            }
        }

        // 方案2: 浏览器API没找到图片，尝试 Tauri 剪贴板命令
        if (!foundImage && selectedNoteId) {
            try {
                const imageDataUrl = await invoke<string | null>('read_clipboard_image');
                if (imageDataUrl) {
                    e.preventDefault();
                    const base64 = imageDataUrl.split(',')[1];
                    const fileName = `img_${Date.now()}.png`;
                    const savedPath = await invoke<string>('save_note_image', {
                        noteId: selectedNoteId,
                        fileName,
                        imageDataBase64: base64,
                    });
                    // 转换为 asset protocol URL 以便 WebView 加载
                    const assetUrl = convertFileSrc(savedPath);
                    insertAtCursor(`<div style="text-align:center">\n  <img src="${assetUrl}" alt="paste-image" />\n</div>\n\n`);
                }
            } catch (error) {
                console.error('通过Tauri读取剪贴板图片失败:', error);
            }
        }
    };

    // ========== 窗口控制 ==========
    const handleClose = async () => {
        if (hasUnsavedChanges && selectedNoteId) {
            try {
                await invoke('update_note_content', { id: selectedNoteId, content: editorContent });
            } catch (e) {
                console.error('关闭前自动保存失败:', e);
            }
        }
        const win = getCurrentWindow();
        await win.close();
    };

    const handleToggleFullscreen = async () => {
        const win = getCurrentWindow();
        const fs = await win.isFullscreen();
        await win.setFullscreen(!fs);
        setIsFullscreen(!fs);
    };

    // ========== AI 面板 ==========
    const setupStreamListeners = useCallback((
        onToken: (token: string) => void,
        onDone: (content: string) => void,
        onError: (error: string) => void,
    ) => {
        const setup = async () => {
            const unlistenToken = await listen<{ token: string }>("chat://stream-token", (event) => {
                onToken(event.payload.token);
            });
            const unlistenDone = await listen<{ content: string }>("chat://stream-done", (event) => {
                onDone(event.payload.content);
            });
            const unlistenError = await listen<{ error: string }>("chat://stream-error", (event) => {
                onError(event.payload.error);
            });
            unlistenRef.current = [unlistenToken, unlistenDone, unlistenError];
        };
        setup();
    }, []);

    const handleOpenAI = async () => {
        if (!selectedNoteId) return;

        setIsAIPanelOpen(true);
        setIsAiLoading(true);

        try {
            // 创建新的 AI 对话会话
            const session = await invoke<{ id: string; title: string }>('create_chat_session');
            setAiSessionId(session.id);

            // 准备 AI 分析消息
            const summaryPrompt = `请对以下内容进行总结：\n\n${editorContent}`;

            // 添加到本地消息列表
            const userMsg: AiMessage = { role: 'user', content: summaryPrompt };
            setAiMessages([userMsg]);

            // 添加占位 assistant 消息用于流式输出
            const placeholderMsg: AiMessage = { role: 'assistant', content: '', isStreaming: true };
            setAiMessages(prev => [...prev, placeholderMsg]);
            streamingContentRef.current = "";

            // 注册事件监听
            setupStreamListeners(
                (token) => {
                    streamingContentRef.current += token;
                    setAiMessages(prev => {
                        const msgs = [...prev];
                        const last = msgs[msgs.length - 1];
                        if (last && last.role === 'assistant') {
                            msgs[msgs.length - 1] = { ...last, content: streamingContentRef.current, isStreaming: true };
                        }
                        return msgs;
                    });
                },
                (content) => {
                    setIsAiLoading(false);
                    setAiMessages(prev => {
                        const msgs = [...prev];
                        const last = msgs[msgs.length - 1];
                        if (last && last.role === 'assistant') {
                            msgs[msgs.length - 1] = { ...last, content, isStreaming: false };
                        }
                        return msgs;
                    });
                },
                (error) => {
                    setIsAiLoading(false);
                    setAiMessages(prev => {
                        const msgs = [...prev];
                        const last = msgs[msgs.length - 1];
                        if (last && last.role === 'assistant') {
                            msgs[msgs.length - 1] = { ...last, content: `错误: ${error}`, isStreaming: false };
                        }
                        return msgs;
                    });
                },
            );

            // 发送消息给 AI
            await invoke('send_chat_message', {
                sessionId: session.id,
                message: summaryPrompt,
            });
        } catch (error) {
            console.error('AI 对话失败:', error);
            setIsAiLoading(false);
            setAiMessages([{ role: 'assistant', content: `对话失败: ${error}`, isStreaming: false }]);
        }
    };

    const handleSendAiMessage = async () => {
        if (!aiInputValue.trim() || isAiLoading || !aiSessionId) return;

        const userMessage = aiInputValue.trim();
        setAiInputValue('');
        setAiMessages(prev => [...prev, { role: 'user', content: userMessage }]);

        // 添加占位
        setIsAiLoading(true);
        setAiMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }]);
        streamingContentRef.current = "";

        setupStreamListeners(
            (token) => {
                streamingContentRef.current += token;
                setAiMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last && last.role === 'assistant') {
                        msgs[msgs.length - 1] = { ...last, content: streamingContentRef.current, isStreaming: true };
                    }
                    return msgs;
                });
            },
            (content) => {
                setIsAiLoading(false);
                setAiMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last && last.role === 'assistant') {
                        msgs[msgs.length - 1] = { ...last, content, isStreaming: false };
                    }
                    return msgs;
                });
            },
            (error) => {
                setIsAiLoading(false);
                setAiMessages(prev => {
                    const msgs = [...prev];
                    const last = msgs[msgs.length - 1];
                    if (last && last.role === 'assistant') {
                        msgs[msgs.length - 1] = { ...last, content: `错误: ${error}`, isStreaming: false };
                    }
                    return msgs;
                });
            },
        );

        try {
            await invoke('send_chat_message', {
                sessionId: aiSessionId,
                message: userMessage,
            });
        } catch (error) {
            console.error('发送消息失败:', error);
            setIsAiLoading(false);
        }
    };

    const handleAiKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendAiMessage();
        }
    };

    const closeAIPanel = () => {
        setIsAIPanelOpen(false);
        // 清理监听器
        unlistenRef.current.forEach(fn => fn());
        unlistenRef.current = [];
    };

    // 清理监听器
    useEffect(() => {
        return () => {
            unlistenRef.current.forEach(fn => fn());
        };
    }, []);

    // ========== 编辑器 KeyPress ==========
    const handleEditorKeyPress = (e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            handleSaveContent();
        }
    };

    // ========== Markdown 渲染 ==========
    const renderMarkdown = (content: string): string => {
        // 兼容已有数据：将绝对路径转换为 asset protocol URL
        const processed = content.replace(
            /<img\s+[^>]*src="([^"]+)"[^>]*\/?>/g,
            (match, src) => {
                // 已经是可访问的 URL 则跳过
                if (src.startsWith('http') || src.startsWith('asset:') || src.startsWith('data:')) {
                    return match;
                }
                // 本地文件路径 → asset protocol URL
                try {
                    const assetUrl = convertFileSrc(src);
                    return match.replace(`src="${src}"`, `src="${assetUrl}"`);
                } catch {
                    return match;
                }
            }
        );
        try {
            return marked(processed) as string;
        } catch {
            return processed;
        }
    };

    // ========== 渲染文件树节点 ==========
    const renderTreeNodes = (nodes: TreeNode[], level: number = 0): React.ReactNode => {
        return nodes.map(node => (
            <div key={node.id} className="notepad-tree-node">
                {node.is_dir ? (
                    <>
                        <div
                            className="notepad-tree-folder"
                            onClick={() => toggleFolder(node.id)}
                            style={{ paddingLeft: `${12 + level * 16}px` }}
                        >
                            <span className="notepad-tree-arrow">
                                {expandedFolders.has(node.id) ? '▼' : '▶'}
                            </span>
                            <span className="notepad-tree-folder-icon">
                                {expandedFolders.has(node.id) ? '📂' : '📁'}
                            </span>
                            <span className="notepad-tree-name">{node.name}</span>
                            <button
                                className="notepad-tree-add"
                                onClick={(e) => handleAddMenuClick(node.id, e)}
                                title="新建"
                            >+</button>
                            <button
                                className="notepad-tree-delete"
                                onClick={(e) => { e.stopPropagation(); handleDeleteItem(node.id); }}
                                title="删除"
                            >✕</button>
                        </div>
                        {expandedFolders.has(node.id) && node.children && (
                            <div className="notepad-tree-children">
                                {renderTreeNodes(node.children, level + 1)}
                            </div>
                        )}
                    </>
                ) : (
                    <div
                        className={`notepad-tree-file ${selectedNoteId === node.id ? 'selected' : ''}`}
                        onClick={() => handleSelectNote(node as unknown as NoteRecord)}
                        style={{ paddingLeft: `${12 + level * 16}px` }}
                    >
                        <span className="notepad-tree-file-icon">📄</span>
                        <span className="notepad-tree-name">{node.name}</span>
                        <button
                            className="notepad-tree-delete"
                            onClick={(e) => { e.stopPropagation(); handleDeleteItem(node.id); }}
                            title="删除"
                        >✕</button>
                    </div>
                )}
            </div>
        ));
    };

    // ========== 渲染 ==========
    return (
        <div className="notepad-container">
            {/* 标题栏 */}
            <div className="notepad-header" data-tauri-drag-region>
                <div className="notepad-header-title">
                    📝 记事本
                </div>
                <div className="notepad-header-actions">
                    <button className="notepad-header-btn" onClick={handleToggleFullscreen}>
                        {isFullscreen ? '⤡' : '⤢'} {isFullscreen ? '退出全屏' : '全屏'}
                    </button>
                    <button className="notepad-header-btn" onClick={handleClose}>
                        ✕ 关闭
                    </button>
                </div>
            </div>

            {/* 主区域 */}
            <div className="notepad-main">
                {/* 左侧面板 - 文件树 */}
                <div className="notepad-sidebar">
                    <div className="notepad-sidebar-header">
                        <span className="notepad-sidebar-title">📁 笔记</span>
                        <button
                            className="notepad-sidebar-add-btn"
                            onClick={(e) => handleAddMenuClick('', e)}
                            title="新建文件或文件夹"
                        >+</button>
                    </div>
                    <div className="notepad-tree">
                        {noteTree.length > 0 ? (
                            renderTreeNodes(noteTree)
                        ) : (
                            <div className="notepad-tree-empty">
                                <p>暂无笔记</p>
                                <p style={{ fontSize: '11px', opacity: 0.7 }}>点击 + 新建</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* 右侧编辑器 */}
                <div className={`notepad-editor-area ${isAIPanelOpen ? 'with-ai-panel' : ''}`}>
                    {selectedNoteId ? (
                        <div className="notepad-editor-container">
                            <div className="notepad-editor-header">
                                <div className="notepad-editor-file-info">
                                    <span className="notepad-editor-file-icon">📄</span>
                                    <span className="notepad-editor-filename">{selectedNoteName}</span>
                                </div>
                                <div className="notepad-editor-actions">
                                    <button
                                        className={`notepad-editor-btn ${isPreviewMode ? 'notepad-edit-btn' : 'notepad-preview-btn'}`}
                                        onClick={() => setIsPreviewMode(!isPreviewMode)}
                                        title={isPreviewMode ? '编辑模式' : '预览'}
                                    >
                                        <span className="btn-icon">{isPreviewMode ? '✏️' : '👁️'}</span>
                                        <span className="btn-text">{isPreviewMode ? '编辑' : '预览'}</span>
                                    </button>
                                    <button
                                        className="notepad-editor-btn notepad-save-btn"
                                        onClick={handleSaveContent}
                                        title="保存 (Ctrl+S)"
                                    >
                                        <span className="btn-icon">💾</span>
                                        <span className="btn-text">保存</span>
                                    </button>
                                    <button
                                        className="notepad-editor-btn notepad-close-editor-btn"
                                        onClick={() => {
                                            setSelectedNoteId(null);
                                            setSelectedNoteName('');
                                            setEditorContent('');
                                            setIsPreviewMode(false);
                                        }}
                                        title="关闭"
                                    >
                                        <span className="btn-icon">🗑️</span>
                                        <span className="btn-text">关闭</span>
                                    </button>
                                </div>
                            </div>
                            <div className="notepad-editor-body">
                                {isLoadingContent ? (
                                    <div className="notepad-loading">加载中...</div>
                                ) : isPreviewMode ? (
                                    <div
                                        className="notepad-editor-preview markdown-body"
                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(editorContent) }}
                                    />
                                ) : (
                                    <textarea
                                        ref={textareaRef}
                                        className="notepad-editor-textarea"
                                        value={editorContent}
                                        onChange={(e) => {
                                            setEditorContent(e.target.value);
                                            setHasUnsavedChanges(true);
                                        }}
                                        onKeyDown={handleEditorKeyPress}
                                        onPaste={handlePaste}
                                        placeholder="开始编写 Markdown 内容... (可粘贴图片)"
                                    />
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="notepad-editor-empty">
                            <div className="notepad-editor-empty-icon">📝</div>
                            <span>从左侧选择一个笔记</span>
                            <span style={{ fontSize: '12px', opacity: 0.6 }}>或点击 + 新建</span>
                        </div>
                    )}
                </div>

                {/* AI 面板 */}
                {isAIPanelOpen && (
                    <div className="notepad-ai-panel-overlay">
                        <div className="notepad-ai-panel-header">
                            <span className="notepad-ai-panel-title">
                                🤖 {selectedNoteName ? `${selectedNoteName} 总结` : 'AI 对话'}
                            </span>
                            <button className="notepad-ai-panel-close" onClick={closeAIPanel}>
                                ✕
                            </button>
                        </div>
                        <div className="notepad-ai-messages">
                            {aiMessages.map((msg, idx) => (
                                <div
                                    key={idx}
                                    className={`notepad-ai-message ${msg.role} ${msg.isStreaming ? 'notepad-ai-streaming' : ''}`}
                                >
                                    <div className="message-text">{msg.content}</div>
                                </div>
                            ))}
                            {isAiLoading && aiMessages.length === 0 && (
                                <div className="notepad-ai-typing">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </div>
                            )}
                            <div ref={aiMessagesEndRef} />
                        </div>
                        <div className="notepad-ai-input-area">
                            <div className="notepad-ai-input-wrapper">
                                <textarea
                                    ref={aiInputRef}
                                    className="notepad-ai-input"
                                    value={aiInputValue}
                                    onChange={(e) => setAiInputValue(e.target.value)}
                                    onKeyDown={handleAiKeyPress}
                                    placeholder="输入问题... (Enter发送, Shift+Enter换行)"
                                    rows={1}
                                    disabled={isAiLoading}
                                />
                                <button
                                    className="notepad-ai-send-btn"
                                    onClick={handleSendAiMessage}
                                    disabled={!aiInputValue.trim() || isAiLoading}
                                >
                                    ▶
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 右下角 AI 浮动按钮 */}
            {selectedNoteId && (
                <button
                    className={`notepad-ai-fab ${isAIPanelOpen ? 'active' : ''}`}
                    onClick={isAIPanelOpen ? closeAIPanel : handleOpenAI}
                    title={isAIPanelOpen ? '关闭 AI' : 'AI 总结'}
                >
                    {isAIPanelOpen ? '✕' : '🤖'}
                </button>
            )}

            {/* 添加菜单弹出框 */}
            {addMenuPos && (
                <>
                    <div className="notepad-add-menu-overlay" onClick={() => setAddMenuPos(null)} />
                    <div
                        className="notepad-add-menu"
                        style={{ left: addMenuPos.x, top: addMenuPos.y }}
                    >
                        <button className="notepad-add-menu-item" onClick={handleAddNewFolder}>
                            📁 新建文件夹
                        </button>
                        <button className="notepad-add-menu-item" onClick={handleAddNewFile}>
                            📄 新建文件
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
