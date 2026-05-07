import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import "./MapDrawingComponent.css";

// ===== 子点 =====
interface SubPoint {
    id: string;
    x: number;
    y: number;
    z: number;
}

// ===== 外扩点（仅货架有） =====
interface ExpansionPoint {
    id: string;
    x: number;
    y: number;
    z: number;
}

// ===== 图形形状（一个数组解析为一个） =====
interface Shape {
    id: string;
    type: "outerBorder" | "shelf";
    lineColor: string;
    expanded: boolean;
    visible: boolean;
    subPoints: SubPoint[];
    expansionPoints: ExpansionPoint[];
}

let shapeIdCounter = 0;
let subPointIdCounter = 0;
let expPointIdCounter = 0;

function genShapeId(): string {
    return `sh_${++shapeIdCounter}_${Date.now()}`;
}
function genSubPointId(): string {
    return `sp_${++subPointIdCounter}_${Date.now()}`;
}
function genExpPointId(): string {
    return `ep_${++expPointIdCounter}_${Date.now()}`;
}

/** Z 校准：z > 1000 时应用 (z-1500) % 180 */
function calibrateZ(z: number): number {
    if (z > 1000) return (z - 1500) % 180;
    return z;
}

/** 从一个子点数组计算包围盒中心 */
function calcCenter(sps: SubPoint[]): { cx: number; cy: number } {
    if (sps.length === 0) return { cx: 0, cy: 0 };
    const xs = sps.map(s => s.x);
    const ys = sps.map(s => s.y);
    return {
        cx: (Math.min(...xs) + Math.max(...xs)) / 2,
        cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
}

/** 像素到米的转换系数（1像素 = 0.05米） */
const PIXEL_TO_METER_RATIO = 0.05;

/** 计算两点间距离（像素转米） */
function calcDistance(p1: SubPoint, p2: SubPoint): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const distM = distPx * PIXEL_TO_METER_RATIO;
    return Math.round(distM * 100) / 100;
}

