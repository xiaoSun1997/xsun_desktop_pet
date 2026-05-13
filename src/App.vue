<script setup lang="ts">
import { ref, shallowRef, markRaw, onMounted, onUnmounted } from "vue";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";

import PetPage from "./pages/PetPage.vue";
import SystemInfoPage from "./pages/SystemInfoPage.vue";
import ClipboardPage from "./pages/ClipboardPage.vue";
import ExpandWindow from "./pages/ExpandWindow.vue";
import AIChatPage from "./pages/AIChatPage.vue";
import TranslatorPage from "./pages/TranslatorPage.vue";
import CalendarPage from "./pages/CalendarPage.vue";
import TodoWindow from "./pages/TodoWindow.vue";
import MenuPanel from "./pages/MenuPanel.vue";
import JsonComparePage from "./pages/JsonComparePage.vue";
import PomodoroTimerPage from "./pages/PomodoroTimerPage.vue";
import PomodoroNotification from "./pages/PomodoroNotification.vue";
import JiraPage from "./pages/JiraPage.vue";
import SelectionMenu from "./pages/SelectionMenu.vue";
import MapDrawingPage from "./pages/MapDrawingPage.vue";
import NotepadPage from "./pages/NotepadPage.vue";
import FileSearchPage from "./pages/FileSearchPage.vue";
import QuickFileSearch from "./pages/QuickFileSearch.vue";

const label = ref("");
const currentComponent = shallowRef<any>(null);

const componentMap: Record<string, any> = {
  pet: markRaw(PetPage),
  main: markRaw(SystemInfoPage),
  clipboard: markRaw(ClipboardPage),
  "ai-chat": markRaw(AIChatPage),
  translator: markRaw(TranslatorPage),
  calendar: markRaw(CalendarPage),
  "menu-panel": markRaw(MenuPanel),
  "json-compare": markRaw(JsonComparePage),
  "pomodoro-timer": markRaw(PomodoroTimerPage),
  "pomodoro-notification": markRaw(PomodoroNotification),
  jira: markRaw(JiraPage),
  "selection-menu": markRaw(SelectionMenu),
  "map-drawing": markRaw(MapDrawingPage),
  notepad: markRaw(NotepadPage),
  "file-search": markRaw(FileSearchPage),
  "quick-file-search": markRaw(QuickFileSearch),
};

const notepadOpeningRef = { current: false };
const fileSearchOpeningRef = { current: false };
const menuPanelOpeningRef = { current: false };

onMounted(async () => {
  const win = getCurrentWindow();
  label.value = win.label;

  // Set component based on window label
  if (label.value.startsWith("expand_")) {
    currentComponent.value = markRaw(ExpandWindow);
  } else if (label.value.startsWith("todo_")) {
    currentComponent.value = markRaw(TodoWindow);
  } else if (label.value.startsWith("json-format-")) {
    currentComponent.value = markRaw(JsonComparePage);
  } else if (componentMap[label.value]) {
    currentComponent.value = componentMap[label.value];
  }

  // Register keyboard shortcuts only for pet window
  if (label.value === "pet") {
    const unlistenCtrlAltN = await listen("keyboard://ctrl-alt-n", () => {
      if (!notepadOpeningRef.current) openNotepadWindow();
    });
    const unlistenAltS = await listen("keyboard://alt-s", () => {
      console.log("[App] Received Alt+S event");
      if (!fileSearchOpeningRef.current) openQuickFileSearchWindow();
    });
    const unlistenCtrlTab = await listen("keyboard://ctrl-tab", () => {
      if (!menuPanelOpeningRef.current) openMenuPanelWindow();
    });

    onUnmounted(() => {
      unlistenCtrlAltN();
      unlistenAltS();
      unlistenCtrlTab();
    });
  }
});

