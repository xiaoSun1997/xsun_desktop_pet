<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { getCurrentWindow, getAllWindows, PhysicalPosition, currentMonitor } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

interface Bubble {
  label: string;
  action: string;
  icon: string;
}

const actions = [
  { name: "move", src: "/pet/rich_cat.gif" }
];

const bubbles: Bubble[] = [
  { label: "剪贴板", action: "open-clipboard", icon: "/menu/clipboard_512.png" },
  { label: "系统信息", action: "open-main", icon: "/menu/system_512.png" },
  { label: "AI对话", action: "open-ai", icon: "/menu/ai.png" },
  { label: "有道翻译", action: "translator", icon: "/menu/translator_512.png" },
  { label: "日历TODO", action: "calendar", icon: "/menu/calendar_512.png" },
  { label: "JSON对比", action: "json-compare", icon: "/menu/json_512.png" },
  { label: "番茄钟", action: "pomodoro-timer", icon: "/menu/pomodoro_512.png" },
  { label: "JIRA助手", action: "jira", icon: "/menu/jira_512.png" },
  { label: "地图绘制", action: "map-drawing", icon: "/menu/map.png" },
  { label: "记事本", action: "notepad", icon: "/menu/notebook.png" },
  { label: "文件搜索", action: "file-search", icon: "/menu/search.png" },
  { label: "关闭桌宠", action: "close-pet", icon: "/menu/close_512.png" },
  { label: "最小化托盘", action: "minimize-to-tray", icon: "/menu/minimize_512.png" }
];

const index = ref(0);
const showBubbles = ref(false);
const isClickThrough = ref(true);
const isSleeping = ref(false);

let downPos: { x: number; y: number } | null = null;
let dragged = false;
let hideTimer: number | null = null;
let sleepTimer: number | null = null;
let doubleClickTimer: number | null = null;
let clickCount = 0;
let unlisteners: UnlistenFn[] = [];

const DRAG_THRESHOLD = 3;

const setClickThrough = async (enabled: boolean) => {
  if (enabled === isClickThrough.value) return;
  try {
    await invoke("set_click_through", { enabled });
    isClickThrough.value = enabled;
    isSleeping.value = enabled;
  } catch (error) {
    console.error("设置点击穿透失败:", error);
  }
};

const wakeUpPet = () => {
  setClickThrough(false);
  isSleeping.value = false;
};

const putPetToSleep = () => {
  setClickThrough(false);
  isSleeping.value = true;
  showBubbles.value = false;
};

const handleDoubleClick = async () => {
  await wakeUpPet();
};

const onMouseEnter = () => {
  if (isSleeping.value) wakeUpPet();
  if (sleepTimer !== null) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
};

const onMouseLeave = () => {
  if (!showBubbles.value) {
    sleepTimer = window.setTimeout(() => { putPetToSleep(); }, 3000);
  }
};

const onPointerDown = (e: PointerEvent) => {
  if (isSleeping.value) {
    const target = e.target as HTMLElement;
    if (target.classList.contains("pet-image")) {
      clickCount++;
      if (clickCount === 1) {
        doubleClickTimer = window.setTimeout(() => { clickCount = 0; }, 300);
      } else if (clickCount === 2) {
        if (doubleClickTimer !== null) clearTimeout(doubleClickTimer);
        clickCount = 0;
        handleDoubleClick();
      }
    }
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  downPos = { x: e.clientX, y: e.clientY };
  dragged = false;
  (e.target as Element).setPointerCapture?.(e.pointerId);
};

const onPointerMove = async (e: PointerEvent) => {
  if (isSleeping.value || !downPos || dragged) return;
  const dx = e.clientX - downPos.x;
  const dy = e.clientY - downPos.y;
  if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
    dragged = true;
    await getCurrentWindow().startDragging();
  }
};

const onPointerUp = () => {
  if (isSleeping.value) return;
  if (!dragged) {
    index.value = (index.value + 1) % actions.length;
    openMenuPanel();
  }
  downPos = null;
  dragged = false;
};

watch(showBubbles, (val) => {
  if (val) {
    setClickThrough(false);
    if (sleepTimer !== null) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
  }
});

