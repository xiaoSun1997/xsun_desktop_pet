<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { Codemirror } from "vue-codemirror";
import { json } from "@codemirror/lang-json";
import { EditorView, lineNumbers, highlightActiveLine, keymap, Decoration } from "@codemirror/view";
import { bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { search, openSearchPanel, searchKeymap } from "@codemirror/search";
import { StateEffect, StateField } from "@codemirror/state";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface DiffEntry {
  path: string;
  status: "unchanged" | "added" | "removed" | "changed";
  leftValue?: string;
  rightValue?: string;
}

const text = ref("");
const isValidJson = ref(false);
const lineCount = ref(0);
const charCount = ref(0);
const errorLines = ref<number[]>([]);
const formattedInfo = ref("");
const compareMode = ref(false);
const leftText = ref("");
const rightText = ref("");
const diffResult = ref<DiffEntry[] | null>(null);
const diffSummary = ref("");
const isFullscreen = ref(false);

let cmView: EditorView | null = null;

const setErrorLinesEffect = StateEffect.define<number[]>();
const errorLineField = StateField.define({
  create() { return Decoration.none; },
  update(decos: any, tr: any) {
    for (const e of tr.effects) {
      if (e.is(setErrorLinesEffect)) {
        const lines = e.value;
        if (lines.length === 0) return Decoration.none;
        const builder: any[] = [];
        for (const ln of lines) {
          const lineNum1 = Math.min(ln + 1, tr.state.doc.lines);
          const line = tr.state.doc.line(lineNum1);
          builder.push(Decoration.line({ class: "cm-error-line" }).range(line.from));
        }
        return Decoration.set(builder);
      }
    }
    return decos;
  },
  provide: (f: any) => EditorView.decorations.from(f),
});

const highlightTheme = HighlightStyle.define([
  { tag: tags.propertyName, color: "#881391", fontWeight: "bold" },
  { tag: tags.string, color: "#0B7500" },
  { tag: tags.number, color: "#1A1AA6", fontWeight: "500" },
  { tag: tags.bool, color: "#BF3A38", fontWeight: "600" },
  { tag: tags.null, color: "#808080", fontStyle: "italic" },
  { tag: tags.separator, color: "#718096" },
  { tag: tags.bracket, fontWeight: "bold" },
]);

const editorExtensions = computed(() => [
  json(),
  syntaxHighlighting(highlightTheme),
  foldGutter(),
  bracketMatching(),
  lineNumbers(),
  highlightActiveLine(),
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
  search({ top: true }),
  EditorView.lineWrapping,
  errorLineField,
]);

const compareExtensions = computed(() => [
  json(),
  syntaxHighlighting(highlightTheme),
  foldGutter(),
  bracketMatching(),
  lineNumbers(),
  highlightActiveLine(),
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
  EditorView.lineWrapping,
]);

const rulerMarks = computed(() => {
  const total = lineCount.value || 1;
  return errorLines.value.map((ln: number) => ({ percent: (ln / total) * 100 }));
});

onMounted(async () => {
  const globalText = (window as any).__JSON_TEXT__;
  if (globalText) {
    text.value = globalText;
    delete (window as any).__JSON_TEXT__;
  }
  const unlisten = await listen<string>("json://fill-text", (event) => {
    text.value = event.payload;
  });
  onUnmounted(() => unlisten());
  window.addEventListener("keydown", onKeyEscape);
  onUnmounted(() => window.removeEventListener("keydown", onKeyEscape));
});

const onKeyEscape = (e: KeyboardEvent) => {
  if (e.key === "Escape" && cmView) cmView.focus();
};

const onCmReady = ({ view }: { view: EditorView }) => { cmView = view; };

const onTextChange = (val: string) => {
  text.value = val;
  formattedInfo.value = "";
  lineCount.value = val.length > 0 ? val.split("\n").length : 0;
  charCount.value = val.length;
  try {
    if (val.trim()) { JSON.parse(val); isValidJson.value = true; }
    else { isValidJson.value = false; }
  } catch { isValidJson.value = false; }
  syncErrorLines();
};

const syncErrorLines = () => {
  if (cmView) {
    cmView.dispatch({ effects: setErrorLinesEffect.of(errorLines.value) });
  }
};

const sortJsonKeys = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(sortJsonKeys);
  if (obj !== null && typeof obj === "object")
    return Object.keys(obj).sort().reduce((acc: any, key: string) => { acc[key] = sortJsonKeys(obj[key]); return acc; }, {} as any);
  return obj;
};

