<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import Vditor from "vditor";
import "vditor/dist/index.css";

interface NoteRecord { id: string; name: string; content: string; parent_path: string; is_dir: boolean; created_at: number; updated_at: number; }
interface TreeNode { id: string; name: string; path: string; is_dir: boolean; children?: TreeNode[]; parent_path: string; content?: string; }

let vditorIns: Vditor | null = null;
const vditorContainer = ref<HTMLDivElement | null>(null);
const editorReady = ref(false);
const isFullscreen = ref(false);
const noteTree = ref<TreeNode[]>([]);
const expandedFolders = ref<Set<string>>(new Set());
const selectedNoteId = ref<string | null>(null);
const selectedNoteName = ref<string>("");
const isLoadingContent = ref(false);
const hasUnsavedChanges = ref(false);
const saveStatus = ref<"idle" | "saving" | "saved">("idle");
const isShowMdRef = ref(false);

const markdownRefItems = [
  { title: "标题", demo: "# 一级标题  |  ## 二级标题  |  ### 三级标题", note: "# 号数量控制级别" },
  { title: "粗体 & 斜体", demo: "**粗体**  |  *斜体*  |  ***粗斜体***", note: "* 或 _ 包裹文字" },
  { title: "链接", demo: "[文字](URL)", note: "方括号+圆括号" },
  { title: "图片", demo: "![替代文字](URL)", note: "前加 ! 号" },
  { title: "无序列表", demo: "- 项目   |   - 嵌套", note: "- * + 均可" },
  { title: "有序列表", demo: "1. 第一项  |  2. 第二项", note: "数字+点+空格" },
  { title: "代码", demo: "`行内`  |  ```语言  代码块  ```", note: "反引号包裹" },
  { title: "表格", demo: "| 列1 | 列2 |\n| --- | --- |\n| A | B |", note: "管道符分隔" },
  { title: "引用", demo: "> 引用内容", note: "> 开头" },
  { title: "任务列表", demo: "- [ ] 待办  |  - [x] 已完成", note: "- [ ] 格式" },
];

let aiOpening = false;

const buildTree = (notes: NoteRecord[]): TreeNode[] => {
  const map = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  for (const note of notes) {
    const node: TreeNode = { id: note.id, name: note.name, path: note.id, is_dir: note.is_dir, parent_path: note.parent_path, content: note.content };
    if (note.parent_path === "" || note.parent_path === "root") roots.push(node);
    else {
      const children = map.get(note.parent_path) || [];
      children.push(node);
      map.set(note.parent_path, children);
    }
  }
  const addChildren = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.is_dir) {
        const children = map.get(node.id) || [];
        children.sort((a, b) => { if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1; return a.name.localeCompare(b.name); });
        node.children = children;
        addChildren(children);
      }
    }
  };
  roots.sort((a, b) => { if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1; return a.name.localeCompare(b.name); });
  addChildren(roots);
  return roots;
};

const loadNotes = async () => {
  try {
    const notes = await invoke<NoteRecord[]>("get_all_notes");
    noteTree.value = buildTree(notes);
  } catch (e) { console.error("加载笔记失败:", e); }
};

const toggleFolder = (id: string) => {
  const next = new Set(expandedFolders.value);
  next.has(id) ? next.delete(id) : next.add(id);
  expandedFolders.value = next;
};

const getVditorContent = (): string => {
  if (vditorIns) {
    try {
      const content = vditorIns.getValue();
      return content || "";
    } catch { return ""; }
  }
  return "";
};

const setVditorContent = (content: string) => {
  if (vditorIns) {
    try { vditorIns.setValue(content || ""); } catch { /* */ }
  }
};

const autoSave = async () => {
  if (hasUnsavedChanges.value && selectedNoteId.value) {
    try {
      const content = getVditorContent();
      await invoke("update_note_content", { id: selectedNoteId.value, content });
    } catch (e) { console.error("自动保存失败:", e); }
  }
};

const handleSelectNote = async (note: NoteRecord) => {
  await autoSave();
  selectedNoteId.value = note.id;
  selectedNoteName.value = note.name;
  isLoadingContent.value = true;
  try {
    const content = await invoke<string>("get_note_content", { id: note.id });
    if (vditorIns) {
      setVditorContent(content || "");
    }
    hasUnsavedChanges.value = false;
  } catch (e) {
    console.error("加载笔记内容失败:", e);
    setVditorContent("");
  }
  isLoadingContent.value = false;
};

