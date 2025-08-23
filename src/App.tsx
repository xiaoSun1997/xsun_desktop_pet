import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import PetComponent from "./components/PetComponent";
import SystemInfoComponent from "./components/SystemInfoComponent";

function App() {
    const [label, setLabel] = useState<string>("");

    useEffect(() => {
        // 获取当前窗口的 label
        const win = getCurrentWindow();
        setLabel(win.label);
    }, []);

    if (label === "pet") {
        return <PetComponent />;      // 桌宠窗口
    } else {
        return <SystemInfoComponent />; // 系统监控窗口
    }
}

export default App;
