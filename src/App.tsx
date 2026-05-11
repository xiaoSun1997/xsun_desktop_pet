import { useEffect, useState, useRef } from "react";
import { getCurrentWindow, getAllWindows } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import PetComponent from "./components/PetComponent";
import SystemInfoComponent from "./components/SystemInfoComponent";
import Clipboard from "./components/ClipboardComponent";
import ExpandWindow from "./components/ExpandWindow";
import AIChatComponent from "./components/AIChatComponent";  // 添加这个导入
import TranslatorComponent from "./components/TranslatorComponent"; // 添加这个导入
import CalendarComponent from "./components/CalendarComponent";
import TodoWindow from "./components/TodoWindow";
import MenuPanel from "./components/MenuPanel.tsx";
import JsonCompareComponent from "./components/JsonCompareComponent"; // 添加JSON比较组件导入
import PomodoroTimerComponent from "./components/PomodoroTimerComponent"; // 添加番茄钟组件导入
import PomodoroNotification from './components/PomodoroNotification';
import JiraComponent from './components/JiraComponent'; // 添加JIRA组件导入
import SelectionMenu from './components/SelectionMenu';
import MapDrawingComponent from './components/MapDrawingComponent';
import NotepadComponent from "./components/NotepadComponent";
import FileSearchComponent from "./components/FileSearchComponent";
import QuickFileSearch from "./components/QuickFileSearch";