const handleSaveContent = async () => {
  if (!selectedNoteId.value) return;
  saveStatus.value = "saving";
  try {
    const content = getVditorContent();
    await invoke("update_note_content", { id: selectedNoteId.value, content });
    hasUnsavedChanges.value = false;
    saveStatus.value = "saved";
    setTimeout(() => saveStatus.value = "idle", 1500);
  } catch (e) {
    console.error("保存失败:", e);
    saveStatus.value = "idle";
  }
};

const handleCreateItem = async (name: string, parentId: string, isDir: boolean) => {
  try {
    await invoke<NoteRecord>("create_note_document", { name, parentPath: parentId || "root", isDir });
    await loadNotes();
  } catch (e) { console.error("创建失败:", e); }
};

const handleDeleteItem = async (id: string) => {
  try {
    await invoke("delete_note_document", { id });
    if (selectedNoteId.value === id) { selectedNoteId.value = null; selectedNoteName.value = ""; setVditorContent(""); }
    await loadNotes();
  } catch (e) { console.error("删除失败:", e); }
};

const handleClose = async () => {
  await autoSave();
  await getCurrentWindow().close();
};

const handleToggleFullscreen = async () => {
  const win = getCurrentWindow();
  const fs = await win.isFullscreen();
  await win.setFullscreen(!fs);
  isFullscreen.value = !fs;
};

const handleNewFolder = async (parentId: string) => {
  const name = prompt("请输入文件夹名称:");
  if (name && name.trim()) await handleCreateItem(name.trim(), parentId, true);
};

const handleNewFile = async (parentId: string) => {
  const name = prompt("请输入文件名称 (例如: 笔记.md):");
  if (name && name.trim()) await handleCreateItem(name.trim(), parentId, false);
};

const openAIChatWindow = async () => {
  if (!selectedNoteId.value) return;
  if (aiOpening) return;
  aiOpening = true;

  const content = getVditorContent();

  try {
    const windows = await getAllWindows();
    const existing = windows.find((w: any) => w.label === "ai-chat");

    if (existing) {
      await existing.show();
      await existing.setFocus();
      await existing.emit("notepad://ai-summarize", { content, title: selectedNoteName.value });
      return;
    }

    const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";
    const webview = new WebviewWindow("ai-chat", {
      url, title: "AI对话助手", width: 800, height: 600,
      visible: true, transparent: true, decorations: false,
      resizable: true, minWidth: 600, minHeight: 500, center: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("等待AI对话窗口创建超时")), 5000);
      webview.once("tauri://created", () => { clearTimeout(timeout); resolve(); });
      webview.once("tauri://error", (e) => { clearTimeout(timeout); reject(new Error("创建AI对话窗口出错: " + JSON.stringify(e))); });
    });

    await webview.show();
    await webview.setFocus();
    await new Promise(r => setTimeout(r, 500));
    await webview.emit("notepad://ai-summarize", { content, title: selectedNoteName.value });
  } catch (e) { console.error("打开AI对话窗口失败:", e); }
  finally { aiOpening = false; }
};

const handleEditorKeyDown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSaveContent(); }
};

const closeEditor = () => {
  selectedNoteId.value = null;
  selectedNoteName.value = "";
  setVditorContent("");
};

const initVditor = async () => {
  if (!vditorContainer.value) return;
  vditorIns = new Vditor(vditorContainer.value, {
    height: "100%",
    mode: "wysiwyg",
    toolbarConfig: { pin: true },
    cache: { enable: false },
    placeholder: "开始输入内容... 支持 Markdown 快捷输入（如 # 标题、- 列表等）",
    input: () => {
      hasUnsavedChanges.value = true;
    },
    blur: () => {
      const content = getVditorContent();
      if (selectedNoteId.value && hasUnsavedChanges.value) {
        invoke("update_note_content", { id: selectedNoteId.value, content }).catch(() => {});
        hasUnsavedChanges.value = false;
      }
    },
  });
  editorReady.value = true;
};

onMounted(() => {
  loadNotes();
  nextTick(() => initVditor());
  window.addEventListener("keydown", handleEditorKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleEditorKeyDown);
});
</script>

