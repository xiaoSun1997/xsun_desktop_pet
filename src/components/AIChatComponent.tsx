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

export default function AIChatComponent() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [configError, setConfigError] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        // 检查配置
        checkConfig();
        // 添加欢迎消息
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
            await invoke('load_deepseek_config');
            setConfigError(null);
        } catch (error) {
            console.error('配置检查失败:', error);
            setConfigError(error as string);
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
            // 准备发送给API的消息格式
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

    if (configError) {
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
                    <h3>配置错误</h3>
                    <p>{configError}</p>
                    <p>请检查 public/config/deepseek.json 文件</p>
                    <button className="retry-button" onClick={checkConfig}>
                        重试
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="ai-chat-container">
            <div className="ai-chat-header" data-tauri-drag-region>
                <div className="header-left">
                    <div className="ai-avatar">🤖</div>
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
                        <div className="message-avatar">
                            {message.role === 'user' ? '👤' : '🤖'}
                        </div>
                        <div className="message-content">
                            <div className="message-text">{message.content}</div>
                            <div className="message-time">{formatTime(message.timestamp)}</div>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="message assistant-message">
                        <div className="message-avatar">🤖</div>
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
        </div>
    );
}
