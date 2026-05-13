<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { save } from "@tauri-apps/plugin-dialog";

interface SubPoint { id: string; x: number; y: number; z: number; }
interface ExpansionPoint { id: string; x: number; y: number; z: number; }
interface Shape {
  id: string; type: "outerBorder" | "shelf";
  lineColor: string; expanded: boolean; visible: boolean;
  subPoints: SubPoint[]; expansionPoints: ExpansionPoint[];
}

let shapeIdC = 0, subPtIdC = 0, expPtIdC = 0;
const genShapeId = () => `sh_${++shapeIdC}_${Date.now()}`;
const genSubPointId = () => `sp_${++subPtIdC}_${Date.now()}`;
const genExpPointId = () => `ep_${++expPtIdC}_${Date.now()}`;
const calibrateZ = (z: number) => z > 1000 ? (z - 1500) % 180 : z;
const calcCenter = (sps: SubPoint[]) => {
  if (!sps.length) return { cx: 0, cy: 0 };
  const xs = sps.map((s: SubPoint) => s.x), ys = sps.map((s: SubPoint) => s.y);
  return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
};
const PIXEL_TO_METER = 0.05;
const calcDistance = (p1: SubPoint, p2: SubPoint) => {
  const d = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) * PIXEL_TO_METER;
  return Math.round(d * 100) / 100;
};

const shapes = ref<Shape[]>([]);
const showPasteInput = ref(false);
const pasteText = ref("");
const pasteType = ref<"outerBorder" | "shelf">("outerBorder");
const pasteError = ref("");
const selectedShapeId = ref<string | null>(null);
const selectedSubPointId = ref<string | null>(null);
const selectedExpPointId = ref<string | null>(null);
const savedMaps = ref<string[]>([]);
const currentMapName = ref("");
const selectedMapName = ref("");
const saveMessage = ref("");
const isFullscreen = ref(false);
const exportResult = ref<{ path: string; label: string } | null>(null);
const pan = ref({ x: 0, y: 0 });
const scale = ref(1);
const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0 });
const panStartPos = ref({ x: 0, y: 0 });
const svgRef = ref<SVGSVGElement | null>(null);

const totalSubPoints = computed(() =>
  shapes.value.reduce((s: number, sh: Shape) => s + sh.subPoints.length, 0)
);

const handleClose = async () => { try { await getCurrentWindow().close(); } catch { /* */ } };
const showIdx = (i: number) => String(i + 1);

const handleAddShape = () => {
  const sp: SubPoint = { id: genSubPointId(), x: 0, y: 0, z: 0 };
  const ns: Shape = { id: genShapeId(), type: "outerBorder", lineColor: "#6366f1", expanded: true, visible: true, subPoints: [sp], expansionPoints: [] };
  shapes.value.push(ns);
  selectedShapeId.value = ns.id;
  selectedSubPointId.value = null;
  selectedExpPointId.value = null;
};

const handleDeleteShape = (id: string) => {
  shapes.value = shapes.value.filter((s: Shape) => s.id !== id);
  if (selectedShapeId.value === id) { selectedShapeId.value = null; selectedSubPointId.value = null; selectedExpPointId.value = null; }
};

const updateShape = (id: string, updater: Partial<Shape>) => {
  const s = shapes.value.find((s: Shape) => s.id === id);
  if (s) Object.assign(s, updater);
};

const toggleExpand = (id: string) => { const s = shapes.value.find((s: Shape) => s.id === id); if (s) s.expanded = !s.expanded; };
const toggleVisible = (id: string) => { const s = shapes.value.find((s: Shape) => s.id === id); if (s) s.visible = !s.visible; };

const handleAddSubPoint = (shapeId: string) => {
  const s = shapes.value.find((s: Shape) => s.id === shapeId);
  if (s) s.subPoints.push({ id: genSubPointId(), x: 0, y: 0, z: 0 });
};

const updateSubPoint = (shapeId: string, spId: string, updater: Partial<SubPoint>) => {
  const s = shapes.value.find((s: Shape) => s.id === shapeId);
  const sp = s?.subPoints.find((p: SubPoint) => p.id === spId);
  if (sp) Object.assign(sp, updater);
};

const handleDeleteSubPoint = (shapeId: string, spId: string) => {
  const s = shapes.value.find((s: Shape) => s.id === shapeId);
  if (s) { s.subPoints = s.subPoints.filter((p: SubPoint) => p.id !== spId); }
  if (selectedSubPointId.value === spId) selectedSubPointId.value = null;
};

const handleAddExpPoint = (shapeId: string) => {
  const s = shapes.value.find((s: Shape) => s.id === shapeId);
  if (s) s.expansionPoints.push({ id: genExpPointId(), x: 0, y: 0, z: 0 });
};

const updateExpPoint = (shapeId: string, epId: string, updater: Partial<ExpansionPoint>) => {
  const s = shapes.value.find((s: Shape) => s.id === shapeId);
  const ep = s?.expansionPoints.find((p: ExpansionPoint) => p.id === epId);
  if (ep) Object.assign(ep, updater);
};

const handleDeleteExpPoint = (shapeId: string, epId: string) => {
  const s = shapes.value.find((s: Shape) => s.id === shapeId);
  if (s) { s.expansionPoints = s.expansionPoints.filter((p: ExpansionPoint) => p.id !== epId); }
  if (selectedExpPointId.value === epId) selectedExpPointId.value = null;
};

const handleClearAll = () => {
  shapes.value = []; pan.value = { x: 0, y: 0 }; scale.value = 1;
  selectedShapeId.value = null; selectedSubPointId.value = null; selectedExpPointId.value = null;
};