async function openQuickFileSearchWindow() {
  if (fileSearchOpeningRef.current) {
    console.log("[QuickSearch] Opening in progress, skip");
    return;
  }
  fileSearchOpeningRef.current = true;

  const guardTimeout = setTimeout(() => {
    if (fileSearchOpeningRef.current) {
      console.warn("[QuickSearch] Guard timeout, force reset");
      fileSearchOpeningRef.current = false;
    }
  }, 15000);

  try {
    const windows = await getAllWindows();
    const existing = windows.find((w) => w.label === "quick-file-search");

    if (existing) {
      try {
        await existing.show();
        await existing.setFocus();
        return;
      } catch (showErr) {
        console.warn("[QuickSearch] Existing window show failed, try recreate:", showErr);
        try {
          await existing.close();
        } catch (closeErr) {
          console.warn("[QuickSearch] Close zombie window failed:", closeErr);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

    const webview = new WebviewWindow("quick-file-search", {
      url,
      title: "Quick Search",
      width: 680,
      height: 460,
      center: true,
      resizable: false,
      skipTaskbar: true,
      transparent: true,
      decorations: false,
      shadow: false,
      focus: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Waiting for quick-file-search window creation timeout"));
      }, 8000);
      webview.once("tauri://created", () => {
        clearTimeout(timeout);
        resolve();
      });
      webview.once("tauri://error", (e) => {
        clearTimeout(timeout);
        reject(new Error(`Create quick-file-search error: ${JSON.stringify(e)}`));
      });
    });

    await webview.show();
    await webview.setFocus();
  } catch (error) {
    console.error("[QuickSearch] Open failed:", error);
  } finally {
    clearTimeout(guardTimeout);
    fileSearchOpeningRef.current = false;
  }
}

async function openMenuPanelWindow() {
  if (menuPanelOpeningRef.current) return;
  menuPanelOpeningRef.current = true;
  try {
    const windows = await getAllWindows();
    const existing = windows.find((w) => w.label === "menu-panel");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      return;
    }

    const url = import.meta.env.DEV ? "http://localhost:1420/menu" : "menu.html";

    const webview = new WebviewWindow("menu-panel", {
      url,
      title: "Menu",
      width: 600,
      height: 600,
      visible: false,
      transparent: true,
      decorations: false,
      resizable: false,
      alwaysOnTop: false,
      center: true,
      skipTaskbar: true,
      focus: true,
      shadow: false,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Waiting for menu panel creation timeout"));
      }, 5000);
      webview.once("tauri://created", () => {
        clearTimeout(timeout);
        resolve();
      });
      webview.once("tauri://error", (e) => {
        clearTimeout(timeout);
        reject(new Error(`Create menu panel error: ${JSON.stringify(e)}`));
      });
    });

    await webview.show();
    await webview.setFocus();
  } catch (error) {
    console.error("Open menu panel failed:", error);
  } finally {
    menuPanelOpeningRef.current = false;
  }
}

async function openNotepadWindow() {
  if (notepadOpeningRef.current) {
    console.log("[Notepad] Opening in progress, skip");
    return;
  }
  notepadOpeningRef.current = true;

  const guardTimeout = setTimeout(() => {
    if (notepadOpeningRef.current) {
      console.warn("[Notepad] Guard timeout, force reset");
      notepadOpeningRef.current = false;
    }
  }, 15000);

  try {
    const windows = await getAllWindows();
    const existing = windows.find((w) => w.label === "notepad");

    if (existing) {
      try {
        await existing.show();
        await existing.setFocus();
        return;
      } catch (showErr) {
        console.warn("[Notepad] Existing window show failed, try recreate:", showErr);
        try {
          await existing.close();
        } catch (closeErr) {
          console.warn("[Notepad] Close zombie window failed:", closeErr);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const url = import.meta.env.DEV ? "http://localhost:1420" : "index.html";

    const webview = new WebviewWindow("notepad", {
      url,
      title: "Notepad",
      width: 1100,
      height: 750,
      center: true,
      resizable: true,
      skipTaskbar: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Waiting for notepad window creation timeout"));
      }, 5000);
      webview.once("tauri://created", () => {
        clearTimeout(timeout);
        resolve();
      });
      webview.once("tauri://error", (e) => {
        clearTimeout(timeout);
        reject(new Error(`Create notepad error: ${JSON.stringify(e)}`));
      });
    });

    await webview.show();
    await webview.setFocus();
  } catch (error) {
    console.error("[Notepad] Open failed:", error);
  } finally {
    clearTimeout(guardTimeout);
    notepadOpeningRef.current = false;
  }
}
</script>

<template>
  <component :is="currentComponent" />
</template>
