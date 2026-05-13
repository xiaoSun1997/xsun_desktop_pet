<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { confirm } from "@tauri-apps/plugin-dialog";
import { marked } from "marked";

interface Message { role: 'user' | 'assistant'; content: string; timestamp: number; isStreaming?: boolean; }
interface ChatMessage { role: string; content: string; }
interface DeepSeekConfig { apiKey: string; baseUrl: string; model: string; }
interface Session { id: string; title: string; created_at: number; updated_at: number; is_pinned: boolean; }
interface MessageRecord { id: number; session_id: string; role: string; content: string; timestamp: number; }
interface TreeNode { name: string; path: string; is_dir: boolean; children?: TreeNode[]; }

const messages = ref<Message[]>([]);
const inputValue = ref("");
const isLoading = ref(false);
const configError = ref<string | null>(null);
const showSettings = ref(false);
const config = ref<DeepSeekConfig>({ apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' });
const tempConfig = ref<DeepSeekConfig>({ apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' });
const sessions = ref<Session[]>([]);
const currentSessionId = ref<string | null>(null);
const isFullscreen = ref(false);
const editingSessionId = ref<string | null>(null);
const editingSessionTitle = ref('');
const activeTab = ref<'history' | 'skill' | 'flowchart'>('history');

const skillFileTree = ref<TreeNode[]>([]);
const skillsDir = ref('');
const selectedFilePath = ref<string | null>(null);
const selectedFileName = ref('');
const editorContent = ref('');
const editorMode = ref<0 | 1 | 2>(1);
const isFileLoading = ref(false);
const expandedFolders = ref<Set<string>>(new Set());
const isShowMdRef = ref(false);
const addMenuPos = ref<{ x: number; y: number; folderPath: string } | null>(null);

let streamingContent = '';
let unlisteners: UnlistenFn[] = [];
let notepadUnlisten: UnlistenFn | null = null;
let isProcessingSummary = false;
let lastSummaryRequest: { content: string; title: string; time: number } | null = null;

const markdownRefItems = [
  { title: '标题 (Headings)', demo: '# 一级标题 | ## 二级标题 | ### 三级标题', note: '使用 # 号数量控制级别，最多 ######' },
  { title: '粗体 & 斜体', demo: '**粗体** | *斜体* | ***粗斜体***', note: '使用 * 或 _ 包裹文字' },
  { title: '链接', demo: '[显示文字](https://链接)', note: '方括号放文字，圆括号放 URL' },
  { title: '图片', demo: '![替代文字](图片URL)', note: '前面加 ! 号表示图片' },
  { title: '无序列表', demo: '- 项目一 | * 项目二 |   - 嵌套项目', note: '使用 -、* 或 +' },
  { title: '有序列表', demo: '1. 第一项 | 2. 第二项 |    1. 子项', note: '数字加点号，自动排序' },
  { title: '代码', demo: '`行内代码` | ```语言 代码块 ```', note: '三个反引号包裹多行代码块' },
  { title: '表格', demo: '| 列1 | 列2 | | --- | --- | | A | B |', note: '对齐：:---（左）:---:（中）---:（右）' },
  { title: '引用', demo: '> 引用 | >> 嵌套引用', note: '使用 > 符号' },
  { title: '分割线', demo: '--- | *** | ___', note: '三个或更多星号/短横线/下划线' },
];

const scrollToBottom = () => {
  nextTick(() => {
    const el = document.querySelector('.messages-container');
    if (el) el.scrollTop = el.scrollHeight;
  });
};

watch(messages, scrollToBottom, { deep: true });

const checkConfig = async () => {
  try {
    const loadedConfig = await invoke<DeepSeekConfig | null>('load_local_deepseek_config');
    if (loadedConfig) { config.value = loadedConfig; tempConfig.value = { ...loadedConfig }; }
    await invoke('load_deepseek_config');
    configError.value = null;
  } catch (error) { configError.value = error as string; }
};

const loadSessions = async () => {
  try { sessions.value = await invoke<Session[]>('get_chat_sessions'); }
  catch (error) { console.error('加载会话列表失败:', error); }
};

const handleNewSession = async () => {
  try {
    const session = await invoke<Session>('create_chat_session');
    sessions.value = [session, ...sessions.value];
    currentSessionId.value = session.id;
    messages.value = [{ role: 'assistant', content: '你好！我是你的AI助手，有什么可以帮助你的吗？', timestamp: Date.now() }];
  } catch (error) { console.error('创建会话失败:', error); }
};

const handleLoadSession = async (sessionId: string) => {
  try {
    const records = await invoke<MessageRecord[]>('get_chat_session_messages', { sessionId });
    const msgs: Message[] = records.map(r => ({ role: r.role as 'user' | 'assistant', content: r.content, timestamp: r.timestamp * 1000 }));
    messages.value = msgs.length > 0 ? msgs : [{ role: 'assistant', content: '你好！我是你的AI助手，有什么可以帮助你的吗？', timestamp: Date.now() }];
    currentSessionId.value = sessionId;
  } catch (error) { console.error('加载会话消息失败:', error); }
};

const handleDeleteSession = async (e: MouseEvent, sessionId: string) => {
  e.stopPropagation();
  try {
    await invoke('delete_chat_session', { sessionId });
    sessions.value = sessions.value.filter((s: Session) => s.id !== sessionId);
    if (currentSessionId.value === sessionId) {
      currentSessionId.value = null;
      messages.value = [{ role: 'assistant', content: '你好！我是你的AI助手，有什么可以帮助你的吗？', timestamp: Date.now() }];
    }
  } catch (error) { console.error('删除会话失败:', error); }
};

const setupStreamListeners = async (
  onToken: (token: string) => void,
  onDone: (content: string) => void,
  onError: (error: string) => void
) => {
  unlisteners.forEach(fn => fn()); unlisteners = [];
  const t = await listen<{ token: string }>("chat://stream-token", (e) => onToken(e.payload.token));
  const d = await listen<{ content: string }>("chat://stream-done", (e) => onDone(e.payload.content));
  const err = await listen<{ error: string }>("chat://stream-error", (e) => onError(e.payload.error));
  unlisteners = [t, d, err];
};

const handleSendMessage = async () => {
  if (!inputValue.value.trim() || isLoading.value) return;
  let sessionId = currentSessionId.value;
  if (!sessionId) {
    try {
      const session = await invoke<Session>('create_chat_session');
      sessions.value = [session, ...sessions.value];
      sessionId = session.id;
      currentSessionId.value = session.id;
    } catch (error) { console.error('创建会话失败:', error); return; }
  }

  const userMsg: Message = { role: 'user', content: inputValue.value.trim(), timestamp: Date.now() };
  const assistantMsg: Message = { role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true };
  messages.value = [...messages.value, userMsg, assistantMsg];
  inputValue.value = "";
  isLoading.value = true;
  streamingContent = "";

  try {
    const chatMessages: ChatMessage[] = [...messages.value.map((m: Message) => ({ role: m.role, content: m.content }))];
    let streamComplete = false;

    const tokenHandler = (token: string) => {
      streamingContent += token;
      const msgs = [...messages.value];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        msgs[msgs.length - 1] = { ...last, content: streamingContent };
        messages.value = msgs;
      }
    };
    const doneHandler = () => {
      streamComplete = true;
      const msgs = [...messages.value];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        msgs[msgs.length - 1] = { ...last, isStreaming: false, timestamp: Date.now() };
        messages.value = msgs;
      }
      isLoading.value = false;
      loadSessions();
    };
    const errorHandler = (error: string) => {
      if (!streamComplete) {
        const msgs = [...messages.value];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant' && last.isStreaming) {
          msgs[msgs.length - 1] = { role: 'assistant', content: `抱歉，发生了错误：${error}`, timestamp: Date.now(), isStreaming: false };
          messages.value = msgs;
        }
      }
      isLoading.value = false;
    };

    await setupStreamListeners(tokenHandler, doneHandler, errorHandler);
    await invoke('stream_chat_message', { messages: chatMessages, sessionId });
  } catch (error) {
    console.error('发送消息失败:', error);
    isLoading.value = false;
    if (streamingContent) {
      const msgs = [...messages.value];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) { msgs[msgs.length - 1] = { ...last, isStreaming: false }; messages.value = msgs; }
    } else {
      messages.value = [...messages.value.filter((m: Message) => !m.isStreaming), { role: 'assistant', content: `抱歉，发生了错误：${error}`, timestamp: Date.now() }];
    }
  }
};

