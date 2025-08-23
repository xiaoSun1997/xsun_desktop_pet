import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type SystemInfo = {
    cpu_usage: number;
    total_memory: number;
    used_memory: number;
};

export default function SystemInfoComponent() {
    const [info, setInfo] = useState<SystemInfo | null>(null);

    useEffect(() => {
        // 一次性拉取
        invoke<SystemInfo>("get_system_info").then(setInfo);

        // 订阅后台事件
        const unlistenPromise = listen<SystemInfo>("system://stats", (event) => {
            setInfo(event.payload);
        });

        return () => {
            unlistenPromise.then((unlistenFn) => unlistenFn());
        };
    }, []);

    return (
        <div style={{ padding: 20 }}>
            <h1>系统信息</h1>
            {info ? (
                <ul>
                    <li>CPU 使用率: {info.cpu_usage.toFixed(1)}%</li>
                    <li>总内存: {info.total_memory} KB</li>
                    <li>已用内存: {info.used_memory} KB</li>
                </ul>
            ) : (
                <p>加载中...</p>
            )}
        </div>
    );
}
