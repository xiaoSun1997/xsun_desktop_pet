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
    }

    return null;
}

export default App;