const diffJson = (left: any, right: any, path = ""): DiffEntry[] => {
  const res: DiffEntry[] = [];
  if (typeof left !== typeof right) {
    res.push({ path: path || "(根)", status: "changed", leftValue: JSON.stringify(left), rightValue: JSON.stringify(right) });
    return res;
  }
  if (left === null || right === null) {
    res.push({ path: path || "(根)", status: left !== right ? "changed" : "unchanged", leftValue: left !== right ? String(left) : undefined, rightValue: left !== right ? String(right) : undefined });
    return res;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const maxLen = Math.max(left.length, right.length);
    for (let i = 0; i < maxLen; i++) {
      const ip = path ? `${path}[${i}]` : `[${i}]`;
      if (i >= left.length) res.push({ path: ip, status: "added", rightValue: JSON.stringify(right[i]) });
      else if (i >= right.length) res.push({ path: ip, status: "removed", leftValue: JSON.stringify(left[i]) });
      else res.push(...diffJson(left[i], right[i], ip));
    }
    return res;
  }
  if (typeof left === "object" && typeof right === "object") {
    const allKeys = [...new Set([...Object.keys(left).sort(), ...Object.keys(right).sort()])].sort();
    for (const key of allKeys) {
      const kp = path ? `${path}.${key}` : key;
      const lh = key in left, rh = key in right;
      if (!lh && rh) res.push({ path: kp, status: "added", rightValue: JSON.stringify(right[key], null, 2) });
      else if (lh && !rh) res.push({ path: kp, status: "removed", leftValue: JSON.stringify(left[key], null, 2) });
      else res.push(...diffJson(left[key], right[key], kp));
    }
    return res;
  }
  res.push({ path: path || "(根)", status: left !== right ? "changed" : "unchanged", leftValue: left !== right ? JSON.stringify(left) : undefined, rightValue: left !== right ? JSON.stringify(right) : undefined });
  return res;
};

const handleClose = async () => { try { await getCurrentWindow().close(); } catch { /* */ } };

const handleToggleFullscreen = async () => {
  try { const w = getCurrentWindow(); const fs = await w.isFullscreen(); await w.setFullscreen(!fs); isFullscreen.value = !fs; }
  catch { /* */ }
};

const handleFormat = () => {
  if (!text.value.trim()) return;
  errorLines.value = []; formattedInfo.value = "";
  try {
    const parsed = JSON.parse(text.value);
    text.value = JSON.stringify(parsed, null, 2).replace(/\n{3,}/g, "\n\n");
  } catch (e) { tryPartialFormat(e as Error); }
};

const tryPartialFormat = (_err: Error) => {
  const lines = text.value.split("\n");
  let accumulated = "", lastValid = "", firstErrorIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const test = accumulated + (accumulated ? "\n" : "") + lines[i];
    try { JSON.parse(test); accumulated = test; lastValid = test; }
    catch { firstErrorIdx = i; break; }
  }
  if (firstErrorIdx === -1) return;
  let formattedValid = "", fLineCount = 0;
  if (lastValid) {
    try { const p = JSON.parse(lastValid); formattedValid = JSON.stringify(p, null, 2); fLineCount = formattedValid.split("\n").length; }
    catch { formattedValid = lastValid; fLineCount = formattedValid.split("\n").length; }
  }
  const result: string[] = formattedValid ? formattedValid.split("\n") : [];
  const errLines: number[] = [];
  const remaining = lines.slice(firstErrorIdx);
  for (let i = 0; i < remaining.length; i++) { result.push(remaining[i]); errLines.push(fLineCount + i); }
  text.value = result.join("\n");
  errorLines.value = errLines;
  formattedInfo.value = `⚠️ 已部分格式化，第 ${firstErrorIdx + 1} 行存在语法错误（共 ${errLines.length} 行标记红色）`;
};

const handleCompact = () => {
  if (!text.value.trim()) return;
  errorLines.value = []; formattedInfo.value = "";
  try { const p = JSON.parse(text.value); text.value = JSON.stringify(p); }
  catch { alert("JSON 格式错误，无法压缩"); }
};

