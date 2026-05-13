<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";

const content = ref("");
const isEditing = ref(false);
const saveStatus = ref<"" | "saving" | "saved" | "error">("");
const originalContent = ref("");

const autoFormat = (text: string): string => {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
};

onMounted(() => {
  const initialContent = (window as any).__EXPAND_CONTENT__ || "";
  const formattedContent = autoFormat(initialContent);
  content.value = formattedContent;
  originalContent.value = initialContent;
});

const handleClose = async () => {
  try {
    const appWindow = getCurrentWindow();
    await appWindow.close();
  } catch (error) {
    console.error("Close window failed:", error);
  }
};

const handleCopy = async () => {
  try {
    await invoke("copy_to_clipboard", { content: content.value });
    saveStatus.value = "saved";
    setTimeout(() => (saveStatus.value = ""), 2000);
  } catch (error) {
    console.error("Copy failed:", error);
    saveStatus.value = "error";
    setTimeout(() => (saveStatus.value = ""), 2000);
  }
};

const handleSave = async () => {
  try {
    saveStatus.value = "saving";
    await invoke("add_to_clipboard_history", { content: content.value });
    await invoke("copy_to_clipboard", { content: content.value });
    originalContent.value = content.value;
    saveStatus.value = "saved";
    setTimeout(() => (saveStatus.value = ""), 2000);
  } catch (error) {
    console.error("Save failed:", error);
    saveStatus.value = "error";
    setTimeout(() => (saveStatus.value = ""), 2000);
  }
};

const handleCancel = () => {
  const formattedOriginal = autoFormat(originalContent.value);
  content.value = formattedOriginal;
  isEditing.value = false;
};

const handleFormat = () => {
  content.value = autoFormat(content.value);
};

const hasChanges = (): boolean => content.value !== autoFormat(originalContent.value);
const contentSizeByte = (): number => new Blob([content.value]).size;

const formatSize = (size: number): string => {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
};

const lineCount = (): number => content.value.split("\n").length;
</script>

<template>
  <div class="expand-container">
    <div class="expand-header" data-tauri-drag-region>
      <div class="header-left">
        <h1 class="expand-title">Clipboard Content</h1>
        <div class="content-info">
          <span class="content-size">{{ formatSize(contentSizeByte()) }}</span>
          <span class="content-length">{{ content.length }} chars</span>
        </div>
      </div>
      <div class="header-actions">
        <template v-if="isEditing">
          <button
            v-if="content.length <= 200000"
            class="edit-button"
            @click="handleFormat"
            title="Format content"
            style="background: linear-gradient(135deg, #9b59b6, #8e44ad)"
          >
            Format
          </button>
          <button class="cancel-button" @click="handleCancel" title="Cancel">Cancel</button>
          <button
            :class="['save-button', { disabled: !hasChanges() }, saveStatus]"
            @click="handleSave"
            :disabled="!hasChanges() || saveStatus === 'saving'"
            title="Save to clipboard"
          >
            <template v-if="saveStatus === 'saving'">Saving...</template>
            <template v-else-if="saveStatus === 'saved'">Saved</template>
            <template v-else-if="saveStatus === 'error'">Save failed</template>
            <template v-else>Save</template>
          </button>
        </template>
        <template v-else>
          <button :class="['action-copy-button', saveStatus]" @click="handleCopy" title="Copy all">
            <span>{{ saveStatus === "saved" ? "Copied" : "Copy" }}</span>
          </button>
          <button class="edit-button" @click="isEditing = true" title="Edit">
            <span>Edit</span>
          </button>
          <div class="expand-action-divider"></div>
          <button class="expand-close-button" @click="handleClose" title="Close">
            <span>Close</span>
          </button>
        </template>
      </div>
    </div>

    <div class="expand-content">
      <textarea
        v-if="isEditing"
        class="content-editor"
        v-model="content"
        placeholder="Edit content here..."
        autofocus
        spellcheck="false"
      />
      <div v-else class="content-display">
        <pre class="content-text">{{ content || "No content" }}</pre>
      </div>
    </div>

    <div class="expand-footer">
      <div class="expand-footer-info">
        <span>Lines: {{ lineCount() }}</span>
        <span>Chars: {{ content.length }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.expand-container { display: flex; flex-direction: column; height: 100vh; background: #1a1a2e; color: #e0e0e0; }
.expand-header { display: flex; justify-content: space-between; align-items: flex-start; padding: 12px 16px; background: #16213e; border-bottom: 1px solid rgba(255,255,255,0.08); cursor: grab; }
.header-left { display: flex; flex-direction: column; gap: 4px; }
.expand-title { font-size: 16px; font-weight: 600; margin: 0; color: #fff; }
.content-info { display: flex; gap: 12px; font-size: 11px; color: rgba(255,255,255,0.5); }
.header-actions { display: flex; align-items: center; gap: 8px; }
.edit-button, .cancel-button, .save-button, .action-copy-button, .expand-close-button {
  padding: 6px 12px; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; color: #fff; transition: all 0.15s;
}
.edit-button { background: #0f3460; }
.cancel-button { background: #533483; }
.save-button { background: #e94560; }
.save-button.disabled { opacity: 0.4; cursor: not-allowed; }
.save-button.saving { background: #f0a500; }
.save-button.saved { background: #27ae60; }
.save-button.error { background: #c0392b; }
.action-copy-button { background: #0f3460; }
.expand-close-button { background: #e94560; }
.expand-action-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.15); }
.expand-content { flex: 1; overflow: auto; padding: 16px; }
.content-editor {
  width: 100%; height: 100%; background: #0f0f23; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px; color: #e0e0e0; font-family: monospace; font-size: 13px; padding: 12px; resize: none; outline: none;
}
.content-display { height: 100%; }
.content-text {
  margin: 0; white-space: pre-wrap; word-break: break-all; font-family: monospace; font-size: 13px; line-height: 1.5; color: #ccc;
}
.expand-footer { padding: 8px 16px; background: #16213e; border-top: 1px solid rgba(255,255,255,0.08); }
.expand-footer-info { display: flex; gap: 16px; font-size: 11px; color: rgba(255,255,255,0.4); }
</style>
