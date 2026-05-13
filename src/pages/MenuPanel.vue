<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import defaultMenuItems from "../../public/config/bubbles.json";

interface MenuItem {
  label: string;
  action: string;
  icon?: string;
}

const STORAGE_KEY = "menu-panel-order";

function loadMenuOrder(): MenuItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const savedOrder: MenuItem[] = JSON.parse(stored);
      const defaultItems = defaultMenuItems as MenuItem[];
      const savedActions = new Set(savedOrder.map((i) => i.action));
      const newItems = defaultItems.filter((i) => !savedActions.has(i.action));
      return [...savedOrder.filter((i) => savedActions.has(i.action)), ...newItems];
    }
  } catch {}
  return defaultMenuItems as MenuItem[];
}

function saveMenuOrder(items: MenuItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

const items = ref<MenuItem[]>(loadMenuOrder());
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
const panelRef = ref<HTMLDivElement | null>(null);

onMounted(() => {
  const handleClickOutside = (event: MouseEvent) => {
    if (panelRef.value && !panelRef.value.contains(event.target as Node)) {
      closePanel();
    }
  };
  setTimeout(() => {
    document.addEventListener("mousedown", handleClickOutside);
  }, 100);
});

const closePanel = async () => {
  try { await getCurrentWindow().close(); }
  catch (error) { console.error("Close panel failed:", error); }
};

const handleDragStart = (index: number) => { dragIndex.value = index; };
const handleDragOver = (e: DragEvent, index: number) => { e.preventDefault(); dragOverIndex.value = index; };
const handleDragLeave = () => { dragOverIndex.value = null; };
const handleDrop = (e: DragEvent, dropIndex: number) => {
  e.preventDefault();
  dragOverIndex.value = null;
  if (dragIndex.value === null || dragIndex.value === dropIndex) {
    dragIndex.value = null;
    return;
  }
  const next = [...items.value];
  const [moved] = next.splice(dragIndex.value, 1);
  next.splice(dropIndex, 0, moved);
  items.value = next;
  saveMenuOrder(next);
  dragIndex.value = null;
};
const handleDragEnd = () => { dragIndex.value = null; dragOverIndex.value = null; };

const createOrShowWindow = async (label: string, config: any) => {
  const windows = await getAllWindows();
  const existing = windows.find((w: any) => w.label === label);
  if (existing) {
    try {
      await existing.show();
      await existing.setFocus();
      return;
    } catch (e) {
      console.warn(`Show ${label} failed, recreate:`, e);
      try { await existing.close(); } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const url = import.meta.env.DEV ? config.devUrl : config.prodUrl;
  try {
    const webview = new WebviewWindow(label, { url, ...config.options });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Create ${label} timeout`)), 5000);
      webview.once("tauri://created", () => { clearTimeout(timeout); resolve(); });
      webview.once("tauri://error", (e: any) => { clearTimeout(timeout); reject(new Error(`Create ${label} error: ${JSON.stringify(e)}`)); });
    });
    await webview.show();
    await webview.setFocus();
  } catch (err) { console.error(`Create ${label} failed:`, err); }
};

const handleItemClick = async (item: MenuItem) => {
  const windowConfigs: Record<string, any> = {
    "open-main": { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "System Info", width: 600, height: 600, visible: false, transparent: true, decorations: false, center: true, skipTaskbar: true, focus: true, shadow: false } },
    "open-clipboard": { devUrl: "http://localhost:1420/clipboard", prodUrl: "clipboard.html", options: { title: "Clipboard", width: 400, height: 500, visible: true, transparent: true, decorations: false, center: true } },
    "open-ai": { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "AI Chat", width: 800, height: 600, visible: true, transparent: true, decorations: false, resizable: true, minWidth: 600, minHeight: 500, center: true } },
    translator: { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "Translator", width: 1000, height: 700, visible: true, transparent: true, decorations: false, resizable: true, minWidth: 800, minHeight: 600, center: true } },
    calendar: { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "Calendar", width: 800, height: 600, visible: true, transparent: true, decorations: false, resizable: true, minWidth: 900, minHeight: 950, center: true } },
    "json-compare": { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "JSON Compare", width: 1200, height: 800, visible: true, transparent: true, decorations: false, resizable: true, minWidth: 800, minHeight: 600, center: true } },
    "pomodoro-timer": { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "Pomodoro Timer", width: 800, height: 600, visible: true, transparent: true, decorations: false, resizable: true, minWidth: 600, minHeight: 500, center: true } },
    jira: { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "JIRA", width: 1000, height: 1000, visible: true, transparent: true, decorations: false, resizable: true, minWidth: 800, minHeight: 600, center: true } },
    "map-drawing": { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "Map Drawing", width: 1200, height: 800, visible: true, transparent: true, decorations: false, resizable: true, minWidth: 900, minHeight: 600, center: true } },
    notepad: { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "Notepad", width: 1100, height: 750, center: true, resizable: true } },
    "file-search": { devUrl: "http://localhost:1420", prodUrl: "index.html", options: { title: "File Search", width: 700, height: 550, center: true, resizable: true, skipTaskbar: true } },
    "minimize-to-tray": null,
    "close-pet": null,
  };

  const config = windowConfigs[item.action];
  if (config) {
    await createOrShowWindow(item.action.replace("open-", ""), config);
  } else if (item.action === "minimize-to-tray") {
    await invoke("hide_to_tray");
  } else if (item.action === "close-pet") {
    const windows = await getAllWindows();
    const pet = windows.find((w: any) => w.label === "pet");
    if (pet) await pet.close();
  } else {
    console.warn(`Unknown action: ${item.action}`);
  }
  await closePanel();
};
</script>

<template>
  <div class="menu-panel-container">
    <div class="menu-panel" ref="panelRef">
      <div class="menu-header">
        <h2>Menu</h2>
        <button class="close-btn" @click="closePanel"><span>x</span></button>
      </div>
      <div class="menu-grid">
        <div
          v-for="(item, index) in items"
          :key="item.action"
          :class="['menu-item', { dragging: dragIndex === index, 'drag-over': dragOverIndex === index }]"
          draggable="true"
          @dragstart="handleDragStart(index)"
          @dragover="(e) => handleDragOver(e, index)"
          @dragleave="handleDragLeave"
          @drop="(e) => handleDrop(e, index)"
          @dragend="handleDragEnd"
          @click="handleItemClick(item)"
        >
          <div class="menu-item-icon">
            <img
              :src="item.icon || `/menu/${item.action.replace('open-', '')}.png`"
              :alt="item.label"
              @error="($event.target as HTMLImageElement).src = '/menu/ai.png'"
            />
          </div>
          <div class="menu-item-label">{{ item.label }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-panel-container { display: flex; align-items: center; justify-content: center; height: 100vh; background: transparent; }
.menu-panel { background: rgba(28,28,38,0.95); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); width: 500px; max-width: 90vw; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.menu-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); cursor: grab; }
.menu-header h2 { margin: 0; font-size: 16px; font-weight: 600; color: #fff; }
.close-btn { background: none; border: none; color: rgba(255,255,255,0.4); font-size: 20px; cursor: pointer; padding: 0; }
.menu-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 20px; }
.menu-item { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px; border-radius: 12px; cursor: pointer; transition: all 0.15s; user-select: none; }
.menu-item:hover { background: rgba(255,255,255,0.08); }
.menu-item.dragging { opacity: 0.4; }
.menu-item.drag-over { background: rgba(233,69,96,0.15); }
.menu-item-icon { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; }
.menu-item-icon img { width: 48px; height: 48px; object-fit: contain; }
.menu-item-label { font-size: 11px; color: rgba(255,255,255,0.7); text-align: center; }
</style>