const handleClear = () => {
  if (!text.value) return;
  if (confirm("确定要清空所有内容吗？")) { text.value = ""; errorLines.value = []; formattedInfo.value = ""; }
};

const handleCopy = async () => {
  if (!text.value) return;
  try { await invoke("copy_to_clipboard", { content: text.value }); alert("已复制到剪贴板"); }
  catch { /* */ }
};

const handleSearchToggle = () => { if (cmView) openSearchPanel(cmView); };
const handleReplaceToggle = () => { if (cmView) openSearchPanel(cmView); };

const handleEnterCompare = () => {
  leftText.value = text.value; rightText.value = text.value;
  diffResult.value = null; diffSummary.value = ""; compareMode.value = true;
};

const handleExitCompare = () => {
  text.value = leftText.value; compareMode.value = false;
  diffResult.value = null; diffSummary.value = "";
};

const handleRunCompare = () => {
  try {
    const lp = sortJsonKeys(JSON.parse(leftText.value));
    const rp = sortJsonKeys(JSON.parse(rightText.value));
    const fl = JSON.stringify(lp, null, 2);
    const fr = JSON.stringify(rp, null, 2);
    leftText.value = fl; rightText.value = fr;
    const diffs = diffJson(lp, rp);
    diffResult.value = diffs;
    const u = diffs.filter((d: DiffEntry) => d.status === "unchanged").length;
    const a = diffs.filter((d: DiffEntry) => d.status === "added").length;
    const r = diffs.filter((d: DiffEntry) => d.status === "removed").length;
    const c = diffs.filter((d: DiffEntry) => d.status === "changed").length;
    diffSummary.value = `✅ 相同: ${u}  |  ➕ 右侧新增: ${a}  |  ❌ 左侧独有: ${r}  |  🔄 值不同: ${c}`;
  } catch (e: any) {
    diffSummary.value = `❌ 对比失败: ${e.message || "JSON 格式错误，请检查两侧输入"}`;
  }
};

const handleCopyLeft = () => { invoke("copy_to_clipboard", { content: leftText.value }); };
const handleCopyRight = () => { invoke("copy_to_clipboard", { content: rightText.value }); };
</script>

