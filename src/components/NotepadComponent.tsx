import { useEffect, useState, useRef, useCallback } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { marked } from "marked";
import mermaid from 'mermaid';
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
    const [editorMode, setEditorMode] = useState<0 | 1 | 2>(1); // 0=全编辑, 1=分屏, 2=全预览
    const [isLoadingContent, setIsLoadingContent] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

    // ---- Markdown 语法参考 ----
    const [isShowMdRef, setIsShowMdRef] = useState(false);

    // ---- 添加菜单 ----
    const [addMenuPos, setAddMenuPos] = useState<{ x: number; y: number; parentId: string } | null>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const aiOpeningRef = useRef(false);

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

    // ========== 初始化 Mermaid ==========
    useEffect(() => {
        mermaid.initialize({ startOnLoad: false, theme: 'dark' });
    }, []);

    // ========== 渲染 Mermaid 图表 ==========
    useEffect(() => {
        if (editorMode === 0) return;
        const timer = setTimeout(() => {
            mermaid.run({ querySelector: '.markdown-body pre.mermaid' }).catch(() => {});
        }, 50);
        return () => clearTimeout(timer);
    }, [editorContent, editorMode]);

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
        setEditorMode(1);
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
        setSaveStatus('saving');
        try {
            await invoke('update_note_content', { id: selectedNoteId, content: editorContent });
            setHasUnsavedChanges(false);
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 1500);
        } catch (error) {
            console.error('保存失败:', error);
            setSaveStatus('idle');
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
                setEditorMode(1);
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

    // ========== 打开外部 AI 对话窗口 ==========
    const openAIChatWindow = async () => {
        if (!selectedNoteId) return;
        if (aiOpeningRef.current) return;
        aiOpeningRef.current = true;
        
        try {
            const windows = await getAllWindows();
            const existing = windows.find(w => w.label === 'ai-chat');
            
            if (existing) {
                await existing.show();
                await existing.setFocus();
                await existing.emit('notepad://ai-summarize', {
                    content: editorContent,
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
            
            // 等待窗口加载完成
            await new Promise(resolve => setTimeout(resolve, 500));
            
            await webview.emit('notepad://ai-summarize', {
                content: editorContent,
                title: selectedNoteName,
            });
        } catch (error) {
            console.error('打开AI对话窗口失败:', error);
        } finally {
            aiOpeningRef.current = false;
        }
    };

    // ========== 编辑器 KeyPress ==========
    const handleEditorKeyPress = (e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            handleSaveContent();
        }
    };

    // ========== 提取内容中的图片用于编辑模式预览 ==========
    const extractImages = (content: string): string[] => {
        const urls: string[] = [];
        const regex = /<img\s+[^>]*src="([^"]+)"[^>]*\/?>/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            if (!urls.includes(match[1])) {
                urls.push(match[1]);
            }
        }
        return urls;
    };
    const extractedImages = extractImages(editorContent);

    const markdownRefItems = [
        {
            title: '标题 (Headings)',
            demo: (
                <>
                    <code># 一级标题</code><br />
                    <code>## 二级标题</code><br />
                    <code>### 三级标题</code>
                    <span className="mdref-result">使用 # 号数量控制级别，最多 ######</span>
                </>
            ),
        },
        {
            title: '粗体 & 斜体',
            demo: (
                <>
                    <code>**粗体文字**</code> 或 <code>__粗体__</code><br />
                    <code>*斜体文字*</code> 或 <code>_斜体_</code><br />
                    <code>***粗斜体***</code>
                    <span className="mdref-result">使用 * 或 _ 包裹文字</span>
                </>
            ),
        },
        {
            title: '链接',
            demo: (
                <>
                    <code>[显示文字](https://链接)</code><br />
                    <code>[带标题](链接 "鼠标悬停提示")</code>
                    <span className="mdref-result">方括号放文字，圆括号放 URL</span>
                </>
            ),
        },
        {
            title: '图片',
            demo: (
                <>
                    <code>![替代文字](图片URL)</code><br />
                    <code>[![点击图片](img.jpg)](链接)</code>
                    <span className="mdref-result">前面加 ! 号表示图片</span>
                </>
            ),
        },
        {
            title: '无序列表',
            demo: (
                <>
                    <code>- 项目一</code><br />
                    <code>* 项目二</code><br />
                    <code>  - 嵌套项目</code>
                    <span className="mdref-result">使用 -、* 或 +</span>
                </>
            ),
        },
        {
            title: '有序列表',
            demo: (
                <>
                    <code>1. 第一项</code><br />
                    <code>2. 第二项</code><br />
                    <code>   1. 子项（缩进）</code>
                    <span className="mdref-result">数字加点号，自动排序</span>
                </>
            ),
        },
        {
            title: '代码',
            demo: (
                <>
                    <code>\`行内代码\`</code><br />
                    <code>\`\`\`语言</code><br />
                    <code>代码块</code><br />
                    <code>\`\`\`</code>
                    <span className="mdref-result">三个反引号包裹多行代码块</span>
                </>
            ),
        },
        {
            title: '表格',
            demo: (
                <>
                    <code>| 列1 | 列2 |</code><br />
                    <code>| --- | --- |</code><br />
                    <code>| A | B |</code>
                    <span className="mdref-result">对齐：:---（左）:---:（中）---:（右）</span>
                </>
            ),
        },
        {
            title: '引用',
            demo: (
                <>
                    <code>&gt; 这是一段引用</code><br />
                    <code>&gt;&gt; 嵌套引用</code><br />
                    <code>&gt; **引号内可放其他语法**</code>
                    <span className="mdref-result">使用 &gt; 符号</span>
                </>
            ),
        },
        {
            title: '分割线',
            demo: (
                <>
                    <code>---</code><br />
                    <code>***</code><br />
                    <code>___</code>
                    <span className="mdref-result">三个或以上的符号</span>
                </>
            ),
        },
        {
            title: '删除线',
            demo: (
                <>
                    <code>~~被删除的文字~~</code>
                    <span className="mdref-result">两个波浪线包裹文字</span>
                </>
            ),
        },
        {
            title: '任务列表',
            demo: (
                <>
                    <code>- [ ] 待办事项</code><br />
                    <code>- [x] 已完成</code>
                    <span className="mdref-result">- 后跟空格和方括号</span>
                </>
            ),
        },
    ];

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
            let html = marked(processed) as string;
            // 将 mermaid 代码块转换为 mermaid 可识别的格式
            html = html.replace(
                /<pre><code class="[^"]*language-mermaid[^"]*">([\s\S]*?)<\/code><\/pre>/g,
                '<pre class="mermaid">$1</pre>'
            );
            return html;
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
                                        className={`notepad-editor-btn ${editorMode === 0 ? 'notepad-edit-btn' : editorMode === 2 ? 'notepad-preview-btn' : 'notepad-split-btn'}`}
                                        onClick={() => setEditorMode(((editorMode + 1) % 3) as 0 | 1 | 2)}
                                        title={
                                            editorMode === 0 ? '全编辑模式' :
                                            editorMode === 1 ? '分屏模式' : '全预览模式'
                                        }
                                    >
                                        <span className="btn-icon">
                                            {editorMode === 0 ? '✏️' : editorMode === 1 ? '📝/👁️' : '👁️'}
                                        </span>
                                        <span className="btn-text">
                                            {editorMode === 0 ? '全编辑' : editorMode === 1 ? '分屏' : '全预览'}
                                        </span>
                                    </button>
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
                                            setEditorContent('');
                                            setEditorMode(1);
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
                                ) : editorMode === 2 ? (
                                    <div
                                        className="notepad-editor-preview markdown-body"
                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(editorContent) }}
                                    />
                                ) : editorMode === 1 ? (
                                    <div className="notepad-editor-split">
                                        <div className="notepad-editor-split-edit">
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
                                        </div>
                                        <div
                                            className="notepad-editor-split-preview markdown-body"
                                            dangerouslySetInnerHTML={{ __html: renderMarkdown(editorContent) }}
                                        />
                                    </div>
                                ) : (
                                    <div className="notepad-editor-edit-wrap">
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
                                        {extractedImages.length > 0 && (
                                            <div className="notepad-editor-images">
                                                {extractedImages.map((src, idx) => (
                                                    <div key={idx} className="notepad-editor-image-item">
                                                        <img src={src} alt={`paste-image-${idx}`}
                                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
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
