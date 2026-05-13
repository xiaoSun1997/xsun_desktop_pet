<script setup lang="ts">
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TimerState {
  isRunning: boolean;
  isWorkTime: boolean;
  timeRemaining: number;
  totalTime: number;
  workDuration: number;
  breakDuration: number;
  sessionsCompleted: number;
}

const state = ref<TimerState>({
  isRunning: false,
  isWorkTime: true,
  timeRemaining: 25 * 60,
  totalTime: 25 * 60,
  workDuration: 25,
  breakDuration: 5,
  sessionsCompleted: 0,
});

const showSettings = ref(false);
const tempWorkDuration = ref(25);
const tempBreakDuration = ref(5);

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

const progress = (): number => {
  if (state.value.totalTime === 0) return 0;
  return ((state.value.totalTime - state.value.timeRemaining) / state.value.totalTime) * 100;
};

const toggleTimer = () => {
  state.value.isRunning = !state.value.isRunning;
  if (state.value.isRunning) {
    invoke("start_pomodoro", { workDuration: state.value.workDuration, breakDuration: state.value.breakDuration });
  } else {
    invoke("pause_pomodoro");
  }
};

const currentPhase = (): string => state.value.isWorkTime ? "Focus" : "Break";
</script>

<template>
  <div class="pomodoro-container">
    <div class="pomodoro-header" data-tauri-drag-region>
      <h1 class="pomodoro-title">Pomodoro Timer</h1>
      <button class="settings-btn" @click="showSettings = true">Settings</button>
    </div>

    <div class="pomodoro-content">
      <div class="timer-display">
        <div class="timer-phase">{{ currentPhase() }}</div>
        <div class="timer-time">{{ formatTime(state.timeRemaining) }}</div>
        <div class="timer-progress-bar">
          <div class="timer-progress-fill" :style="{ width: `${progress()}%` }"></div>
        </div>
        <div class="timer-info">
          <span>{{ state.isWorkTime ? state.workDuration : state.breakDuration }} min</span>
          <span>Sessions: {{ state.sessionsCompleted }}</span>
        </div>
        <button class="timer-toggle-btn" @click="toggleTimer">
          {{ state.isRunning ? "Pause" : "Start" }}
        </button>
      </div>
    </div>

    <div class="pomodoro-footer">
      <button class="close-btn" @click="getCurrentWindow().close()">Close</button>
    </div>

    <div v-if="showSettings" class="settings-overlay" @click.self="showSettings = false">
      <div class="settings-modal">
        <h3>Timer Settings</h3>
        <div class="setting-item">
          <label>Focus Duration (min):</label>
          <input type="number" v-model.number="tempWorkDuration" min="1" max="120" />
        </div>
        <div class="setting-item">
          <label>Break Duration (min):</label>
          <input type="number" v-model.number="tempBreakDuration" min="1" max="60" />
        </div>
        <div class="settings-actions">
          <button @click="showSettings = false">Cancel</button>
          <button @click="state.workDuration = tempWorkDuration; state.breakDuration = tempBreakDuration; state.timeRemaining = state.isWorkTime ? tempWorkDuration * 60 : tempBreakDuration * 60; state.totalTime = state.timeRemaining; showSettings = false">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pomodoro-container { display: flex; flex-direction: column; height: 100vh; background: #1a1a2e; color: #e0e0e0; }
.pomodoro-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #16213e; border-bottom: 1px solid rgba(255,255,255,0.08); cursor: grab; }
.pomodoro-title { font-size: 16px; font-weight: 600; margin: 0; color: #fff; }
.settings-btn { background: rgba(255,255,255,0.08); border: none; border-radius: 6px; padding: 4px 10px; color: rgba(255,255,255,0.6); font-size: 11px; cursor: pointer; }
.pomodoro-content { flex: 1; display: flex; align-items: center; justify-content: center; padding: 16px; }
.timer-display { text-align: center; }
.timer-phase { font-size: 14px; color: rgba(255,255,255,0.5); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 2px; }
.timer-time { font-size: 72px; font-weight: 700; color: #fff; font-family: monospace; line-height: 1; margin-bottom: 16px; }
.timer-progress-bar { width: 280px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; margin: 0 auto 12px; }
.timer-progress-fill { height: 100%; background: linear-gradient(90deg, #e94560, #c0392b); border-radius: 3px; transition: width 0.5s; }
.timer-info { display: flex; justify-content: center; gap: 16px; font-size: 12px; color: rgba(255,255,255,0.4); margin-bottom: 16px; }
.timer-toggle-btn { padding: 12px 48px; border: none; border-radius: 50px; background: #e94560; color: #fff; font-size: 16px; cursor: pointer; transition: background 0.15s; }
.timer-toggle-btn:hover { background: #c0392b; }
.pomodoro-footer { padding: 8px 16px; background: #16213e; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: flex-end; }
.close-btn { background: rgba(255,255,255,0.08); border: none; border-radius: 6px; padding: 4px 12px; color: rgba(255,255,255,0.5); font-size: 11px; cursor: pointer; }
.settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }
.settings-modal { background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; width: 300px; }
.settings-modal h3 { margin: 0 0 16px; color: #fff; font-size: 15px; }
.setting-item { margin-bottom: 12px; }
.setting-item label { display: block; font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 4px; }
.setting-item input { width: 100%; background: #0f0f23; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #e0e0e0; padding: 8px; font-size: 13px; box-sizing: border-box; }
.settings-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; }
.settings-actions button { padding: 6px 16px; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; }
.settings-actions button:first-child { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); }
.settings-actions button:last-child { background: #e94560; color: #fff; }
</style>