// Mouse move auto-hide bubbles when outside
watch(showBubbles, (val) => {
  if (!val) return;
  const handler = (e: MouseEvent) => {
    const pet = document.querySelector(".pet-container");
    if (pet && !pet.contains(e.target as Node)) {
      if (hideTimer !== null) clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => { showBubbles.value = false; }, 3000);
    } else {
      if (hideTimer !== null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    }
  };
  document.addEventListener("mousemove", handler);
  onUnmounted(() => {
    document.removeEventListener("mousemove", handler);
    if (hideTimer !== null) clearTimeout(hideTimer);
  });
});

// Window creation helpers using config pattern matching the composable
const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

async function findOrCreateWindow(label: string, config: Record<string, any>): Promise<void> {
  const windows = await getAllWindows();
  const existing = windows.find((w) => w.label === label);
  if (existing) {
    try { await existing.show(); await existing.setFocus(); return; }
    catch (e) { console.warn(`${label} show/setFocus failed:`, e); }
  }
  try {
    const webview = new WebviewWindow(label, { url, ...config });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`${label} creation timeout`)), 5000);
      webview.once("tauri://created", () => { clearTimeout(timeout); resolve(); });
      webview.once("tauri://error", (e) => { clearTimeout(timeout); reject(new Error(JSON.stringify(e))); });
    });
    await webview.show();
    await webview.setFocus();
  } catch (err) { console.error(`Create ${label} failed:`, err); }
}

async function createOrShowMain() {
  await findOrCreateWindow("main", { title: "系统信息", width: 400, height: 600, transparent: true, decorations: false, center: true, skipTaskbar: true });
}
async function createOrShowClipboard() {
  await findOrCreateWindow("clipboard", { title: "剪贴板历史", width: 400, height: 500, transparent: true, decorations: false, center: true, skipTaskbar: true });
}
async function createOrShowAIChat() {
  await findOrCreateWindow("ai-chat", { title: "AI对话助手", width: 800, height: 600, transparent: true, decorations: false, resizable: true, minWidth: 600, minHeight: 500, center: true, skipTaskbar: true });
}
async function createOrShowTranslator() {
  await findOrCreateWindow("translator", { title: "有道翻译", width: 1000, height: 700, transparent: true, decorations: false, resizable: true, minWidth: 800, minHeight: 600, center: true, skipTaskbar: true });
}
async function createOrShowCalendar() {
  await findOrCreateWindow("calendar", { title: "智能日历", width: 800, height: 600, transparent: true, decorations: false, resizable: true, minWidth: 900, minHeight: 950, shadow: false, center: true, skipTaskbar: true });
}
async function createOrShowJira() {
  await findOrCreateWindow("jira", { title: "JIRA工作流助手", width: 1000, height: 600, visible: false, transparent: true, decorations: false, resizable: true, alwaysOnTop: false, center: true, skipTaskbar: true, shadow: false });
}
async function createOrShowFileSearch() {
  await findOrCreateWindow("file-search", { title: "文件搜索", width: 700, height: 550, visible: false, transparent: true, decorations: false, resizable: true, alwaysOnTop: false, center: true, skipTaskbar: true, shadow: false });
}
async function createOrShowJsonCompare() {
  await findOrCreateWindow("jira", { title: "JSON对比", width: 1000, height: 700, transparent: true, decorations: false, resizable: true, center: true, skipTaskbar: true });
}
async function createOrShowPomodoro() {
  await findOrCreateWindow("pomodoro-timer", { title: "番茄钟", width: 400, height: 500, transparent: true, decorations: false, center: true, skipTaskbar: true });
}
async function createOrShowMapDrawing() {
  await findOrCreateWindow("map-drawing", { title: "地图绘制", width: 1000, height: 700, transparent: true, decorations: false, resizable: true, center: true, skipTaskbar: true });
}
async function createOrShowNotepad() {
  await findOrCreateWindow("notepad", { title: "记事本", width: 1100, height: 750, transparent: true, decorations: false, resizable: true, center: true, skipTaskbar: true });
}

const minimizeToTray = async () => {
  try { await invoke("hide_to_tray"); }
  catch (error) { console.error("最小化到托盘失败:", error); }
};