const focusOnPoint = (px: number, py: number) => {
  const el = svgRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  pan.value = { x: rect.width / 2 - px * scale.value, y: rect.height / 2 - py * scale.value };
};

const handleSelectShape = (shapeId: string) => {
  selectedShapeId.value = shapeId; selectedSubPointId.value = null; selectedExpPointId.value = null;
  const shape = shapes.value.find((s: Shape) => s.id === shapeId);
  if (shape && shape.subPoints.length > 0) { const { cx, cy } = calcCenter(shape.subPoints); focusOnPoint(cx, cy); }
};

const handleSelectSubPoint = (shapeId: string, spId: string) => {
  selectedShapeId.value = shapeId; selectedSubPointId.value = spId; selectedExpPointId.value = null;
  const shape = shapes.value.find((s: Shape) => s.id === shapeId);
  const sp = shape?.subPoints.find((p: SubPoint) => p.id === spId);
  if (sp) focusOnPoint(sp.x, sp.y);
};

const handleSelectExpPoint = (shapeId: string, epId: string) => {
  selectedShapeId.value = shapeId; selectedSubPointId.value = null; selectedExpPointId.value = epId;
  const shape = shapes.value.find((s: Shape) => s.id === shapeId);
  const ep = shape?.expansionPoints.find((p: ExpansionPoint) => p.id === epId);
  if (ep) focusOnPoint(ep.x, ep.y);
};

const handleCanvasBgClick = () => { selectedShapeId.value = null; selectedSubPointId.value = null; selectedExpPointId.value = null; };

const handleParsePastedData = () => {
  pasteError.value = "";
  const trimmed = pasteText.value.trim();
  if (!trimmed) { pasteError.value = "请先粘贴坐标数据"; return; }
  let parsed: any;
  try { parsed = JSON.parse(trimmed); } catch { pasteError.value = "JSON 格式无效"; return; }
  if (!Array.isArray(parsed)) { pasteError.value = "数据必须是数组格式"; return; }
  if (parsed.length === 0) { pasteError.value = "数组为空"; return; }
  const isMultiArray = Array.isArray(parsed[0]);
  const arraysToParse: any[][] = isMultiArray ? parsed : [parsed];
  const newShapes: Shape[] = [];
  for (let ai = 0; ai < arraysToParse.length; ai++) {
    const arr = arraysToParse[ai];
    if (!Array.isArray(arr)) { pasteError.value = `第 ${ai + 1} 组数据不是数组格式`; return; }
    if (arr.length === 0) { pasteError.value = `第 ${ai + 1} 组数据为空`; return; }
    const sps: SubPoint[] = [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (typeof item.x !== "number" || typeof item.y !== "number") { pasteError.value = `第 ${ai + 1} 组第 ${i + 1} 项缺少有效的 x 或 y`; return; }
      sps.push({ id: genSubPointId(), x: item.x, y: item.y, z: typeof item.z === "number" ? item.z : 0 });
    }
    newShapes.push({ id: genShapeId(), type: pasteType.value, lineColor: pasteType.value === "shelf" ? "#f59e0b" : "#6366f1", expanded: true, visible: true, subPoints: sps, expansionPoints: [] });
  }
  shapes.value.push(...newShapes);
  pasteText.value = ""; showPasteInput.value = false; pasteError.value = "";
  const lastShape = newShapes[newShapes.length - 1];
  selectedShapeId.value = lastShape.id; selectedSubPointId.value = null; selectedExpPointId.value = null;
  if (lastShape.subPoints.length > 0) { const { cx, cy } = calcCenter(lastShape.subPoints); focusOnPoint(cx, cy); }
};

const onCanvasMouseDown = (e: MouseEvent) => {
  if (e.button !== 0) return;
  isPanning.value = true;
  panStart.value = { x: e.clientX, y: e.clientY };
  panStartPos.value = { x: pan.value.x, y: pan.value.y };
};

const onCanvasMouseMove = (e: MouseEvent) => {
  if (!isPanning.value) return;
  pan.value = { x: panStartPos.value.x + e.clientX - panStart.value.x, y: panStartPos.value.y + e.clientY - panStart.value.y };
};

const onCanvasMouseUp = () => { isPanning.value = false; };

const onCanvasWheel = (e: WheelEvent) => {
  e.preventDefault();
  scale.value = Math.max(0.1, Math.min(10, scale.value * (e.deltaY > 0 ? 0.9 : 1.1)));
};

const handleResetView = () => { pan.value = { x: 0, y: 0 }; scale.value = 1; };

const handleToggleFullscreen = async () => {
  try {
    const win = getCurrentWindow();
    const fs = await win.isFullscreen();
    await win.setFullscreen(!fs);
    isFullscreen.value = !fs;
  } catch { /* */ }
};

const loadSavedMaps = async () => {
  try { savedMaps.value = await invoke("list_map_names") as string[]; } catch { /* */ }
};

const handleSelectMap = async (name: string) => {
  if (!name) return;
  try {
    const data = await invoke("load_map_data", { name }) as string | null;
    if (data) {
      shapes.value = JSON.parse(data);
      selectedMapName.value = name; currentMapName.value = name;
      selectedShapeId.value = null; selectedSubPointId.value = null; selectedExpPointId.value = null;
      pan.value = { x: 0, y: 0 }; scale.value = 1;
      saveMessage.value = `已加载「${name}」`;
      setTimeout(() => saveMessage.value = "", 2000);
    }
  } catch (e) {
    saveMessage.value = `加载失败: ${e}`;
    setTimeout(() => saveMessage.value = "", 3000);
  }
};