export default function MapDrawingComponent() {
    const [shapes, setShapes] = useState<Shape[]>([]);
    const [showPasteInput, setShowPasteInput] = useState(false);
    const [pasteText, setPasteText] = useState("");
    const [pasteType, setPasteType] = useState<"outerBorder" | "shelf">("outerBorder");
    const [pasteError, setPasteError] = useState("");

    // 选中 / 聚焦状态
    const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
    const [selectedSubPointId, setSelectedSubPointId] = useState<string | null>(null);
    const [selectedExpPointId, setSelectedExpPointId] = useState<string | null>(null);

    // ===== 地图持久化 =====
    const [savedMaps, setSavedMaps] = useState<string[]>([]);
    const [currentMapName, setCurrentMapName] = useState("");
    const [selectedMapName, setSelectedMapName] = useState("");
    const [saveMessage, setSaveMessage] = useState("");

    // 全屏 / 导出结果
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [exportResult, setExportResult] = useState<{ path: string; label: string } | null>(null);

    // 画布变换
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [scale, setScale] = useState(1);
    const isPanning = useRef(false);
    const panStart = useRef({ x: 0, y: 0 });
    const panStartPos = useRef({ x: 0, y: 0 });
    const svgRef = useRef<SVGSVGElement>(null);

    // ===== 窗口关闭 =====
    const handleClose = async () => {
        try { await getCurrentWindow().close(); }
        catch { /* ignore */ }
    };

    // ===== 添加空白形状 =====
    const handleAddShape = () => {
        const sp: SubPoint = { id: genSubPointId(), x: 0, y: 0, z: 0 };
        const newShape: Shape = {
            id: genShapeId(),
            type: "outerBorder",
            lineColor: "#6366f1",
            expanded: true,
            visible: true,
            subPoints: [sp],
            expansionPoints: [],
        };
        setShapes(prev => [...prev, newShape]);
        // 新添加的形状默认选中聚焦
        setSelectedShapeId(newShape.id);
        setSelectedSubPointId(null);
        setSelectedExpPointId(null);
        setTimeout(() => focusOnPoint(sp.x, sp.y), 0);
    };

    // ===== 删除形状 =====
    const handleDeleteShape = (id: string) => {
        setShapes(prev => prev.filter(s => s.id !== id));
        if (selectedShapeId === id) {
            setSelectedShapeId(null);
            setSelectedSubPointId(null);
            setSelectedExpPointId(null);
        }
    };

    // ===== 更新形状字段 =====
    const updateShape = (id: string, updater: Partial<Shape>) => {
        setShapes(prev => prev.map(s => (s.id === id ? { ...s, ...updater } : s)));
    };

    // ===== 切换展开/折叠 =====
    const toggleExpand = (id: string) => {
        setShapes(prev => prev.map(s => s.id === id ? { ...s, expanded: !s.expanded } : s));
    };

    // ===== 切换可见性 =====
    const toggleVisible = (id: string) => {
        setShapes(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
    };

    // ===== 添加子点 =====
    const handleAddSubPoint = (shapeId: string) => {
        const sp: SubPoint = { id: genSubPointId(), x: 0, y: 0, z: 0 };
        setShapes(prev => prev.map(s =>
            s.id === shapeId ? { ...s, subPoints: [...s.subPoints, sp] } : s
        ));
    };

    // ===== 更新子点 =====
    const updateSubPoint = (shapeId: string, spId: string, updater: Partial<SubPoint>) => {
        setShapes(prev => prev.map(s =>
            s.id === shapeId
                ? { ...s, subPoints: s.subPoints.map(sp => sp.id === spId ? { ...sp, ...updater } : sp) }
                : s
        ));
    };

    // ===== 删除子点 =====
    const handleDeleteSubPoint = (shapeId: string, spId: string) => {
        setShapes(prev => prev.map(s =>
            s.id === shapeId
                ? { ...s, subPoints: s.subPoints.filter(sp => sp.id !== spId) }
                : s
        ));
        if (selectedSubPointId === spId) setSelectedSubPointId(null);
    };

    // ===== 外扩点操作 =====
    const handleAddExpPoint = (shapeId: string) => {
        const ep: ExpansionPoint = { id: genExpPointId(), x: 0, y: 0, z: 0 };
        setShapes(prev => prev.map(s =>
            s.id === shapeId ? { ...s, expansionPoints: [...s.expansionPoints, ep] } : s
        ));
    };
    const updateExpPoint = (shapeId: string, epId: string, updater: Partial<ExpansionPoint>) => {
        setShapes(prev => prev.map(s =>
            s.id === shapeId
                ? { ...s, expansionPoints: s.expansionPoints.map(ep => ep.id === epId ? { ...ep, ...updater } : ep) }
                : s
        ));
    };
    const handleDeleteExpPoint = (shapeId: string, epId: string) => {
        setShapes(prev => prev.map(s =>
            s.id === shapeId
                ? { ...s, expansionPoints: s.expansionPoints.filter(ep => ep.id !== epId) }
                : s
        ));
        if (selectedExpPointId === epId) setSelectedExpPointId(null);
    };

    // ===== 清空 =====
    const handleClearAll = () => {
        if (shapes.length === 0) return;
        setShapes([]);
        setPan({ x: 0, y: 0 });
        setScale(1);
        setSelectedShapeId(null);
        setSelectedSubPointId(null);
        setSelectedExpPointId(null);
    };

    // ===== 聚焦到画布某点 =====
    const focusOnPoint = useCallback((px: number, py: number) => {
        const svgEl = svgRef.current;
        if (!svgEl) return;
        const rect = svgEl.getBoundingClientRect();
        setPan({
            x: rect.width / 2 - px * scale,
            y: rect.height / 2 - py * scale,
        });
    }, [scale]);

    // ===== 点击形状 → 聚焦 =====
    const handleSelectShape = (shapeId: string) => {
        setSelectedShapeId(shapeId);
        setSelectedSubPointId(null);
        setSelectedExpPointId(null);
        const shape = shapes.find(s => s.id === shapeId);
        if (shape && shape.subPoints.length > 0) {
            const { cx, cy } = calcCenter(shape.subPoints);
            focusOnPoint(cx, cy);
        }
    };

    // ===== 点击子点行 → 选中 + 聚焦 =====
    const handleSelectSubPoint = (shapeId: string, spId: string) => {
        setSelectedShapeId(shapeId);
        setSelectedSubPointId(spId);
        setSelectedExpPointId(null);
        const shape = shapes.find(s => s.id === shapeId);
        if (shape) {
            const sp = shape.subPoints.find(s => s.id === spId);
            if (sp) focusOnPoint(sp.x, sp.y);
        }
    };

    // ===== 点击外扩点行 → 选中 + 聚焦 =====
    const handleSelectExpPoint = (shapeId: string, epId: string) => {
        setSelectedShapeId(shapeId);
        setSelectedSubPointId(null);
        setSelectedExpPointId(epId);
        const shape = shapes.find(s => s.id === shapeId);
        if (shape) {
            const ep = shape.expansionPoints.find(e => e.id === epId);
            if (ep) focusOnPoint(ep.x, ep.y);
        }
    };

    // 点击画布空白 → 取消选中
    const handleCanvasBgClick = () => {
        setSelectedShapeId(null);
        setSelectedSubPointId(null);
        setSelectedExpPointId(null);
    };

    // ===== 粘贴解析（支持单个数组 或 多个数组 [[...],[...]]） =====
    const handleParsePastedData = () => {
        setPasteError("");
        const trimmed = pasteText.trim();
        if (!trimmed) { setPasteError("请先粘贴坐标数据"); return; }

        let parsed: any;
        try { parsed = JSON.parse(trimmed); }
        catch { setPasteError("JSON 格式无效"); return; }

        if (!Array.isArray(parsed)) { setPasteError("数据必须是数组格式"); return; }
        if (parsed.length === 0) { setPasteError("数组为空"); return; }

        // 检测是多数组格式 [[...],[...]] 还是单数组 [...]
        const isMultiArray = Array.isArray(parsed[0]);

        const arraysToParse: any[][] = isMultiArray ? parsed : [parsed];
        const newShapes: Shape[] = [];

        for (let arrIdx = 0; arrIdx < arraysToParse.length; arrIdx++) {
            const arr = arraysToParse[arrIdx];
            if (!Array.isArray(arr)) {
                setPasteError(`第 ${arrIdx + 1} 组数据不是数组格式`); return;
            }
            if (arr.length === 0) {
                setPasteError(`第 ${arrIdx + 1} 组数据为空`); return;
            }

            const subPoints: SubPoint[] = [];
            for (let i = 0; i < arr.length; i++) {
                const item = arr[i];
                if (typeof item.x !== "number" || typeof item.y !== "number") {
                    setPasteError(`第 ${arrIdx + 1} 组第 ${i + 1} 项缺少有效的 x 或 y 字段`); return;
                }
                subPoints.push({
                    id: genSubPointId(),
                    x: item.x,
                    y: item.y,
                    z: typeof item.z === "number" ? item.z : 0,
                });
            }

            newShapes.push({
                id: genShapeId(),
                type: pasteType,
                lineColor: pasteType === "shelf" ? "#f59e0b" : "#6366f1",
                expanded: true,
                visible: true,
                subPoints,
                expansionPoints: [],
            });
        }

        setShapes(prev => [...prev, ...newShapes]);
        setPasteText("");
        setShowPasteInput(false);
        setPasteError("");

        // 自动聚焦到最后一个新形状
        const lastShape = newShapes[newShapes.length - 1];
        setSelectedShapeId(lastShape.id);
        setSelectedSubPointId(null);
        setSelectedExpPointId(null);
        setTimeout(() => {
            if (lastShape.subPoints.length > 0) {
                const { cx, cy } = calcCenter(lastShape.subPoints);
                focusOnPoint(cx, cy);
            }
        }, 0);
    };

    // ===== 画布交互：拖拽平移 =====
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY };
        panStartPos.current = { x: pan.x, y: pan.y };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isPanning.current) return;
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setPan({ x: panStartPos.current.x + dx, y: panStartPos.current.y + dy });
    };

    const handleMouseUp = () => { isPanning.current = false; };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        setScale(prev => Math.max(0.1, Math.min(10, prev * factor)));
    };

    // ===== 重置视角 =====
    const handleResetView = () => {
        setPan({ x: 0, y: 0 });
        setScale(1);
    };

    // ===== 加载已保存的地图列表 =====
    const loadSavedMaps = useCallback(async () => {
        try {
            const names: string[] = await invoke("list_map_names");
            setSavedMaps(names);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { loadSavedMaps(); }, [loadSavedMaps]);

    // ===== 选择已保存的地图加载 =====
    const handleSelectMap = async (name: string) => {
        if (!name) return;
        try {
            const data: string | null = await invoke("load_map_data", { name });
            if (data) {
                const loaded: Shape[] = JSON.parse(data);
                setShapes(loaded);
                setSelectedMapName(name);
                setCurrentMapName(name);
                setSelectedShapeId(null);
                setSelectedSubPointId(null);
                setSelectedExpPointId(null);
                setPan({ x: 0, y: 0 });
                setScale(1);
                setSaveMessage(`已加载「${name}」`);
                setTimeout(() => setSaveMessage(""), 2000);
            }
        } catch (e: any) {
            setSaveMessage(`加载失败: ${e}`);
            setTimeout(() => setSaveMessage(""), 3000);
        }
    };

    // ===== 保存当前地图（若已选择则更新同名，否则根据输入新建） =====
    const handleSaveMap = async () => {
        // 如果已选择地图，使用选择的地图名称（保持 ID 一致实现更新）
        const name = selectedMapName || currentMapName.trim();
        if (!name) {
            setSaveMessage("请输入地图名称");
            setTimeout(() => setSaveMessage(""), 2000);
            return;
        }
        if (shapes.length === 0) {
            setSaveMessage("没有形状可保存");
            setTimeout(() => setSaveMessage(""), 2000);
            return;
        }
        try {
            const data = JSON.stringify(shapes);
            await invoke("save_map_data", { name, data });
            setSelectedMapName(name);
            setCurrentMapName(name);
            setSaveMessage(`已保存「${name}」`);
            setTimeout(() => setSaveMessage(""), 2000);
            await loadSavedMaps();
        } catch (e: any) {
            setSaveMessage(`保存失败: ${e}`);
            setTimeout(() => setSaveMessage(""), 3000);
        }
    };

    // ===== 清除选择地图状态（新建模式） =====
    const handleClearSelection = () => {
        setSelectedMapName("");
        setCurrentMapName("");
        setSaveMessage("已切换为新建模式");
        setTimeout(() => setSaveMessage(""), 1500);
    };

    // ===== 全屏切换 =====
    const handleToggleFullscreen = async () => {
        try {
            const win = getCurrentWindow();
            const fs = await win.isFullscreen();
            await win.setFullscreen(!fs);
            setIsFullscreen(!fs);
        } catch { /* ignore */ }
    };

    // ===== 打开文件夹并定位文件 =====
    const handleOpenFolder = async () => {
        if (!exportResult) return;
        try {
            await invoke("reveal_in_folder", { path: exportResult.path });
            setExportResult(null);
        } catch (e: any) {
            setSaveMessage(`打开文件夹失败: ${e}`);
            setTimeout(() => setSaveMessage(""), 3000);
        }
    };

    // ===== 删除当前选择的地图 =====
    const handleDeleteMap = async () => {
        if (!selectedMapName) return;
        try {
            await invoke("delete_map_data", { name: selectedMapName });
            setSaveMessage(`已删除「${selectedMapName}」`);
            setTimeout(() => setSaveMessage(""), 2000);
            setSelectedMapName("");
            setCurrentMapName("");
            setShapes([]);
            await loadSavedMaps();
        } catch (e: any) {
            setSaveMessage(`删除失败: ${e}`);
            setTimeout(() => setSaveMessage(""), 3000);
        }
    };

    // ===== 导出形状为 JSON（和导入格式一致） =====
    const handleExportShape = async (shape: Shape) => {
        if (shape.subPoints.length === 0) return;
        const exportData = shape.subPoints.map(sp => ({
            x: sp.x,
            y: sp.y,
            z: sp.z,
        }));
        const jsonStr = JSON.stringify(exportData, null, 2);
        try {
            const filePath = await save({
                filters: [{ name: "文本文件", extensions: ["txt"] }],
                defaultPath: `${shape.type}_${Date.now()}.txt`,
            });
            if (filePath) {
                await invoke("write_text_file", { path: filePath, content: jsonStr });
                const label = shape.type === "shelf" ? "货架" : "外边框";
                setExportResult({ path: filePath, label });
            }
        } catch (e: any) {
            setSaveMessage(`导出失败: ${e}`);
            setTimeout(() => setSaveMessage(""), 3000);
        }
    };

    // ===== 导出整个地图（outer + shelves 格式） =====
    const handleExportAllShapes = async () => {
        if (shapes.length === 0) return;
        const outer: { x: number; y: number; z: number }[] = [];
        const shelves: { x: number; y: number; z: number }[][] = [];
        for (const shape of shapes) {
            const pts = shape.subPoints.map(sp => ({ x: sp.x, y: sp.y, z: sp.z }));
            if (shape.type === "outerBorder") {
                outer.push(...pts);
            } else if (shape.type === "shelf") {
                shelves.push(pts);
            }
        }
        const exportData = { outer, shelves };
        const jsonStr = JSON.stringify(exportData, null, 2);
        try {
            const filePath = await save({
                filters: [{ name: "文本文件", extensions: ["txt"] }],
                defaultPath: `map_${Date.now()}.txt`,
            });
            if (filePath) {
                await invoke("write_text_file", { path: filePath, content: jsonStr });
                setExportResult({ path: filePath, label: "地图" });
            }
        } catch (e: any) {
            setSaveMessage(`导出失败: ${e}`);
            setTimeout(() => setSaveMessage(""), 3000);
        }
    };

    // ===== SVG 视口 =====
    const getSvgViewBox = useCallback(() => {
        if (shapes.length === 0) return "0 0 600 400";
        const allCoords: { x: number; y: number }[] = [];
        shapes.forEach(s => s.subPoints.forEach(sp => allCoords.push({ x: sp.x, y: sp.y })));
        shapes.forEach(s => s.expansionPoints.forEach(ep => allCoords.push({ x: ep.x, y: ep.y })));
        if (allCoords.length === 0) return "0 0 600 400";
        const xs = allCoords.map(c => c.x);
        const ys = allCoords.map(c => c.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const pad = 50;
        const w = Math.max(maxX - minX + pad * 2, 300);
        const h = Math.max(maxY - minY + pad * 2, 300);
        return `${minX - pad} ${minY - pad} ${w} ${h}`;
    }, [shapes]);

    // ===== 渲染形状的连线 =====
    const renderShapeLines = (shape: Shape) => {
        if (!shape.visible || shape.subPoints.length === 0) return null;
        const sps = shape.subPoints;
        const color = shape.lineColor;

        const elements: React.ReactElement[] = [];
        for (let i = 0; i < sps.length - 1; i++) {
            const p1 = sps[i];
            const p2 = sps[i + 1];
            elements.push(
                <line key={`l-${shape.id}-${i}`}
                    x1={p1.x} y1={p1.y}
                    x2={p2.x} y2={p2.y}
                    stroke={color} strokeWidth={0.5} strokeLinecap="round" />
            );
            // 货架类型：在边上显示长度标签
            if (shape.type === "shelf") {
                const dist = calcDistance(p1, p2);
                if (dist > 0) {
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    elements.push(
                        <text key={`len-${shape.id}-${i}`}
                            x={midX} y={midY}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="#d97706" fontSize={4} fontWeight={600}
                            style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: "1px", strokeLinecap: "round", strokeLinejoin: "round" }}>
                            {dist.toFixed(2)}m
                        </text>
                    );
                }
            }
        }
        if (sps.length >= 3) {
            const p1 = sps[sps.length - 1];
            const p2 = sps[0];
            elements.push(
                <line key={`l-${shape.id}-close`}
                    x1={p1.x} y1={p1.y}
                    x2={p2.x} y2={p2.y}
                    stroke={color} strokeWidth={0.5} strokeLinecap="round"
                    strokeDasharray={shape.type === "shelf" ? "4 3" : "none"} />
            );
            // 货架类型：闭合边也显示长度
            if (shape.type === "shelf") {
                const dist = calcDistance(p1, p2);
                if (dist > 0) {
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    elements.push(
                        <text key={`len-${shape.id}-close`}
                            x={midX} y={midY}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fill="#d97706" fontSize={4} fontWeight={600}
                            style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: "1px", strokeLinecap: "round", strokeLinejoin: "round" }}>
                            {dist.toFixed(2)}m
                        </text>
                    );
                }
            }
        }
        return elements;
    };

    // ===== 渲染子点（圆点 + 选中高亮 + 坐标标签） =====
    const renderShapeDots = (shape: Shape) => {
        if (!shape.visible || shape.subPoints.length === 0) return null;
        const sps = shape.subPoints;
        const color = shape.lineColor;

        return sps.map((sp, idx) => {
            const isSelected = selectedSubPointId === sp.id;
            return (
                <g key={sp.id}>
                    {/* 选中高亮圈 */}
                    {isSelected && (
                        <circle cx={sp.x} cy={sp.y} r={3}
                            fill="none" stroke="#fbbf24" strokeWidth={1.5}
                            opacity={0.8} />
                    )}
                    {/* 圆点 r=1 */}
                    <circle cx={sp.x} cy={sp.y} r={0.5}
                        fill={isSelected ? "#fbbf24" : color}
                        stroke={isSelected ? "#f59e0b" : "#fff"}
                        strokeWidth={0.4} />

                    {/* 序号：只在 5 的倍数位置显示 */}
                    {(idx + 1) % 5 === 0 && (
                        <text x={sp.x} y={sp.y - 4} textAnchor="middle"
                            fill="rgba(0,0,0,0.4)" fontSize={4} fontWeight={600}>
                            {idx + 1}
                        </text>
                    )}

                    {/* 坐标标签：外边框只有选中才显示，货架始终显示但更小 */}
                    {shape.type === "shelf" && (
                        <text x={sp.x} y={sp.y + 7} textAnchor="middle"
                            fill="rgba(0,0,0,0.25)" fontSize={4}>
                            ({sp.x.toFixed(1)},{sp.y.toFixed(1)})
                        </text>
                    )}
                    {shape.type === "outerBorder" && isSelected && (
                        <text x={sp.x} y={sp.y + 7} textAnchor="middle"
                            fill="rgba(0,0,0,0.4)" fontSize={4}>
                            ({sp.x.toFixed(1)},{sp.y.toFixed(1)})
                        </text>
                    )}

                    {/* Z 校准值 */}
                    {sp.z > 1000 && (
                        <text x={sp.x} y={sp.y + (shape.type === "shelf" ? 19 : 21)} textAnchor="middle"
                            fill="rgba(217,119,6,0.5)" fontSize={4}>
                            ↻{calibrateZ(sp.z).toFixed(1)}°
                        </text>
                    )}
                </g>
            );
        });
    };

    // ===== 渲染外扩点及方向箭头 =====
    const renderExpansionPoints = (shape: Shape) => {
        if (!shape.visible || shape.type !== "shelf" || shape.expansionPoints.length === 0) return null;

        return shape.expansionPoints.map(ep => {
            const isSelected = selectedExpPointId === ep.id;
            const cz = calibrateZ(ep.z);
            const zRad = cz * Math.PI / 180;
            const arrowLen = 14;
            const dx = Math.sin(zRad) * arrowLen;
            const dy = -Math.cos(zRad) * arrowLen;
            const endX = ep.x + dx;
            const endY = ep.y + dy;

            // 箭头头部
            const headLen = 5;
            const headAngle = 0.5;
            // 单位方向向量（从起点到终点）
            const ux = dx / arrowLen;
            const uy = dy / arrowLen;
            // 左翼：反向向量逆时针旋转 headAngle
            const hx1 = endX + headLen * (-ux * Math.cos(headAngle) + uy * Math.sin(headAngle));
            const hy1 = endY + headLen * (-ux * Math.sin(headAngle) - uy * Math.cos(headAngle));
            // 右翼：反向向量顺时针旋转 headAngle
            const hx2 = endX + headLen * (-ux * Math.cos(headAngle) - uy * Math.sin(headAngle));
            const hy2 = endY + headLen * (ux * Math.sin(headAngle) - uy * Math.cos(headAngle));

            return (
                <g key={ep.id}>
                    {/* 选中高亮 */}
                    {isSelected && (
                        <circle cx={ep.x} cy={ep.y} r={4}
                            fill="none" stroke="#fbbf24" strokeWidth={1}
                            opacity={0.8} />
                    )}
                    {/* 方向线 */}
                    <line x1={ep.x} y1={ep.y} x2={endX} y2={endY}
                        stroke={isSelected ? "#fbbf24" : "#f59e0b"}
                        strokeWidth={0.4} strokeLinecap="round" />
                    {/* 箭头 */}
                    <polygon points={`${endX},${endY} ${hx1},${hy1} ${hx2},${hy2}`}
                        fill={isSelected ? "#fbbf24" : "#f59e0b"} />
                    {/* 外扩点标记（小菱形，与普通点大小一致） */}
                    <rect x={ep.x - 1} y={ep.y - 1} width={1.5} height={1.5}
                        transform={`rotate(45, ${ep.x}, ${ep.y})`}
                        fill={isSelected ? "#fbbf24" : "#f59e0b"}
                        stroke="#fff" strokeWidth={0.5} />
                </g>
            );
        });
    };

    // ===== 渲染一个形状（完整的图形） =====
    const renderShape = (shape: Shape) => {
        if (!shape.visible || shape.subPoints.length === 0) return null;
        const sps = shape.subPoints;
        const color = shape.lineColor;

        return (
            <g key={shape.id}>
                {/* 填充半透明背景 */}
                {sps.length >= 3 && (
                    <polygon
                        points={sps.map(sp => `${sp.x},${sp.y}`).join(" ")}
                        fill={color + "11"}
                        stroke="none" />
                )}
                {/* 连线 */}
                {renderShapeLines(shape)}
                {/* 子点 */}
                {renderShapeDots(shape)}
                {/* 外扩点（仅货架） */}
                {renderExpansionPoints(shape)}
            </g>
        );
    };

    // ===== 渲染画布 =====
    const renderCanvas = () => {
        return (
            <svg ref={svgRef}
                className="map-canvas-svg"
                viewBox={getSvgViewBox()}
                preserveAspectRatio="xMidYMid meet"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                style={{ cursor: isPanning.current ? "grabbing" : "grab" }}>
                <defs>
                    <pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(0,0,0,0.04)" strokeWidth={1} />
                    </pattern>
                </defs>
                {/* 点击空白取消选中 */}
                <rect width="100%" height="100%" fill="url(#grid)" onClick={handleCanvasBgClick} />
                <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
                    {shapes.map(renderShape)}
                </g>
            </svg>
        );
    };

    // ===== 子点总计 =====
    const totalSubPoints = useMemo(() =>
        shapes.reduce((sum, s) => sum + s.subPoints.length, 0),
        [shapes]
    );

    // ===== 渲染外扩点方向箭头图标（用于左侧列表） =====
    const ArrowIcon = ({ z }: { z: number }) => {
        const cz = calibrateZ(z);
        const zRad = cz * Math.PI / 180;
        const dx = Math.sin(zRad) * 6;
        const dy = -Math.cos(zRad) * 6;
        return (
            <svg width="14" height="14" viewBox="-7 -7 14 14" style={{ display: "inline-block", verticalAlign: "middle" }}>
                <line x1={0} y1={0} x2={dx} y2={dy}
                    stroke="#d97706" strokeWidth={1.2} strokeLinecap="round" />
                <circle cx={0} cy={0} r={0.8} fill="#d97706" />
            </svg>
        );
    };

    // ===== 渲染 =====
    return (
        <div className="map-drawing-container">
            {/* 头部 */}
            <div className="map-header" data-tauri-drag-region>
                <h1 className="map-title">图形绘制</h1>
                <div className="map-header-actions">
                    {shapes.length > 0 && (
                        <button className="map-btn map-btn-xs map-btn-ghost" onClick={handleResetView} title="重置视角">
                            ⌖ 重置视角
                        </button>
                    )}
                    <button className="map-btn map-btn-xs map-btn-ghost"
                        onClick={handleToggleFullscreen}
                        title={isFullscreen ? "退出全屏" : "全屏"}>
                        {isFullscreen ? "⤡" : "⤢"}
                    </button>
                    <button className="map-close-btn" onClick={handleClose}>
                        <span>×</span>
                    </button>
                </div>
            </div>

            <div className="map-body">
                {/* ===== 左侧：形状列表 ===== */}
                <div className="map-left-panel">
                    {/* 顶部：地图选择器 */}
                    <div className="map-selector-bar">
                        <select className="map-select"
                            value={selectedMapName}
                            onChange={e => {
                                const val = e.target.value;
                                if (val === "__clear__") {
                                    handleClearSelection();
                                } else {
                                    handleSelectMap(val);
                                }
                            }}>
                            <option value="">— 选择已保存的地图 —</option>
                            {selectedMapName && <option value="__clear__">— 清空选择（新建模式） —</option>}
                            {savedMaps.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                        {selectedMapName && (
                            <button className="map-btn map-btn-xs map-btn-danger"
                                onClick={handleDeleteMap}
                                title="删除当前地图">🗑</button>
                        )}
                    </div>

                    <div className="left-panel-header">
                        <span className="panel-title">
                            形状列表
                            {shapes.length > 0 && <span className="panel-count">({shapes.length})</span>}
                        </span>
                        <div className="left-header-actions">
                            <button className="map-btn map-btn-sm map-btn-ghost"
                                onClick={() => {
                                    setShowPasteInput(!showPasteInput);
                                    setPasteError(""); setPasteText("");
                                }}
                                title="粘贴坐标数据">📋 粘贴</button>
                            <button className="map-btn map-btn-sm map-btn-danger"
                                onClick={handleClearAll} disabled={shapes.length === 0}
                                title="清空所有">清空</button>
                            <button className="map-btn map-btn-primary"
                                onClick={handleAddShape}>+ 添加</button>
                        </div>
                    </div>

                    {/* 粘贴区域 */}
                    {showPasteInput && (
                        <div className="paste-section">
                            <div className="paste-section-header">
                                <span className="paste-section-title">粘贴坐标数据</span>
                                <button className="map-btn map-btn-xs map-btn-ghost"
                                    onClick={() => { setShowPasteInput(false); setPasteError(""); setPasteText(""); }}>✕</button>
                            </div>
                            <textarea className="paste-textarea"
                                placeholder={`[\n  {"x":235,"y":302,"z":0},\n  {"x":236,"y":282,"z":0},\n  ...\n]`}
                                value={pasteText}
                                onChange={e => { setPasteText(e.target.value); setPasteError(""); }}
                                rows={4} spellCheck={false} />
                            <div className="paste-type-row">
                                <label>导入为:</label>
                                <select className="coord-select paste-type-select"
                                    value={pasteType}
                                    onChange={e => setPasteType(e.target.value as any)}>
                                    <option value="outerBorder">外边框</option>
                                    <option value="shelf">货架</option>
                                </select>
                            </div>
                            {pasteError && <div className="paste-error">{pasteError}</div>}
                            <div className="paste-actions">
                                <span className="paste-hint">一个数组解析为一个形状，首尾自动连接</span>
                                <button className="map-btn map-btn-primary map-btn-sm" onClick={handleParsePastedData}>
                                    解析导入
                                </button>
                            </div>
                        </div>
                    )}

                    {/* 形状列表 */}
                    <div className="shape-list">
                        {shapes.length === 0 && (
                            <div className="empty-hint">
                                📋 粘贴坐标数组 或 点击「+ 添加」创建形状
                            </div>
                        )}

                        {shapes.map((shape, idx) => {
                            const isSelected = selectedShapeId === shape.id;
                            return (
                                <div key={shape.id}
                                    className={`shape-item ${shape.expanded ? "expanded" : ""} ${!shape.visible ? "hidden" : ""} ${isSelected ? "selected" : ""}`}
                                    onClick={() => handleSelectShape(shape.id)}>
                                    {/* 头部 */}
                                    <div className="shape-item-header">
                                        <button className="shape-vis-btn"
                                            onClick={e => { e.stopPropagation(); toggleVisible(shape.id); }}
                                            title={shape.visible ? "隐藏" : "显示"}>
                                            {shape.visible ? "👁" : "👁‍🗨"}
                                        </button>
                                        <span className="shape-index">#{idx + 1}</span>
                                        <span className={`shape-type-badge ${shape.type}`}>
                                            {shape.type === "shelf" ? "货架" : "外边框"}
                                        </span>
                                        <span className="shape-point-count">
                                            {shape.subPoints.length}点
                                            {shape.type === "shelf" && shape.expansionPoints.length > 0 && `+${shape.expansionPoints.length}外扩`}
                                        </span>
                                        <button className="map-btn map-btn-xs map-btn-ghost expand-toggle"
                                            onClick={e => { e.stopPropagation(); toggleExpand(shape.id); }}
                                            title={shape.expanded ? "收起" : "展开"}>
                                            {shape.expanded ? "▲" : "▼"}
                                        </button>
                                        <button className="map-btn map-btn-xs map-btn-ghost"
                                            onClick={e => { e.stopPropagation(); handleExportShape(shape); }} title="导出为 JSON">📤</button>
                                        <button className="map-btn map-btn-xs map-btn-danger"
                                            onClick={e => { e.stopPropagation(); handleDeleteShape(shape.id); }} title="删除">×</button>
                                    </div>

                                    {/* 配置字段 */}
                                    <div className="shape-config">
                                        <div className="shape-config-row">
                                            <label>颜色:</label>
                                            <input type="color" className="coord-color"
                                                value={shape.lineColor}
                                                onChange={e => { e.stopPropagation(); updateShape(shape.id, { lineColor: e.target.value }); }} />
                                        </div>
                                        {!shape.expanded && (
                                            <div className="shape-config-row">
                                                <label>类型:</label>
                                                <select className="coord-select"
                                                    value={shape.type}
                                                    onChange={e => { e.stopPropagation(); updateShape(shape.id, { type: e.target.value as any }); }}>
                                                    <option value="outerBorder">外边框</option>
                                                    <option value="shelf">货架</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    {/* 展开：子点列表 */}
                                    {shape.expanded && (
                                        <div className="subpoints-area">
                                            <div className="subpoints-header">
                                                <span className="subpoints-title">坐标点 ({shape.subPoints.length})</span>
                                                <button className="map-btn map-btn-xs map-btn-primary"
                                                    onClick={e => { e.stopPropagation(); handleAddSubPoint(shape.id); }}>+ 加点</button>
                                            </div>
                                            <div className="subpoints-header-row">
                                                <span className="subp-h">#</span>
                                                <span className="subp-h">X</span>
                                                <span className="subp-h">Y</span>
                                                <span className="subp-h">Z</span>
                                                <span className="subp-h"></span>
                                            </div>
                                            {shape.subPoints.map((sp, spIdx) => (
                                                <div key={sp.id}
                                                    className={`subpoint-row ${selectedSubPointId === sp.id ? "selected" : ""}`}
                                                    onClick={e => { e.stopPropagation(); handleSelectSubPoint(shape.id, sp.id); }}>
                                                    <span className="subp-idx">{spIdx + 1}</span>
                                                    <input type="number" step="any" className="coord-input subp-input"
                                                        value={sp.x}
                                                        onChange={e => { e.stopPropagation(); updateSubPoint(shape.id, sp.id, { x: parseFloat(e.target.value) || 0 }); }} />
                                                    <input type="number" step="any" className="coord-input subp-input"
                                                        value={sp.y}
                                                        onChange={e => { e.stopPropagation(); updateSubPoint(shape.id, sp.id, { y: parseFloat(e.target.value) || 0 }); }} />
                                                    <input type="number" step="any" className="coord-input subp-input"
                                                        value={sp.z}
                                                        onChange={e => { e.stopPropagation(); updateSubPoint(shape.id, sp.id, { z: parseFloat(e.target.value) || 0 }); }} />
                                                    <button className="map-btn map-btn-xs map-btn-danger subp-del"
                                                        onClick={e => { e.stopPropagation(); handleDeleteSubPoint(shape.id, sp.id); }}>×</button>
                                                    {sp.z > 1000 && (
                                                        <span className="subp-cal">↻{calibrateZ(sp.z).toFixed(1)}°</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* 展开：外扩点列表（仅货架） */}
                                    {shape.expanded && shape.type === "shelf" && (
                                        <div className="expansion-area">
                                            <div className="subpoints-header">
                                                <span className="subpoints-title">外扩点 ({shape.expansionPoints.length})</span>
                                                <button className="map-btn map-btn-xs map-btn-primary"
                                                    onClick={e => { e.stopPropagation(); handleAddExpPoint(shape.id); }}
                                                    disabled={shape.subPoints.length === 0}
                                                    title={shape.subPoints.length === 0 ? "请先添加坐标点" : "添加外扩点"}>
                                                    + 外扩点
                                                </button>
                                            </div>
                                            {shape.subPoints.length === 0 && (
                                                <div className="expansion-empty-hint">需先有坐标点才能添加外扩点</div>
                                            )}
                                            {shape.expansionPoints.length > 0 && (
                                                <>
                                                    <div className="subpoints-header-row">
                                                        <span className="subp-h">#</span>
                                                        <span className="subp-h">X</span>
                                                        <span className="subp-h">Y</span>
                                                        <span className="subp-h">Z</span>
                                                        <span className="subp-h">↗</span>
                                                        <span className="subp-h"></span>
                                                    </div>
                                                    {shape.expansionPoints.map((ep, epIdx) => (
                                                        <div key={ep.id}
                                                            className={`subpoint-row ${selectedExpPointId === ep.id ? "selected" : ""}`}
                                                            onClick={e => { e.stopPropagation(); handleSelectExpPoint(shape.id, ep.id); }}>
                                                            <span className="subp-idx">{epIdx + 1}</span>
                                                            <input type="number" step="any" className="coord-input subp-input"
                                                                value={ep.x}
                                                                onChange={e => { e.stopPropagation(); updateExpPoint(shape.id, ep.id, { x: parseFloat(e.target.value) || 0 }); }} />
                                                            <input type="number" step="any" className="coord-input subp-input"
                                                                value={ep.y}
                                                                onChange={e => { e.stopPropagation(); updateExpPoint(shape.id, ep.id, { y: parseFloat(e.target.value) || 0 }); }} />
                                                            <input type="number" step="any" className="coord-input subp-input"
                                                                value={ep.z}
                                                                onChange={e => { e.stopPropagation(); updateExpPoint(shape.id, ep.id, { z: parseFloat(e.target.value) || 0 }); }} />
                                                            <span className="exp-dir-icon" title={`方向: ${calibrateZ(ep.z).toFixed(1)}°`}>
                                                                <ArrowIcon z={ep.z} />
                                                            </span>
                                                            <button className="map-btn map-btn-xs map-btn-danger subp-del"
                                                                onClick={e => { e.stopPropagation(); handleDeleteExpPoint(shape.id, ep.id); }}>×</button>
                                                            {ep.z > 1000 && (
                                                                <span className="subp-cal">↻{calibrateZ(ep.z).toFixed(1)}°</span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* 底部：保存区域 */}
                    <div className="map-save-bar">
                        <div className="save-bar-row">
                            <input className="save-name-input"
                                type="text"
                                placeholder="输入地图名称..."
                                value={currentMapName}
                                onChange={e => setCurrentMapName(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") handleSaveMap(); }}
                            />
                            <button className="map-btn map-btn-primary map-btn-sm"
                                onClick={handleSaveMap}
                                disabled={shapes.length === 0}
                                title="保存/更新地图">
                                保存{selectedMapName ? "更新" : ""}
                            </button>
                            <button className="map-btn map-btn-sm map-btn-ghost"
                                onClick={handleExportAllShapes}
                                disabled={shapes.length === 0}
                                title="导出整个地图为 JSON">📦导出</button>
                        </div>
                        {saveMessage && (
                            <div className="save-message">{saveMessage}</div>
                        )}
                    </div>

                    {/* 导出成功弹出框 */}
                    {exportResult && (
                        <div className="export-toast-overlay">
                            <div className="export-toast">
                                <div className="export-toast-icon">✅</div>
                                <div className="export-toast-text">
                                    {exportResult.label} 导出成功
                                </div>
                                <button className="map-btn map-btn-primary map-btn-sm"
                                    onClick={handleOpenFolder}>
                                    📂 打开文件夹
                                </button>
                                <button className="map-btn map-btn-xs map-btn-ghost export-toast-close"
                                    onClick={() => setExportResult(null)}>✕</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* ===== 右侧：画布 ===== */}
                <div className="map-right-panel">
                    <div className="canvas-header">
                        <span className="canvas-title">图形预览</span>
                        <span className="canvas-info">
                            {shapes.length} 个形状 · {totalSubPoints} 个坐标点
                            {scale !== 1 && ` · ${(scale * 100).toFixed(0)}%`}
                        </span>
                    </div>
                    <div className="canvas-area">
                        {shapes.length === 0 ? (
                            <div className="canvas-empty-hint">
                                <div className="canvas-empty-icon">📐</div>
                                <div>请在左侧粘贴或添加形状</div>
                                <div className="canvas-empty-sub">
                                    拖拽平移 · 滚轮缩放 · 点击左侧列表聚焦
                                </div>
                            </div>
                        ) : (
                            renderCanvas()
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
