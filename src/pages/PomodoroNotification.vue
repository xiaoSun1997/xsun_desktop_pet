<script setup lang="ts">
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface NotificationData {
  message: string;
  isWorkTime: boolean;
}

const data = ref<NotificationData>({ message: "", isWorkTime: true });

onMounted(() => {
  const params = new URLSearchParams(window.location.hash.split("?")[1]);
  const message = params.get("message") || "";
  const isWorkTime = params.get("isWorkTime") === "true";
  data.value = { message, isWorkTime };

  let unlistenFn: (() => void) | undefined;
  listen<NotificationData>("pomodoro-update", (event) => {
    data.value = event.payload;
  }).then((fn) => {
    unlistenFn = fn;
  });

  return () => {
    if (unlistenFn) unlistenFn();
  };
});

const handleContinue = async () => {
  try {
    await invoke("close_pomodoro_notification");
  } catch (error) {
    console.error("Close notification failed:", error);
  }
};
</script>

<template>
  <div :class="['notification-container', { 'work-time': data.isWorkTime, 'break-time': !data.isWorkTime }]">
    <div class="notification-content">
      <div class="notification-icon">{{ data.isWorkTime ? "☕" : "🎯" }}</div>
      <div class="notification-message">{{ data.message }}</div>
      <button class="notification-button" @click="handleContinue">Got it</button>
    </div>
  </div>
</template>

<style scoped>
.notification-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: transparent;
}
.notification-container.work-time { background: rgba(233, 69, 96, 0.9); }
.notification-container.break-time { background: rgba(39, 174, 96, 0.9); }
.notification-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px;
  color: #fff;
}
.notification-icon { font-size: 48px; }
.notification-message { font-size: 18px; font-weight: 500; text-align: center; }
.notification-button {
  padding: 8px 24px;
  border: none;
  border-radius: 8px;
  background: rgba(255,255,255,0.2);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.notification-button:hover { background: rgba(255,255,255,0.3); }
</style>