const handleSaveMap = async () => {
  const name = selectedMapName.value || currentMapName.value.trim();
  if (!name) { saveMessage.value = "请输入地图名称"; setTimeout(() => saveMessage.value = "", 2000); return; }
  if (shapes.value.length === 0) { saveMessage.value = "没有形状可保存"; setTimeout(() => saveMessage.value = "", 2000); return; }
  try {
    await invoke("save_map_data", { name, data: JSON.stringify(shapes.value) });
    selectedMapName.value = name; currentMapName.value = name;
    saveMessage.value = `已保存「${name}」`;
    setTimeout(() => saveMessage.value = "", 2000);
    await loadSavedMaps();
  } catch (e) {
    saveMessage.value = `保存失败: ${e}`;
    setTimeout(() => saveMessage.value = "", 3000);
  }
};

const handleClearSelection = () => {
  selectedMapName.value = ""; currentMapName.value = "";
  saveMessage.value = "已切换为新建模式"; setTimeout(() => saveMessage.value = "", 1500);
};

const handleDeleteMap = async () => {
  if (!selectedMapName.value) return;
  try {
    await invoke("delete_map_data", { name: selectedMapName.value });
    saveMessage.value = `已删除「${selectedMapName.value}」`; setTimeout(() => saveMessage.value = "", 2000);
    selectedMapName.value = ""; currentMapName.value = ""; shapes.value = [];
    await loadSavedMaps();
  } catch (e) { saveMessage.value = `删除失败: ${e}`; setTimeout(() => saveMessage.value = "", 3000); }
};

const handleExportShape = async (shape: Shape) => {
  if (!shape.subPoints.length) return;
  const data = shape.subPoints.map((sp: SubPoint) => ({ x: sp.x, y: sp.y, z: sp.z }));
  try {
    const fp = await save({ filters: [{ name: "文本文件", extensions: ["txt"] }], defaultPath: `${shape.type}_${Date.now()}.txt` });
    if (fp) {
      await invoke("write_text_file", { path: fp, content: JSON.stringify(data, null, 2) });
      exportResult.value = { path: fp, label: shape.type === "shelf" ? "货架" : "外边框" };
    }
  } catch (e) { saveMessage.value = `导出失败: ${e}`; setTimeout(() => saveMessage.value = "", 3000); }
};

const handleExportAllShapes = async () => {
  if (!shapes.value.length) return;
  const outer: { x: number; y: number; z: number }[] = [];
  const shelves: { x: number; y: number; z: number }[][] = [];
  for (const shape of shapes.value) {
    const pts = shape.subPoints.map((sp: SubPoint) => ({ x: sp.x, y: sp.y, z: sp.z }));
    if (shape.type === "outerBorder") outer.push(...pts);
    else shelves.push(pts);
  }
  try {
    const fp = await save({ filters: [{ name: "文本文件", extensions: ["txt"] }], defaultPath: `map_${Date.now()}.txt` });
    if (fp) {
      await invoke("write_text_file", { path: fp, content: JSON.stringify({ outer, shelves }, null, 2) });
      exportResult.value = { path: fp, label: "地图" };
    }
  } catch (e) { saveMessage.value = `导出失败: ${e}`; setTimeout(() => saveMessage.value = "", 3000); }
};

const handleOpenFolder = async () => {
  if (!exportResult.value) return;
  try {
    await invoke("reveal_in_folder", { path: exportResult.value.path });
    exportResult.value = null;
  } catch (e) { saveMessage.value = `打开文件夹失败: ${e}`; setTimeout(() => saveMessage.value = "", 3000); }
};

const getSvgViewBox = () => {
  if (!shapes.value.length) return "0 0 600 400";
  const all: { x: number; y: number }[] = [];
  shapes.value.forEach((s: Shape) => { s.subPoints.forEach((sp: SubPoint) => all.push(sp)); s.expansionPoints.forEach((ep: ExpansionPoint) => all.push(ep)); });
  if (!all.length) return "0 0 600 400";
  const xs = all.map((c: { x: number }) => c.x), ys = all.map((c: { y: number }) => c.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys), pad = 50;
  return `${minX - pad} ${minY - pad} ${Math.max(maxX - minX + pad * 2, 300)} ${Math.max(maxY - minY + pad * 2, 300)}`;
};

const arrowIconHtml = (z: number) => {
  const cz = calibrateZ(z), rad = cz * Math.PI / 180;
  const dx = Math.sin(rad) * 6, dy = -Math.cos(rad) * 6;
  return `<svg width="14" height="14" viewBox="-7 -7 14 14" style="display:inline-block;vertical-align:middle"><line x1="0" y1="0" x2="${dx}" y2="${dy}" stroke="#d97706" stroke-width="1.2" stroke-linecap="round"/><circle cx="0" cy="0" r="0.8" fill="#d97706"/></svg>`;
};

const visibleShapes = computed(() => shapes.value.filter((s: Shape) => s.visible && s.subPoints.length > 0));

const shapeLineSegments = (shape: Shape) => {
  const segs: { p1: SubPoint; p2: SubPoint; isClose: boolean }[] = [];
  const sps = shape.subPoints;
  for (let i = 0; i < sps.length - 1; i++) segs.push({ p1: sps[i], p2: sps[i + 1], isClose: false });
  if (sps.length >= 3) segs.push({ p1: sps[sps.length - 1], p2: sps[0], isClose: true });
  return segs;
};

