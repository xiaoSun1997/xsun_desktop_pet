<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface ClipboardItem {
  content: string;
  content_type: string;
  timestamp: number;
  id: number;
}

const clipboardItems = ref<ClipboardItem[]>([]);
const copyStatus = ref<Record<number, boolean>>({});
const isLoading = ref(true);
const isLoadingMore = ref(false);
const expandedItems = ref<Set<number>>(new Set());
const currentPage = ref(1);
const hasMore = ref(true);
const enlargeImage = ref<string | null>(null);
const confirmDelete = ref<number | null>(null);
let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  loadClipboardHistory(1);
  refreshTimer = setInterval(async () => {
    try {
      const history = await invoke<ClipboardItem[]>("get_clipboard_history");
      if (history.length === 0) return;
      if (clipboardItems.value.length > 0) {
        const latestTimestamp = clipboardItems.value[0].timestamp;
        const newItems = history.filter((item: ClipboardItem) => item.timestamp > latestTimestamp);
        if (newItems.length > 0) clipboardItems.value = [...newItems, ...clipboardItems.value];
      } else {
        clipboardItems.value = history;
      }
      hasMore.value = history.length >= 10;
    } catch (error) { console.error("Auto refresh clipboard failed:", error); }
  }, 2000);
});

onUnmounted(() => {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});

const loadClipboardHistory = async (page: number = 1) => {
  try {
    if (page === 1) {
      isLoading.value = true;
      clipboardItems.value = await invoke<ClipboardItem[]>("get_clipboard_history");
      hasMore.value = clipboardItems.value.length >= 10;
      currentPage.value = 1;
    } else {
      isLoadingMore.value = true;
      const history = await invoke<ClipboardItem[]>("get_clipboard_history_paginated", { page, pageSize: 10 });
      if (history.length < 10) hasMore.value = false;
      clipboardItems.value = [...clipboardItems.value, ...history];
      currentPage.value = page;
    }
  } catch (error) { console.error("Get clipboard history failed:", error); }
  finally { isLoading.value = false; isLoadingMore.value = false; }
};

const handleDelete = async (id: number) => {
  try {
    await invoke("delete_clipboard_item", { id });
    clipboardItems.value = clipboardItems.value.filter((item: ClipboardItem) => item.id !== id);
    confirmDelete.value = null;
  } catch (error) { console.error("Delete failed:", error); }
};

const handleCopy = async (content: string, id: number) => {
  try {
    await invoke("copy_to_clipboard", { content });
    copyStatus.value = { ...copyStatus.value, [id]: true };
    setTimeout(() => { copyStatus.value = { ...copyStatus.value, [id]: false }; }, 2000);
  } catch (error) { console.error("Copy failed:", error); }
};

const handleExpand = async (content: string) => {
  try { await invoke("open_expand_window", { content }); }
  catch (error) { console.error("Open expand window failed:", error); }
};

const handleClearHistory = async () => {
  try {
    await invoke("clear_clipboard_history");
    clipboardItems.value = [];
    hasMore.value = false;
  } catch (error) { console.error("Clear history failed:", error); }
};

const handleClose = async () => {
  try { await getCurrentWindow().close(); }
  catch (error) { console.error("Close window failed:", error); }
};