const sendSummaryRequest = async (content: string, title: string) => {
  if (isProcessingSummary) return;
  const now = Date.now();
  if (lastSummaryRequest && lastSummaryRequest.content === content && lastSummaryRequest.title === title && (now - lastSummaryRequest.time) < 5000) return;
  lastSummaryRequest = { content, title, time: now };
  isProcessingSummary = true;
  try {
    const session = await invoke<Session>('create_chat_session');
    await invoke('update_chat_session_title', { sessionId: session.id, title: `${title} 总结` });
    sessions.value = [session, ...sessions.value];
    currentSessionId.value = session.id;
    messages.value = [
      { role: 'user', content: `${content}\n\n帮我总结一下上述内容`, timestamp: Date.now() },
      { role: 'assistant', content: '', timestamp: Date.now(), isStreaming: true },
    ];
    streamingContent = '';
    isLoading.value = true;
    let streamComplete = false;
    const tokenHandler = (token: string) => { streamingContent += token; const msgs = [...messages.value]; const last = msgs[msgs.length - 1]; if (last && last.role === 'assistant' && last.isStreaming) { msgs[msgs.length - 1] = { ...last, content: streamingContent }; messages.value = msgs; } };
    const doneHandler = () => { streamComplete = true; const msgs = [...messages.value]; const last = msgs[msgs.length - 1]; if (last && last.role === 'assistant' && last.isStreaming) { msgs[msgs.length - 1] = { ...last, isStreaming: false, timestamp: Date.now() }; messages.value = msgs; } isLoading.value = false; loadSessions(); };
    const errorHandler = (error: string) => { if (!streamComplete) { const msgs = [...messages.value]; const last = msgs[msgs.length - 1]; if (last && last.role === 'assistant' && last.isStreaming) { msgs[msgs.length - 1] = { role: 'assistant', content: `抱歉，发生了错误：${error}`, timestamp: Date.now(), isStreaming: false }; messages.value = msgs; } } isLoading.value = false; };
    await setupStreamListeners(tokenHandler, doneHandler, errorHandler);
    await invoke('stream_chat_message', { messages: [{ role: 'user', content }], sessionId: session.id });
  } catch (error) { console.error('处理记事本总结请求失败:', error); isLoading.value = false; }
  finally { isProcessingSummary = false; }
};

const handleKeyPress = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
};

const handleClose = async () => { try { await getCurrentWindow().close(); } catch (error) { console.error('关闭窗口失败:', error); } };