function App() {
    const [label, setLabel] = useState<string>("");
    const notepadOpeningRef = useRef(false);
    const fileSearchOpeningRef = useRef(false);
    const menuPanelOpeningRef = useRef(false);

    useEffect(() => {
        // 获取当前窗口的 label
        const win = getCurrentWindow();
        setLabel(win.label);
    }, []);

    // ===== Ctrl+Alt+N 打开记事本（只在桌宠窗口监听） =====
    useEffect(() => {
        const win = getCurrentWindow();
        if (win.label !== 'pet') return;

        let cancelled = false;
        let unlistenFn: (() => void) | undefined;

        listen('keyboard://ctrl-alt-n', () => {
            if (!cancelled) openNotepadWindow();
        }).then(fn => { unlistenFn = fn; });

        return () => {
            cancelled = true;
            if (unlistenFn) unlistenFn();
        };
    }, []);

    // ===== Alt+S 打开文件搜索（只在桌宠窗口监听） =====
    useEffect(() => {
        const win = getCurrentWindow();
        if (win.label !== 'pet') return;

        let cancelled = false;
        let unlistenFn: (() => void) | undefined;

        listen('keyboard://alt-s', () => {
            console.log('[App] 收到Alt+S事件');
            if (!cancelled) openQuickFileSearchWindow();
        }).then(fn => { unlistenFn = fn; console.log('[App] Alt+S监听已注册'); });

        return () => {
            cancelled = true;
            if (unlistenFn) unlistenFn();
        };
    }, []);

    // ===== Ctrl+Tab 打开功能菜单（只在桌宠窗口监听） =====
    useEffect(() => {
        const win = getCurrentWindow();
        if (win.label !== 'pet') return;

        let cancelled = false;
        let unlistenFn: (() => void) | undefined;

        listen('keyboard://ctrl-tab', () => {
            if (!cancelled) openMenuPanelWindow();
        }).then(fn => { unlistenFn = fn; });

        return () => {
            cancelled = true;
            if (unlistenFn) unlistenFn();
        };
    }, []);

    const openQuickFileSearchWindow = async () => {
        // 防止并发打开
        if (fileSearchOpeningRef.current) {
            console.log('[QuickSearch] 已有打开任务进行中，跳过');
            return;
        }
        fileSearchOpeningRef.current = true;

        const guardTimeout = setTimeout(() => {
            if (fileSearchOpeningRef.current) {
                console.warn('[QuickSearch] 守卫超时，强制重置');
                fileSearchOpeningRef.current = false;
            }
        }, 15000);

        try {
            const windows = await getAllWindows();
            const existing = windows.find(w => w.label === 'quick-file-search');

            if (existing) {
                try {
                    await existing.show();
                    await existing.setFocus();
                    return;
                } catch (showErr) {
                    console.warn('[QuickSearch] 已有窗口无法显示，尝试关闭并重建:', showErr);
                    try {
                        await existing.close();
                    } catch (closeErr) {
                        console.warn('[QuickSearch] 关闭僵尸窗口失败:', closeErr);
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
            }

            const url = import.meta.env.DEV
                ? 'http://localhost:1420'
                : 'index.html';

            const webview = new WebviewWindow('quick-file-search', {
                url,
                title: '快速搜索',
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
                    reject(new Error('等待快速搜索窗口创建超时'));
                }, 8000);
                webview.once('tauri://created', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                webview.once('tauri://error', (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建快速搜索窗口出错: ${JSON.stringify(e)}`));
                });
            });

            await webview.show();
            await webview.setFocus();
        } catch (error) {
            console.error('[QuickSearch] 打开快速搜索失败:', error);
        } finally {
            clearTimeout(guardTimeout);
            fileSearchOpeningRef.current = false;
        }
    };

    const openMenuPanelWindow = async () => {
        if (menuPanelOpeningRef.current) return;
        menuPanelOpeningRef.current = true;
        try {
            const windows = await getAllWindows();
            const existing = windows.find(w => w.label === 'menu-panel');
            if (existing) {
                await existing.show();
                await existing.setFocus();
                return;
            }

            const url = import.meta.env.DEV
                ? 'http://localhost:1420/menu'
                : 'menu.html';

            const webview = new WebviewWindow('menu-panel', {
                url,
                title: '功能菜单',
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
                    reject(new Error('等待菜单面板创建超时'));
                }, 5000);
                webview.once('tauri://created', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                webview.once('tauri://error', (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建菜单面板出错: ${JSON.stringify(e)}`));
                });
            });

            await webview.show();
            await webview.setFocus();
        } catch (error) {
            console.error('打开功能菜单失败:', error);
        } finally {
            menuPanelOpeningRef.current = false;
        }
    };

    const openNotepadWindow = async () => {
        if (notepadOpeningRef.current) {
            console.log('[Notepad] 已有打开任务进行中，跳过');
            return;
        }
        notepadOpeningRef.current = true;

        const guardTimeout = setTimeout(() => {
            if (notepadOpeningRef.current) {
                console.warn('[Notepad] 守卫超时，强制重置');
                notepadOpeningRef.current = false;
            }
        }, 15000);

        try {
            const windows = await getAllWindows();
            const existing = windows.find(w => w.label === 'notepad');

            if (existing) {
                try {
                    await existing.show();
                    await existing.setFocus();
                    return;
                } catch (showErr) {
                    console.warn('[Notepad] 已有窗口无法显示，尝试关闭并重建:', showErr);
                    try {
                        await existing.close();
                    } catch (closeErr) {
                        console.warn('[Notepad] 关闭僵尸窗口失败:', closeErr);
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
            }

            const url = import.meta.env.DEV
                ? 'http://localhost:1420'
                : 'index.html';

            const webview = new WebviewWindow('notepad', {
                url,
                title: '记事本',
                width: 1100,
                height: 750,
                center: true,
                resizable: true,
                skipTaskbar: true,
            });

            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('等待记事本窗口创建超时'));
                }, 5000);
                webview.once('tauri://created', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                webview.once('tauri://error', (e) => {
                    clearTimeout(timeout);
                    reject(new Error(`创建记事本窗口出错: ${JSON.stringify(e)}`));
                });
            });

            await webview.show();
            await webview.setFocus();
        } catch (error) {
            console.error('[Notepad] 打开记事本失败:', error);
        } finally {
            clearTimeout(guardTimeout);
            notepadOpeningRef.current = false;
        }
    };

    if (label === "pet") {
        return <PetComponent />;      // 桌宠窗口
    } else if (label === "main"){
        return <SystemInfoComponent />; // 系统监控窗口
    }else if (label === "clipboard"){
        return <Clipboard />; // 系统监控窗口
    }else if (label.startsWith("expand_")){
        return <ExpandWindow />; // 系统监控窗口
    }else if (label === "ai-chat"){  // 添加这个
        return <AIChatComponent />;
    } else   if (label === "translator") {  // 添加这个条件
        return <TranslatorComponent />;
    } else if (label === "calendar"){
        return <CalendarComponent />;
    } else if (label.startsWith("todo_")){
        return <TodoWindow />;
    }else if (label ==="menu-panel"){
        return <MenuPanel />;
    }else if (label === "json-compare" || label.startsWith("json-format-")){  // JSON对比/格式化窗口支持多开
        return <JsonCompareComponent />;
    }else if (label === "pomodoro-timer"){  // 添加番茄钟组件条件
        return <PomodoroTimerComponent />;
    }else if (label === "pomodoro-notification"){
        return <PomodoroNotification />;
    } else if (label === "jira") {
        return <JiraComponent />;
    } else if (label === "selection-menu") {
        return <SelectionMenu />;
    } else if (label === "map-drawing") {
        return <MapDrawingComponent />;
    } else if (label === "notepad") {
        return <NotepadComponent />;
    } else if (label === "file-search") {
        return <FileSearchComponent />;
    } else if (label === "quick-file-search") {
        return <QuickFileSearch />;
    }

    return null;
}

export default App;