<template>
  <div class="notepad-container">
    <div class="notepad-header" data-tauri-drag-region>
      <div class="notepad-header-title">📝 记事本</div>
      <div class="notepad-header-actions">
        <button class="notepad-header-btn" @click="handleToggleFullscreen">{{ isFullscreen ? '⤡ 退出全屏' : '⤢ 全屏' }}</button>
        <button class="notepad-header-btn" @click="handleClose">✕ 关闭</button>
      </div>
    </div>

    <div class="notepad-main">
      <div class="notepad-sidebar">
        <div class="notepad-sidebar-header">
          <span class="notepad-sidebar-title">📁 笔记</span>
          <button class="notepad-sidebar-add-btn" @click="handleNewFile('')" title="新建文件">+</button>
        </div>
        <div class="notepad-tree">
          <div v-if="noteTree.length === 0" class="notepad-tree-empty">
            <p>暂无笔记</p>
            <p style="font-size: 11px; opacity: 0.7">点击 + 新建</p>
          </div>
          <template v-for="node in noteTree" :key="node.id">
            <div v-if="node.is_dir" class="notepad-tree-node">
              <div class="notepad-tree-folder" @click="toggleFolder(node.id)" :style="{ paddingLeft: '12px' }">
                <span class="notepad-tree-arrow">{{ expandedFolders.has(node.id) ? '▼' : '▶' }}</span>
                <span class="notepad-tree-folder-icon">{{ expandedFolders.has(node.id) ? '📂' : '📁' }}</span>
                <span class="notepad-tree-name">{{ node.name }}</span>
                <button class="notepad-tree-add" @click.stop="handleNewFile(node.id)" title="新建">+</button>
                <button class="notepad-tree-delete" @click.stop="handleDeleteItem(node.id)" title="删除">✕</button>
              </div>
              <div v-if="expandedFolders.has(node.id) && node.children" class="notepad-tree-children">
                <div v-for="child in node.children" :key="child.id" class="notepad-tree-node">
                  <template v-if="child.is_dir">
                    <div class="notepad-tree-folder" @click="toggleFolder(child.id)" :style="{ paddingLeft: '28px' }">
                      <span class="notepad-tree-arrow">{{ expandedFolders.has(child.id) ? '▼' : '▶' }}</span>
                      <span class="notepad-tree-folder-icon">{{ expandedFolders.has(child.id) ? '📂' : '📁' }}</span>
                      <span class="notepad-tree-name">{{ child.name }}</span>
                      <button class="notepad-tree-add" @click.stop="handleNewFile(child.id)" title="新建">+</button>
                      <button class="notepad-tree-delete" @click.stop="handleDeleteItem(child.id)" title="删除">✕</button>
                    </div>
                    <div v-if="expandedFolders.has(child.id) && child.children" class="notepad-tree-children">
                      <div v-for="gc in child.children" :key="gc.id" class="notepad-tree-node">
                        <div :class="['notepad-tree-file', { selected: selectedNoteId === gc.id }]"
                          @click="handleSelectNote(gc as unknown as NoteRecord)"
                          :style="{ paddingLeft: '44px' }">
                          <span class="notepad-tree-file-icon">📄</span>
                          <span class="notepad-tree-name">{{ gc.name }}</span>
                          <button class="notepad-tree-delete" @click.stop="handleDeleteItem(gc.id)" title="删除">✕</button>
                        </div>
                      </div>
                    </div>
                  </template>
                  <template v-else>
                    <div :class="['notepad-tree-file', { selected: selectedNoteId === child.id }]"
                      @click="handleSelectNote(child as unknown as NoteRecord)"
                      :style="{ paddingLeft: '28px' }">
                      <span class="notepad-tree-file-icon">📄</span>
                      <span class="notepad-tree-name">{{ child.name }}</span>
                      <button class="notepad-tree-delete" @click.stop="handleDeleteItem(child.id)" title="删除">✕</button>
                    </div>
                  </template>
                </div>
              </div>
            </div>
            <template v-else>
              <div :class="['notepad-tree-file', { selected: selectedNoteId === node.id }]"
                @click="handleSelectNote(node as unknown as NoteRecord)"
                :style="{ paddingLeft: '12px' }">
                <span class="notepad-tree-file-icon">📄</span>
                <span class="notepad-tree-name">{{ node.name }}</span>
                <button class="notepad-tree-delete" @click.stop="handleDeleteItem(node.id)" title="删除">✕</button>
              </div>
            </template>
          </template>
        </div>
      </div>

      <div :class="['notepad-editor-area', { 'with-mdref-panel': isShowMdRef }]">
        <template v-if="selectedNoteId">
          <div class="notepad-editor-container">
            <div class="notepad-editor-header">
              <div class="notepad-editor-file-info">
                <span class="notepad-editor-file-icon">📄</span>
                <span class="notepad-editor-filename">{{ selectedNoteName }}</span>
              </div>
              <div class="notepad-editor-actions">
                <button :class="['notepad-mdref-btn', { active: isShowMdRef }]"
                  @click="isShowMdRef = !isShowMdRef"
                  :title="isShowMdRef ? '关闭语法参考' : 'Markdown 语法参考'">📘 语法</button>
                <button :class="['notepad-editor-btn notepad-save-btn', { saved: saveStatus === 'saved' }]"
                  @click="handleSaveContent" title="保存 (Ctrl+S)" :disabled="saveStatus === 'saving'">
                  <span class="btn-icon">{{ saveStatus === 'saved' ? '✅' : saveStatus === 'saving' ? '⏳' : '💾' }}</span>
                  <span class="btn-text">{{ saveStatus === 'saved' ? '已保存' : saveStatus === 'saving' ? '保存中' : '保存' }}</span>
                </button>
                <button class="notepad-editor-btn notepad-close-editor-btn" @click="closeEditor" title="关闭">
                  <span class="btn-icon">🗑️</span><span class="btn-text">关闭</span>
                </button>
              </div>
            </div>
            <div class="notepad-editor-body">
              <div v-if="isLoadingContent" class="notepad-loading">加载中...</div>
              <div ref="vditorContainer" class="vditor-container" :class="{ hidden: isLoadingContent }" />
            </div>
          </div>
        </template>
        <template v-else>
          <div class="notepad-editor-empty">
            <div class="notepad-editor-empty-icon">📝</div>
            <span>从左侧选择一个笔记</span>
            <span style="font-size: 12px; opacity: 0.6">或点击 + 新建</span>
          </div>
        </template>
      </div>

      <div v-if="isShowMdRef" class="notepad-mdref-panel">
        <div class="notepad-mdref-header">
          <span class="notepad-mdref-title">📘 Markdown 语法参考</span>
          <button class="notepad-mdref-close" @click="isShowMdRef = false">✕</button>
        </div>
        <div class="notepad-mdref-body">
          <div v-for="(item, idx) in markdownRefItems" :key="idx" class="notepad-mdref-item">
            <div class="notepad-mdref-item-title">{{ item.title }}</div>
            <div class="notepad-mdref-item-demo">{{ item.demo }}</div>
            <div class="notepad-mdref-item-note">{{ item.note }}</div>
          </div>
        </div>
      </div>
    </div>

    <button v-if="selectedNoteId" class="notepad-ai-fab" @click="openAIChatWindow" title="AI 总结">
      <img src="/menu/ai.png" alt="AI" />
    </button>
  </div>
