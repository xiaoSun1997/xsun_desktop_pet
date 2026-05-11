import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { marked } from "marked";
import TipTapEditor from "./TipTapEditor";
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

// ========== 数据兼容层：解析存储内容 ==========
function parseStoredContent(content: string): string {
    if (!content) return "";
    // 尝试解析为 JSON（TipTap 格式：{\"type\":\"doc\", ...}）
    try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object" && "type" in parsed) {
            return content; // 已是 TipTap JSON
        }
    } catch { /* 不是 JSON，继续检测 */ }
    // 如果包含 HTML 标签，直接返回
    if (/<[a-zA-Z][^>]*>/.test(content)) {
        return content;
    }
    // 否则视为 Markdown，转为 HTML 给 TipTap 解析
    try {
        const html = marked.parse(content, { breaks: true }) as string;
        return html;
    } catch {
        return content;
    }
}

// ========== 获取编辑器纯文本（用于AI总结） ==========
function htmlToPlainText(html: string): string {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
}

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
    const [editorJson, setEditorJson] = useState<string>('');
    const [editorHtml, setEditorHtml] = useState<string>('');
    const [isLoadingContent, setIsLoadingContent] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

    // ---- Markdown 语法参考 ----
    const [isShowMdRef, setIsShowMdRef] = useState(false);

    // ---- 添加菜单 ----
    const [addMenuPos, setAddMenuPos] = useState<{ x: number; y: number; parentId: string } | null>(null);

    const aiOpeningRef = useRef(false);

    // ========== 构建文件树 ==========
    const buildTree = useCallback((notes: NoteRecord[]): TreeNode[] => {
        const map = new Map<string, TreeNode[]>();
        const roots: TreeNode[] = [];

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

        const addChildren = (nodes: TreeNode[]) => {
            for (const node of nodes) {
                if (node.is_dir) {
                    const children = map.get(node.id) || [];
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

    // ========== 文件树操作 ==========
    const toggleFolder = (id: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(id)) { next.delete(id); }
            else { next.add(id); }
            return next;
        });
    };

    const handleSelectNote = async (note: NoteRecord) => {
        if (hasUnsavedChanges && selectedNoteId) {
            try {
                await invoke('update_note_content', { id: selectedNoteId, content: editorJson });
            } catch (e) {
                console.error('自动保存失败:', e);
            }
        }
        setSelectedNoteId(note.id);
        setSelectedNoteName(note.name);
        setIsLoadingContent(true);
        try {
            const content = await invoke<string>('get_note_content', { id: note.id });
            const parsed = parseStoredContent(content || '');
            setEditorJson(parsed);
            setEditorHtml('');
            setHasUnsavedChanges(false);
        } catch (error) {
            console.error('加载笔记内容失败:', error);
            setEditorJson('');
            setEditorHtml('');
        }
        setIsLoadingContent(false);
    };

    const handleSaveContent = async () => {
        if (!selectedNoteId) return;
        setSaveStatus('saving');
        try {
            await invoke('update_note_content', { id: selectedNoteId, content: editorJson });
            setHasUnsavedChanges(false);
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 1500);
        } catch (error) {
            console.error('保存失败:', error);
            setSaveStatus('idle');
        }
    };

    // ========== TipTap 编辑器回调 ==========
    const handleEditorChange = useCallback((json: string, html: string) => {
        setEditorJson(json);
        setEditorHtml(html);
        setHasUnsavedChanges(true);
    }, []);

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
                setEditorJson('');
                setEditorHtml('');
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

    // ========== 窗口控制 ==========
    const handleClose = async () => {
        if (hasUnsavedChanges && selectedNoteId) {
            try {
                await invoke('update_note_content', { id: selectedNoteId, content: editorJson });
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

    // ========== 打开外部 AI 对话窗口 ==========
    const openAIChatWindow = async () => {
        if (!selectedNoteId) return;
        if (aiOpeningRef.current) return;
        aiOpeningRef.current = true;

        // 获取编辑器纯文本内容
        const plainText = htmlToPlainText(editorHtml) || editorJson;

        try {
            const windows = await getAllWindows();
            const existing = windows.find(w => w.label === 'ai-chat');

            if (existing) {
                await existing.show();
                await existing.setFocus();
                await existing.emit('notepad://ai-summarize', {
                    content: plainText,
                    title: selectedNoteName,
                });
                return;
            }

            const url = import.meta.env.DEV ? 'http://localhost:1420' : 'index.html';

            const webview = new WebviewWindow('ai-chat', {
                url,
                title: 'AI对话助手',
                width: 800,
                height: 600,
                visible: true,
                transparent: true,
                decorations: false,
                resizable: true,
                minWidth: 600,
                minHeight: 500,
                center: true,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('等待AI对话窗口创建超时'));
                }, 5000);
                webview.once('tauri://created', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                webview.once('tauri://error', (e) => {
                    clearTimeout(timeout);
                    reject(new Error('创建AI对话窗口出错: ' + JSON.stringify(e)));
                });
            });

            await webview.show();
            await webview.setFocus();
            await new Promise(resolve => setTimeout(resolve, 500));

            await webview.emit('notepad://ai-summarize', {
                content: plainText,
                title: selectedNoteName,
            });
        } catch (error) {
            console.error('打开AI对话窗口失败:', error);
        } finally {
            aiOpeningRef.current = false;
        }
    };

    // ========== 编辑器快捷键 ==========
    const handleEditorKeyDown = (e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            handleSaveContent();
        }
    };

    // ========== Markdown 语法参考 ==========
    const markdownRefItems = [
        { title: '标题', demo: <><code># 一级标题</code><br /><code>## 二级标题</code><br /><code>### 三级标题</code><span className="mdref-result"># 号数量控制级别</span></> },
        { title: '粗体 & 斜体', demo: <><code>**粗体**</code><br /><code>*斜体*</code><br /><code>***粗斜体***</code><span className="mdref-result">* 或 _ 包裹</span></> },
        { title: '链接', demo: <><code>[文字](URL)</code><span className="mdref-result">方括号+圆括号</span></> },
        { title: '图片', demo: <><code>![替代文字](URL)</code><span className="mdref-result">前加 ! 号</span></> },
        { title: '无序列表', demo: <><code>- 项目</code><br /><code>  - 嵌套</code><span className="mdref-result">- * + 均可</span></> },
        { title: '有序列表', demo: <><code>1. 第一项</code><br /><code>2. 第二项</code><span className="mdref-result">数字+点+空格</span></> },
        { title: '代码', demo: <><code>\`行内\`</code><br /><code>\`\`\`语言</code><br /><code>代码块</code><br /><code>\`\`\`</code><span className="mdref-result">反引号包裹</span></> },
        { title: '表格', demo: <><code>| 列1 | 列2 |</code><br /><code>| --- | --- |</code><br /><code>| A | B |</code><span className="mdref-result">管道符分隔</span></> },
        { title: '引用', demo: <><code>&gt; 引用内容</code><span className="mdref-result">&gt; 开头</span></> },
        { title: '任务列表', demo: <><code>- [ ] 待办</code><br /><code>- [x] 已完成</code><span className="mdref-result">- [ ] 格式</span></> },
    ];

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
        <div className="notepad-container" onKeyDown={handleEditorKeyDown}>
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
                <div className={`notepad-editor-area${isShowMdRef ? ' with-mdref-panel' : ''}`}>
                    {selectedNoteId ? (
                        <div className="notepad-editor-container">
                            <div className="notepad-editor-header">
                                <div className="notepad-editor-file-info">
                                    <span className="notepad-editor-file-icon">📄</span>
                                    <span className="notepad-editor-filename">{selectedNoteName}</span>
                                </div>
                                <div className="notepad-editor-actions">
                                    <button
                                        className={`notepad-mdref-btn ${isShowMdRef ? 'active' : ''}`}
                                        onClick={() => setIsShowMdRef(!isShowMdRef)}
                                        title={isShowMdRef ? '关闭语法参考' : 'Markdown 语法参考'}
                                    >
                                        📘 语法
                                    </button>
                                    <button
                                        className={`notepad-editor-btn notepad-save-btn ${saveStatus === 'saved' ? 'saved' : ''}`}
                                        onClick={handleSaveContent}
                                        title="保存 (Ctrl+S)"
                                        disabled={saveStatus === 'saving'}
                                    >
                                        <span className="btn-icon">{saveStatus === 'saved' ? '✅' : saveStatus === 'saving' ? '⏳' : '💾'}</span>
                                        <span className="btn-text">{saveStatus === 'saved' ? '已保存' : saveStatus === 'saving' ? '保存中' : '保存'}</span>
                                    </button>
                                    <button
                                        className="notepad-editor-btn notepad-close-editor-btn"
                                        onClick={() => {
                                            setSelectedNoteId(null);
                                            setSelectedNoteName('');
                                            setEditorJson('');
                                            setEditorHtml('');
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
                                ) : (
                                    <TipTapEditor
                                        content={editorJson}
                                        onChange={handleEditorChange}
                                        noteId={selectedNoteId}
                                        placeholder="开始输入内容... 支持 Markdown 快捷输入（如 # 标题、- 列表等）"
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

                {/* Markdown 语法参考面板 */}
                {isShowMdRef && (
                    <div className="notepad-mdref-panel">
                        <div className="notepad-mdref-header">
                            <span className="notepad-mdref-title">📘 Markdown 语法参考</span>
                            <button className="notepad-mdref-close" onClick={() => setIsShowMdRef(false)}>✕</button>
                        </div>
                        <div className="notepad-mdref-body">
                            {markdownRefItems.map((item, idx) => (
                                <div key={idx} className="notepad-mdref-item">
                                    <div className="notepad-mdref-item-title">{item.title}</div>
                                    <div className="notepad-mdref-item-demo">{item.demo}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* 右下角 AI 浮动按钮 */}
            {selectedNoteId && (
                <button
                    className="notepad-ai-fab"
                    onClick={openAIChatWindow}
                    title="AI 总结"
                >
                    <img src="/menu/ai.png" alt="AI" />
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
