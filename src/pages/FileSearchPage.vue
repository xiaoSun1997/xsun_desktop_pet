<script setup lang="ts">
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface SearchResult {
  path: string;
  name: string;
  is_dir: boolean;
}

const query = ref("");
const resultPath = ref("");
const searchDepth = ref(3);
const results = ref<SearchResult[]>([]);
const isSearching = ref(false);
const searchMessage = ref("");

const searchFiles = async () => {
  if (!query.value.trim()) return;
  isSearching.value = true;
  searchMessage.value = "Searching...";
  results.value = [];
  try {
    const res = await invoke<SearchResult[]>("search_files_internal", {
      query: query.value,
      rootPath: resultPath.value || undefined,
      maxDepth: searchDepth.value,
    });
    results.value = res;
    searchMessage.value = res.length > 0 ? `${res.length} results` : "No results found";
  } catch (e) {
    console.error("Search failed:", e);
    searchMessage.value = `Error: ${e}`;
  } finally {
    isSearching.value = false;
  }
};

const openFile = async (file: SearchResult) => {
  try {
    await invoke("open_file", { path: file.path });
  } catch (e) {
    console.error("Open file failed:", e);
  }
};

const handleClose = async () => {
  try { await getCurrentWindow().close(); }
  catch (e) { console.error("Close failed:", e); }
};
</script>

<template>
  <div class="file-search-container">
    <div class="file-search-header" data-tauri-drag-region>
      <h1 class="file-search-title">File Search</h1>
      <button class="close-button" @click="handleClose">Close</button>
    </div>

    <div class="file-search-content">
      <div class="search-controls">
        <input v-model="query" type="text" class="search-input" placeholder="Search files..." @keydown.enter="searchFiles" />
        <button class="search-button" @click="searchFiles" :disabled="isSearching">{{ isSearching ? "..." : "Search" }}</button>
      </div>
      <div class="search-options">
        <label>Depth: <select v-model.number="searchDepth"><option :value="1">1</option><option :value="2">2</option><option :value="3">3</option><option :value="5">5</option></select></label>
      </div>
      <div class="search-message" v-if="searchMessage">{{ searchMessage }}</div>
      <div class="search-results">
        <div v-for="(file, i) in results" :key="i" class="search-result-item" @click="openFile(file)">
          <span class="result-icon">{{ file.is_dir ? "D" : "F" }}</span>
          <div class="result-info">
            <div class="result-name">{{ file.name }}</div>
            <div class="result-path">{{ file.path }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-search-container { display: flex; flex-direction: column; height: 100vh; background: #1a1a2e; color: #e0e0e0; }
.file-search-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; background: #16213e; border-bottom: 1px solid rgba(255,255,255,0.08); cursor: grab; }
.file-search-title { font-size: 16px; font-weight: 600; margin: 0; color: #fff; }
.close-button { background: rgba(255,255,255,0.08); border: none; border-radius: 6px; padding: 4px 12px; color: rgba(255,255,255,0.5); font-size: 11px; cursor: pointer; }
.file-search-content { flex: 1; padding: 12px 16px; overflow-y: auto; }
.search-controls { display: flex; gap: 8px; margin-bottom: 8px; }
.search-input { flex: 1; background: #0f0f23; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #e0e0e0; padding: 8px 12px; font-size: 13px; outline: none; }
.search-button { padding: 8px 16px; background: #e94560; border: none; border-radius: 6px; color: #fff; font-size: 12px; cursor: pointer; }
.search-button:disabled { opacity: 0.5; }
.search-options { margin-bottom: 8px; font-size: 12px; color: rgba(255,255,255,0.5); }
.search-options select { background: #0f0f23; border: 1px solid rgba(255,255,255,0.1); color: #e0e0e0; margin-left: 4px; }
.search-message { font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 8px; }
.search-results { }
.search-result-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.search-result-item:hover { background: rgba(255,255,255,0.05); }
.result-icon { width: 20px; text-align: center; font-size: 12px; }
.result-info { flex: 1; min-width: 0; }
.result-name { font-size: 13px; color: #e0e0e0; }
.result-path { font-size: 10px; color: rgba(255,255,255,0.35); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