const toggleExpand = (id: number) => {
  const next = new Set(expandedItems.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expandedItems.value = next;
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
};

const formatContentSize = (content: string): string => {
  const size = new Blob([content]).size;
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
};

const truncateText = (text: string, isExpanded: boolean): string => {
  if (!isExpanded && text.length > 500) return text.substring(0, 200) + "...";
  return text;
};
</script>

<template>
  <div class="clipboard-container">
    <div class="clipboard-header" data-tauri-drag-region>
      <div class="clipboard-header-top">
        <h1 class="clipboard-title">Clipboard</h1>
        <div class="clipboard-badge">{{ clipboardItems.length }} items</div>
      </div>
      <div class="clipboard-header-actions">
        <button v-if="clipboardItems.length > 0" class="clipboard-action-btn" @click="handleClearHistory">Clear</button>
      </div>
    </div>

    <div class="clipboard-items">
      <div v-if="isLoading" class="cb-loading-container">
        <div class="cb-loading-spinner"></div>
        <p class="cb-loading-text">Loading...</p>
      </div>
      <template v-else-if="clipboardItems.length > 0">
        <div v-for="item in clipboardItems" :key="item.id" :class="['cb-item', item.content_type === 'image' ? 'cb-item-image' : 'cb-item-text']">
          <div class="cb-item-header">
            <span class="cb-type-badge">{{ item.content_type === "image" ? "Image" : "Text" }}</span>
            <span class="cb-time">{{ formatTime(item.timestamp) }}</span>
            <span class="cb-size">{{ formatContentSize(item.content) }}</span>
          </div>
          <div class="cb-item-body">
            <template v-if="item.content_type === 'image'">
              <div class="cb-image-container">
                <img :src="item.content" alt="clipboard image" class="cb-image" />
              </div>
            </template>
            <template v-else>
              <div class="cb-text-container">
                <pre :class="['cb-text', { 'cb-text-expanded': expandedItems.has(item.id) }]">
                  {{ truncateText(item.content, expandedItems.has(item.id)) }}
                </pre>
                <button v-if="item.content.length > 500" class="cb-expand-toggle" @click="toggleExpand(item.id)">
                  {{ expandedItems.has(item.id) ? "Collapse" : `Expand (${(item.content.length / 1024).toFixed(1)}KB)` }}
                </button>
              </div>
            </template>
          </div>
          <div class="cb-item-actions">
            <button :class="['cb-action-btn', copyStatus[item.id] ? 'copied' : '']" @click="handleCopy(item.content, item.id)">
              {{ copyStatus[item.id] ? "Copied" : "Copy" }}
            </button>
            <button v-if="item.content_type === 'text'" class="cb-action-btn" @click="handleExpand(item.content)">Edit</button>
            <button class="cb-action-btn" @click="confirmDelete = item.id">Delete</button>
          </div>
          <div v-if="confirmDelete === item.id" class="cb-delete-confirm">
            <span>Confirm delete?</span>
            <button @click="handleDelete(item.id)">Yes</button>
            <button @click="confirmDelete = null">No</button>
          </div>
        </div>
        <div v-if="hasMore" class="cb-load-more-container">
          <button class="cb-load-more-btn" @click="loadClipboardHistory(currentPage + 1)" :disabled="isLoadingMore">
            {{ isLoadingMore ? "Loading..." : "Load more" }}
          </button>
        </div>
      </template>
      <div v-else class="cb-empty-state">
        <p class="cb-empty-title">No clipboard history</p>
      </div>
    </div>

    <div class="clipboard-footer">
      <button class="cb-close-btn" @click="handleClose" title="Close">Close</button>
    </div>
  </div>
</template>

<style scoped>
.clipboard-container { display: flex; flex-direction: column; height: 100vh; background: #1a1a2e; color: #e0e0e0; }
.clipboard-header { padding: 12px 16px; background: #16213e; border-bottom: 1px solid rgba(255,255,255,0.08); cursor: grab; }
.clipboard-header-top { display: flex; align-items: center; gap: 8px; }
.clipboard-title { font-size: 16px; font-weight: 600; margin: 0; color: #fff; }
.clipboard-badge { font-size: 10px; padding: 2px 8px; background: #0f3460; border-radius: 10px; color: rgba(255,255,255,0.7); }
.clipboard-header-actions { margin-top: 4px; }
.clipboard-action-btn { background: rgba(255,255,255,0.08); border: none; border-radius: 6px; padding: 4px 10px; color: rgba(255,255,255,0.6); font-size: 11px; cursor: pointer; }
.clipboard-items { flex: 1; overflow-y: auto; padding: 8px; }
.cb-loading-container { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
.cb-loading-spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,0.1); border-top-color: #e94560; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.cb-loading-text { font-size: 13px; color: rgba(255,255,255,0.5); margin-top: 8px; }
.cb-item { background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 8px; padding: 10px; }
.cb-item-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.cb-type-badge { font-size: 10px; padding: 1px 6px; background: #0f3460; border-radius: 4px; color: #7ec8e3; }
.cb-time { font-size: 10px; color: rgba(255,255,255,0.4); }
.cb-size { font-size: 10px; color: rgba(255,255,255,0.4); margin-left: auto; }
.cb-image-container { text-align: center; }
.cb-image { max-width: 100%; max-height: 200px; border-radius: 4px; }
.cb-text-container { }
.cb-text { font-size: 12px; color: rgba(255,255,255,0.7); white-space: pre-wrap; word-break: break-all; max-height: 60px; overflow: hidden; margin: 0; }
.cb-text-expanded { max-height: none; }
.cb-expand-toggle { background: none; border: none; color: #3498db; font-size: 11px; cursor: pointer; padding: 4px 0; }
.cb-item-actions { display: flex; gap: 6px; margin-top: 8px; }
.cb-action-btn { background: rgba(255,255,255,0.08); border: none; border-radius: 4px; padding: 4px 8px; color: rgba(255,255,255,0.6); font-size: 11px; cursor: pointer; }
.cb-action-btn.copied { background: #27ae60; color: #fff; }
.cb-delete-confirm { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 11px; color: rgba(255,255,255,0.6); }
.cb-delete-confirm button { background: rgba(255,255,255,0.1); border: none; border-radius: 4px; padding: 2px 8px; color: #e0e0e0; font-size: 11px; cursor: pointer; }
.cb-load-more-container { text-align: center; padding: 8px; }
.cb-load-more-btn { background: rgba(255,255,255,0.05); border: none; border-radius: 6px; padding: 8px 24px; color: rgba(255,255,255,0.6); font-size: 12px; cursor: pointer; }
.cb-empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
.cb-empty-title { font-size: 14px; color: rgba(255,255,255,0.4); }
.clipboard-footer { padding: 8px 16px; background: #16213e; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: flex-end; }
.cb-close-btn { background: rgba(255,255,255,0.08); border: none; border-radius: 6px; padding: 4px 12px; color: rgba(255,255,255,0.5); font-size: 11px; cursor: pointer; }
</style>