const createSelectionMenu = async (payload: { text: string; x: number; y: number }) => {
  const windows = await getAllWindows();
  const existing = windows.find((w) => w.label === "selection-menu");
  if (existing) {
    try { await existing.close(); } catch (e) { console.warn("关闭旧菜单窗口失败:", e); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    const webview = new WebviewWindow("selection-menu", {
      url,
      title: "快速操作", width: 220, height: 210,
      x: Math.min(payload.x, window.screen.availWidth - 240),
      y: Math.min(payload.y, window.screen.availHeight - 230),
      visible: false, transparent: true, decorations: false,
      resizable: false, alwaysOnTop: true, skipTaskbar: true, focus: true,
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("菜单窗口创建超时")), 5000);
      webview.once("tauri://created", () => { clearTimeout(timeout); resolve(); });
      webview.once("tauri://error", (e) => { clearTimeout(timeout); reject(new Error(JSON.stringify(e))); });
    });
    await webview.show();
    await webview.setFocus();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await webview.emit("selection://show", payload);
  } catch (err) { console.error("创建选中文本快捷菜单失败:", err); }
};

const openMenuPanel = async () => {
  await findOrCreateWindow("menu-panel", {
    title: "功能菜单", width: 600, height: 600,
    visible: false, transparent: true, decorations: false,
    resizable: false, alwaysOnTop: false, center: true,
    skipTaskbar: true, focus: true, shadow: false,
  });
};

const handleBubbleClick = async (bubble: Bubble) => {
  const actionMap: Record<string, () => Promise<void>> = {
    "open-main": createOrShowMain,
    "open-clipboard": createOrShowClipboard,
    "open-ai": createOrShowAIChat,
    "translator": createOrShowTranslator,
    "calendar": createOrShowCalendar,
    "jira": createOrShowJira,
    "file-search": createOrShowFileSearch,
    "json-compare": createOrShowJsonCompare,
    "pomodoro-timer": createOrShowPomodoro,
    "map-drawing": createOrShowMapDrawing,
    "notepad": createOrShowNotepad,
    "close-pet": handleClosePet,
    "minimize-to-tray": minimizeToTray,
  };
  const action = actionMap[bubble.action];
  if (action) await action();
  else console.warn(`未知的气泡动作: ${bubble.action}`);
  showBubbles.value = false;
};

const handleClosePet = async () => {
  try { await getCurrentWindow().close(); }
  catch (error) { console.error("关闭桌宠失败:", error); }
};

const renderBubbles = () => {
  const radius = 120;
  const count = bubbles.length;
  return bubbles.map((bubble, i) => {
    const angle = (360 / count) * i - 90;
    const rad = (angle * Math.PI) / 180;
    const x = radius * Math.cos(rad);
    const y = radius * Math.sin(rad);
    return { ...bubble, x, y };
  });
};

const bubblePositions = renderBubbles();

onMounted(async () => {
  await setClickThrough(true);

  // Position at bottom right
  try {
    const appWindow = getCurrentWindow();
    const monitor = await currentMonitor();
    if (monitor) {
      const { width: screenWidth, height: screenHeight } = monitor.size;
      await appWindow.setPosition(new PhysicalPosition(
        Math.round(screenWidth - 75),
        Math.round(screenHeight - 80)
      ));
    }
  } catch (error) { console.error("定位桌宠窗口失败:", error); }

  // Register all event listeners
  const events: [string, () => void][] = [
    ["pet://wake-up", wakeUpPet],
    ["tray://open-clipboard", createOrShowClipboard],
    ["tray://open-system", createOrShowMain],
    ["tray://open-ai", createOrShowAIChat],
    ["tray://open-translator", createOrShowTranslator],
    ["tray://open-calendar", createOrShowCalendar],
    ["tray://open-jira", createOrShowJira],
    ["tray://open-file-search", createOrShowFileSearch],
  ];

  for (const [event, handler] of events) {
    const unlisten = await listen(event, handler);
    unlisteners.push(unlisten);
  }

  const unlistenSelection = await listen<{ text: string; x: number; y: number }>(
    "selection://popup",
    (event) => createSelectionMenu(event.payload)
  );
  unlisteners.push(unlistenSelection);
});