onMounted(() => { loadSavedMaps(); });
</script>

<template>
  <div class="map-drawing-container">
    <div class="map-header" data-tauri-drag-region>
      <h1 class="map-title">图形绘制</h1>
      <div class="map-header-actions">
        <button v-if="shapes.length > 0" class="map-btn map-btn-xs map-btn-ghost" @click="handleResetView" title="重置视角">⌖ 重置视角</button>
        <button class="map-btn map-btn-xs map-btn-ghost" @click="handleToggleFullscreen" :title="isFullscreen ? '退出全屏' : '全屏'">{{ isFullscreen ? '⤡' : '⤢' }}</button>
        <button class="map-close-btn" @click="handleClose"><span>×</span></button>
      </div>
    </div>

    <div class="map-body">
      <div class="map-left-panel">
        <div class="map-selector-bar">
          <select class="map-select" :value="selectedMapName" @change="(e: any) => { const v = e.target.value; v === '__clear__' ? handleClearSelection() : handleSelectMap(v); }">
            <option value="">— 选择已保存的地图 —</option>
            <option v-if="selectedMapName" value="__clear__">— 清空选择（新建模式） —</option>
            <option v-for="n in savedMaps" :key="n" :value="n">{{ n }}</option>
          </select>
          <button v-if="selectedMapName" class="map-btn map-btn-xs map-btn-danger" @click="handleDeleteMap" title="删除当前地图">🗑</button>
        </div>

        <div class="left-panel-header">
          <span class="panel-title">形状列表<span v-if="shapes.length > 0" class="panel-count">({{ shapes.length }})</span></span>
          <div class="left-header-actions">
            <button class="map-btn map-btn-sm map-btn-ghost" @click="showPasteInput = !showPasteInput; pasteError = ''; pasteText = ''" title="粘贴坐标数据">📋 粘贴</button>
            <button class="map-btn map-btn-sm map-btn-danger" @click="handleClearAll" :disabled="shapes.length === 0" title="清空所有">清空</button>
            <button class="map-btn map-btn-primary" @click="handleAddShape">+ 添加</button>
          </div>
        </div>

        <div v-if="showPasteInput" class="paste-section">
          <div class="paste-section-header">
            <span class="paste-section-title">粘贴坐标数据</span>
            <button class="map-btn map-btn-xs map-btn-ghost" @click="showPasteInput = false; pasteError = ''; pasteText = ''">✕</button>
          </div>
          <textarea class="paste-textarea" v-model="pasteText" placeholder='[\n  {"x":235,"y":302,"z":0},\n  ...\n]' rows="4" spellcheck="false" />
          <div class="paste-type-row">
            <label>导入为:</label>
            <select class="coord-select paste-type-select" v-model="pasteType"><option value="outerBorder">外边框</option><option value="shelf">货架</option></select>
          </div>
          <div v-if="pasteError" class="paste-error">{{ pasteError }}</div>
          <div class="paste-actions">
            <span class="paste-hint">一个数组解析为一个形状，首尾自动连接</span>
            <button class="map-btn map-btn-primary map-btn-sm" @click="handleParsePastedData">解析导入</button>
          </div>
        </div>

        <div class="shape-list">
          <div v-if="shapes.length === 0" class="empty-hint">📋 粘贴坐标数组 或 点击「+ 添加」创建形状</div>
          <div v-for="(shape, idx) in shapes" :key="shape.id"
            :class="['shape-item', { expanded: shape.expanded, hidden: !shape.visible, selected: selectedShapeId === shape.id }]"
            @click="handleSelectShape(shape.id)">
            <div class="shape-item-header">
              <button class="shape-vis-btn" @click.stop="toggleVisible(shape.id)" :title="shape.visible ? '隐藏' : '显示'">{{ shape.visible ? '👁' : '👁‍🗨' }}</button>
              <span class="shape-index">#{{ showIdx(idx) }}</span>
              <span :class="['shape-type-badge', shape.type]">{{ shape.type === 'shelf' ? '货架' : '外边框' }}</span>
              <span class="shape-point-count">{{ shape.subPoints.length }}点<span v-if="shape.type === 'shelf' && shape.expansionPoints.length > 0">+{{ shape.expansionPoints.length }}外扩</span></span>
              <button class="map-btn map-btn-xs map-btn-ghost expand-toggle" @click.stop="toggleExpand(shape.id)" :title="shape.expanded ? '收起' : '展开'">{{ shape.expanded ? '▲' : '▼' }}</button>
              <button class="map-btn map-btn-xs map-btn-ghost" @click.stop="handleExportShape(shape)" title="导出为 JSON">📤</button>
              <button class="map-btn map-btn-xs map-btn-danger" @click.stop="handleDeleteShape(shape.id)" title="删除">×</button>
            </div>

            <div class="shape-config">
              <div class="shape-config-row">
                <label>颜色:</label>
                <input type="color" class="coord-color" :value="shape.lineColor" @input.stop="updateShape(shape.id, { lineColor: ($event.target as HTMLInputElement).value })" />
              </div>
              <div v-if="!shape.expanded" class="shape-config-row">
                <label>类型:</label>
                <select class="coord-select" :value="shape.type" @change.stop="updateShape(shape.id, { type: ($event.target as HTMLSelectElement).value as 'outerBorder' | 'shelf' })">
                  <option value="outerBorder">外边框</option><option value="shelf">货架</option>
                </select>
              </div>
            </div>

            <div v-if="shape.expanded" class="subpoints-area">
              <div class="subpoints-header">
                <span class="subpoints-title">坐标点 ({{ shape.subPoints.length }})</span>
                <button class="map-btn map-btn-xs map-btn-primary" @click.stop="handleAddSubPoint(shape.id)">+ 加点</button>
              </div>
              <div class="subpoints-header-row">
                <span class="subp-h">#</span><span class="subp-h">X</span><span class="subp-h">Y</span><span class="subp-h">Z</span><span class="subp-h"></span>
              </div>
              <div v-for="(sp, spIdx) in shape.subPoints" :key="sp.id"
                :class="['subpoint-row', { selected: selectedSubPointId === sp.id }]"
                @click.stop="handleSelectSubPoint(shape.id, sp.id)">
                <span class="subp-idx">{{ showIdx(spIdx) }}</span>
                <input type="number" step="any" class="coord-input subp-input" :value="sp.x" @input.stop="updateSubPoint(shape.id, sp.id, { x: parseFloat(($event.target as HTMLInputElement).value) || 0 })" />
                <input type="number" step="any" class="coord-input subp-input" :value="sp.y" @input.stop="updateSubPoint(shape.id, sp.id, { y: parseFloat(($event.target as HTMLInputElement).value) || 0 })" />
                <input type="number" step="any" class="coord-input subp-input" :value="sp.z" @input.stop="updateSubPoint(shape.id, sp.id, { z: parseFloat(($event.target as HTMLInputElement).value) || 0 })" />
                <button class="map-btn map-btn-xs map-btn-danger subp-del" @click.stop="handleDeleteSubPoint(shape.id, sp.id)">×</button>
                <span v-if="sp.z > 1000" class="subp-cal">↻{{ calibrateZ(sp.z).toFixed(1) }}°</span>
              </div>
            </div>

            <div v-if="shape.expanded && shape.type === 'shelf'" class="expansion-area">
              <div class="subpoints-header">
                <span class="subpoints-title">外扩点 ({{ shape.expansionPoints.length }})</span>
                <button class="map-btn map-btn-xs map-btn-primary" @click.stop="handleAddExpPoint(shape.id)" :disabled="shape.subPoints.length === 0" :title="shape.subPoints.length === 0 ? '请先添加坐标点' : '添加外扩点'">+ 外扩点</button>
              </div>
              <div v-if="shape.subPoints.length === 0" class="expansion-empty-hint">需先有坐标点才能添加外扩点</div>
              <template v-if="shape.expansionPoints.length > 0">
                <div class="subpoints-header-row">
                  <span class="subp-h">#</span><span class="subp-h">X</span><span class="subp-h">Y</span><span class="subp-h">Z</span><span class="subp-h">↗</span><span class="subp-h"></span>
                </div>
                <div v-for="(ep, epIdx) in shape.expansionPoints" :key="ep.id"
                  :class="['subpoint-row', { selected: selectedExpPointId === ep.id }]"
                  @click.stop="handleSelectExpPoint(shape.id, ep.id)">
                  <span class="subp-idx">{{ showIdx(epIdx) }}</span>
                  <input type="number" step="any" class="coord-input subp-input" :value="ep.x" @input.stop="updateExpPoint(shape.id, ep.id, { x: parseFloat(($event.target as HTMLInputElement).value) || 0 })" />
                  <input type="number" step="any" class="coord-input subp-input" :value="ep.y" @input.stop="updateExpPoint(shape.id, ep.id, { y: parseFloat(($event.target as HTMLInputElement).value) || 0 })" />
                  <input type="number" step="any" class="coord-input subp-input" :value="ep.z" @input.stop="updateExpPoint(shape.id, ep.id, { z: parseFloat(($event.target as HTMLInputElement).value) || 0 })" />
                  <span class="exp-dir-icon" :title="`方向: ${calibrateZ(ep.z).toFixed(1)}°`" v-html="arrowIconHtml(ep.z)" />
                  <button class="map-btn map-btn-xs map-btn-danger subp-del" @click.stop="handleDeleteExpPoint(shape.id, ep.id)">×</button>
                  <span v-if="ep.z > 1000" class="subp-cal">↻{{ calibrateZ(ep.z).toFixed(1) }}°</span>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div class="map-save-bar">
          <div class="save-bar-row">
            <input class="save-name-input" type="text" placeholder="输入地图名称..." v-model="currentMapName" @keydown.enter="handleSaveMap" />
            <button class="map-btn map-btn-primary map-btn-sm" @click="handleSaveMap" :disabled="shapes.length === 0" :title="'保存/更新地图'">保存{{ selectedMapName ? '更新' : '' }}</button>
            <button class="map-btn map-btn-sm map-btn-ghost" @click="handleExportAllShapes" :disabled="shapes.length === 0" title="导出整个地图为 JSON">📦导出</button>
          </div>
          <div v-if="saveMessage" class="save-message">{{ saveMessage }}</div>
        </div>

        <div v-if="exportResult" class="export-toast-overlay">
          <div class="export-toast">
            <div class="export-toast-icon">✅</div>
            <div class="export-toast-text">{{ exportResult.label }} 导出成功</div>
            <button class="map-btn map-btn-primary map-btn-sm" @click="handleOpenFolder">📂 打开文件夹</button>
            <button class="map-btn map-btn-xs map-btn-ghost export-toast-close" @click="exportResult = null">✕</button>
          </div>
        </div>
      </div>

      <div class="map-right-panel">
        <div class="canvas-header">
          <span class="canvas-title">图形预览</span>
          <span class="canvas-info">{{ shapes.length }} 个形状 · {{ totalSubPoints }} 个坐标点<span v-if="scale !== 1"> · {{ (scale * 100).toFixed(0) }}%</span></span>
        </div>
        <div class="canvas-area">
          <div v-if="shapes.length === 0" class="canvas-empty-hint">
            <div class="canvas-empty-icon">📐</div>
            <div>请在左侧粘贴或添加形状</div>
            <div class="canvas-empty-sub">拖拽平移 · 滚轮缩放 · 点击左侧列表聚焦</div>
          </div>
          <svg v-else ref="svgRef" class="map-canvas-svg"
            :viewBox="getSvgViewBox()" preserveAspectRatio="xMidYMid meet"
            @mousedown="onCanvasMouseDown" @mousemove="onCanvasMouseMove"
            @mouseup="onCanvasMouseUp" @mouseleave="onCanvasMouseUp"
            @wheel="onCanvasWheel"
            :style="{ cursor: isPanning ? 'grabbing' : 'grab' }">
            <defs>
              <pattern id="mg" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,0,0,0.04)" stroke-width="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#mg)" @click="handleCanvasBgClick" />
            <g :transform="`translate(${pan.x}, ${pan.y}) scale(${scale})`">
              <template v-for="shape in visibleShapes" :key="shape.id">
                <polygon v-if="shape.subPoints.length >= 3"
                  :points="shape.subPoints.map((sp: SubPoint) => `${sp.x},${sp.y}`).join(' ')"
                  :fill="shape.lineColor + '11'" stroke="none" />
                <template v-for="seg in shapeLineSegments(shape)" :key="shape.id + '-' + (seg.isClose ? 'close' : 'seg')">
                  <line :x1="seg.p1.x" :y1="seg.p1.y" :x2="seg.p2.x" :y2="seg.p2.y"
                    :stroke="shape.lineColor" stroke-width="0.5" stroke-linecap="round"
                    :stroke-dasharray="seg.isClose && shape.type === 'shelf' ? '4 3' : 'none'" />
                  <text v-if="shape.type === 'shelf'"
                    :x="(seg.p1.x + seg.p2.x) / 2" :y="(seg.p1.y + seg.p2.y) / 2"
                    text-anchor="middle" dominant-baseline="middle"
                    fill="#d97706" font-size="4" font-weight="600"
                    style="paint-order:stroke;stroke:#fff;stroke-width:1px;stroke-linecap:round;stroke-linejoin:round">
                    {{ calcDistance(seg.p1, seg.p2).toFixed(2) }}m
                  </text>
                </template>
                <g v-for="sp in shape.subPoints" :key="sp.id">
                  <circle v-if="selectedSubPointId === sp.id" :cx="sp.x" :cy="sp.y" r="3" fill="none" stroke="#fbbf24" stroke-width="1.5" opacity="0.8" />
                  <circle :cx="sp.x" :cy="sp.y" r="0.5" :fill="selectedSubPointId === sp.id ? '#fbbf24' : shape.lineColor" :stroke="selectedSubPointId === sp.id ? '#f59e0b' : '#fff'" stroke-width="0.4" />
                  <text v-if="(shape.subPoints.indexOf(sp) + 1) % 5 === 0" :x="sp.x" :y="sp.y - 4" text-anchor="middle" fill="rgba(0,0,0,0.4)" font-size="4" font-weight="600">{{ shape.subPoints.indexOf(sp) + 1 }}</text>
                  <text v-if="shape.type === 'shelf'" :x="sp.x" :y="sp.y + 7" text-anchor="middle" fill="rgba(0,0,0,0.25)" font-size="4">({{ sp.x.toFixed(1) }},{{ sp.y.toFixed(1) }})</text>
                  <text v-if="shape.type === 'outerBorder' && selectedSubPointId === sp.id" :x="sp.x" :y="sp.y + 7" text-anchor="middle" fill="rgba(0,0,0,0.4)" font-size="4">({{ sp.x.toFixed(1) }},{{ sp.y.toFixed(1) }})</text>
                  <text v-if="sp.z > 1000" :x="sp.x" :y="sp.y + (shape.type === 'shelf' ? 19 : 21)" text-anchor="middle" fill="rgba(217,119,6,0.5)" font-size="4">↻{{ calibrateZ(sp.z).toFixed(1) }}°</text>
                </g>
                <g v-for="ep in shape.expansionPoints" :key="ep.id">
                  <circle v-if="selectedExpPointId === ep.id" :cx="ep.x" :cy="ep.y" r="4" fill="none" stroke="#fbbf24" stroke-width="1" opacity="0.8" />
                  <line :x1="ep.x" :y1="ep.y" :x2="ep.x + Math.sin(calibrateZ(ep.z) * Math.PI / 180) * 14" :y2="ep.y - Math.cos(calibrateZ(ep.z) * Math.PI / 180) * 14" :stroke="selectedExpPointId === ep.id ? '#fbbf24' : '#f59e0b'" stroke-width="0.4" stroke-linecap="round" />
                  <polygon :points="(function(){ const ex = ep.x + Math.sin(calibrateZ(ep.z) * Math.PI / 180) * 14, ey = ep.y - Math.cos(calibrateZ(ep.z) * Math.PI / 180) * 14; const ux = Math.sin(calibrateZ(ep.z) * Math.PI / 180), uy = -Math.cos(calibrateZ(ep.z) * Math.PI / 180); return `${ex},${ey} ${ex + 5 * (-ux * Math.cos(0.5) + uy * Math.sin(0.5))},${ey + 5 * (-ux * Math.sin(0.5) - uy * Math.cos(0.5))} ${ex + 5 * (-ux * Math.cos(0.5) - uy * Math.sin(0.5))},${ey + 5 * (ux * Math.sin(0.5) - uy * Math.cos(0.5))}`; })()" :fill="selectedExpPointId === ep.id ? '#fbbf24' : '#f59e0b'" />
                  <rect :x="ep.x - 1" :y="ep.y - 1" width="1.5" height="1.5" :transform="`rotate(45, ${ep.x}, ${ep.y})`" :fill="selectedExpPointId === ep.id ? '#fbbf24' : '#f59e0b'" stroke="#fff" stroke-width="0.5" />
                </g>
              </template>
            </g>
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-drawing-container {
  width: 100vw; height: 100vh;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(20px);
  display: flex; flex-direction: column; overflow: hidden;
  pointer-events: auto; user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.map-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid rgba(0,0,0,0.06); flex-shrink: 0; }