</template>

<style scoped>
.notepad-container { width: 100%; height: 100vh; display: flex; flex-direction: column; background: rgba(255,255,255,0.92); backdrop-filter: blur(20px); overflow: hidden; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif; }
.notepad-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: rgba(255,255,255,0.95); border-bottom: 1px solid rgba(0,0,0,0.06); cursor: move; flex-shrink: 0; }
.notepad-header-title { font-size: 15px; font-weight: 600; color: #1a1a1a; }
.notepad-header-actions { display: flex; gap: 8px; }
.notepad-header-btn { padding: 4px 10px; border: none; border-radius: 6px; background: rgba(0,0,0,0.04); color: #666; font-size: 12px; cursor: pointer; }
.notepad-header-btn:hover { background: rgba(0,0,0,0.08); }
.notepad-main { flex: 1; display: flex; overflow: hidden; position: relative; }
.notepad-sidebar { width: 220px; min-width: 200px; border-right: 1px solid rgba(0,0,0,0.06); display: flex; flex-direction: column; background: rgba(247,250,252,0.5); }
.notepad-sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,0.04); }
.notepad-sidebar-title { font-size: 13px; font-weight: 600; color: #333; }
.notepad-sidebar-add-btn { width: 24px; height: 24px; border: none; border-radius: 6px; background: rgba(99,102,241,0.1); color: #6366f1; cursor: pointer; font-size: 16px; line-height: 1; display: flex; align-items: center; justify-content: center; }
.notepad-sidebar-add-btn:hover { background: rgba(99,102,241,0.2); }
.notepad-tree { flex: 1; overflow-y: auto; padding: 4px 0; }
.notepad-tree-empty { text-align: center; padding: 40px 16px; color: #999; font-size: 13px; }
.notepad-tree-node { }
.notepad-tree-folder { display: flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; color: #555; white-space: nowrap; position: relative; }
.notepad-tree-folder:hover { background: rgba(0,0,0,0.03); }
.notepad-tree-arrow { flex: none; width: 14px; font-size: 9px; color: #999; }
.notepad-tree-folder-icon { flex: none; margin-right: 2px; font-size: 12px; }
.notepad-tree-file { display: flex; align-items: center; gap: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; color: #555; white-space: nowrap; position: relative; }
.notepad-tree-file:hover { background: rgba(0,0,0,0.03); }
.notepad-tree-file.selected { background: rgba(99,102,241,0.1); color: #6366f1; font-weight: 600; }
.notepad-tree-file-icon { flex: none; font-size: 12px; }
.notepad-tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.notepad-tree-add { position: absolute; right: 24px; width: 18px; height: 18px; border: none; border-radius: 3px; background: transparent; color: #999; cursor: pointer; font-size: 12px; line-height: 1; display: none; align-items: center; justify-content: center; padding: 0; }
.notepad-tree-folder:hover .notepad-tree-add { display: flex; }
.notepad-tree-add:hover { background: rgba(99,102,241,0.1); color: #6366f1; }
.notepad-tree-delete { position: absolute; right: 4px; width: 18px; height: 18px; border: none; border-radius: 3px; background: transparent; color: #ccc; cursor: pointer; font-size: 10px; line-height: 1; display: none; align-items: center; justify-content: center; padding: 0; }
.notepad-tree-folder:hover .notepad-tree-delete { display: flex; }
.notepad-tree-file:hover .notepad-tree-delete { display: flex; }
.notepad-tree-delete:hover { background: rgba(239,68,68,0.1); color: #ef4444; }
.notepad-editor-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.notepad-editor-area.with-mdref-panel { margin-right: 260px; }
.notepad-editor-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.notepad-editor-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; border-bottom: 1px solid rgba(0,0,0,0.04); flex-shrink: 0; }
.notepad-editor-file-info { display: flex; align-items: center; gap: 6px; }
.notepad-editor-file-icon { font-size: 14px; }
.notepad-editor-filename { font-size: 13px; font-weight: 600; color: #333; }
.notepad-editor-actions { display: flex; gap: 6px; }
.notepad-editor-btn { display: flex; align-items: center; gap: 4px; padding: 5px 10px; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.15s; font-family: inherit; }
.notepad-save-btn { background: rgba(99,102,241,0.1); color: #6366f1; }
.notepad-save-btn:hover { background: rgba(99,102,241,0.2); }
.notepad-save-btn.saved { background: rgba(72,187,120,0.15); color: #38a169; }
.notepad-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.notepad-close-editor-btn { background: transparent; color: #999; }
.notepad-close-editor-btn:hover { background: rgba(239,68,68,0.08); color: #ef4444; }
.notepad-mdref-btn { display: flex; align-items: center; gap: 4px; padding: 5px 10px; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; background: transparent; color: #666; font-family: inherit; }
.notepad-mdref-btn:hover { background: rgba(0,0,0,0.04); }
.notepad-mdref-btn.active { background: rgba(99,102,241,0.1); color: #6366f1; }
.notepad-editor-body { flex: 1; position: relative; overflow: hidden; }
.vditor-container { width: 100%; height: 100%; }
.vditor-container.hidden { display: none; }
.vditor-container :deep(.vditor) { border: none; border-radius: 0; }
.notepad-loading { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; font-size: 14px; }
.notepad-editor-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #bbb; gap: 8px; }
.notepad-editor-empty-icon { font-size: 48px; opacity: 0.4; }
.notepad-mdref-panel { position: absolute; top: 0; right: 0; width: 260px; height: 100%; background: rgba(255,255,255,0.98); border-left: 1px solid rgba(0,0,0,0.06); display: flex; flex-direction: column; z-index: 10; }
.notepad-mdref-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,0.06); flex-shrink: 0; }
.notepad-mdref-title { font-size: 12px; font-weight: 600; color: #333; }
.notepad-mdref-close { width: 22px; height: 22px; border: none; border-radius: 4px; background: transparent; color: #999; cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; }
.notepad-mdref-close:hover { background: rgba(0,0,0,0.05); }
.notepad-mdref-body { flex: 1; overflow-y: auto; padding: 8px; }
.notepad-mdref-item { padding: 8px; margin-bottom: 4px; border-radius: 6px; background: rgba(0,0,0,0.02); }
.notepad-mdref-item-title { font-size: 11px; font-weight: 600; color: #333; margin-bottom: 4px; }
.notepad-mdref-item-demo { font-size: 11px; color: #666; font-family: 'Consolas','Monaco',monospace; white-space: pre-wrap; line-height: 1.5; }
.notepad-mdref-item-note { font-size: 10px; color: #999; font-style: italic; margin-top: 2px; }
.notepad-ai-fab { position: fixed; bottom: 20px; right: 20px; width: 44px; height: 44px; border: none; border-radius: 50%; background: linear-gradient(135deg,#667eea,#764ba2); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(102,126,234,0.4); z-index: 20; transition: all 0.2s; }
.notepad-ai-fab:hover { transform: scale(1.1); box-shadow: 0 6px 20px rgba(102,126,234,0.5); }
.notepad-ai-fab img { width: 22px; height: 22px; }
</style>
