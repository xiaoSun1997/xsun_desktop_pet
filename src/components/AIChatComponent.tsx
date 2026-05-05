import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { marked } from "marked";
import "./AIChatComponent.css";

type Message = {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    isStreaming?: boolean;
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

type Session = {
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
    is_pinned: boolean;
};

type MessageRecord = {
    id: number;
    session_id: string;
    role: string;
    content: string;
    timestamp: number;
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
    // 会话管理
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingSessionTitle, setEditingSessionTitle] = useState('');
    const streamingContent = useRef("");
    const unlistenRef = useRef<UnlistenFn[]>([]);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 加载配置
    useEffect(() => {
        checkConfig();
        loadSessions();

        // 清理监听器
        return () => {
            unlistenRef.current.forEach(fn => fn());
        };
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // 设置流式监听
    const setupStreamListeners = useCallback((onToken: (token: string) => void, onDone: (content: string) => void, onError: (error: string) => void) => {
        const setup = async () => {
            const unlistenToken = await listen<{ token: string }>("chat://stream-token", (event) => {
                onToken(event.payload.token);
            });
            const unlistenDone = await listen<{ content: string }>("chat://stream-done", (event) => {
                onDone(event.payload.content);
            });
            const unlistenError = await listen<{ error: string }>("chat://stream-error", (event) => {
                onError(event.payload.error);
            });
            unlistenRef.current = [unlistenToken, unlistenDone, unlistenError];
        };
        setup();
    }, []);

    const checkConfig = async () => {
        try {
            const loadedConfig = await invoke<DeepSeekConfig | null>('load_local_deepseek_config');
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
            await checkConfig();
        } catch (error) {
            console.error('保存配置失败:', error);
            alert(`保存配置失败: ${error}`);
        }
    };

    const scrollToBottom = () => {
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 50);
    };

    // 加载会话列表
    const loadSessions = async () => {
        try {
            const list = await invoke<Session[]>('get_chat_sessions');
            setSessions(list);
        } catch (error) {
            console.error('加载会话列表失败:', error);
        }
    };

    // 创建新会话
    const handleNewSession = async () => {
        try {
            const session = await invoke<Session>('create_chat_session');
            setSessions(prev => [session, ...prev]);
            setCurrentSessionId(session.id);
            setMessages([{
                role: 'assistant',
                content: '你好！我是你的AI助手，有什么可以帮助你的吗？',
                timestamp: Date.now()
            }]);
        } catch (error) {
            console.error('创建会话失败:', error);
        }
    };

    // 加载会话消息
    const handleLoadSession = async (sessionId: string) => {
        try {
            const records = await invoke<MessageRecord[]>('get_chat_session_messages', { sessionId });
            const msgs: Message[] = records.map(r => ({
                role: r.role as 'user' | 'assistant',
                content: r.content,
                timestamp: r.timestamp * 1000
            }));
            setMessages(msgs.length > 0 ? msgs : [{
                role: 'assistant',
                content: '你好！我是你的AI助手，有什么可以帮助你的吗？',
                timestamp: Date.now()
            }]);
            setCurrentSessionId(sessionId);
        } catch (error) {
            console.error('加载会话消息失败:', error);
        }
    };

    // 删除会话
    const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        try {
            await invoke('delete_chat_session', { sessionId });
            setSessions(prev => prev.filter(s => s.id !== sessionId));
            if (currentSessionId === sessionId) {
                setCurrentSessionId(null);
                setMessages([{
                    role: 'assistant',
                    content: '你好！我是你的AI助手，有什么可以帮助你的吗？',
                    timestamp: Date.now()
                }]);
            }
        } catch (error) {
            console.error('删除会话失败:', error);
        }
    };

    // 发送消息（使用流式）
    const handleSendMessage = async () => {
        if (!inputValue.trim() || isLoading) return;

        // 如果没有会话，自动创建一个
        let sessionId = currentSessionId;
        if (!sessionId) {
            try {
                const session = await invoke<Session>('create_chat_session');
                setSessions(prev => [session, ...prev]);
                sessionId = session.id;
                setCurrentSessionId(session.id);
            } catch (error) {
                console.error('创建会话失败:', error);
                return;
            }
        }

        const userMessage: Message = {
            role: 'user',
            content: inputValue.trim(),
            timestamp: Date.now()
        };

        // 创建空白的流式assistant消息
        const assistantMessage: Message = {
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            isStreaming: true
        };

        setMessages(prev => [...prev, userMessage, assistantMessage]);
        const userInput = inputValue.trim();
        setInputValue("");
        setIsLoading(true);
        streamingContent.current = "";

        try {
            const chatMessages: ChatMessage[] = [
                ...messages.map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                { role: 'user', content: userInput }
            ];

            // 设置流式监听
            let streamComplete = false;
            const tokenHandler = (token: string) => {
                streamingContent.current += token;
                setMessages(prev => {
                    const newMsgs = [...prev];
                    const lastMsg = newMsgs[newMsgs.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                        newMsgs[newMsgs.length - 1] = {
                            ...lastMsg,
                            content: streamingContent.current
                        };
                    }
                    return newMsgs;
                });
            };

            const doneHandler = (_content: string) => {
                streamComplete = true;
                setMessages(prev => {
                    const newMsgs = [...prev];
                    const lastMsg = newMsgs[newMsgs.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                        newMsgs[newMsgs.length - 1] = {
                            ...lastMsg,
                            isStreaming: false,
                            timestamp: Date.now()
                        };
                    }
                    return newMsgs;
                });
                setIsLoading(false);
                loadSessions(); // 更新会话列表
            };

            const errorHandler = (error: string) => {
                if (!streamComplete) {
                    setMessages(prev => {
                        const newMsgs = [...prev];
                        const lastMsg = newMsgs[newMsgs.length - 1];
                        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                            newMsgs[newMsgs.length - 1] = {
                                role: 'assistant',
                                content: `抱歉，发生了错误：${error}`,
                                timestamp: Date.now(),
                                isStreaming: false
                            };
                        }
                        return newMsgs;
                    });
                }
                setIsLoading(false);
            };

            // 清理旧监听器
            unlistenRef.current.forEach(fn => fn());
            unlistenRef.current = [];

            await setupStreamListeners(tokenHandler, doneHandler, errorHandler);

            // 调用流式API
            await invoke('stream_chat_message', {
                messages: chatMessages,
                sessionId: sessionId,
            });
        } catch (error) {
            console.error('发送消息失败:', error);
            if (streamingContent.current) {
                setMessages(prev => {
                    const newMsgs = [...prev];
                    const lastMsg = newMsgs[newMsgs.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                        newMsgs[newMsgs.length - 1] = {
                            ...lastMsg,
                            isStreaming: false
                        };
                    }
                    return newMsgs;
                });
            } else {
                setMessages(prev => {
                    const newMsgs = prev.filter(m => !m.isStreaming);
                    newMsgs.push({
                        role: 'assistant' as const,
                        content: `抱歉，发生了错误：${error}`,
                        timestamp: Date.now()
                    });
                    return newMsgs;
                });
            }
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
        // 清理监听器
        unlistenRef.current.forEach(fn => fn());
        try {
            const appWindow = getCurrentWindow();
            await appWindow.close();
        } catch (error) {
            console.error('关闭窗口失败:', error);
        }
    };

    const handleToggleFullscreen = async () => {
        try {
            const appWindow = getCurrentWindow();
            const fs = await appWindow.isFullscreen();
            await appWindow.setFullscreen(!fs);
            setIsFullscreen(!fs);
        } catch (error) {
            console.error('切换全屏失败:', error);
        }
    };

    const handleTogglePin = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        try {
            const newState = await invoke<boolean>('toggle_chat_session_pin', { sessionId });
            setSessions(prev => {
                const updated = prev.map(s => s.id === sessionId ? { ...s, is_pinned: newState } : s);
                return updated.sort((a, b) => {
                    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
                    return b.updated_at - a.updated_at;
                });
            });
        } catch (error) {
            console.error('切换置顶失败:', error);
        }
    };

    const handleRenameSession = async (sessionId: string) => {
        const newTitle = editingSessionTitle.trim();
        if (!newTitle) {
            setEditingSessionId(null);
            return;
        }
        try {
            await invoke('update_chat_session_title', { sessionId, title: newTitle });
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s));
            setEditingSessionId(null);
        } catch (error) {
            console.error('重命名失败:', error);
            setEditingSessionId(null);
        }
    };

    const formatTime = (timestamp: number): string => {
        return new Date(timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatSessionTime = (timestamp: number): string => {
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        if (diff < 86400000) {
            return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        } else if (diff < 604800000) {
            const days = Math.floor(diff / 86400000);
            return `${days}天前`;
        } else {
            return date.toLocaleDateString('zh-CN');
        }
    };

    const handleSettingsClose = () => {
        setTempConfig(config);
        setShowSettings(false);
    };

    // 渲染Markdown
    const renderMarkdown = (content: string) => {
        if (!content) return '';
        try {
            const html = marked.parse(content, { breaks: true }) as string;
            return html;
        } catch {
            return content;
        }
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
            {/* 左侧对话历史侧边栏 */}
            <div className="chat-sidebar open">
                <div className="sidebar-header">
                    <h2 className="sidebar-title">对话历史</h2>
                    <button className="new-chat-btn" onClick={handleNewSession} title="新建对话">
                        <span className="new-chat-icon">+</span>
                        <span>新建</span>
                    </button>
                </div>
                <div className="sidebar-list">
                    {sessions.length === 0 ? (
                        <div className="sidebar-empty">
                            <p>暂无对话记录</p>
                            <p className="sidebar-empty-hint">开始一段新对话吧</p>
                        </div>
                    ) : (
                        sessions.map(session => (
                            <div
                                key={session.id}
                                className={`sidebar-item ${currentSessionId === session.id ? 'active' : ''} ${session.is_pinned ? 'pinned' : ''}`}
                                onClick={() => handleLoadSession(session.id)}
                            >
                                <div className="sidebar-item-content">
                                    {editingSessionId === session.id ? (
                                        <input
                                            className="sidebar-item-rename-input"
                                            value={editingSessionTitle}
                                            onChange={(e) => setEditingSessionTitle(e.target.value)}
                                            onBlur={() => handleRenameSession(session.id)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleRenameSession(session.id);
                                                if (e.key === 'Escape') setEditingSessionId(null);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            autoFocus
                                        />
                                    ) : (
                                        <div
                                            className="sidebar-item-title"
                                            onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                setEditingSessionId(session.id);
                                                setEditingSessionTitle(session.title);
                                            }}
                                            title="双击重命名"
                                        >
                                            {session.title}
                                        </div>
                                    )}
                                    <div className="sidebar-item-time">{formatSessionTime(session.updated_at)}</div>
                                </div>
                                <div className="sidebar-item-actions">
                                    <button
                                        className={`sidebar-item-pin ${session.is_pinned ? 'pinned' : ''}`}
                                        onClick={(e) => handleTogglePin(e, session.id)}
                                        title={session.is_pinned ? "取消置顶" : "置顶"}
                                    >
                                        📌
                                    </button>
                                    <button
                                        className="sidebar-item-delete"
                                        onClick={(e) => handleDeleteSession(e, session.id)}
                                        title="删除对话"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* 主聊天区域 */}
            <div className="chat-main">
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
                        <button className="chat-action-btn settings-btn" onClick={() => setShowSettings(true)} title="设置">
                            <span className="chat-action-icon">⚙️</span>
                            <span>设置</span>
                        </button>
                        <button className="chat-action-btn new-chat-action-btn" onClick={handleNewSession} title="开启新对话">
                            <span className="chat-action-icon">💬</span>
                            <span>新对话</span>
                        </button>
                        <button className="chat-action-btn fullscreen-btn" onClick={handleToggleFullscreen} title={isFullscreen ? "退出全屏" : "全屏"}>
                            <span className="chat-action-icon">{isFullscreen ? '⤡' : '⤢'}</span>
                            <span>{isFullscreen ? '退出全屏' : '全屏'}</span>
                        </button>
                        <button className="chat-action-btn close-window-btn" onClick={handleClose} title="关闭窗口">
                            <span className="chat-action-icon">✕</span>
                            <span>关闭</span>
                        </button>
                    </div>
                </div>

                <div className="messages-container">
                    {messages.map((message, index) => (
                        <div
                            key={index}
                            className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'} ${message.isStreaming ? 'streaming' : ''}`}
                        >
                            <div className="message-avatar"></div>
                            <div className="message-content">
                                <div
                                    className="message-text markdown-body"
                                    dangerouslySetInnerHTML={{
                                        __html: message.role === 'assistant'
                                            ? renderMarkdown(message.content)
                                            : escapeHtml(message.content)
                                    }}
                                />
                                <div className="message-time">{formatTime(message.timestamp)}</div>
                            </div>
                        </div>
                    ))}
                    {isLoading && !messages.some(m => m.isStreaming) && (
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

// HTML转义工具函数
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