const handleToggleFullscreen = async () => {
  try { const w = getCurrentWindow(); const fs = await w.isFullscreen(); await w.setFullscreen(!fs); isFullscreen.value = !fs; }
  catch (error) { console.error('切换全屏失败:', error); }
};

const handleTogglePin = async (e: MouseEvent, sessionId: string) => {
  e.stopPropagation();
  try {
    const newState = await invoke<boolean>('toggle_chat_session_pin', { sessionId });
    sessions.value = sessions.value.map((s: Session) => s.id === sessionId ? { ...s, is_pinned: newState } : s)
      .sort((a: Session, b: Session) => { if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1; return b.updated_at - a.updated_at; });
  } catch (error) { console.error('切换置顶失败:', error); }
};

const handleRenameSession = async (sessionId: string) => {
  const newTitle = editingSessionTitle.value.trim();
  if (!newTitle) { editingSessionId.value = null; return; }
  try {
    await invoke('update_chat_session_title', { sessionId, title: newTitle });
    sessions.value = sessions.value.map((s: Session) => s.id === sessionId ? { ...s, title: newTitle } : s);
    editingSessionId.value = null;
  } catch (error) { console.error('重命名失败:', error); editingSessionId.value = null; }
};

const loadSkillTree = async () => {
  try { skillsDir.value = await invoke<string>('get_skills_dir'); skillFileTree.value = await invoke<TreeNode[]>('list_skills_directory'); }
  catch (error) { console.error('加载skills目录失败:', error); }
};

const toggleFolder = (path: string) => {
  const next = new Set(expandedFolders.value);
  if (next.has(path)) next.delete(path); else next.add(path);
  expandedFolders.value = next;
};

const handleSkillFileClick = async (file: TreeNode) => {
  if (file.is_dir) { toggleFolder(file.path); return; }
  try {
    isFileLoading.value = true;
    selectedFileName.value = file.name;
    const fullPath = `${skillsDir.value}\\${file.path}`;
    editorContent.value = await invoke<string>('read_text_file', { path: fullPath });
    selectedFilePath.value = file.path;
  } catch (error) { console.error('读取文件失败:', error); editorContent.value = `// 读取文件失败: ${error}`; }
  finally { isFileLoading.value = false; }
};

const handleSaveSkillFile = async () => {
  if (!selectedFilePath.value) return;
  try {
    const fullPath = `${skillsDir.value}\\${selectedFilePath.value}`;
    await invoke('write_text_file', { path: fullPath, content: editorContent.value });
    skillFileTree.value = await invoke<TreeNode[]>('list_skills_directory');
    alert('保存成功');
  } catch (error) { console.error('保存文件失败:', error); alert(`保存失败: ${error}`); }
};

const handleUploadFile = async () => {
  try {
    const selected = await open({ multiple: true, title: '选择要上传的文件或文件夹' });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const srcPath of paths) await invoke('copy_to_skills', { sourcePath: srcPath });
    skillFileTree.value = await invoke<TreeNode[]>('list_skills_directory');
  } catch (error) { console.error('上传文件失败:', error); alert(`上传失败: ${error}`); }
};

const handleUploadFolder = async () => {
  try {
    const selected = await open({ directory: true, title: '选择要上传的文件夹' });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const srcPath of paths) await invoke('copy_to_skills', { sourcePath: srcPath });
    skillFileTree.value = await invoke<TreeNode[]>('list_skills_directory');
  } catch (error) { console.error('上传文件夹失败:', error); alert(`上传失败: ${error}`); }
};

const handleDeleteSkillItem = async (filePath: string, isDir: boolean) => {
  const msg = isDir ? `确定要删除文件夹 "${filePath}" 及其所有内容吗？` : `确定要删除文件 "${filePath}" 吗？`;
  const confirmed = await confirm(msg, { title: "确认删除", kind: "warning" });
  if (!confirmed) return;
  try {
    await invoke('delete_skill_item', { filePath, isDir });
    skillFileTree.value = await invoke<TreeNode[]>('list_skills_directory');
    if (selectedFilePath.value === filePath) { selectedFilePath.value = null; selectedFileName.value = ''; editorContent.value = ''; }
  } catch (error) { console.error('删除失败:', error); alert(`删除失败: ${error}`); }
};

const handleToggleEditorMode = () => { editorMode.value = ((editorMode.value + 1) % 3) as 0 | 1 | 2; };

const renderMarkdown = (content: string): string => {
  if (!content) return '';
  try { return marked.parse(content, { breaks: true }) as string; }
  catch { return content; }
};

const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

const formatSessionTime = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 86400000) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
  return date.toLocaleDateString('zh-CN');
};

const handleSettingsClose = () => { tempConfig.value = { ...config.value }; showSettings.value = false; };

const saveConfig = async () => {
  try {
    await invoke('save_deepseek_config', { config: tempConfig.value });
    config.value = { ...tempConfig.value };
    showSettings.value = false;
    configError.value = null;
    await checkConfig();
  } catch (error) { console.error('保存配置失败:', error); alert(`保存配置失败: ${error}`); }
};

const getEditorMode = (filename: string): 'markdown' | 'python' | 'plain' => {
  if (filename.endsWith('.md') || filename.endsWith('.markdown')) return 'markdown';
  if (filename.endsWith('.py') || filename.endsWith('.pyw')) return 'python';
  return 'plain';
};

const handleFolderAddClick = (folderPath: string, e: MouseEvent) => {
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  addMenuPos.value = { x: rect.left, y: rect.bottom + 4, folderPath };
};

