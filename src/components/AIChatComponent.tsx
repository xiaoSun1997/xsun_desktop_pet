import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./AIChatComponent.css";

type Message = {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
};

type ChatMessage = {
    role: string;
    content: string;
};

type DeepSeekConfig = {
    apiKey: string;
    baseUrl: string;
    model: string;
};

export default function AIChatComponent() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [configError, setConfigError] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [config, setConfig] = useState<DeepSeekConfig>({
        apiKey: '',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat'
    });
    const [tempConfig, setTempConfig] = useState<DeepSeekConfig>({
        apiKey: '',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat'
    });
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        checkConfig();
        setMessages([{
            role: 'assistant',
            content: '你好！我是你的AI助手，有什么可以帮助你的吗？',
            timestamp: Date.now()
        }]);
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const checkConfig = async () => {
        try {
            const loadedConfig = await invoke<DeepSeekConfig>('load_local_deepseek_config');
            if (loadedConfig) {
                setConfig(loadedConfig);
                setTempConfig(loadedConfig);
            }
            await invoke('load_deepseek_config');
            setConfigError(null);
        } catch (error) {
            console.error('配置检查失败:', error);
            setConfigError(error as string);
        }
    };

    const saveConfig = async () => {
        try {
            await invoke('save_deepseek_config', { config: tempConfig });
            setConfig(tempConfig);
            setShowSettings(false);
            setConfigError(null);
            // 重新检查配置
            await checkConfig();
        } catch (error) {
            console.error('保存配置失败:', error);
            alert(`保存配置失败: ${error}`);
        }
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const handleSendMessage = async () => {
        if (!inputValue.trim() || isLoading) return;

        const userMessage: Message = {
            role: 'user',
            content: inputValue.trim(),
            timestamp: Date.now()
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue("");
        setIsLoading(true);

        try {
            const chatMessages: ChatMessage[] = [
                ...messages.map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                {
                    role: 'user',
                    content: userMessage.content
                }
            ];

            const response = await invoke<string>('send_chat_message', {
                messages: chatMessages
            });

            const assistantMessage: Message = {
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            };

            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            console.error('发送消息失败:', error);
            const errorMessage: Message = {
                role: 'assistant',
                content: `抱歉，发生了错误：${error}`,
                timestamp: Date.now()
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleClose = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.close();
        } catch (error) {
            console.error('关闭窗口失败:', error);
        }
    };

    const clearChat = () => {
        setMessages([{
            role: 'assistant',
            content: '聊天记录已清空。有什么新的问题吗？',
            timestamp: Date.now()
        }]);
    };

    const formatTime = (timestamp: number): string => {
        return new Date(timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleSettingsClose = () => {
        setTempConfig(config); // 恢复原配置
        setShowSettings(false);
    };

    if (configError && !config.apiKey) {
        return (
            <div className="ai-chat-container">
                <div className="ai-chat-header" data-tauri-drag-region>
                    <h1 className="ai-chat-title">AI对话助手</h1>
                    <button className="close-button" onClick={handleClose}>
                        <div className="close-icon"></div>
                    </button>
                </div>
                <div className="config-error">
                    <div className="error-icon">⚠️</div>
                    <h3>需要配置</h3>
                    <p>{configError}</p>
                    <button className="retry-button" onClick={() => setShowSettings(true)}>
                        配置API Key
                    </button>
                </div>
                {showSettings && (
                    <div className="settings-overlay">
                        <div className="settings-modal">
                            <div className="settings-header">
                                <h3>DeepSeek 配置</h3>
                                <button className="settings-close" onClick={handleSettingsClose}>
                                    <div className="close-icon"></div>
                                </button>
                            </div>
                            <div className="settings-content">
                                <div className="setting-item">
                                    <label>API Key:</label>
                                    <input
                                        type="password"
                                        value={tempConfig.apiKey}
                                        onChange={(e) => setTempConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                                        placeholder="输入你的 DeepSeek API Key"
                                    />
                                </div>
                                <div className="setting-item">
                                    <label>Base URL:</label>
                                    <input
                                        type="text"
                                        value={tempConfig.baseUrl}
                                        onChange={(e) => setTempConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                                        placeholder="API 基础URL"
                                    />
                                </div>
                                <div className="setting-item">
                                    <label>模型:</label>
                                    <input
                                        type="text"
                                        value={tempConfig.model}
                                        onChange={(e) => setTempConfig(prev => ({ ...prev, model: e.target.value }))}
                                        placeholder="模型名称"
                                    />
                                </div>
                            </div>
                            <div className="settings-actions">
                                <button className="cancel-button" onClick={handleSettingsClose}>取消</button>
                                <button className="save-button" onClick={saveConfig}>保存</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="ai-chat-container">
            <div className="ai-chat-header" data-tauri-drag-region>
                <div className="header-left">
                    <div className="ai-avatar"></div>
                    <div className="header-info">
                        <h1 className="ai-chat-title">AI对话助手</h1>
                        <div className="status-indicator">
                            <div className={`status-dot ${isLoading ? 'thinking' : 'online'}`}></div>
                            <span>{isLoading ? 'AI思考中...' : '在线'}</span>
                        </div>
                    </div>
                </div>
                <div className="header-actions">
                    <button
                        className="settings-button"
                        onClick={() => setShowSettings(true)}
                        title="设置"
                    >
                        <div className="settings-icon"></div>
                    </button>
                    <button
                        className="clear-chat-button"
                        onClick={clearChat}
                        title="清空聊天"
                    >
                        <div className="clear-icon"></div>
                    </button>
                    <button className="close-button" onClick={handleClose}>
                        <div className="close-icon"></div>
                    </button>
                </div>
            </div>

            <div className="messages-container">
                {messages.map((message, index) => (
                    <div
                        key={index}
                        className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}
                    >
                        <div className="message-avatar"></div>
                        <div className="message-content">
                            <div className="message-text">{message.content}</div>
                            <div className="message-time">{formatTime(message.timestamp)}</div>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="message assistant-message">
                        <div className="message-avatar"></div>
                        <div className="message-content">
                            <div className="typing-indicator">
                                <span></span>
                                <span></span>
                                <span></span>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="input-container">
                <div className="input-wrapper">
                    <textarea
                        ref={textareaRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="输入你的问题... (Enter发送, Shift+Enter换行)"
                        className="message-input"
                        rows={1}
                        disabled={isLoading}
                    />
                    <button
                        className={`send-button ${inputValue.trim() && !isLoading ? 'active' : ''}`}
                        onClick={handleSendMessage}
                        disabled={!inputValue.trim() || isLoading}
                    >
                        <div className="send-icon"></div>
                    </button>
                </div>
            </div>

            {showSettings && (
                <div className="settings-overlay">
                    <div className="settings-modal">
                        <div className="settings-header">
                            <h3>DeepSeek 配置</h3>
                            <button className="settings-close" onClick={handleSettingsClose}>
                                <div className="close-icon"></div>
                            </button>
                        </div>
                        <div className="settings-content">
                            <div className="setting-item">
                                <label>API Key:</label>
                                <input
                                    type="password"
                                    value={tempConfig.apiKey}
                                    onChange={(e) => setTempConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                                    placeholder="输入你的 DeepSeek API Key"
                                />
                            </div>
                            <div className="setting-item">
                                <label>Base URL:</label>
                                <input
                                    type="text"
                                    value={tempConfig.baseUrl}
                                    onChange={(e) => setTempConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                                    placeholder="API 基础URL"
                                />
                            </div>
                            <div className="setting-item">
                                <label>模型:</label>
                                <input
                                    type="text"
                                    value={tempConfig.model}
                                    onChange={(e) => setTempConfig(prev => ({ ...prev, model: e.target.value }))}
                                    placeholder="模型名称"
                                />
                            </div>
                        </div>
                        <div className="settings-actions">
                            <button className="cancel-button" onClick={handleSettingsClose}>取消</button>
                            <button className="save-button" onClick={saveConfig}>保存</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
