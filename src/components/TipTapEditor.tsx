import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import { common, createLowlight } from "lowlight";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import "./TipTapEditor.css";

const lowlight = createLowlight(common);

type TipTapEditorProps = {
    content: string;
    onChange: (json: string, html: string) => void;
    noteId: string | null;
    placeholder?: string;
    editable?: boolean;
};

// ========== 解析内容：兼容 TipTap JSON / HTML / 纯文本 ==========
function parseContent(content: string): string | object {
    if (!content) return "";

    // 尝试解析为 TipTap JSON（格式：{"type":"doc", ...}）
    try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object" && "type" in parsed) {
            // 返回解析后的对象，TipTap 的 content 属性接受对象
            return parsed;
        }
    } catch { /* 不是 JSON */ }

    // 包含 HTML 标签，直接返回 HTML 字符串
    if (/<[a-zA-Z][^>]*>/.test(content)) {
        return content;
    }

    // 纯文本，返回字符串
    return content;
}

// ========== 扩展 TableCell：支持 backgroundColor 属性 ==========
const CustomTableCell = TableCell.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            backgroundColor: {
                default: null,
                parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
                renderHTML: (attributes: Record<string, unknown>) => {
                    if (!attributes.backgroundColor) return {};
                    return { style: `background-color: ${attributes.backgroundColor}` };
                },
            },
        };
    },
});

// 表格工具栏预设颜色
const TABLE_COLORS = [
    "#ffffff", "#fef2f2", "#fef3c7", "#ecfccb",
    "#dbeafe", "#f3e8ff", "#fce7f3", "#e5e7eb",
];