const handleNewFolderIn = async (parentPath: string) => {
  addMenuPos.value = null;
  const name = prompt('请输入文件夹名称:');
  if (!name || !name.trim()) return;
  try {
    await invoke('create_skill_folder', { name: name.trim(), parentPath });
    skillFileTree.value = await invoke<TreeNode[]>('list_skills_directory');
  } catch (error) { console.error('创建文件夹失败:', error); alert(`创建失败: ${error}`); }
};

const handleNewFileIn = async (parentPath: string) => {
  addMenuPos.value = null;
  const name = prompt('请输入文件名 (例如: script.py 或 skill.md):');
  if (!name || !name.trim()) return;
  try {
    const relativePath = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
    await invoke('create_skill_file', { relativePath });
    skillFileTree.value = await invoke<TreeNode[]>('list_skills_directory');
    const fullPath = `${skillsDir.value}\\${relativePath}`;
    editorContent.value = await invoke<string>('read_text_file', { path: fullPath });
    selectedFilePath.value = relativePath;
    selectedFileName.value = name.trim();
  } catch (error) { console.error('创建文件失败:', error); alert(`创建失败: ${error}`); }
};

const closeSkillEditor = () => {
  selectedFilePath.value = null;
  selectedFileName.value = '';
  editorContent.value = '';
  editorMode.value = 1;
  isShowMdRef.value = false;
};

onMounted(async () => {
  await checkConfig();
  await loadSessions();

  const unlistenNotepad = await listen<{ content: string; title: string }>('notepad://ai-summarize', async (event) => {
    await sendSummaryRequest(event.payload.content, event.payload.title);
  });
  notepadUnlisten = unlistenNotepad;

  watch(activeTab, (tab: string) => {
    if (tab === 'skill') loadSkillTree();
    editorMode.value = 1;
  });

  watch(selectedFilePath, () => { editorMode.value = 1; });
});

onUnmounted(() => {
  unlisteners.forEach(fn => fn());
  if (notepadUnlisten) notepadUnlisten();
});
</script>

