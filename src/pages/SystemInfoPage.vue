<script setup lang="ts">
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface SystemInfo {
  cpu_usage: number;
  total_memory: number;
  used_memory: number;
  total_swap: number;
  used_swap: number;
  uptime: number;
  os_name: string;
  os_version: string;
  host_name: string;
  total_processes: number;
  cpu_cores: number;
  cpu_name: string;
}

interface ProcessInfo {
  pid: number;
  name: string;
  cpu_usage: number;
  memory: number;
  exe_path: string;
  ports: number[];
}

const processIconMap: Record<string, string> = {
  chrome: "C", msedge: "C", firefox: "F", code: "V", cursor: "V",
  powershell: "P", pwsh: "P", cmd: "C", notepad: "N",
  winword: "W", excel: "E", discord: "D", wechat: "W",
  spotify: "S", vscode: "V", steam: "S", calculator: "C",
  node: "N", python: "P", java: "J", rust: "R",
};

const info = ref<SystemInfo | null>(null);
const cpuProcesses = ref<ProcessInfo[]>([]);
const memProcesses = ref<ProcessInfo[]>([]);
const showCpuProcesses = ref(false);
const showMemProcesses = ref(false);
const loadingProcesses = ref({ cpu: false, mem: false });

onMounted(() => {
  invoke<SystemInfo>("get_system_info").then(setInfo);

  listen<SystemInfo>("system://stats", (event) => {
    info.value = event.payload;
  });
});

const setInfo = (data: SystemInfo) => { info.value = data; };

const formatBytes = (bytes: number): string => (bytes / 1024 / 1024 / 1024).toFixed(1);

const formatBytesFull = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
  return bytes + " B";
};

const getMemoryPercentage = (): number => {
  if (!info.value || info.value.total_memory === 0) return 0;
  return (info.value.used_memory / info.value.total_memory) * 100;
};

const getSwapPercentage = (): number => {
  if (!info.value || info.value.total_swap === 0) return 0;
  return (info.value.used_swap / info.value.total_swap) * 100;
};

const formatMemoryValue = (used: number, total: number): string =>
  `${formatBytes(used)}/${formatBytes(total)}GB`;