export default function TipTapEditor({
    content,
    onChange,
    noteId,
    placeholder = "开始输入内容... 支持 Markdown 快捷输入",
    editable = true,
}: TipTapEditorProps) {
    const noteIdRef = useRef(noteId);
    noteIdRef.current = noteId;

    // ---- 表格工具栏状态 ----
    const [tableToolbarPos, setTableToolbarPos] = useState<{ x: number; y: number } | null>(null);
    const [cellToolbarPos, setCellToolbarPos] = useState<{ x: number; y: number } | null>(null);
    const [showTableColorPicker, setShowTableColorPicker] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const rowResizeRef = useRef<{ row: HTMLTableRowElement; startY: number; startHeight: number; cells: HTMLElement[] } | null>(null);

    // ===== 行高拖拽处理 =====
    const handleRowResizeMouseDown = useCallback((e: MouseEvent, cell: HTMLElement) => {
        const row = cell.closest('tr') as HTMLTableRowElement;
        if (!row) return;
        const cells = Array.from(row.querySelectorAll('td, th')) as HTMLElement[];
        rowResizeRef.current = {
            row,
            startY: e.clientY,
            startHeight: cells[0]?.offsetHeight || row.offsetHeight,
            cells,
        };
        e.preventDefault();
        e.stopPropagation();
    }, []);

    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => {
            const state = rowResizeRef.current;
            if (!state) return;
            const delta = e.clientY - state.startY;
            const newHeight = Math.max(24, state.startHeight + delta);
            state.cells.forEach(cell => {
                cell.style.height = `${newHeight}px`;
            });
        };
        const onMouseUp = () => {
            if (rowResizeRef.current) {
                // 拖拽结束，保存行高到编辑器（通过设置 cell 属性）
                rowResizeRef.current = null;
            }
            rowResizeRef.current = null;
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        return () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    }, []);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({ codeBlock: false }),
            Placeholder.configure({ placeholder }),
            Table.configure({ resizable: true }),
            TableRow,
            CustomTableCell,
            TableHeader,
            Image.configure({
                allowBase64: false,
                HTMLAttributes: { class: "tiptap-image" },
            }),
            TaskList,
            TaskItem.configure({ nested: true }),
            CodeBlockLowlight.configure({ lowlight }),
            Highlight.configure({ multicolor: true }),
            Underline,
            TextAlign.configure({ types: ["heading", "paragraph"] }),
            Link.configure({
                openOnClick: true,
                HTMLAttributes: { class: "tiptap-link" },
            }),
        ],
        content: parseContent(content),
        editable,
        onUpdate: ({ editor }) => {
            const json = JSON.stringify(editor.getJSON());
            const html = editor.getHTML();
            onChange(json, html);
        },
        onSelectionUpdate: ({ editor }) => {
            // 更新表格工具栏位置
            if (editor.isActive("table")) {
                updateTableToolbarPos();
            } else {
                setTableToolbarPos(null);
                setCellToolbarPos(null);
                setShowTableColorPicker(false);
            }
        },
        editorProps: {
            attributes: {
                class: "tiptap-editor-content",
            },
        },
    });

    // ========== 更新表格工具栏位置 ==========
    const updateTableToolbarPos = useCallback(() => {
        if (!editor || !wrapperRef.current) return;
        const { from } = editor.state.selection;
        const resolved = editor.state.doc.resolve(from);
        // 找到最近的 table 节点
        let tablePos = -1;
        for (let d = resolved.depth; d > 0; d--) {
            const node = resolved.node(d);
            if (node.type.name === "table") {
                tablePos = resolved.before(d);
                break;
            }
        }
        if (tablePos < 0) { setTableToolbarPos(null); setCellToolbarPos(null); return; }

        const tableCoords = editor.view.coordsAtPos(tablePos);
        const wrapperRect = wrapperRef.current.getBoundingClientRect();
        // 全表工具栏（表格上方）
        setTableToolbarPos({
            x: tableCoords.left - wrapperRect.left,
            y: tableCoords.top - wrapperRect.top - 42,
        });

        // 单元格行操作工具栏（选中单元格底部）
        const cellCoords = editor.view.coordsAtPos(from);
        setCellToolbarPos({
            x: cellCoords.left - wrapperRect.left,
            y: cellCoords.bottom - wrapperRect.top + 4,
        });
    }, [editor]);

    // ===== 注入行高拖拽手柄到表格单元格 =====
    useEffect(() => {
        if (!editor) return;
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        const injectHandles = () => {
            const cells = wrapper.querySelectorAll('.tiptap-editor-content td, .tiptap-editor-content th');
            cells.forEach(cell => {
                if (!cell.querySelector('.row-resize-handle')) {
                    const handle = document.createElement('div');
                    handle.className = 'row-resize-handle';
                    handle.addEventListener('mousedown', (e) => {
                        handleRowResizeMouseDown(e as unknown as MouseEvent, cell as HTMLElement);
                    });
                    cell.appendChild(handle);
                }
            });
        };

        // 初始注入
        injectHandles();
        // 监听DOM变化（表格编辑可能新增/删除行）
        const observer = new MutationObserver(() => injectHandles());
        observer.observe(wrapper, { childList: true, subtree: true });

        return () => observer.disconnect();
    }, [editor, handleRowResizeMouseDown]);

    // 监窗口滚动/大小变化时更新位置
    useEffect(() => {
        const el = wrapperRef.current?.closest(".notepad-editor-body") as HTMLElement;
        if (!el || !editor) return;
        const handler = () => { if (editor.isActive("table")) updateTableToolbarPos(); };
        el.addEventListener("scroll", handler, { passive: true });
        window.addEventListener("resize", handler);
        return () => {
            el.removeEventListener("scroll", handler);
            window.removeEventListener("resize", handler);
        };
    }, [editor, updateTableToolbarPos]);

    // ========== 图片粘贴处理 ==========
    const handleImagePaste = useCallback(async (file: File): Promise<string | null> => {
        if (!noteIdRef.current) return null;
        try {
            const reader = new FileReader();
            const dataUrl = await new Promise<string>((resolve) => {
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(file);
            });
            const base64 = dataUrl.split(",")[1];
            const ext = file.type.split("/")[1] || "png";
            const fileName = `img_${Date.now()}.${ext}`;
            const savedPath = await invoke<string>("save_note_image", {
                noteId: noteIdRef.current,
                fileName,
                imageDataBase64: base64,
            });
            return convertFileSrc(savedPath);
        } catch (error) {
            console.error("保存图片失败:", error);
            return null;
        }
    }, []);

    // ========== 工具栏命令 ==========
    const execCmd = useCallback((action: string) => {
        if (!editor) return;
        const chain = editor.chain().focus();

        switch (action) {
            case "bold": chain.toggleBold().run(); break;
            case "italic": chain.toggleItalic().run(); break;
            case "underline": chain.toggleUnderline().run(); break;
            case "strike": chain.toggleStrike().run(); break;
            case "code": chain.toggleCode().run(); break;
            case "highlight": chain.toggleHighlight().run(); break;
            case "h1": chain.toggleHeading({ level: 1 }).run(); break;
            case "h2": chain.toggleHeading({ level: 2 }).run(); break;
            case "h3": chain.toggleHeading({ level: 3 }).run(); break;
            case "h4": chain.toggleHeading({ level: 4 }).run(); break;
            case "bulletList": chain.toggleBulletList().run(); break;
            case "orderedList": chain.toggleOrderedList().run(); break;
            case "taskList": chain.toggleTaskList().run(); break;
            case "blockquote": chain.toggleBlockquote().run(); break;
            case "codeBlock": chain.toggleCodeBlock().run(); break;
            case "horizontalRule": chain.setHorizontalRule().run(); break;
            case "alignLeft": chain.setTextAlign("left").run(); break;
            case "alignCenter": chain.setTextAlign("center").run(); break;
            case "alignRight": chain.setTextAlign("right").run(); break;
            case "undo": chain.undo().run(); break;
            case "redo": chain.redo().run(); break;
            case "link":
                if (editor.isActive("link")) { chain.unsetLink().run(); }
                else { const url = prompt("输入链接地址:"); if (url) chain.setLink({ href: url }).run(); }
                break;
            case "image": {
                const url = prompt("输入图片 URL:");
                if (url) chain.setImage({ src: url }).run();
                break;
            }
            case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
            case "clearFormat": chain.clearNodes().unsetAllMarks().run(); break;
            // ---- 表格操作 ----
            case "addRowBefore": chain.addRowBefore().run(); updateTableToolbarPos(); break;
            case "addRowAfter": chain.addRowAfter().run(); updateTableToolbarPos(); break;
            case "deleteRow": chain.deleteRow().run(); updateTableToolbarPos(); break;
            case "addColumnBefore": chain.addColumnBefore().run(); updateTableToolbarPos(); break;
            case "addColumnAfter": chain.addColumnAfter().run(); updateTableToolbarPos(); break;
            case "deleteColumn": chain.deleteColumn().run(); updateTableToolbarPos(); break;
            case "mergeCells": chain.mergeCells().run(); break;
            case "splitCell": chain.splitCell().run(); break;
            case "toggleHeaderRow": chain.toggleHeaderRow().run(); break;
            case "deleteTable": chain.deleteTable().run(); setTableToolbarPos(null); break;
        }
    }, [editor, updateTableToolbarPos]);

    // ========== 设置单元格背景色 ==========
    const setCellBgColor = useCallback((color: string) => {
        if (!editor) return;
        editor.chain().focus().setCellAttribute("backgroundColor", color === "#ffffff" ? null : color).run();
        setShowTableColorPicker(false);
    }, [editor]);

    if (!editor) return null;

    // ---- 工具栏定义 ----
    type ToolbarItem = { icon: string; title: string; action: string; active?: boolean };
    const groups: { items: ToolbarItem[] }[] = [
        { items: [
            { icon: "↩", title: "撤销", action: "undo" },
            { icon: "↪", title: "重做", action: "redo" },
        ]},
        { items: [
            { icon: "B", title: "加粗", action: "bold", active: editor.isActive("bold") },
            { icon: "I", title: "斜体", action: "italic", active: editor.isActive("italic") },
            { icon: "U", title: "下划线", action: "underline", active: editor.isActive("underline") },
            { icon: "S", title: "删除线", action: "strike", active: editor.isActive("strike") },
            { icon: "<>", title: "行内代码", action: "code", active: editor.isActive("code") },
            { icon: "H", title: "高亮", action: "highlight", active: editor.isActive("highlight") },
        ]},
        { items: [
            { icon: "H1", title: "一级标题", action: "h1", active: editor.isActive("heading", { level: 1 }) },
            { icon: "H2", title: "二级标题", action: "h2", active: editor.isActive("heading", { level: 2 }) },
            { icon: "H3", title: "三级标题", action: "h3", active: editor.isActive("heading", { level: 3 }) },
            { icon: "H4", title: "四级标题", action: "h4", active: editor.isActive("heading", { level: 4 }) },
        ]},
        { items: [
            { icon: "•", title: "无序列表", action: "bulletList", active: editor.isActive("bulletList") },
            { icon: "1.", title: "有序列表", action: "orderedList", active: editor.isActive("orderedList") },
            { icon: "☑", title: "任务列表", action: "taskList", active: editor.isActive("taskList") },
        ]},
        { items: [
            { icon: "❝", title: "引用", action: "blockquote", active: editor.isActive("blockquote") },
            { icon: "{ }", title: "代码块", action: "codeBlock", active: editor.isActive("codeBlock") },
            { icon: "—", title: "分割线", action: "horizontalRule" },
        ]},
        { items: [
            { icon: "⫷", title: "左对齐", action: "alignLeft", active: editor.isActive({ textAlign: "left" }) },
            { icon: "⫿", title: "居中", action: "alignCenter", active: editor.isActive({ textAlign: "center" }) },
            { icon: "⫸", title: "右对齐", action: "alignRight", active: editor.isActive({ textAlign: "right" }) },
        ]},
        { items: [
            { icon: "🔗", title: "链接", action: "link", active: editor.isActive("link") },
            { icon: "🖼", title: "图片", action: "image" },
            { icon: "⊞", title: "表格", action: "table" },
        ]},
        { items: [
            { icon: "✕", title: "清除格式", action: "clearFormat" },
        ]},
    ];

    return (
        <div className="tiptap-wrapper" ref={wrapperRef}>
            {/* 顶部工具栏 */}
            <div className="tiptap-toolbar">
                {groups.map((group, gi) => (
                    <div key={gi} className="tiptap-toolbar-group">
                        {group.items.map((item, ii) => (
                            <button
                                key={ii}
                                type="button"
                                className={`tiptap-toolbar-btn ${item.active ? "is-active" : ""}`}
                                title={item.title}
                                onClick={() => execCmd(item.action)}
                            >
                                {item.icon}
                            </button>
                        ))}
                    </div>
                ))}
            </div>

            {/* 表格浮动工具栏 */}
            {tableToolbarPos && (
                <div
                    className="table-toolbar"
                    style={{ left: tableToolbarPos.x, top: tableToolbarPos.y }}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    <button onClick={() => execCmd("addRowBefore")}>+ 上行</button>
                    <button onClick={() => execCmd("addRowAfter")}>+ 下行</button>
                    <button onClick={() => execCmd("deleteRow")} className="table-action-delete">- 行</button>
                    <span className="table-toolbar-sep" />
                    <button onClick={() => execCmd("addColumnBefore")}>+ 左列</button>
                    <button onClick={() => execCmd("addColumnAfter")}>+ 右列</button>
                    <button onClick={() => execCmd("deleteColumn")} className="table-action-delete">- 列</button>
                    <span className="table-toolbar-sep" />
                    <button onClick={() => execCmd("mergeCells")} title="合并选中单元格">⋈ 合并</button>
                    <button onClick={() => execCmd("splitCell")} title="拆分单元格">⧉ 拆分</button>
                    <span className="table-toolbar-sep" />
                    <button onClick={() => execCmd("toggleHeaderRow")}>≡ 表头</button>
                    <span className="table-toolbar-sep" />
                    <div style={{ position: "relative" }}>
                        <button onClick={() => setShowTableColorPicker(!showTableColorPicker)}>🎨 背景色</button>
                        {showTableColorPicker && (
                            <div
                                className="table-color-picker"
                                style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: 0,
                                    marginTop: 4,
                                    padding: 4,
                                    background: "#ffffff",
                                    border: "1px solid rgba(0,0,0,0.12)",
                                    borderRadius: 6,
                                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                                    zIndex: 101,
                                    flexWrap: "wrap",
                                    width: 178,
                                }}
                                onMouseDown={(e) => e.preventDefault()}
                            >
                                <div className="table-color-btn table-color-reset" onClick={() => setCellBgColor("#ffffff")} />
                                {TABLE_COLORS.slice(1).map((c) => (
                                    <div
                                        key={c}
                                        className="table-color-btn"
                                        style={{ background: c }}
                                        onClick={() => setCellBgColor(c)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    <span className="table-toolbar-sep" />
                    <button onClick={() => execCmd("deleteTable")} className="table-action-delete">🗑 删表</button>
                </div>
            )}

            {/* 单元格行操作工具栏（选中单元格时出现在单元格下方） */}
            {cellToolbarPos && tableToolbarPos && (
                <div
                    className="table-toolbar table-row-toolbar"
                    style={{
                        left: cellToolbarPos.x,
                        top: cellToolbarPos.y,
                        background: 'rgba(255,255,255,0.95)',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
                        border: '1px solid rgba(59,130,246,0.2)',
                        borderRadius: 6,
                        padding: '2px 4px',
                        gap: 1,
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    <button onClick={() => execCmd("addRowBefore")} title="上方插入行">⬆ +</button>
                    <button onClick={() => execCmd("addRowAfter")} title="下方插入行">⬇ +</button>
                    <button onClick={() => execCmd("deleteRow")} className="table-action-delete" title="删除当前行">✕ 行</button>
                </div>
            )}

            {/* 编辑器内容区 */}
            <EditorContent
                editor={editor}
                className="tiptap-editor-body"
                onPaste={(e) => {
                    const items = e.clipboardData.items;
                    for (const item of items) {
                        if (item.type.startsWith("image/")) {
                            e.preventDefault();
                            const file = item.getAsFile();
                            if (file) {
                                handleImagePaste(file).then((url) => {
                                    if (url && editor) {
                                        editor.chain().focus().setImage({ src: url }).run();
                                    }
                                });
                            }
                            return;
                        }
                    }
                }}
                onDrop={(e) => {
                    for (const file of e.dataTransfer.files) {
                        if (file.type.startsWith("image/")) {
                            e.preventDefault();
                            handleImagePaste(file).then((url) => {
                                if (url && editor) {
                                    editor.chain().focus().setImage({ src: url }).run();
                                }
                            });
                            return;
                        }
                    }
                }}
            />
        </div>
    );
}
