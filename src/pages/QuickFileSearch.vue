<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface FileResult {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
}

const query = ref("");
const results = ref<FileResult[]>([]);
const isSearching = ref(false);
const selectedIndex = ref(-1);
const isIndexing = ref(false);
const indexProgress = ref({ current: 0, total: 0, message: "" });
const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLDivElement | null>(null);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let resultsCache: FileResult[] = [];

const getFileIcon = (name: string, isDir: boolean): string => {
  if (isDir) return "D";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const iconMap: Record<string, string> = {
    pdf: "P", doc: "P", docx: "P", txt: "T",
    jpg: "I", jpeg: "I", png: "I", gif: "I",
    mp3: "A", wav: "A", mp4: "V", avi: "V",
    zip: "Z", rar: "Z", exe: "E", lnk: "L",
    html: "H", css: "C", js: "J", ts: "T", json: "J",
    rs: "R", go: "G", py: "P", java: "J",
    md: "M", sql: "S",
  };
  return iconMap[ext] || "F";
};

onMounted(() => {
  setTimeout(() => inputRef.value?.focus(), 50);
  invoke("get_index_status").then((status: any) => {
    if (status && status.indexed_count > 0) {
      // has index
    } else {
      isIndexing.value = true;
      invoke("build_file_index").catch(() => (isIndexing.value = false));
    }
  }).catch(() => {});

  let unlistens: (() => void)[] = [];
  listen<FileResult[]>("file-search://result", (event) => {
    resultsCache = [...resultsCache, ...event.payload];
    results.value = [...resultsCache];
  }).then((fn) => unlistens.push(fn));
  listen("file-search://done", () => {
    isSearching.value = false;
  }).then((fn) => unlistens.push(fn));
  listen<any>("file-index://status", (event) => {
    const { phase } = event.payload;
    if (phase === "done") { isIndexing.value = false; }
    else if (phase === "error") { isIndexing.value = false; }
  }).then((fn) => unlistens.push(fn));
  listen<any>("file-index://progress", (event) => {
    indexProgress.value = event.payload;
  }).then((fn) => unlistens.push(fn));

  onUnmounted(() => {
    unlistens.forEach((fn) => fn());
  });
});

const doSearch = async (q: string) => {
  const trimmed = q.trim();
  if (!trimmed) {
    results.value = [];
    resultsCache = [];
    isSearching.value = false;
    selectedIndex.value = -1;
    return;
  }
  isSearching.value = true;
  results.value = [];
  resultsCache = [];
  selectedIndex.value = -1;
  try { await invoke("search_files", { query: trimmed }); }
  catch (e) { console.error("Search failed:", e); isSearching.value = false; }
};

const handleInputChange = () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(query.value), 80);
};

const openFile = async (file: FileResult) => {
  try {
    await invoke("open_file", { path: file.path });
    getCurrentWindow().close();
  } catch (e) { console.error("Open file failed:", e); }
};

const visibleResults = () => results.value.slice(0, 15);
</script>

<template>
  <div class="quick-search-container">
    <div class="quick-search-box">
      <div v-if="isIndexing" class="quick-index-bar">
        <span>
          {{ indexProgress.message || "Indexing..." }}
          <template v-if="indexProgress.total > 0">({{ indexProgress.current }} / {{ indexProgress.total }})</template>
        </span>
      </div>

      <div class="quick-input-wrapper">
        <input
          ref="inputRef"
          type="text"
          class="quick-input"
          placeholder="Search files..."
          v-model="query"
          @input="handleInputChange"
          @keydown.up.prevent="selectedIndex = Math.max(-1, selectedIndex - 1)"
          @keydown.down.prevent="selectedIndex = Math.min(visibleResults().length - 1, selectedIndex + 1)"
          @keydown.enter="selectedIndex >= 0 && openFile(visibleResults()[selectedIndex])"
          @keydown.escape="getCurrentWindow().close()"
        />
        <button v-if="query" class="quick-clear-btn" @click="query = ''; results = []; resultsCache = []; selectedIndex = -1; inputRef?.focus()">x</button>
      </div>

      <div class="quick-results" ref="listRef">
        <div v-if="isSearching && results.length === 0" class="quick-status">Searching...</div>
        <div v-else-if="!isSearching && query.trim() && results.length === 0" class="quick-status">No results</div>

        <div
          v-for="(file, index) in visibleResults()"
          :key="file.path"
          :class="['quick-result-item', { selected: index === selectedIndex }]"
          @click="openFile(file)"
          @mouseenter="selectedIndex = index"
        >
          <span class="quick-file-icon">{{ getFileIcon(file.name, file.is_dir) }}</span>
          <div class="quick-file-info">
            <div class="quick-file-name" :title="file.name">{{ file.name }}</div>
            <div class="quick-file-path" :title="file.path">{{ file.path }}</div>
          </div>
          <span v-if="index < 9" class="quick-shortcut-hint">Ctrl+{{ index + 1 }}</span>
        </div>

        <div v-if="results.length > 15" class="quick-more-hint">{{ results.length - 15 }} more results...</div>
      </div>

      <div class="quick-footer">
        <span class="quick-footer-hint">
          {{ isIndexing ? "Search will be faster after indexing" : results.length > 0 ? `${results.length} results` : isSearching ? "Searching..." : "Type to search" }}
        </span>
        <span class="quick-footer-keys">Up/Down Select Enter Open Esc Close</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quick-search-container { display: flex; flex-direction: column; height: 100vh; background: rgba(20,20,35,0.95); color: #e0e0e0; }
.quick-search-box { display: flex; flex-direction: column; height: 100%; }
.quick-index-bar { padding: 6px 12px; background: rgba(233,69,96,0.15); font-size: 11px; color: #e94560; }
.quick-input-wrapper { display: flex; align-items: center; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.quick-input { flex: 1; background: transparent; border: none; color: #e0e0e0; font-size: 14px; outline: none; }
.quick-clear-btn { background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer; font-size: 16px; }
.quick-results { flex: 1; overflow-y: auto; }
.quick-status { display: flex; align-items: center; justify-content: center; padding: 24px; color: rgba(255,255,255,0.4); font-size: 13px; }
.quick-result-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; transition: background 0.1s; }
.quick-result-item:hover,
.quick-result-item.selected { background: rgba(255,255,255,0.08); }
.quick-file-icon { width: 24px; text-align: center; font-size: 14px; flex-shrink: 0; }
.quick-file-info { flex: 1; min-width: 0; }
.quick-file-name { font-size: 13px; color: #e0e0e0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quick-file-path { font-size: 10px; color: rgba(255,255,255,0.35); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quick-shortcut-hint { font-size: 10px; color: rgba(255,255,255,0.25); flex-shrink: 0; }
.quick-more-hint { text-align: center; padding: 8px; font-size: 11px; color: rgba(255,255,255,0.3); }
.quick-footer { display: flex; justify-content: space-between; padding: 6px 12px; background: rgba(255,255,255,0.03); border-top: 1px solid rgba(255,255,255,0.06); font-size: 10px; color: rgba(255,255,255,0.3); }
</style>
