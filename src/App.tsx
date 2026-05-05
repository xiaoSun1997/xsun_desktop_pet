import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

function App() {
    const [label, setLabel] = useState<string>("");

    useEffect(() => {
        // 获取当前窗口的 label
        const win = getCurrentWindow();
        setLabel(win.label);
    }, []);

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
    }else if (label === "json-compare"){  // 添加JSON比较组件条件
        return <JsonCompareComponent />;
    }else if (label === "pomodoro-timer"){  // 添加番茄钟组件条件
        return <PomodoroTimerComponent />;
    }else if (label === "pomodoro-notification"){
        return <PomodoroNotification />;
    } else if (label === "jira") {
        return <JiraComponent />;
    } else if (label === "selection-menu") {
        return <SelectionMenu />;
    }

    return null;
}

export default App;