.map-title { margin: 0; font-size: 18px; font-weight: 600; color: #1a1a1a; letter-spacing: 0.5px; }
.map-header-actions { display: flex; align-items: center; gap: 8px; }
.map-close-btn { width: 32px; height: 32px; border: none; background: rgba(0,0,0,0.05); border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; font-size: 20px; color: #666; line-height: 1; padding: 0; }
.map-close-btn:hover { background: rgba(231,76,60,0.1); color: #e74c3c; }
.map-body { display: flex; flex: 1; overflow: hidden; }
.map-left-panel { width: 380px; min-width: 320px; border-right: 1px solid rgba(0,0,0,0.06); display: flex; flex-direction: column; background: rgba(255,255,255,0.5); }
.map-selector-bar { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgba(0,0,0,0.06); background: rgba(99,102,241,0.04); flex-shrink: 0; }
.map-select { flex: 1; height: 28px; border: 1px solid rgba(99,102,241,0.2); border-radius: 6px; padding: 0 8px; font-size: 11px; color: #333; background: rgba(255,255,255,0.8); outline: none; cursor: pointer; font-family: inherit; transition: border-color 0.2s; }
.map-select:focus { border-color: #6366f1; }
.map-select option { font-size: 11px; padding: 2px; }
.left-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid rgba(0,0,0,0.06); flex-shrink: 0; }
.panel-title { font-size: 14px; font-weight: 600; color: #333; }
.panel-count { font-weight: 400; color: #999; font-size: 12px; margin-left: 4px; }
.left-header-actions { display: flex; gap: 4px; }
.map-btn { border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s; font-family: inherit; line-height: 1.4; }
.map-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.map-btn-primary { background: #6366f1; color: #fff; padding: 5px 12px; }
.map-btn-primary:hover:not(:disabled) { background: #4f46e5; }
.map-btn-danger { background: transparent; color: #ef4444; padding: 4px 8px; }
.map-btn-danger:hover:not(:disabled) { background: rgba(239,68,68,0.08); }
.map-btn-sm { font-size: 11px; padding: 4px 8px; }
.map-btn-xs { font-size: 10px; padding: 2px 6px; min-width: 22px; text-align: center; }
.map-btn-ghost { background: transparent; color: #666; }
.map-btn-ghost:hover { background: rgba(0,0,0,0.05); }
.paste-section { padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,0.06); background: rgba(99,102,241,0.03); flex-shrink: 0; }
.paste-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.paste-section-title { font-size: 12px; font-weight: 600; color: #6366f1; }
.paste-textarea { width: 100%; box-sizing: border-box; border: 1px solid rgba(99,102,241,0.2); border-radius: 6px; padding: 6px 8px; font-size: 11px; font-family: "Cascadia Code","Fira Code","Consolas",monospace; color: #333; background: rgba(255,255,255,0.8); outline: none; resize: vertical; min-height: 60px; line-height: 1.5; }
.paste-textarea:focus { border-color: #6366f1; background: #fff; }
.paste-type-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.paste-type-row label { font-size: 11px; color: #666; flex-shrink: 0; }
.paste-type-select { height: 26px !important; font-size: 11px !important; flex: none !important; width: 100px; }
.paste-error { margin-top: 4px; font-size: 11px; color: #ef4444; padding: 3px 6px; background: rgba(239,68,68,0.06); border-radius: 4px; }
.paste-actions { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.paste-hint { font-size: 10px; color: #aaa; }
.shape-list { flex: 1; overflow-y: auto; padding: 8px; }
.empty-hint { text-align: center; color: #999; font-size: 13px; padding: 48px 16px; }
.shape-item { background: #fff; border-radius: 10px; margin-bottom: 8px; border: 1px solid rgba(0,0,0,0.06); overflow: hidden; transition: box-shadow 0.2s; }
.shape-item:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.shape-item.expanded { border-color: rgba(99,102,241,0.15); }
.shape-item.hidden { opacity: 0.5; }
.shape-item.selected { border-color: #6366f1; box-shadow: 0 0 0 1px #6366f1; }
.shape-item.selected > .shape-item-header { background: rgba(99,102,241,0.06); }
.shape-item-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: rgba(0,0,0,0.02); border-bottom: 1px solid rgba(0,0,0,0.04); }
.shape-vis-btn { background: none; border: none; cursor: pointer; font-size: 12px; padding: 0 2px; line-height: 1; opacity: 0.5; }
.shape-vis-btn:hover { opacity: 1; }
.shape-index { font-size: 12px; font-weight: 600; color: #999; min-width: 22px; }
.shape-type-badge { font-size: 10px; font-weight: 500; padding: 2px 8px; border-radius: 10px; }
.shape-type-badge.outerBorder { background: rgba(99,102,241,0.08); color: #6366f1; }
.shape-type-badge.shelf { background: rgba(245,158,11,0.1); color: #d97706; }
.shape-point-count { font-size: 10px; color: #bbb; margin-left: auto; }
.expand-toggle { margin-left: 4px; }
.shape-config { padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.shape-config-row { display: flex; align-items: center; gap: 4px; }
.shape-config-row label { font-size: 10px; color: #888; }
.shape-config-row .coord-color { width: 24px; height: 24px; }
.shape-config-row .coord-select { height: 24px; font-size: 11px; width: 100px; }
.subpoints-area { border-top: 1px solid rgba(0,0,0,0.04); background: rgba(0,0,0,0.015); padding: 6px 8px; }
.subpoints-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.subpoints-title { font-size: 11px; font-weight: 600; color: #555; }
.subpoints-header-row { display: flex; align-items: center; gap: 4px; padding: 2px 0; margin-bottom: 2px; }
.subp-h { font-size: 9px; color: #aaa; flex: 1; text-align: center; }
.subp-h:first-child { flex: none; width: 18px; }
.subp-h:last-child { flex: none; width: 22px; }
.subpoint-row { display: flex; align-items: center; gap: 4px; padding: 2px 0; position: relative; }
.subpoint-row:hover { background: rgba(0,0,0,0.02); border-radius: 4px; }
.subpoint-row.selected { background: rgba(251,191,36,0.1) !important; border-radius: 4px; outline: 1px solid rgba(251,191,36,0.3); }
.subp-idx { flex: none; width: 18px; text-align: center; font-size: 10px; color: #999; font-weight: 600; }
.subp-input { flex: 1; height: 24px; min-width: 0; border: 1px solid rgba(0,0,0,0.08); border-radius: 3px; padding: 0 6px; font-size: 10px; color: #333; background: rgba(0,0,0,0.02); outline: none; font-family: inherit; }
.subp-input:focus { border-color: #6366f1; background: #fff; }
.subp-del { flex: none; width: 20px; height: 20px; padding: 0 !important; line-height: 1; font-size: 11px; }
.subp-cal { position: absolute; right: 26px; top: -6px; font-size: 8px; color: #d97706; background: rgba(255,255,255,0.9); padding: 0 4px; border-radius: 2px; pointer-events: none; }
.expansion-area { border-top: 1px solid rgba(245,158,11,0.12); background: rgba(245,158,11,0.02); padding: 6px 8px; }
.expansion-empty-hint { font-size: 10px; color: #aaa; padding: 8px 0; text-align: center; font-style: italic; }
.exp-dir-icon { flex: none; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; cursor: default; }
.map-right-panel { flex: 1; display: flex; flex-direction: column; background: rgba(248,249,250,0.5); }
.canvas-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; border-bottom: 1px solid rgba(0,0,0,0.06); flex-shrink: 0; }
.canvas-title { font-size: 14px; font-weight: 600; color: #333; }
.canvas-info { font-size: 11px; color: #999; }
.canvas-area { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 8px; }
.canvas-empty-hint { text-align: center; color: #bbb; }
.canvas-empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.4; }
.canvas-empty-sub { font-size: 12px; color: #ccc; margin-top: 4px; }
.map-canvas-svg { width: 100%; height: 100%; background: rgba(255,255,255,0.6); border-radius: 12px; border: 1px solid rgba(0,0,0,0.04); user-select: none; }
.map-save-bar { border-top: 1px solid rgba(0,0,0,0.06); padding: 10px 12px; background: rgba(255,255,255,0.6); flex-shrink: 0; }
.save-bar-row { display: flex; align-items: center; gap: 6px; }
.save-name-input { flex: 1; height: 28px; border: 1px solid rgba(0,0,0,0.1); border-radius: 6px; padding: 0 8px; font-size: 12px; color: #333; background: rgba(255,255,255,0.9); outline: none; font-family: inherit; }
.save-name-input:focus { border-color: #6366f1; }
.save-message { margin-top: 6px; font-size: 11px; color: #6366f1; text-align: center; padding: 3px 8px; background: rgba(99,102,241,0.06); border-radius: 4px; animation: fadeInOut 2s ease; }
@keyframes fadeInOut { 0% { opacity: 0; transform: translateY(-4px); } 15% { opacity: 1; transform: translateY(0); } 85% { opacity: 1; } 100% { opacity: 0; } }
.shape-list::-webkit-scrollbar { width: 4px; }
.shape-list::-webkit-scrollbar-track { background: transparent; }
.shape-list::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 2px; }
.export-toast-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(2px); }
.export-toast { background: #fff; border-radius: 12px; padding: 28px 32px; box-shadow: 0 8px 32px rgba(0,0,0,0.15); display: flex; flex-direction: column; align-items: center; gap: 12px; position: relative; min-width: 200px; }
.export-toast-icon { font-size: 40px; line-height: 1; }
.export-toast-text { font-size: 14px; font-weight: 600; color: #333; text-align: center; }
.export-toast-close { position: absolute !important; top: 8px; right: 8px; width: 24px; height: 24px; padding: 0 !important; display: flex; align-items: center; justify-content: center; border-radius: 50% !important; font-size: 12px; line-height: 1; }
@media (max-width: 768px) { .map-left-panel { width: 300px; min-width: 260px; } }
</style>