<template>
  <div class="ai-chat-container">
    <div v-if="configError && !config.apiKey" class="config-screen">
      <h3>需要配置</h3>
      <p>{{ configError }}</p>
      <button @click="showSettings = true">配置API Key</button>
    </div>

    <template v-else>
      <!-- Sidebar -->
      <div class="chat-sidebar">
        <div class="sidebar-content">
          <!-- History Tab -->
          <div v-if="activeTab === 'history'">
            <div class="sidebar-header">
              <h2 class="sidebar-title">对话历史</h2>
              <button class="new-chat-btn" @click="handleNewSession">+ 新建</button>
            </div>
            <div class="sidebar-list">
              <div v-if="sessions.length === 0" class="sidebar-empty">
                <p>暂无对话记录</p>
                <p class="sidebar-empty-hint">开始一段新对话吧</p>
              </div>
              <div v-for="session in sessions" :key="session.id"
                :class="['sidebar-item', { active: currentSessionId === session.id, pinned: session.is_pinned }]"
                @click="handleLoadSession(session.id)">
                <div class="sidebar-item-content">
                  <div v-if="editingSessionId === session.id">
                    <input v-model="editingSessionTitle" class="sidebar-item-rename-input"
                      @blur="handleRenameSession(session.id)" @keydown.enter="handleRenameSession(session.id)"
                      @keydown.escape="editingSessionId = null" @click.stop autofocus />
                  </div>
                  <div v-else class="sidebar-item-title"
                    @dblclick.stop="editingSessionId = session.id; editingSessionTitle = session.title"
                    title="双击重命名">
                    {{ session.title }}
                  </div>
                  <div class="sidebar-item-time">{{ formatSessionTime(session.updated_at) }}</div>
                </div>
                <div class="sidebar-item-actions">
                  <button :class="['sidebar-item-pin', { pinned: session.is_pinned }]"
                    @click="(e: MouseEvent) => handleTogglePin(e, session.id)">📌</button>
                  <button class="sidebar-item-delete" @click="(e: MouseEvent) => handleDeleteSession(e, session.id)">✕</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Skill Tab -->
          <div v-if="activeTab === 'skill'" class="skill-tree-panel">
            <div class="skill-tree-header">
              <span class="skill-tree-title">📁 Skills</span>
              <button class="skill-tree-add-root" @click="(e: MouseEvent) => handleFolderAddClick('', e)">+</button>
            </div>
            <div class="skill-tree">
              <template v-if="skillFileTree.length > 0">
                <div v-for="node in skillFileTree" :key="node.path" class="skill-tree-node">
                  <div v-if="node.is_dir">
                    <div class="skill-tree-folder" @click="toggleFolder(node.path)">
                      <span class="skill-tree-arrow">{{ expandedFolders.has(node.path) ? '▼' : '▶' }}</span>
                      <span class="skill-tree-folder-icon">{{ expandedFolders.has(node.path) ? '📂' : '📁' }}</span>
                      <span class="skill-tree-name">{{ node.name }}</span>
                      <button class="skill-tree-add" @click.stop="(e: MouseEvent) => handleFolderAddClick(node.path, e)">+</button>
                      <button class="skill-tree-delete" @click.stop="handleDeleteSkillItem(node.path, true)">🗑️</button>
                    </div>
                    <div v-if="expandedFolders.has(node.path) && node.children" class="skill-tree-children">
                      <div v-for="child in node.children" :key="child.path" class="skill-tree-node">
                        <div v-if="child.is_dir">
                          <div class="skill-tree-folder" @click="toggleFolder(child.path)">
                            <span class="skill-tree-arrow">{{ expandedFolders.has(child.path) ? '▼' : '▶' }}</span>
                            <span class="skill-tree-folder-icon">{{ expandedFolders.has(child.path) ? '📂' : '📁' }}</span>
                            <span class="skill-tree-name">{{ child.name }}</span>
                            <button class="skill-tree-add" @click.stop="(e: MouseEvent) => handleFolderAddClick(child.path, e)">+</button>
                            <button class="skill-tree-delete" @click.stop="handleDeleteSkillItem(child.path, true)">🗑️</button>
                          </div>
                          <div v-if="expandedFolders.has(child.path) && child.children" class="skill-tree-children">
                            <div v-for="grandchild in child.children" :key="grandchild.path" class="skill-tree-node">
                              <div class="skill-tree-file" @click="handleSkillFileClick(grandchild)">
                                <span class="skill-tree-file-icon">{{ grandchild.name.endsWith('.md') ? '📝' : grandchild.name.endsWith('.py') ? '🐍' : '📄' }}</span>
                                <span class="skill-tree-name">{{ grandchild.name }}</span>
                                <button class="skill-tree-delete" @click.stop="handleDeleteSkillItem(grandchild.path, false)">🗑️</button>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div v-else class="skill-tree-file" @click="handleSkillFileClick(child)">
                          <span class="skill-tree-file-icon">{{ child.name.endsWith('.md') ? '📝' : child.name.endsWith('.py') ? '🐍' : '📄' }}</span>
                          <span class="skill-tree-name">{{ child.name }}</span>
                          <button class="skill-tree-delete" @click.stop="handleDeleteSkillItem(child.path, false)">🗑️</button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div v-else class="skill-tree-file" @click="handleSkillFileClick(node)">
                    <span class="skill-tree-file-icon">{{ node.name.endsWith('.md') ? '📝' : node.name.endsWith('.py') ? '🐍' : '📄' }}</span>
                    <span class="skill-tree-name">{{ node.name }}</span>
                    <button class="skill-tree-delete" @click.stop="handleDeleteSkillItem(node.path, false)">🗑️</button>
                  </div>
                </div>
              </template>
              <div v-else class="skill-tree-empty">
                <p>暂无技能文件</p>
                <p class="skill-tree-hint">点击上传添加</p>
              </div>
            </div>
          </div>

          <!-- Flowchart Tab -->
          <div v-if="activeTab === 'flowchart'" class="sidebar-tab-placeholder">
            <div class="placeholder-icon">📊</div>
            <p>流程图绘制</p>
            <span>开发中...</span>
          </div>
        </div>

        <!-- Bottom Nav -->
        <div class="sidebar-nav">
          <button :class="['sidebar-nav-item', { active: activeTab === 'history' }]" @click="activeTab = 'history'">
            <span class="nav-icon">💬</span><span class="nav-label">对话</span>
          </button>
          <button :class="['sidebar-nav-item', { active: activeTab === 'skill' }]" @click="activeTab = 'skill'">
            <span class="nav-icon">⚙️</span><span class="nav-label">Skill</span>
          </button>
          <button :class="['sidebar-nav-item', { active: activeTab === 'flowchart' }]" @click="activeTab = 'flowchart'">
            <span class="nav-icon">📊</span><span class="nav-label">流程图</span>
          </button>
        </div>
      </div>

      <!-- Main Content -->
      <div class="chat-main">
        <!-- Chat Tab -->
        <div v-if="activeTab === 'history'" class="chat-tab">
          <div class="ai-chat-header" data-tauri-drag-region>
            <div class="header-actions">
              <button @click="showSettings = true">⚙️ 设置</button>
              <button @click="handleNewSession">💬 新对话</button>
              <button @click="handleToggleFullscreen">{{ isFullscreen ? '⤡' : '⤢' }} {{ isFullscreen ? '退出全屏' : '全屏' }}</button>
              <button @click="handleClose">✕ 关闭</button>
            </div>
          </div>

          <div class="messages-container">
            <div v-for="(message, idx) in messages" :key="idx"
              :class="['message', message.role === 'user' ? 'user-message' : 'assistant-message', { streaming: message.isStreaming }]">
              <div class="message-avatar"></div>
              <div class="message-content">
                <div class="message-text markdown-body" v-html="renderMarkdown(message.content)"></div>
                <div class="message-time">{{ formatTime(message.timestamp) }}</div>
              </div>
            </div>
            <div v-if="isLoading && !messages.some((m: Message) => m.isStreaming)" class="message assistant-message">
              <div class="message-avatar"></div>
              <div class="message-content"><div class="typing-indicator"><span></span><span></span><span></span></div></div>
            </div>
          </div>

          <div class="input-container">
            <div class="input-wrapper">
              <textarea v-model="inputValue" @keydown="handleKeyPress" placeholder="输入你的问题... (Enter发送, Shift+Enter换行)"
                class="message-input" rows="1" :disabled="isLoading"></textarea>
              <button :class="['send-button', { active: inputValue.trim() && !isLoading }]"
                @click="handleSendMessage" :disabled="!inputValue.trim() || isLoading">
                <div class="send-icon"></div>
              </button>
            </div>
          </div>
        </div>

        <!-- Skill Tab -->
        <div v-if="activeTab === 'skill'" class="skill-main">
          <div class="skill-toolbar">
            <h3 class="skill-toolbar-title">Skill 管理器</h3>
            <div class="skill-toolbar-actions">
              <button @click="handleUploadFile">📁 上传文件</button>
              <button @click="handleUploadFolder">📂 上传文件夹</button>
              <button @click="handleToggleFullscreen">{{ isFullscreen ? '⤡' : '⤢' }}</button>
              <button @click="handleClose">✕ 关闭</button>
            </div>
          </div>
          <div class="skill-editor-area">
            <div v-if="selectedFileName" class="skill-editor-container">
              <div class="skill-editor-header">
                <div class="skill-editor-file-info">
                  <span :class="'skill-editor-file-icon'">{{ getEditorMode(selectedFileName) === 'markdown' ? '📝' : getEditorMode(selectedFileName) === 'python' ? '🐍' : '📄' }}</span>
                  <span class="skill-editor-filename">{{ selectedFileName }}</span>
                  <span class="skill-editor-mode">{{ getEditorMode(selectedFileName).toUpperCase() }}</span>
                </div>
                <div class="skill-editor-actions">
                  <template v-if="getEditorMode(selectedFileName) === 'markdown'">
                    <button @click="handleToggleEditorMode" :class="'skill-editor-btn'">
                      {{ editorMode === 0 ? '全编辑' : editorMode === 1 ? '分屏' : '全预览' }}
                    </button>
                    <button :class="['skill-mdref-btn', { active: isShowMdRef }]" @click="isShowMdRef = !isShowMdRef">📘 语法</button>
                  </template>
                  <button class="skill-editor-btn skill-save-btn" @click="handleSaveSkillFile">保存</button>
                  <button class="skill-editor-btn" @click="closeSkillEditor">关闭</button>
                </div>
              </div>
              <div :class="['skill-editor-body', { 'with-mdref-panel': isShowMdRef }]">
                <div v-if="isFileLoading" class="skill-editor-loading">加载中...</div>
                <template v-else-if="getEditorMode(selectedFileName) === 'markdown'">
                  <!-- Full Preview -->
                  <div v-if="editorMode === 2" class="skill-editor-preview markdown-body" v-html="renderMarkdown(editorContent)"></div>
                  <!-- Split -->
                  <div v-else-if="editorMode === 1" class="skill-editor-split">
                    <div class="skill-editor-split-edit">
                      <textarea v-model="editorContent" class="skill-editor-textarea" spellcheck="false" placeholder="开始编写 Markdown 内容..."></textarea>
                    </div>
                    <div class="skill-editor-split-preview markdown-body" v-html="renderMarkdown(editorContent)"></div>
                  </div>
                  <!-- Full Edit -->
                  <textarea v-else v-model="editorContent" class="skill-editor-textarea" spellcheck="false" placeholder="开始编写 Markdown 内容..."></textarea>
                  <!-- Markdown Reference -->
                  <div v-if="isShowMdRef" class="skill-mdref-panel">
                    <div class="skill-mdref-header">
                      <span class="skill-mdref-title">📘 Markdown 语法参考</span>
                      <button @click="isShowMdRef = false">✕</button>
                    </div>
                    <div class="skill-mdref-body">
                      <div v-for="(item, idx) in markdownRefItems" :key="idx" class="skill-mdref-item">
                        <div class="skill-mdref-item-title">{{ item.title }}</div>
                        <div class="skill-mdref-item-demo">
                          <code>{{ item.demo }}</code><br />
                          <span class="mdref-result">{{ item.note }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <textarea v-else v-model="editorContent" class="skill-editor-textarea" spellcheck="false"></textarea>
              </div>
            </div>
            <div v-else class="skill-empty-state">
              <div class="skill-empty-icon">📂</div>
              <h3>选择或上传 Skill 文件</h3>
              <p>从左侧文件树中选择一个文件进行编辑</p>
              <p class="skill-empty-hint">支持 .md (Markdown) 和 .py (Python) 文件</p>
              <button @click="handleUploadFile">📤 上传文件</button>
            </div>
          </div>
        </div>

        <!-- Flowchart Tab -->
        <div v-if="activeTab === 'flowchart'" class="flowchart-main">
          <div class="flowchart-header">
            <h3>流程图绘制</h3>
            <div class="header-actions">
              <button @click="handleToggleFullscreen">{{ isFullscreen ? '⤡' : '⤢' }}</button>
              <button @click="handleClose">✕ 关闭</button>
            </div>
          </div>
          <div class="flowchart-placeholder">
            <div class="flowchart-icon">📊</div>
            <h3>流程图绘制</h3>
            <p>功能开发中，敬请期待...</p>
          </div>
        </div>
      </div>

      <!-- Context Menu -->
      <div v-if="addMenuPos" class="context-menu-overlay" @click="addMenuPos = null"></div>
      <div v-if="addMenuPos" class="folder-context-menu" :style="{ left: addMenuPos.x + 'px', top: addMenuPos.y + 'px' }">
        <div class="context-menu-item" @click="handleNewFolderIn(addMenuPos.folderPath)"><span class="context-menu-icon">📁</span> 新建文件夹</div>
        <div class="context-menu-item" @click="handleNewFileIn(addMenuPos.folderPath)"><span class="context-menu-icon">📄</span> 新建文件</div>
      </div>

      <!-- Settings Modal -->
      <div v-if="showSettings" class="settings-overlay">
        <div class="settings-modal">
          <div class="settings-header">
            <h3>DeepSeek 配置</h3>
            <button @click="handleSettingsClose"><div class="close-icon"></div></button>
          </div>
          <div class="settings-content">
            <div class="setting-item">
              <label>API Key:</label>
              <input type="password" v-model="tempConfig.apiKey" placeholder="输入你的 DeepSeek API Key" />
            </div>
            <div class="setting-item">
              <label>Base URL:</label>
              <input type="text" v-model="tempConfig.baseUrl" placeholder="API 基础URL" />
            </div>
            <div class="setting-item">
              <label>模型:</label>
              <input type="text" v-model="tempConfig.model" placeholder="模型名称" />
            </div>
          </div>
          <div class="settings-actions">
            <button @click="handleSettingsClose">取消</button>
            <button class="save-button" @click="saveConfig">保存</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ai-chat-container { width: 100%; height: 100vh; display: flex; flex-direction: row; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; overflow: hidden; background: #f5f5f5; }
.config-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; gap: 12px; }
.config-screen button { padding: 8px 20px; background: #1677ff; color: white; border: none; border-radius: 6px; cursor: pointer; }
.chat-sidebar { width: 240px; min-width: 240px; background: white; border-right: 1px solid #e8e8e8; display: flex; flex-direction: column; }
.sidebar-content { flex: 1; overflow-y: auto; }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; }
.sidebar-title { font-size: 16px; font-weight: 600; margin: 0; }
.new-chat-btn { background: #1677ff; color: white; border: none; border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 13px; }
.sidebar-list { padding: 0 8px; }
.sidebar-item { display: flex; align-items: center; justify-content: space-between; padding: 10px; border-radius: 8px; cursor: pointer; margin-bottom: 2px; }
.sidebar-item:hover { background: #f0f0f0; }
.sidebar-item.active { background: #e6f4ff; }
.sidebar-item.pinned { border-left: 3px solid #faad14; }
.sidebar-item-content { flex: 1; min-width: 0; }
.sidebar-item-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-item-time { font-size: 11px; color: #999; margin-top: 2px; }
.sidebar-item-rename-input { width: 100%; border: 1px solid #1677ff; border-radius: 4px; padding: 2px 6px; font-size: 13px; outline: none; }
.sidebar-item-actions { display: flex; gap: 4px; opacity: 0; }
.sidebar-item:hover .sidebar-item-actions { opacity: 1; }
.sidebar-item-pin, .sidebar-item-delete { background: none; border: none; cursor: pointer; padding: 2px; font-size: 12px; }
.sidebar-item-pin.pinned { opacity: 1; }
.sidebar-empty { text-align: center; padding: 40px 16px; color: #999; }
.sidebar-empty-hint { font-size: 12px; margin-top: 4px; }
.sidebar-nav { display: flex; border-top: 1px solid #e8e8e8; }
.sidebar-nav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px; border: none; background: none; cursor: pointer; font-size: 10px; color: #666; }
.sidebar-nav-item.active { color: #1677ff; background: #e6f4ff; }
.nav-icon { font-size: 16px; }
.chat-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.chat-tab { display: flex; flex-direction: column; height: 100%; }
.ai-chat-header { padding: 10px 16px; background: white; border-bottom: 1px solid #e8e8e8; cursor: move; }
.header-actions { display: flex; gap: 8px; justify-content: flex-end; }
.header-actions button { background: #f0f0f0; border: none; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.header-actions button:hover { background: #e0e0e0; }
.messages-container { flex: 1; overflow-y: auto; padding: 16px; }
.message { display: flex; gap: 10px; margin-bottom: 16px; }
.message-avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; background: #1677ff; }
.user-message .message-avatar { background: #52c41a; }
.message-content { max-width: 80%; }
.message-text { font-size: 14px; line-height: 1.6; }
.message-text :deep(pre) { background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 8px; overflow-x: auto; }
.message-text :deep(code) { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.message-text :deep(pre code) { background: none; padding: 0; }
.message-time { font-size: 11px; color: #999; margin-top: 4px; }
.typing-indicator { display: flex; gap: 4px; padding: 8px 0; }
.typing-indicator span { width: 8px; height: 8px; background: #1677ff; border-radius: 50%; animation: blink 1.4s infinite both; }
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 80%, 100% { opacity: 0; } 40% { opacity: 1; } }
.input-container { padding: 12px 16px; background: white; border-top: 1px solid #e8e8e8; }
.input-wrapper { display: flex; gap: 8px; align-items: flex-end; }
.message-input { flex: 1; border: 1px solid #d9d9d9; border-radius: 8px; padding: 8px 12px; font-size: 14px; resize: none; outline: none; min-height: 36px; max-height: 120px; }
.message-input:focus { border-color: #1677ff; }
.send-button { width: 36px; height: 36px; border: none; border-radius: 8px; background: #d9d9d9; cursor: not-allowed; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.send-button.active { background: #1677ff; cursor: pointer; }
.send-icon { width: 16px; height: 16px; border-left: 2px solid white; border-top: 2px solid white; transform: rotate(135deg); }
.skill-tree-panel { display: flex; flex-direction: column; height: 100%; }
.skill-tree-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; }
.skill-tree-title { font-weight: 600; }
.skill-tree-add-root { background: none; border: none; cursor: pointer; font-size: 18px; }
.skill-tree { flex: 1; overflow-y: auto; padding: 0 8px; }
.skill-tree-node { margin: 2px 0; }
.skill-tree-folder, .skill-tree-file { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 13px; }
.skill-tree-folder:hover, .skill-tree-file:hover { background: #f0f0f0; }
.skill-tree-arrow { font-size: 10px; width: 12px; }
.skill-tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-tree-add, .skill-tree-delete { background: none; border: none; cursor: pointer; padding: 2px; font-size: 12px; opacity: 0; }
.skill-tree-folder:hover .skill-tree-add, .skill-tree-folder:hover .skill-tree-delete,
.skill-tree-file:hover .skill-tree-delete { opacity: 1; }
.skill-tree-children { padding-left: 20px; }
.skill-tree-empty { text-align: center; padding: 40px; color: #999; }
.skill-main { display: flex; flex-direction: column; height: 100%; }
.skill-toolbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: white; border-bottom: 1px solid #e8e8e8; }
.skill-toolbar-title { margin: 0; font-size: 15px; }
.skill-toolbar-actions { display: flex; gap: 8px; }
.skill-toolbar-actions button { background: #f0f0f0; border: none; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.skill-editor-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.skill-editor-container { display: flex; flex-direction: column; height: 100%; }
.skill-editor-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; background: #fafafa; border-bottom: 1px solid #e8e8e8; }
.skill-editor-file-info { display: flex; align-items: center; gap: 8px; }
.skill-editor-filename { font-weight: 500; }
.skill-editor-mode { font-size: 11px; color: #999; background: #f0f0f0; padding: 1px 6px; border-radius: 4px; }
.skill-editor-actions { display: flex; gap: 6px; }
.skill-editor-btn { background: #f0f0f0; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
.skill-save-btn { background: #1677ff; color: white; }
.skill-editor-body { flex: 1; display: flex; overflow: hidden; position: relative; }
.skill-editor-body.with-mdref-panel { margin-right: 300px; }
.skill-editor-textarea { flex: 1; border: none; padding: 16px; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; resize: none; outline: none; background: #1e1e1e; color: #d4d4d4; }
.skill-editor-loading { display: flex; align-items: center; justify-content: center; width: 100%; color: #999; }
.skill-editor-preview { flex: 1; padding: 16px; overflow-y: auto; }
.skill-editor-split { display: flex; flex: 1; }
.skill-editor-split-edit, .skill-editor-split-preview { flex: 1; overflow-y: auto; }
.skill-editor-split-edit { border-right: 1px solid #e8e8e8; }
.skill-editor-split-preview { padding: 16px; }
.skill-mdref-btn { background: #f0f0f0; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 12px; }
.skill-mdref-btn.active { background: #1677ff; color: white; }
.skill-mdref-panel { position: absolute; right: 0; top: 0; width: 300px; height: 100%; background: white; border-left: 1px solid #e8e8e8; display: flex; flex-direction: column; z-index: 10; }
.skill-mdref-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #e8e8e8; }
.skill-mdref-title { font-weight: 500; font-size: 13px; }
.skill-mdref-header button { background: none; border: none; cursor: pointer; }
.skill-mdref-body { flex: 1; overflow-y: auto; padding: 8px; }
.skill-mdref-item { margin-bottom: 8px; padding: 8px; background: #fafafa; border-radius: 6px; }
.skill-mdref-item-title { font-weight: 500; font-size: 12px; margin-bottom: 4px; }
.skill-mdref-item-demo { font-size: 12px; }
.skill-mdref-item-demo code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
.mdref-result { color: #999; font-size: 11px; }
.skill-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 8px; color: #999; }
.skill-empty-icon { font-size: 48px; }
.skill-empty-state button { background: #1677ff; color: white; border: none; border-radius: 6px; padding: 8px 20px; cursor: pointer; }
.context-menu-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 100; }
.folder-context-menu { position: fixed; z-index: 101; background: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 4px; }
.context-menu-item { display: flex; align-items: center; gap: 8px; padding: 8px 16px; cursor: pointer; font-size: 13px; border-radius: 4px; }
.context-menu-item:hover { background: #f0f0f0; }
.settings-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 200; }
.settings-modal { background: white; border-radius: 12px; width: 400px; max-width: 90%; }
.settings-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #e8e8e8; }
.settings-header h3 { margin: 0; }
.settings-header button { background: none; border: none; cursor: pointer; }
.close-icon { width: 14px; height: 14px; position: relative; }
.close-icon::before, .close-icon::after { content: ''; position: absolute; top: 50%; left: 50%; width: 14px; height: 2px; background: #333; }
.close-icon::before { transform: translate(-50%,-50%) rotate(45deg); }
.close-icon::after { transform: translate(-50%,-50%) rotate(-45deg); }
.settings-content { padding: 16px 20px; }
.setting-item { margin-bottom: 12px; }
.setting-item label { display: block; font-size: 13px; margin-bottom: 4px; color: #666; }
.setting-item input { width: 100%; border: 1px solid #d9d9d9; border-radius: 6px; padding: 8px 12px; font-size: 13px; outline: none; box-sizing: border-box; }
.setting-item input:focus { border-color: #1677ff; }
.settings-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid #e8e8e8; }
.settings-actions button { padding: 6px 16px; border: none; border-radius: 6px; cursor: pointer; }
.settings-actions .save-button { background: #1677ff; color: white; }
.flowchart-main { display: flex; flex-direction: column; height: 100%; }
.flowchart-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; background: white; border-bottom: 1px solid #e8e8e8; }
.flowchart-header h3 { margin: 0; }
.flowchart-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: #999; gap: 8px; }
.flowchart-icon { font-size: 48px; }
.sidebar-tab-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #999; gap: 4px; }
.placeholder-icon { font-size: 48px; }
</style>