onUnmounted(() => {
  unlisteners.forEach((fn) => fn());
  unlisteners = [];
  if (doubleClickTimer !== null) clearTimeout(doubleClickTimer);
  if (sleepTimer !== null) clearTimeout(sleepTimer);
  if (hideTimer !== null) clearTimeout(hideTimer);
});
</script>

<template>
  <div
    :class="['pet-container', { sleeping: isSleeping }]"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <img
      :src="actions[index].src"
      :alt="actions[index].name"
      :class="['pet-image', { sleeping: isSleeping }]"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    />

    <button
      v-if="!isSleeping && !showBubbles"
      class="pet-close-button"
      @click="handleClosePet"
      title="关闭桌宠"
    >
      <div class="pet-close-icon"></div>
    </button>

    <div v-if="showBubbles && !isSleeping" class="bubbles">
      <div
        v-for="(bubble, i) in bubblePositions"
        :key="i"
        class="bubble"
        :style="{
          transform: `translate(${bubble.x}px, ${bubble.y}px)`,
          left: '50%',
          top: '50%',
          marginLeft: '-50px',
          marginTop: '-25px'
        }"
        @click="handleBubbleClick(bubble)"
      >
        <img src="/pet/bubble/bubble.png" class="bubble-bg" />
        <span class="bubble-text">{{ bubble.label }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pet-container {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  user-select: none;
  background: transparent;
  box-shadow: none !important;
  width: 180px;
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

.pet-image {
  width: 72px;
  height: 72px;
  object-fit: contain;
  pointer-events: auto;
  cursor: grab;
  position: relative;
  z-index: 1;
}

.pet-image:active {
  cursor: grabbing;
}

.bubbles {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  pointer-events: none;
}

.bubble {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: auto;
  width: 100px;
  height: 50px;
  animation: fadeIn 0.4s ease-out;
}

.bubble:nth-child(1) { animation-delay: 0ms; }
.bubble:nth-child(2) { animation-delay: 80ms; }
.bubble:nth-child(3) { animation-delay: 160ms; }
.bubble:nth-child(4) { animation-delay: 240ms; }
.bubble:nth-child(5) { animation-delay: 320ms; }

.bubble-bg {
  width: 100%;
  height: auto;
  object-fit: contain;
  transition: transform 0.2s ease;
}

.bubble-text {
  position: absolute;
  font-family: "Comic Sans MS", "幼圆", cursive;
  font-size: 12px;
  font-weight: bold;
  background: linear-gradient(45deg, #ff66cc, #66ccff, #ffcc66);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-align: center;
  max-width: 80px;
  word-break: break-all;
  transition: transform 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

.bubble:hover .bubble-bg { transform: scale(1.1); }
.bubble:hover .bubble-text { transform: scale(1.05); }

.pet-image.sleeping {
  opacity: 0.5;
  filter: grayscale(50%);
  transition: opacity 0.3s ease, filter 0.3s ease;
}

.pet-close-button {
  position: absolute;
  bottom: -40px;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 24px;
  border: none;
  background: rgba(231, 76, 60, 0.7);
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  backdrop-filter: blur(5px);
  opacity: 0;
  pointer-events: none;
  z-index: 10;
}

.pet-container:hover .pet-close-button {
  opacity: 1;
  pointer-events: auto;
}

.pet-close-button:hover {
  background: rgba(192, 57, 43, 0.9);
  transform: translateX(-50%) scale(1.1);
  box-shadow: 0 2px 8px rgba(231, 76, 60, 0.4);
}

.pet-close-icon {
  width: 12px;
  height: 12px;
  position: relative;
}

.pet-close-icon::before,
.pet-close-icon::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 10px;
  height: 2px;
  background: white;
  border-radius: 1px;
  transition: transform 0.2s ease;
}

.pet-close-icon::before {
  transform: translate(-50%, -50%) rotate(45deg);
}

.pet-close-icon::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.pet-close-button:hover .pet-close-icon::before,
.pet-close-button:hover .pet-close-icon::after {
  transform: translate(-50%, -50%) rotate(90deg);
}

.pet-container.sleeping .pet-close-button {
  display: none;
}
</style>