const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}min`;
};

const getProcessIcon = (name: string, exePath: string): string => {
  const key = name.toLowerCase().replace(/\.exe$/, "").replace(/[^a-z0-9]/g, "");
  const exeName = exePath.split("\\").pop()?.toLowerCase().replace(".exe", "") || "";
  return processIconMap[key] || processIconMap[exeName] || "?";
};

const loadCpuProcesses = async () => {
  if (cpuProcesses.value.length > 0) { showCpuProcesses.value = !showCpuProcesses.value; return; }
  loadingProcesses.value = { ...loadingProcesses.value, cpu: true };
  try {
    cpuProcesses.value = await invoke<ProcessInfo[]>("get_processes", { sortBy: "cpu" });
    showCpuProcesses.value = true;
  } catch (e) { console.error("Load CPU processes failed:", e); }
  finally { loadingProcesses.value = { ...loadingProcesses.value, cpu: false }; }
};

const loadMemProcesses = async () => {
  if (memProcesses.value.length > 0) { showMemProcesses.value = !showMemProcesses.value; return; }
  loadingProcesses.value = { ...loadingProcesses.value, mem: true };
  try {
    memProcesses.value = await invoke<ProcessInfo[]>("get_processes", { sortBy: "memory" });
    showMemProcesses.value = true;
  } catch (e) { console.error("Load memory processes failed:", e); }
  finally { loadingProcesses.value = { ...loadingProcesses.value, mem: false }; }
};

const handleKillProcess = async (pid: number) => {
  try {
    await invoke("kill_process", { pid });
    cpuProcesses.value = cpuProcesses.value.filter((p: ProcessInfo) => p.pid !== pid);
    memProcesses.value = memProcesses.value.filter((p: ProcessInfo) => p.pid !== pid);
  } catch (e) {
    console.error("Kill process failed:", e);
    alert(`Kill process failed: ${e}`);
  }
};

const handleClose = async () => {
  try { await getCurrentWindow().close(); }
  catch (error) { console.error("Close window failed:", error); }
};
</script>

<template>
  <div class="system-info-container">
    <div class="system-info-header">
      <h1 class="system-info-title">System Monitor</h1>
      <div class="system-info-badge">Live</div>
    </div>

    <template v-if="info">
      <div class="metrics-container">
        <div class="metric-section">
          <div class="section-title">Overview</div>
          <div class="overview-grid">
            <div class="overview-item"><span class="overview-label">Host</span><span class="overview-value">{{ info.host_name }}</span></div>
            <div class="overview-item"><span class="overview-label">OS</span><span class="overview-value">{{ info.os_name }} {{ info.os_version }}</span></div>
            <div class="overview-item"><span class="overview-label">CPU</span><span class="overview-value">{{ info.cpu_name }} ({{ info.cpu_cores }} cores)</span></div>
            <div class="overview-item"><span class="overview-label">Uptime</span><span class="overview-value">{{ formatUptime(info.uptime) }}</span></div>
            <div class="overview-item"><span class="overview-label">Processes</span><span class="overview-value">{{ info.total_processes }}</span></div>
          </div>
        </div>

        <div :class="['metric-item', 'expandable', { expanded: showCpuProcesses }]" @click="loadCpuProcesses">
          <div class="metric-header">
            <div class="metric-header-left">
              <span :class="['expand-icon', { rotated: showCpuProcesses }]">> </span>
              <span class="metric-label">CPU</span>
            </div>
            <span class="metric-value">{{ info.cpu_usage.toFixed(1) }}%</span>
          </div>
          <div class="progress-container">
            <div class="progress-bar cpu-progress" :style="{ width: `${Math.min(info.cpu_usage, 100)}%` }"></div>
          </div>
          <div v-if="loadingProcesses.cpu" class="process-loading">Loading...</div>
          <div v-if="showCpuProcesses && cpuProcesses.length > 0" class="process-list" @click.stop>
            <div v-for="p in cpuProcesses" :key="p.pid" class="process-item">
              <div class="process-info">
                <div class="process-name" :title="p.exe_path">
                  <span class="process-default-icon">{{ getProcessIcon(p.name, p.exe_path) }}</span>
                  {{ p.name }}
                </div>
                <div class="process-meta">
                  <span class="process-pid">PID:{{ p.pid }}</span>
                  <span class="process-cpu">CPU:{{ p.cpu_usage.toFixed(1) }}%</span>
                  <span v-if="p.ports.length > 0" class="process-ports">
                    P:{{ p.ports.slice(0, 3).join(",") }}{{ p.ports.length > 3 ? "..." : "" }}
                  </span>
                </div>
              </div>
              <button class="kill-button" @click.stop="handleKillProcess(p.pid)" title="Kill process">X</button>
            </div>
          </div>
        </div>

        <div :class="['metric-item', 'expandable', { expanded: showMemProcesses }]" @click="loadMemProcesses">
          <div class="metric-header">
            <div class="metric-header-left">
              <span :class="['expand-icon', { rotated: showMemProcesses }]">> </span>
              <span class="metric-label">Memory</span>
            </div>
            <span class="metric-value">{{ formatMemoryValue(info.used_memory, info.total_memory) }}</span>
          </div>
          <div class="progress-container">
            <div class="progress-bar memory-progress" :style="{ width: `${getMemoryPercentage()}%` }"></div>
          </div>
          <div v-if="loadingProcesses.mem" class="process-loading">Loading...</div>
          <div v-if="showMemProcesses && memProcesses.length > 0" class="process-list" @click.stop>
            <div v-for="p in memProcesses" :key="p.pid" class="process-item">
              <div class="process-info">
                <div class="process-name" :title="p.exe_path">
                  <span class="process-default-icon">{{ getProcessIcon(p.name, p.exe_path) }}</span>
                  {{ p.name }}
                </div>
                <div class="process-meta">
                  <span class="process-pid">PID:{{ p.pid }}</span>
                  <span class="process-mem">MEM:{{ formatBytesFull(p.memory) }}</span>
                  <span v-if="p.ports.length > 0" class="process-ports">
                    P:{{ p.ports.slice(0, 3).join(",") }}{{ p.ports.length > 3 ? "..." : "" }}
                  </span>
                </div>
              </div>
              <button class="kill-button" @click.stop="handleKillProcess(p.pid)" title="Kill process">X</button>
            </div>
          </div>
        </div>

        <div class="metric-item">
          <div class="metric-header">
            <span class="metric-label">Memory Rate</span>
            <span class="metric-value">{{ getMemoryPercentage().toFixed(1) }}%</span>
          </div>
          <div class="progress-container">
            <div class="progress-bar" :style="{ width: `${getMemoryPercentage()}%`, background: getMemoryPercentage() > 80 ? 'linear-gradient(90deg, #f59e0b, #d97706)' : 'linear-gradient(90deg, #8b5cf6, #7c3aed)' }"></div>
          </div>
        </div>

        <div class="metric-item">
          <div class="metric-header">
            <span class="metric-label">Available</span>
            <span class="metric-value">{{ formatBytes(info.total_memory - info.used_memory) }}GB</span>
          </div>
          <div class="progress-container">
            <div class="progress-bar" :style="{ width: `${100 - getMemoryPercentage()}%`, background: 'linear-gradient(90deg, #10b981, #059669)' }"></div>
          </div>
        </div>

        <div v-if="info.total_swap > 0" class="metric-item">
          <div class="metric-header">
            <span class="metric-label">Swap</span>
            <span class="metric-value">{{ formatMemoryValue(info.used_swap, info.total_swap) }}</span>
          </div>
          <div class="progress-container">
            <div class="progress-bar" :style="{ width: `${getSwapPercentage()}%`, background: 'linear-gradient(90deg, #f472b6, #ec4899)' }"></div>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="loading-container">
      <div class="loading-spinner"></div>
      <p class="loading-text">Loading...</p>
    </div>

    <div class="close-button-container">
      <button class="close-button" @click="handleClose" title="Close"><div class="close-icon"></div></button>
    </div>
  </div>
</template>

<style scoped>
.system-info-container { background: #1a1a2e; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
.system-info-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: #16213e; border-bottom: 1px solid rgba(255,255,255,0.08); }
.system-info-title { font-size: 18px; font-weight: 700; margin: 0; color: #fff; }
.system-info-badge { font-size: 10px; padding: 2px 8px; background: #27ae60; border-radius: 10px; color: #fff; }
.metrics-container { flex: 1; overflow-y: auto; padding: 12px 16px; }
.metric-section { margin-bottom: 16px; }
.section-title { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.5); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; }
.overview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.overview-item { padding: 8px 10px; background: rgba(255,255,255,0.05); border-radius: 8px; }
.overview-label { display: block; font-size: 10px; color: rgba(255,255,255,0.4); margin-bottom: 2px; }
.overview-value { font-size: 12px; color: #fff; font-weight: 500; }
.metric-item { padding: 10px 12px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 8px; }
.metric-item.expandable { cursor: pointer; }
.metric-item.expandable:hover { background: rgba(255,255,255,0.08); }
.metric-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.metric-header-left { display: flex; align-items: center; gap: 6px; }
.expand-icon { font-size: 10px; color: rgba(255,255,255,0.4); transition: transform 0.15s; }
.expand-icon.rotated { transform: rotate(90deg); }
.metric-label { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.8); }
.metric-value { font-size: 13px; font-weight: 600; color: #fff; }
.progress-container { height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
.progress-bar { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
.cpu-progress { background: linear-gradient(90deg, #e94560, #c0392b); }
.memory-progress { background: linear-gradient(90deg, #3498db, #2980b9); }
.process-loading { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 8px; }
.process-list { margin-top: 8px; }
.process-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 2px; }
.process-info { flex: 1; min-width: 0; }
.process-name { font-size: 12px; color: #e0e0e0; display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.process-default-icon { width: 16px; text-align: center; font-size: 12px; }
.process-meta { display: flex; gap: 10px; font-size: 10px; color: rgba(255,255,255,0.4); margin-top: 2px; }
.kill-button { background: rgba(233,69,96,0.2); border: none; color: #e94560; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer; }
.loading-container { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.loading-spinner { width: 24px; height: 24px; border: 2px solid rgba(255,255,255,0.1); border-top-color: #e94560; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 13px; color: rgba(255,255,255,0.5); margin-top: 8px; }
.close-button-container { padding: 8px 16px; background: #16213e; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: flex-end; }
.close-button { background: rgba(255,255,255,0.1); border: none; border-radius: 6px; padding: 6px 12px; color: rgba(255,255,255,0.6); cursor: pointer; }
.close-icon { width: 12px; height: 12px; }
</style>
