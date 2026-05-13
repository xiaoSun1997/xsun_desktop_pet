<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface SelectionPayload {
  text: string;
  x: number;
  y: number;
}

const payload = ref<SelectionPayload | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);

onMounted(async () => {
  try {
    await getCurrentWindow().setBackgroundColor({ red: 28, green: 28, blue: 38, alpha: 0.95 });
  } catch (e) {
    console.warn("Set background color failed:", e);
  }

  const unlisten = await listen<SelectionPayload>("selection://show", (event) => {
    payload.value = event.payload;
  });

  const handleBlur = () => closeMenu();
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeMenu();
  };

  window.addEventListener("blur", handleBlur);
  window.addEventListener("keydown", handleKeyDown);

  // Click outside
  setTimeout(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.value && !menuRef.value.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
  }, 100);
});

const closeMenu = async () => {
  try {
    const win = getCurrentWindow();
    await win.close();
  } catch (e) {
    console.error("Close menu failed:", e);
  }
};

const handleTranslate = async () => {
  if (!payload.value?.text) return;
  try {
    await invoke("open_translator_with_text", { text: payload.value.text });
  } catch (e) {
    console.error("Open translator failed:", e);
  }
  await closeMenu();
};

const handleOpenUrl = async () => {
  if (!payload.value?.text) return;
  try {
    let url = payload.value.text.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch (e) {
    console.error("Open URL failed:", e);
  }
  await closeMenu();
};

const handleJsonFormat = async () => {
  if (!payload.value?.text) return;
  try {
    await invoke("open_json_compare_with_text", { text: payload.value.text });
  } catch (e) {
    console.error("Open JSON compare failed:", e);
  }
  await closeMenu();
};
</script>

<template>
  <div class="selection-menu-container" ref="menuRef" data-tauri-drag-region>
    <div class="menu-header">
      <div class="menu-title">Quick Actions</div>
    </div>
    <div class="menu-actions">
      <button class="menu-action-btn" @click="handleTranslate">
        <span class="action-icon">T</span>
        <span class="action-label">Translate</span>
      </button>
      <button class="menu-action-btn" @click="handleOpenUrl">
        <span class="action-icon">U</span>
        <span class="action-label">Open URL</span>
      </button>
      <button class="menu-action-btn" @click="handleJsonFormat">
        <span class="action-icon">J</span>
        <span class="action-label">JSON Format</span>
      </button>
    </div>
    <div v-if="payload?.text" class="menu-preview">
      <div class="preview-label">Selected text:</div>
      <div class="preview-text">
        {{ payload.text.length > 50 ? payload.text.substring(0, 50) + "..." : payload.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
.selection-menu-container {
  width: 100%; height: 100%; display: flex; flex-direction: column;
  background: rgba(28, 28, 38, 0.95); border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1); box-sizing: border-box;
  user-select: none; overflow: hidden;
}
.menu-header { display: flex; align-items: center; justify-content: center; padding: 8px 10px 6px; cursor: grab; }
.menu-title { font-size: 11px; color: rgba(255,255,255,0.5); font-weight: 600; letter-spacing: 1.5px; text-transform: uppercase; }
.menu-actions { display: flex; flex-direction: column; padding: 2px 4px; gap: 1px; flex: 1; }
.menu-action-btn {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: none;
  background: transparent; border-radius: 8px; color: rgba(255,255,255,0.85); font-size: 13px;
  cursor: pointer; transition: all 0.12s; text-align: left;
}
.menu-action-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
.action-icon { font-size: 16px; width: 24px; text-align: center; flex-shrink: 0; }
.action-label { font-weight: 500; }
.menu-preview { padding: 6px 10px 8px; border-top: 1px solid rgba(255,255,255,0.06); }
.preview-label { font-size: 10px; color: rgba(255,255,255,0.3); margin-bottom: 3px; }
.preview-text { font-size: 11px; color: rgba(255,255,255,0.55); line-height: 1.3; word-break: break-all; max-height: 30px; overflow: hidden; font-family: monospace; }
</style>