<template>
  <div class="json-formatter-container">
    <div class="json-formatter-header" data-tauri-drag-region>
      <div class="header-left">
        <h1 class="json-formatter-title">{{ compareMode ? 'JSON 对比工具' : 'JSON 格式化工具' }}</h1>
      </div>
      <div class="header-actions">
        <button class="fullscreen-button" @click="handleToggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏'">
          <span class="fullscreen-icon">{{ isFullscreen ? '⤡' : '⤢' }}</span>
        </button>
        <button class="close-button" @click="handleClose"><div class="close-icon"></div></button>
      </div>
    </div>

    <div class="json-toolbar">
      <template v-if="!compareMode">
        <button class="toolbar-btn" @click="handleFormat" title="格式化"><span>✨</span> 格式化</button>
        <button class="toolbar-btn" @click="handleCompact" title="压缩"><span>🗜️</span> 压缩</button>
        <button class="toolbar-btn" @click="handleClear" title="清空"><span>🗑️</span> 清空</button>
        <button class="toolbar-btn" @click="handleSearchToggle" title="查找 (Ctrl+F)"><span>🔍</span> 查找</button>
        <button class="toolbar-btn" @click="handleReplaceToggle" title="替换 (Ctrl+H)"><span>🔄</span> 替换</button>
        <button class="toolbar-btn" @click="handleCopy" title="复制全部"><span>📋</span> 复制</button>
      </template>
      <template v-else>
        <span class="compare-mode-label">🔍 对比模式</span>
        <button class="toolbar-btn compare-btn" @click="handleRunCompare" title="开始对比"><span>⚡</span> 开始对比</button>
        <button class="toolbar-btn exit-compare-btn" @click="handleExitCompare" title="退出对比"><span>🚪</span> 退出对比</button>
      </template>
      <span class="toolbar-separator"></span>
      <button :class="['toolbar-btn', { active: compareMode }]" @click="compareMode ? handleExitCompare : handleEnterCompare" :title="compareMode ? '退出对比模式' : '进入 JSON 对比模式'">
        <span>📊</span> {{ compareMode ? '退出对比' : 'JSON对比' }}
      </button>
    </div>

    <div v-if="!compareMode" class="json-editor-area">
      <div class="editor-body">
        <div class="editor-wrapper">
          <Codemirror
            :model-value="text"
            :extensions="editorExtensions"
            :style="{ height: '100%' }"
            class="json-codemirror"
            placeholder="在此粘贴或输入 JSON / 文本数据..."
            :autofocus="true"
            @ready="onCmReady"
            @update:model-value="onTextChange"
          />
        </div>
        <div class="editor-overview-ruler">
          <div v-for="(mark, idx) in rulerMarks" :key="'err-' + idx"
            class="ruler-mark error"
            :style="{ top: mark.percent + '%' }"
            title="语法错误"
          />
        </div>
      </div>
    </div>

    <div v-else class="json-compare-area">
      <div class="compare-panels">
        <div class="compare-panel">
          <div class="compare-panel-header left-header">
            <span class="panel-label">左侧 JSON</span>
            <button class="panel-copy-btn" @click="handleCopyLeft" title="复制左侧">📋</button>
          </div>
          <div class="compare-cm-wrapper">
            <Codemirror
              :model-value="leftText"
              :extensions="compareExtensions"
              :style="{ height: '100%' }"
              class="json-codemirror"
              placeholder="粘贴左侧 JSON..."
              :autofocus="false"
              @ready="onCmReady"
              @update:model-value="(val: string) => { leftText = val; diffResult = null; diffSummary = ''; }"
            />
          </div>
        </div>
        <div class="compare-divider"><div class="divider-icon">⇄</div></div>
        <div class="compare-panel">
          <div class="compare-panel-header right-header">
            <span class="panel-label">右侧 JSON</span>
            <button class="panel-copy-btn" @click="handleCopyRight" title="复制右侧">📋</button>
          </div>
          <div class="compare-cm-wrapper">
            <Codemirror
              :model-value="rightText"
              :extensions="compareExtensions"
              :style="{ height: '100%' }"
              class="json-codemirror"
              placeholder="粘贴右侧 JSON..."
              :autofocus="false"
              @ready="onCmReady"
              @update:model-value="(val: string) => { rightText = val; diffResult = null; diffSummary = ''; }"
            />
          </div>
        </div>
      </div>

      <div v-if="diffSummary" class="diff-result-panel">
        <div class="diff-summary"><span class="diff-summary-text">{{ diffSummary }}</span></div>
        <div v-if="diffResult && diffResult.length > 0" class="diff-details">
          <div class="diff-details-header">
            <span>📝 对比详情（按键名字母序排列）</span>
            <span class="diff-total">{{ diffResult.filter((d: DiffEntry) => d.status !== 'unchanged').length }} 处差异</span>
          </div>
          <div class="diff-details-body">
            <div v-for="(entry, idx) in diffResult.filter((d: DiffEntry) => d.status !== 'unchanged').sort((a: DiffEntry, b: DiffEntry) => a.path.localeCompare(b.path))" :key="idx"
              :class="['diff-row', entry.status === 'added' ? 'diff-row-added' : entry.status === 'removed' ? 'diff-row-removed' : 'diff-row-changed']">
              <span class="diff-row-icon">{{ entry.status === 'added' ? '➕' : entry.status === 'removed' ? '❌' : '🔄' }}</span>
              <span class="diff-row-path">{{ entry.path }}</span>
              <span class="diff-row-values">
                <template v-if="entry.status === 'added'"><span class="diff-value-right">→ {{ entry.rightValue }}</span></template>
                <template v-else-if="entry.status === 'removed'"><span class="diff-value-left">{{ entry.leftValue }} →</span></template>
                <template v-else>
                  <span class="diff-value-left">{{ entry.leftValue }}</span>
                  <span class="diff-arrow"> → </span>
                  <span class="diff-value-right">{{ entry.rightValue }}</span>
                </template>
              </span>
            </div>
          </div>
        </div>
        <div v-if="diffResult && diffResult.filter((d: DiffEntry) => d.status === 'unchanged').length > 0" class="diff-same-count">
          ✅ {{ diffResult.filter((d: DiffEntry) => d.status === 'unchanged').length }} 个字段完全相同
        </div>
      </div>
    </div>

    <div class="json-status-bar">
      <div class="status-left">
        <template v-if="compareMode">
          <span class="json-valid-badge">📊 对比模式</span>
        </template>
        <template v-else-if="formattedInfo">
          <span class="json-valid-badge partial">{{ formattedInfo }}</span>
        </template>
        <template v-else>
          <span :class="['json-valid-badge', text.trim() ? (isValidJson ? 'valid' : 'invalid') : '']">
            {{ text.trim() ? (isValidJson ? '✅ 有效 JSON' : '❌ JSON 格式错误') : '等待输入...' }}
          </span>
        </template>
      </div>
      <div class="status-right">
        <span v-if="!compareMode && errorLines.length > 0" class="error-count" title="语法错误行">🚨 {{ errorLines.length }} 处</span>
        <span v-if="!compareMode">{{ lineCount }} 行</span>
        <span v-if="!compareMode">{{ charCount }} 字符</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.json-formatter-container {
  width: 100%; height: 100vh;
  background-image: url('/public/data/img5.jpeg');
  background-size: cover; background-position: center; background-repeat: no-repeat;
  display: flex; flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
  overflow: hidden; position: relative;
}
.json-formatter-container::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(255,255,255,0.85); pointer-events: none; z-index: 0;
}
.json-formatter-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; background: rgba(255,255,255,0.95);
  backdrop-filter: blur(10px); border-bottom: 1px solid rgba(225,232,237,0.8);
  cursor: move; flex-shrink: 0; position: relative; z-index: 1;
}
.header-left { display: flex; align-items: center; gap: 12px; }
.json-formatter-title { font-size: 18px; font-weight: 600; color: #14171a; margin: 0; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.close-button {
  width: 32px; height: 32px; border: none; border-radius: 16px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.2s; background: #e0245e; color: white;
}
.close-button:hover { background: #c91e4a; transform: scale(1.05); }
.close-icon { width: 16px; height: 16px; position: relative; }
.close-icon::before, .close-icon::after {
  content: ''; position: absolute; top: 50%; left: 50%;
  width: 12px; height: 2px; background: white; border-radius: 1px;
}
.close-icon::before { transform: translate(-50%,-50%) rotate(45deg); }
.close-icon::after { transform: translate(-50%,-50%) rotate(-45deg); }
.fullscreen-button {
  width: 32px; height: 32px; border: none; border-radius: 16px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.2s; background: rgba(102,126,234,0.15); color: #667eea; font-size: 13px;
}
.fullscreen-button:hover { background: rgba(102,126,234,0.3); transform: scale(1.08); }
.fullscreen-icon { font-size: 14px; line-height: 1; }
.json-toolbar {
  display: flex; gap: 8px; padding: 10px 20px;
  background: rgba(255,255,255,0.9); border-bottom: 1px solid rgba(225,232,237,0.6);
  flex-shrink: 0; position: relative; z-index: 1; overflow-x: auto;
}
.toolbar-btn {
  display: flex; align-items: center; gap: 6px; padding: 6px 14px;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 500;
  cursor: pointer; transition: all 0.2s;
  background: linear-gradient(135deg,#667eea 0%,#764ba2 100%); color: white; white-space: nowrap;
}
.toolbar-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102,126,234,0.3); }
.toolbar-btn span { font-size: 14px; }
.compare-mode-label {
  font-size: 13px; font-weight: 600; color: #764ba2;
  padding: 4px 10px; background: rgba(118,75,162,0.1); border-radius: 6px;
}
.toolbar-separator { width: 1px; height: 24px; background: rgba(225,232,237,0.6); flex-shrink: 0; margin: 0 4px; }
.toolbar-btn.compare-btn { background: linear-gradient(135deg,#48bb78 0%,#38a169 100%); }
.toolbar-btn.compare-btn:hover { box-shadow: 0 4px 12px rgba(72,187,120,0.4); }
.toolbar-btn.exit-compare-btn { background: linear-gradient(135deg,#fc8181 0%,#e53e3e 100%); }
.toolbar-btn.exit-compare-btn:hover { box-shadow: 0 4px 12px rgba(229,62,62,0.4); }
.toolbar-btn.active { box-shadow: 0 0 0 2px rgba(102,126,234,0.5); }
.json-editor-area { flex: 1; padding: 16px 20px; overflow: hidden; position: relative; z-index: 1; display: flex; }
.editor-body { flex: 1; display: flex; flex-direction: row; overflow: hidden; gap: 6px; align-items: stretch; }
.editor-wrapper { flex: 1; position: relative; border-radius: 12px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.json-codemirror { flex: 1; border-radius: 12px; height: 100%; overflow: hidden; }
.json-codemirror :deep(.cm-editor) {
  height: 100%; box-sizing: border-box; font-size: 14px;
  font-family: 'Consolas','Monaco','Courier New',monospace;
  background: rgba(255,255,255,0.92); border: 2px solid rgba(225,232,237,0.8);
  border-radius: 12px; outline: none;
}
.json-codemirror :deep(.cm-editor .cm-scroller) { overflow: auto !important; padding: 8px 0; line-height: 1.6; }
.json-codemirror :deep(.cm-editor.cm-focused) { outline: none !important; }
.json-codemirror :deep(.cm-editor .cm-content) { padding: 8px 16px; }
.json-codemirror :deep(.cm-editor .cm-gutters) {
  background: rgba(240,245,252,0.85); border-right: 1px solid rgba(203,213,225,0.5);
  color: #94a3b8; font-size: 12px; padding: 8px 0;
}
.json-codemirror :deep(.cm-editor .cm-lineNumbers .cm-gutterElement) { padding: 0 8px 0 4px; min-width: 28px; text-align: right; }
.json-codemirror :deep(.cm-editor .cm-foldGutter) { width: 18px; }
.json-codemirror :deep(.cm-editor .cm-foldGutter .cm-gutterElement) { padding: 0 2px; cursor: pointer; }
.json-codemirror :deep(.cm-editor .cm-activeLineGutter) { background: rgba(102,126,234,0.08); }
.json-codemirror :deep(.cm-editor .cm-matchingBracket) { background: rgba(102,126,234,0.2); outline: 1px solid rgba(102,126,234,0.4); }
.json-codemirror :deep(.cm-editor .cm-nonmatchingBracket) { background: rgba(229,62,62,0.2); }
.json-codemirror :deep(.cm-editor .cm-activeLine) { background: rgba(102,126,234,0.05); }
.json-codemirror :deep(.cm-editor .cm-selectionMatch) { background: rgba(102,126,234,0.15); }
.json-codemirror :deep(.cm-error-line) { background: rgba(229,62,62,0.08); }
.json-codemirror :deep(.cm-editor .cm-cursor) { border-left-color: #2d3748; }
.json-codemirror :deep(.cm-editor .cm-selectionBackground) { background: rgba(102,126,234,0.25) !important; }
.json-codemirror :deep(.cm-editor .cm-panel.cm-search) { background: rgba(255,255,255,0.97); border-bottom: 1px solid rgba(225,232,237,0.8); padding: 6px 12px; position: sticky; top: 0; z-index: 10; }
.json-codemirror :deep(.cm-editor .cm-search input) { border: 1px solid rgba(203,213,225,0.8); border-radius: 6px; padding: 4px 8px; font-size: 13px; font-family: inherit; }
.json-codemirror :deep(.cm-editor .cm-search button) { background: rgba(102,126,234,0.1); border: 1px solid rgba(203,213,225,0.8); border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; color: #4a5568; }
.json-codemirror :deep(.cm-editor .cm-search button:hover) { background: rgba(102,126,234,0.2); }
.json-codemirror :deep(.cm-editor .cm-search button[name="close"]) { background: transparent; border: none; font-size: 14px; padding: 2px 6px; }
.editor-overview-ruler {
  width: 10px; flex-shrink: 0; position: relative;
  background: rgba(237,242,247,0.6); border-radius: 5px;
  margin: 2px 0; overflow: hidden; cursor: pointer;
}
.ruler-mark { position: absolute; left: 0; width: 100%; height: 3px; border-radius: 2px; cursor: pointer; }
.ruler-mark.error { background: #e53e3e; height: 3px; opacity: 0.8; }
.json-compare-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; padding: 12px 20px; position: relative; z-index: 1; gap: 8px; }
.compare-panels { flex: 1; display: flex; flex-direction: row; gap: 0; overflow: hidden; align-items: stretch; }
.compare-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.compare-panel-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-radius: 8px 8px 0 0;
  font-size: 12px; font-weight: 600; flex-shrink: 0;
}
.left-header { background: rgba(66,153,225,0.1); color: #2b6cb0; margin-right: 2px; }
.right-header { background: rgba(237,137,54,0.1); color: #c05621; margin-left: 2px; }
.panel-copy-btn {
  width: 28px; height: 28px; border: none; border-radius: 6px; cursor: pointer;
  background: rgba(255,255,255,0.8); font-size: 13px;
  display: flex; align-items: center; justify-content: center; transition: all 0.2s;
}
.panel-copy-btn:hover { background: white; transform: scale(1.1); }
.compare-cm-wrapper { flex: 1; border-radius: 0 0 8px 8px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.compare-cm-wrapper .json-codemirror { border-radius: 0 0 8px 8px; flex: 1; height: 100%; overflow: hidden; }
.compare-cm-wrapper :deep(.cm-editor) { border-radius: 0 0 8px 8px; }
.compare-divider { display: flex; align-items: center; justify-content: center; width: 32px; flex-shrink: 0; cursor: default; }
.divider-icon { font-size: 18px; color: #a0aec0; opacity: 0.6; user-select: none; }
.diff-result-panel {
  flex-shrink: 0; max-height: 40%; display: flex; flex-direction: column;
  background: rgba(255,255,255,0.95); border-radius: 10px;
  border: 1px solid rgba(225,232,237,0.8); overflow: hidden;
}
.diff-summary { padding: 10px 14px; border-bottom: 1px solid rgba(225,232,237,0.6); flex-shrink: 0; }
.diff-summary-text { font-size: 13px; font-weight: 600; color: #2d3748; }
.diff-details { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
.diff-details-header {
  display: flex; justify-content: space-between; padding: 6px 14px;
  background: rgba(247,250,252,0.8); font-size: 12px; font-weight: 600;
  color: #4a5568; border-bottom: 1px solid rgba(225,232,237,0.4); flex-shrink: 0;
}
.diff-total { color: #e53e3e; }
.diff-details-body { flex: 1; overflow-y: auto; padding: 4px 0; }
.diff-row { display: flex; align-items: flex-start; padding: 4px 14px; font-size: 12px; font-family: 'Consolas','Monaco','Courier New',monospace; gap: 6px; }
.diff-row:hover { background: rgba(0,0,0,0.02); }
.diff-row-added { background: rgba(72,187,120,0.06); }
.diff-row-removed { background: rgba(245,101,101,0.06); }
.diff-row-changed { background: rgba(237,137,54,0.06); }
.diff-row-icon { flex-shrink: 0; width: 20px; text-align: center; }
.diff-row-path { color: #2b6cb0; font-weight: 600; flex-shrink: 0; min-width: 80px; }
.diff-row-values { color: #4a5568; word-break: break-all; line-height: 1.4; }
.diff-value-left { color: #e53e3e; text-decoration: line-through; opacity: 0.8; }
.diff-value-right { color: #38a169; font-weight: 500; }
.diff-arrow { color: #a0aec0; margin: 0 2px; }
.diff-same-count { padding: 6px 14px; font-size: 11px; color: #718096; border-top: 1px solid rgba(225,232,237,0.4); flex-shrink: 0; }
.json-status-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 20px; background: rgba(255,255,255,0.95);
  border-top: 1px solid rgba(225,232,237,0.6); flex-shrink: 0; position: relative; z-index: 1; font-size: 12px;
}
.json-valid-badge { padding: 4px 10px; border-radius: 6px; font-weight: 500; background: #edf2f7; color: #718096; }
.json-valid-badge.valid { background: rgba(72,187,120,0.15); color: #38a169; }
.json-valid-badge.invalid { background: rgba(245,101,101,0.15); color: #e53e3e; }
.json-valid-badge.partial { background: rgba(237,137,54,0.15); color: #dd6b20; }
.error-count { color: #e53e3e; font-weight: 600; }
.status-right { display: flex; gap: 16px; color: #718096; }
.status-right span { font-weight: 500; }
</style>
