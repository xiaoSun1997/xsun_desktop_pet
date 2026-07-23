import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { confirm } from "@tauri-apps/plugin-dialog";
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

type TreeNode = {
    name: string;
    path: string;
    is_dir: boolean;
    children?: TreeNode[];
};

// Spec/Loop 模式类型定义
type LoopStepStatus = 'pending' | 'running' | 'needs_review' | 'completed' | 'failed';

type LoopStep = {
    id: string;
    title: string;
    description: string;
    status: LoopStepStatus;
    result?: string;
    reviewResult?: string;
    error?: string;
};

type SpecDocument = {
    title: string;
    description: string;
    requirements: string[];
    steps: LoopStep[];
};

type ThinkingStep = {
    step: string;
    content: string;
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
    const notepadUnlistenRef = useRef<UnlistenFn | null>(null);
    const isProcessingSummaryRef = useRef(false);
    const lastSummaryRequestRef = useRef<{ content: string; title: string; time: number } | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Tab 导航
    const [activeTab, setActiveTab] = useState<'history' | 'skill' | 'flowchart' | 'spec'>('history');

    // Spec/Loop 模块
    const [specInput, setSpecInput] = useState('');
    const [specDocument, setSpecDocument] = useState<SpecDocument | null>(null);
    const [isGeneratingSpec, setIsGeneratingSpec] = useState(false);
    const [isExecutingLoop, setIsExecutingLoop] = useState(false);
    const [specError, setSpecError] = useState<string | null>(null);
    const [thinkingChain, setThinkingChain] = useState<ThinkingStep[]>([]);

    // Skill 模块
    const [skillFileTree, setSkillFileTree] = useState<TreeNode[]>([]);
    const [skillsDir, setSkillsDir] = useState<string>('');
    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const [selectedFileName, setSelectedFileName] = useState<string>('');
    const [editorContent, setEditorContent] = useState<string>('');
    const [editorMode, setEditorMode] = useState<0 | 1 | 2>(1); // 0=全编辑, 1=分屏, 2=全预览
    const [isFileLoading, setIsFileLoading] = useState(false);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [isShowMdRef, setIsShowMdRef] = useState(false); // Markdown 语法参考
    const [addMenuPos, setAddMenuPos] = useState<{x: number; y: number; folderPath: string} | null>(null);
    const previewRef = useRef<HTMLDivElement>(null);

    // 加载配置
    useEffect(() => {
        checkConfig();
        loadSessions();

        // 监听来自记事本的总结请求
        const setupNotepadListener = async () => {
            // 先清理之前的监听器，防止 Strict Mode 下重复注册
            if (notepadUnlistenRef.current) {
                notepadUnlistenRef.current();
                notepadUnlistenRef.current = null;
            }
            try {
                const unlisten = await listen<{ content: string; title: string }>('notepad://ai-summarize', async (event) => {
                    const { content, title } = event.payload;
                    await sendSummaryRequest(content, title);
                });
                notepadUnlistenRef.current = unlisten;
            } catch (error) {
                console.error('设置记事本监听失败:', error);
            }
        };
        setupNotepadListener();

        // 清理监听器
        return () => {
            if (notepadUnlistenRef.current) {
                notepadUnlistenRef.current();
                notepadUnlistenRef.current = null;
            }
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

    // ===== 处理来自记事本的总结请求 =====
    const sendSummaryRequest = async (content: string, title: string) => {
        // 防止并发重复创建会话
        if (isProcessingSummaryRef.current) return;

        // 去重：相同内容+标题在 5 秒内不重复处理
        const now = Date.now();
        const lastReq = lastSummaryRequestRef.current;
        if (lastReq && lastReq.content === content && lastReq.title === title && (now - lastReq.time) < 5000) {
            return;
        }
        lastSummaryRequestRef.current = { content, title, time: now };

        isProcessingSummaryRef.current = true;
        try {
            // 创建新会话
            const session = await invoke<Session>('create_chat_session');
            await invoke('update_chat_session_title', { sessionId: session.id, title: `${title} 总结` });

            setSessions(prev => [session, ...prev]);
            setCurrentSessionId(session.id);

            // 准备消息
            const userMessage: Message = {
                role: 'user',
                content: `${content}\n\n帮我总结一下上述内容`,
                timestamp: Date.now(),
            };
            const assistantMessage: Message = {
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                isStreaming: true,
            };

            setMessages([userMessage, assistantMessage]);
            streamingContent.current = '';
            setIsLoading(true);

            let streamComplete = false;
            const tokenHandler = (token: string) => {
                streamingContent.current += token;
                setMessages(prev => {
                    const newMsgs = [...prev];
                    const lastMsg = newMsgs[newMsgs.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isStreaming) {
                        newMsgs[newMsgs.length - 1] = { ...lastMsg, content: streamingContent.current };
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
                        newMsgs[newMsgs.length - 1] = { ...lastMsg, isStreaming: false, timestamp: Date.now() };
                    }
                    return newMsgs;
                });
                setIsLoading(false);
                loadSessions();
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
                                isStreaming: false,
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

            await invoke('stream_chat_message', {
                messages: [{ role: 'user', content: userMessage.content }],
                sessionId: session.id,
            });
        } catch (error) {
            console.error('处理记事本总结请求失败:', error);
            setIsLoading(false);
        } finally {
            isProcessingSummaryRef.current = false;
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

    // ===== Spec/Loop 模块函数 =====
    const handleGenerateSpec = async () => {
        if (!specInput.trim() || isGeneratingSpec) return;
        
        setIsGeneratingSpec(true);
        setSpecError(null);
        setSpecDocument(null);
        
        try {
            // 使用AI生成Spec文档
            const specPrompt = `根据以下需求描述，生成一个结构化的Spec文档和执行步骤。

需求：${specInput}

请以JSON格式返回，包含以下字段：
{
  "title": "项目标题",
  "description": "项目描述",
  "requirements": ["需求1", "需求2", ...],
  "steps": [
    {"id": "1", "title": "步骤标题", "description": "步骤描述"},
    ...
  ]
}`;
            
            const chatMessages: ChatMessage[] = [
                { role: 'user', content: specPrompt }
            ];
            
            // 调用AI生成
            const result = await invoke<string>('send_chat_message', { messages: chatMessages });
            
            // 解析JSON结果
            try {
                let jsonStr: string | null = null;

                // 策略1: 优先提取 ```json ... ``` 代码块
                const jsonBlockMatch = result.match(/```json\s*\n?([\s\S]*?)\n?```/);
                if (jsonBlockMatch) {
                    jsonStr = jsonBlockMatch[1].trim();
                }

                // 策略2: 提取 ``` ... ``` 通用代码块
                if (!jsonStr) {
                    const codeBlockMatch = result.match(/```\s*\n?([\s\S]*?)\n?```/);
                    if (codeBlockMatch && codeBlockMatch[1].trim().startsWith('{')) {
                        jsonStr = codeBlockMatch[1].trim();
                    }
                }

                // 策略3: 从文本中提取第一个完整的JSON对象（非贪婪逐层匹配）
                if (!jsonStr) {
                    const jsonObjMatch = result.match(/\{(?:[^{}]|\{[^{}]*\})*\}/);
                    if (jsonObjMatch) {
                        jsonStr = jsonObjMatch[0];
                    }
                }

                // 策略4: fallback - 贪婪匹配（最后手段）
                if (!jsonStr) {
                    const greedyMatch = result.match(/\{[\s\S]*\}/);
                    if (greedyMatch) {
                        jsonStr = greedyMatch[0];
                    }
                }

                if (jsonStr) {
                    const parsed = JSON.parse(jsonStr) as SpecDocument;
                    // 为每个步骤添加初始状态
                    const stepsWithStatus = parsed.steps.map((step, index) => ({
                        ...step,
                        id: step.id || String(index + 1),
                        status: 'pending' as LoopStepStatus
                    }));
                    setSpecDocument({
                        ...parsed,
                        steps: stepsWithStatus
                    });
                } else {
                    setSpecError('AI返回的格式不正确，请重试');
                }
            } catch (parseErr) {
                console.error('解析Spec JSON失败:', parseErr);
                setSpecError('解析AI返回内容失败，请重试');
            }
        } catch (err) {
            console.error('生成Spec失败:', err);
            setSpecError(`生成失败: ${err}`);
        } finally {
            setIsGeneratingSpec(false);
        }
    };

    const handleExecuteLoopStep = async (stepId: string) => {
        if (!specDocument || isExecutingLoop) return;
        
        // 更新步骤状态为运行中
        setSpecDocument(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                steps: prev.steps.map(step => 
                    step.id === stepId ? { ...step, status: 'running' as LoopStepStatus } : step
                )
            };
        });
        
        setIsExecutingLoop(true);
        
        try {
            const step = specDocument.steps.find(s => s.id === stepId);
            if (!step) throw new Error('步骤不存在');
            
            // 构建执行提示
            const executePrompt = `你是一个执行者。请根据以下Spec文档和步骤描述，生成该步骤的执行结果。

## Spec文档
标题：${specDocument.title}
描述：${specDocument.description}

## 当前执行步骤
标题：${step.title}
描述：${step.description}

请直接输出该步骤的执行结果内容。`;
            
            const chatMessages: ChatMessage[] = [
                { role: 'user', content: executePrompt }
            ];
            
            const result = await invoke<string>('send_chat_message', { messages: chatMessages });
            
            // 记录思考链
            setThinkingChain(prev => [...prev, { step: step.title, content: `执行完成，等待审核。` }]);

            // 更新步骤状态为需审核
            setSpecDocument(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    steps: prev.steps.map(step => 
                        step.id === stepId ? { ...step, status: 'needs_review' as LoopStepStatus, result } : step
                    )
                };
            });
        } catch (err) {
            console.error('执行步骤失败:', err);
            setSpecDocument(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    steps: prev.steps.map(step => 
                        step.id === stepId ? { ...step, status: 'failed' as LoopStepStatus, error: String(err) } : step
                    )
                };
            });
        } finally {
            setIsExecutingLoop(false);
        }
    };

    const handleExecuteAllSteps = async () => {
        if (!specDocument || isExecutingLoop) return;
        
        for (const step of specDocument.steps) {
            if (step.status === 'pending') {
                await handleExecuteLoopStep(step.id);
            }
        }
    };

    const handleReviewStep = async (stepId: string, approved: boolean) => {
        if (!specDocument) return;
        
        const step = specDocument.steps.find(s => s.id === stepId);
        if (!step || step.status !== 'needs_review') return;

        if (approved) {
            // 审核通过
            setSpecDocument(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    steps: prev.steps.map(s => 
                        s.id === stepId ? { ...s, status: 'completed' as LoopStepStatus, reviewResult: 'approved' } : s
                    )
                };
            });
            setThinkingChain(prev => [...prev, { step: step.title, content: '审核通过。' }]);
        } else {
            // 驳回 - 回退到 pending 并清除结果
            setSpecDocument(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    steps: prev.steps.map(s => 
                        s.id === stepId ? { ...s, status: 'pending' as LoopStepStatus, result: undefined, reviewResult: 'rejected', error: '审核未通过，请重新执行' } : s
                    )
                };
            });
            setThinkingChain(prev => [...prev, { step: step.title, content: '审核驳回，需重新执行。' }]);
        }
    };

    const handleResetSpec = () => {
        setSpecDocument(null);
        setSpecInput('');
        setSpecError(null);
    };

    // ===== Skill 模块函数 =====
    const loadSkillTree = async () => {
        try {
            const dir = await invoke<string>('get_skills_dir');
            setSkillsDir(dir);
            const tree = await invoke<TreeNode[]>('list_skills_directory');
            setSkillFileTree(tree);
        } catch (error) {
            console.error('加载skills目录失败:', error);
        }
    };

    const toggleFolder = (path: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return next;
        });
    };

    const handleSkillFileClick = async (file: TreeNode) => {
        if (file.is_dir) {
            toggleFolder(file.path);
            return;
        }
        try {
            setIsFileLoading(true);
            setSelectedFileName(file.name);
            const fullPath = `${skillsDir}\\${file.path}`;
            const content = await invoke<string>('read_text_file', { path: fullPath });
            setSelectedFilePath(file.path);
            setEditorContent(content);
        } catch (error) {
            console.error('读取文件失败:', error);
            setEditorContent(`// 读取文件失败: ${error}`);
        } finally {
            setIsFileLoading(false);
        }
    };

    const handleSaveSkillFile = async () => {
        if (!selectedFilePath) return;
        try {
            const fullPath = `${skillsDir}\\${selectedFilePath}`;
            await invoke('write_text_file', { path: fullPath, content: editorContent });
            const tree = await invoke<TreeNode[]>('list_skills_directory');
            setSkillFileTree(tree);
            alert('保存成功');
        } catch (error) {
            console.error('保存文件失败:', error);
            alert(`保存失败: ${error}`);
        }
    };

    const handleUploadFile = async () => {
        try {
            const selected = await open({
                multiple: true,
                title: '选择要上传的文件或文件夹',
            });
            if (!selected) return;
            const paths = Array.isArray(selected) ? selected : [selected];
            for (const srcPath of paths) {
                await invoke('copy_to_skills', { sourcePath: srcPath });
            }
            const tree = await invoke<TreeNode[]>('list_skills_directory');
            setSkillFileTree(tree);
        } catch (error) {
            console.error('上传文件失败:', error);
            alert(`上传失败: ${error}`);
        }
    };

    const handleDeleteSkillItem = async (filePath: string, isDir: boolean) => {
        const msg = isDir ? `确定要删除文件夹 "${filePath}" 及其所有内容吗？` : `确定要删除文件 "${filePath}" 吗？`;
        const confirmed = await confirm(msg, { title: "确认删除", kind: "warning" });
        if (!confirmed) return;
        try {
            await invoke('delete_skill_item', { filePath, isDir });
            const tree = await invoke<TreeNode[]>('list_skills_directory');
            setSkillFileTree(tree);
            if (selectedFilePath === filePath) {
                setSelectedFilePath(null);
                setSelectedFileName('');
                setEditorContent('');
            }
        } catch (error) {
            console.error('删除失败:', error);
            alert(`删除失败: ${error}`);
        }
    };

    const handleToggleEditorMode = () => {
        setEditorMode(((editorMode + 1) % 3) as 0 | 1 | 2);
    };

    // ========== Markdown 语法参考数据 ==========
    const markdownRefItems = [
        {
            title: '标题 (Headings)',
            demo: (
                <>
                    <code># 一级标题</code><br />
                    <code>## 二级标题</code><br />
                    <code>### 三级标题</code>
                    <span className="mdref-result">使用 # 号数量控制级别，最多 ######</span>
                </>
            ),
        },
        {
            title: '粗体 & 斜体',
            demo: (
                <>
                    <code>**粗体文字**</code> 或 <code>__粗体__</code><br />
                    <code>*斜体文字*</code> 或 <code>_斜体_</code><br />
                    <code>***粗斜体***</code>
                    <span className="mdref-result">使用 * 或 _ 包裹文字</span>
                </>
            ),
        },
        {
            title: '链接',
            demo: (
                <>
                    <code>[显示文字](https://链接)</code><br />
                    <code>[带标题](链接 "鼠标悬停提示")</code>
                    <span className="mdref-result">方括号放文字，圆括号放 URL</span>
                </>
            ),
        },
        {
            title: '图片',
            demo: (
                <>
                    <code>![替代文字](图片URL)</code><br />
                    <code>[![点击图片](img.jpg)](链接)</code>
                    <span className="mdref-result">前面加 ! 号表示图片</span>
                </>
            ),
        },
        {
            title: '无序列表',
            demo: (
                <>
                    <code>- 项目一</code><br />
                    <code>* 项目二</code><br />
                    <code>  - 嵌套项目</code>
                    <span className="mdref-result">使用 -、* 或 +</span>
                </>
            ),
        },
        {
            title: '有序列表',
            demo: (
                <>
                    <code>1. 第一项</code><br />
                    <code>2. 第二项</code><br />
                    <code>   1. 子项（缩进）</code>
                    <span className="mdref-result">数字加点号，自动排序</span>
                </>
            ),
        },
        {
            title: '代码',
            demo: (
                <>
                    <code>`行内代码`</code><br />
                    <code>```语言</code><br />
                    <code>代码块</code><br />
                    <code>```</code>
                    <span className="mdref-result">三个反引号包裹多行代码块</span>
                </>
            ),
        },
        {
            title: '表格',
            demo: (
                <>
                    <code>| 列1 | 列2 |</code><br />
                    <code>| --- | --- |</code><br />
                    <code>| A | B |</code>
                    <span className="mdref-result">对齐：:---（左）:---:（中）---:（右）</span>
                </>
            ),
        },
        {
            title: '引用',
            demo: (
                <>
                    <code>&gt; 这是一段引用</code><br />
                    <code>&gt;&gt; 嵌套引用</code><br />
                    <code>&gt; **引号内可放其他语法**</code>
                    <span className="mdref-result">使用 &gt; 符号</span>
                </>
            ),
        },
        {
            title: '分割线',
            demo: (
                <>
                    <code>---</code> 或 <code>***</code> 或 <code>___</code>
                    <span className="mdref-result">三个或更多星号/短横线/下划线</span>
                </>
            ),
        },
    ];

    const handleUploadFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                title: '选择要上传的文件夹',
            });
            if (!selected) return;
            const paths = Array.isArray(selected) ? selected : [selected];
            for (const srcPath of paths) {
                await invoke('copy_to_skills', { sourcePath: srcPath });
            }
            const tree = await invoke<TreeNode[]>('list_skills_directory');
            setSkillFileTree(tree);
        } catch (error) {
            console.error('上传文件夹失败:', error);
            alert(`上传失败: ${error}`);
        }
    };

    const handleNewFolderIn = async (parentPath: string) => {
        setAddMenuPos(null);
        const name = prompt('请输入文件夹名称:');
        if (!name || !name.trim()) return;
        try {
            await invoke('create_skill_folder', { name: name.trim(), parentPath });
            const tree = await invoke<TreeNode[]>('list_skills_directory');
            setSkillFileTree(tree);
        } catch (error) {
            console.error('创建文件夹失败:', error);
            alert(`创建失败: ${error}`);
        }
    };

    const handleNewFileIn = async (parentPath: string) => {
        setAddMenuPos(null);
        const name = prompt('请输入文件名 (例如: script.py 或 skill.md):');
        if (!name || !name.trim()) return;
        try {
            const relativePath = parentPath ? `${parentPath}/${name.trim()}` : name.trim();
            await invoke('create_skill_file', { relativePath });
            const tree = await invoke<TreeNode[]>('list_skills_directory');
            setSkillFileTree(tree);
            // 在编辑器中打开新文件
            const fullPath = `${skillsDir}\\${relativePath}`;
            const content = await invoke<string>('read_text_file', { path: fullPath });
            setSelectedFilePath(relativePath);
            setSelectedFileName(name.trim());
            setEditorContent(content);
        } catch (error) {
            console.error('创建文件失败:', error);
            alert(`创建失败: ${error}`);
        }
    };

    const handleFolderAddClick = (folderPath: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setAddMenuPos({
            x: rect.left,
            y: rect.bottom + 4,
            folderPath,
        });
    };

    // 点击外部关闭菜单
    useEffect(() => {
        const handleClickOutside = () => setAddMenuPos(null);
        if (addMenuPos) {
            document.addEventListener('click', handleClickOutside);
        }
        return () => document.removeEventListener('click', handleClickOutside);
    }, [addMenuPos]);

    const getEditorMode = (filename: string): 'markdown' | 'python' | 'plain' => {
        if (filename.endsWith('.md') || filename.endsWith('.markdown')) return 'markdown';
        if (filename.endsWith('.py') || filename.endsWith('.pyw')) return 'python';
        return 'plain';
    };

    // 当activeTab变为skill时加载目录树
    useEffect(() => {
        if (activeTab === 'skill') {
            loadSkillTree();
        }
        setEditorMode(1);
    }, [activeTab]);

    // 切换文件时重置预览状态
    useEffect(() => {
        setEditorMode(1);
    }, [selectedFilePath]);

    // Markdown预览代码块添加复制按钮
    useEffect(() => {
        if (editorMode === 0 || !previewRef.current) return;
        const preElements = previewRef.current.querySelectorAll('pre');
        preElements.forEach((pre) => {
            if (pre.querySelector('.copy-code-btn')) return;
            const btn = document.createElement('button');
            btn.className = 'copy-code-btn';
            btn.textContent = '📋 复制';
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const code = pre.querySelector('code');
                const text = code ? code.textContent || '' : pre.textContent || '';
                try {
                    await navigator.clipboard.writeText(text);
                    btn.textContent = '✅ 已复制';
                    btn.classList.add('copied');
                    setTimeout(() => {
                        btn.textContent = '📋 复制';
                        btn.classList.remove('copied');
                    }, 2000);
                } catch {
                    btn.textContent = '❌ 失败';
                    setTimeout(() => {
                        btn.textContent = '📋 复制';
                    }, 2000);
                }
            });
            pre.appendChild(btn);
        });
    }, [editorMode, editorContent]);

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

    // ===== 渲染文件树 =====
    const renderFileTree = (
        nodes: TreeNode[],
        parentPath: string,
        expandedSet: Set<string>,
        onToggle: (path: string) => void,
        onClick: (file: TreeNode) => void,
        onDelete: (path: string, isDir: boolean) => void,
        onAddClick: (path: string, e: React.MouseEvent) => void
    ): React.ReactNode => {
        return nodes.map(node => {
            const fullPath = parentPath ? `${parentPath}/${node.name}` : node.path;
            if (node.is_dir) {
                const isExpanded = expandedSet.has(node.path);
                return (
                    <div key={node.path} className="skill-tree-node">
                        <div
                            className="skill-tree-folder"
                            onClick={() => onToggle(node.path)}
                        >
                            <span className="skill-tree-arrow">{isExpanded ? '▼' : '▶'}</span>
                            <span className="skill-tree-folder-icon">{isExpanded ? '📂' : '📁'}</span>
                            <span className="skill-tree-name">{node.name}</span>
                            <button
                                className="skill-tree-add"
                                onClick={(e) => onAddClick(node.path, e)}
                                title="新建文件或文件夹"
                            >+</button>
                            <button
                                className="skill-tree-delete"
                                onClick={(e) => { e.stopPropagation(); onDelete(node.path, true); }}
                                title="删除文件夹"
                            >🗑️</button>
                        </div>
                        {isExpanded && node.children && (
                            <div className="skill-tree-children">
                                {renderFileTree(node.children, fullPath, expandedSet, onToggle, onClick, onDelete, onAddClick)}
                            </div>
                        )}
                    </div>
                );
            }
            return (
                <div key={node.path} className="skill-tree-node">
                    <div
                        className="skill-tree-file"
                        onClick={() => onClick(node)}
                    >
                        <span className="skill-tree-file-icon">
                            {node.name.endsWith('.md') ? '📝' : node.name.endsWith('.py') ? '🐍' : '📄'}
                        </span>
                        <span className="skill-tree-name">{node.name}</span>
                        <button
                            className="skill-tree-delete"
                            onClick={(e) => { e.stopPropagation(); onDelete(node.path, false); }}
                            title="删除文件"
                        >🗑️</button>
                    </div>
                </div>
            );
        });
    };

    return (
        <div className="ai-chat-container">
            {/* 左侧边栏 */}
            <div className="chat-sidebar">
                {/* Tab 内容区域 */}
                <div className="sidebar-content">
                    {activeTab === 'history' && (
                        <>
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
                        </>
                    )}
                    {activeTab === 'skill' && (
                        <div className="skill-tree-panel">
                            <div className="skill-tree-header">
                                <span className="skill-tree-title">📁 Skills</span>
                                <button
                                    className="skill-tree-add-root"
                                    onClick={(e) => handleFolderAddClick('', e)}
                                    title="新建文件或文件夹"
                                >+</button>
                            </div>
                            <div className="skill-tree">
                                {renderFileTree(skillFileTree, '', expandedFolders, toggleFolder, handleSkillFileClick, handleDeleteSkillItem, handleFolderAddClick)}
                                {skillFileTree.length === 0 && (
                                    <div className="skill-tree-empty">
                                        <p>暂无技能文件</p>
                                        <p className="skill-tree-hint">点击上传添加</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    {activeTab === 'flowchart' && (
                        <div className="sidebar-tab-placeholder">
                            <div className="placeholder-icon">📊</div>
                            <p>流程图绘制</p>
                            <span>开发中...</span>
                        </div>
                    )}
                </div>

                {/* 底部导航 */}
                <div className="sidebar-nav">
                    <button
                        className={`sidebar-nav-item ${activeTab === 'history' ? 'active' : ''}`}
                        onClick={() => setActiveTab('history')}
                    >
                        <span className="nav-icon">💬</span>
                        <span className="nav-label">对话</span>
                    </button>
                    <button
                        className={`sidebar-nav-item ${activeTab === 'skill' ? 'active' : ''}`}
                        onClick={() => setActiveTab('skill')}
                    >
                        <span className="nav-icon">⚙️</span>
                        <span className="nav-label">Skill</span>
                    </button>
                    <button
                        className={`sidebar-nav-item ${activeTab === 'flowchart' ? 'active' : ''}`}
                        onClick={() => setActiveTab('flowchart')}
                    >
                        <span className="nav-icon">📊</span>
                        <span className="nav-label">流程图</span>
                    </button>
                    <button
                        className={`sidebar-nav-item ${activeTab === 'spec' ? 'active' : ''}`}
                        onClick={() => setActiveTab('spec')}
                    >
                        <span className="nav-icon">📋</span>
                        <span className="nav-label">Spec</span>
                    </button>
                </div>
            </div>

            {/* 主内容区域 */}
            <div className="chat-main">
                {activeTab === 'history' && (
                    <>
                        <div className="ai-chat-header" data-tauri-drag-region>
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
                                                __html: renderMarkdown(message.content)
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
                    </>
                )}

                {activeTab === 'skill' && (
                    <div className="skill-main">
                        <div className="skill-toolbar">
                            <h3 className="skill-toolbar-title">Skill 管理器</h3>
                            <div className="skill-toolbar-actions">
                                <button className="skill-toolbar-btn upload-btn" onClick={handleUploadFile} title="上传文件">
                                    📁 上传文件
                                </button>
                                <button className="skill-toolbar-btn upload-folder-btn" onClick={handleUploadFolder} title="上传文件夹">
                                    📂 上传文件夹
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
                        <div className="skill-editor-area">
                            {selectedFileName ? (
                                <div className="skill-editor-container">
                                    <div className="skill-editor-header">
                                        <div className="skill-editor-file-info">
                                            <span className={`skill-editor-file-icon ${getEditorMode(selectedFileName) === 'markdown' ? 'md-icon' : getEditorMode(selectedFileName) === 'python' ? 'py-icon' : ''}`}>
                                                {getEditorMode(selectedFileName) === 'markdown' ? '📝' : getEditorMode(selectedFileName) === 'python' ? '🐍' : '📄'}
                                            </span>
                                            <span className="skill-editor-filename">{selectedFileName}</span>
                                            <span className="skill-editor-mode">{getEditorMode(selectedFileName).toUpperCase()}</span>
                                        </div>
                                        <div className="skill-editor-actions">
                                            {getEditorMode(selectedFileName) === 'markdown' && (
                                                <>
                                                    <button
                                                        className={`skill-editor-btn ${
                                                            editorMode === 0 ? 'skill-edit-btn' :
                                                            editorMode === 2 ? 'skill-preview-btn' : 'skill-split-btn'
                                                        }`}
                                                        onClick={handleToggleEditorMode}
                                                        title={
                                                            editorMode === 0 ? '全编辑模式' :
                                                            editorMode === 1 ? '分屏模式' : '全预览模式'
                                                        }
                                                    >
                                                        <span className="btn-text">
                                                            {editorMode === 0 ? '全编辑' : editorMode === 1 ? '分屏' : '全预览'}
                                                        </span>
                                                    </button>
                                                    <button
                                                        className={`skill-mdref-btn ${isShowMdRef ? 'active' : ''}`}
                                                        onClick={() => setIsShowMdRef(!isShowMdRef)}
                                                        title={isShowMdRef ? '关闭语法参考' : 'Markdown 语法参考'}
                                                    >
                                                        📘 语法
                                                    </button>
                                                </>
                                            )}
                                            <button className="skill-editor-btn skill-save-btn" onClick={handleSaveSkillFile} title="保存文件">
                                                <span className="btn-text">保存</span>
                                            </button>
                                            <button className="skill-editor-btn skill-close-editor-btn" onClick={() => {
                                                setSelectedFilePath(null);
                                                setSelectedFileName('');
                                                setEditorContent('');
                                                setEditorMode(1);
                                                setIsShowMdRef(false);
                                            }} title="关闭编辑器">
                                                <span className="btn-text">关闭</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div className={`skill-editor-body${isShowMdRef ? ' with-mdref-panel' : ''}`}>
                                        {isFileLoading ? (
                                            <div className="skill-editor-loading">加载中...</div>
                                        ) : getEditorMode(selectedFileName) === 'markdown' ? (
                                            <>
                                                {editorMode === 2 ? (
                                                    <div
                                                        ref={previewRef}
                                                        className="skill-editor-preview markdown-body"
                                                        dangerouslySetInnerHTML={{ __html: renderMarkdown(editorContent) }}
                                                    />
                                                ) : editorMode === 1 ? (
                                                    <div className="skill-editor-split">
                                                        <div className="skill-editor-split-edit">
                                                            <textarea
                                                                className="skill-editor-textarea"
                                                                value={editorContent}
                                                                onChange={(e) => setEditorContent(e.target.value)}
                                                                spellCheck={false}
                                                                placeholder="开始编写 Markdown 内容..."
                                                            />
                                                        </div>
                                                        <div
                                                            className="skill-editor-split-preview markdown-body"
                                                            dangerouslySetInnerHTML={{ __html: renderMarkdown(editorContent) }}
                                                        />
                                                    </div>
                                                ) : (
                                                    <textarea
                                                        className="skill-editor-textarea"
                                                        value={editorContent}
                                                        onChange={(e) => setEditorContent(e.target.value)}
                                                        spellCheck={false}
                                                        placeholder="开始编写 Markdown 内容..."
                                                    />
                                                )}
                                                {/* Markdown 语法参考面板 */}
                                                {isShowMdRef && (
                                                    <div className="skill-mdref-panel">
                                                        <div className="skill-mdref-header">
                                                            <span className="skill-mdref-title">📘 Markdown 语法参考</span>
                                                            <button className="skill-mdref-close" onClick={() => setIsShowMdRef(false)}>✕</button>
                                                        </div>
                                                        <div className="skill-mdref-body">
                                                            {markdownRefItems.map((item, idx) => (
                                                                <div key={idx} className="skill-mdref-item">
                                                                    <div className="skill-mdref-item-title">{item.title}</div>
                                                                    <div className="skill-mdref-item-demo">{item.demo}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <textarea
                                                className="skill-editor-textarea"
                                                value={editorContent}
                                                onChange={(e) => setEditorContent(e.target.value)}
                                                spellCheck={false}
                                            />
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="skill-empty-state">
                                    <div className="skill-empty-icon">📂</div>
                                    <h3>选择或上传 Skill 文件</h3>
                                    <p>从左侧文件树中选择一个文件进行编辑</p>
                                    <p className="skill-empty-hint">支持 .md (Markdown) 和 .py (Python) 文件</p>
                                    <button className="skill-upload-btn" onClick={handleUploadFile}>
                                        📤 上传文件
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'flowchart' && (
                    <div className="flowchart-main">
                        <div className="flowchart-header">
                            <h3 className="flowchart-title">流程图绘制</h3>
                            <div className="header-actions">
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
                        <div className="flowchart-placeholder">
                            <div className="flowchart-icon">📊</div>
                            <h3>流程图绘制</h3>
                            <p>功能开发中，敬请期待...</p>
                        </div>
                    </div>
                )}

                {activeTab === 'spec' && (
                    <div className="spec-main">
                        <div className="spec-header">
                            <h3 className="spec-title">📋 Spec 模式</h3>
                            <div className="header-actions">
                                {specDocument && (
                                    <button className="chat-action-btn" onClick={handleResetSpec} title="重置Spec">
                                        <span className="chat-action-icon">🔄</span>
                                        <span>重置</span>
                                    </button>
                                )}
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
                        
                        <div className="spec-content">
                            {/* Spec 输入区域 */}
                            {!specDocument && (
                                <div className="spec-input-section">
                                    <div className="spec-input-header">
                                        <h4>输入你的需求</h4>
                                        <p>描述你想要实现的功能，AI将为你生成结构化的Spec文档和执行步骤</p>
                                    </div>
                                    <textarea
                                        className="spec-textarea"
                                        value={specInput}
                                        onChange={(e) => setSpecInput(e.target.value)}
                                        placeholder="例如：创建一个用户登录系统，包含注册、登录、忘记密码功能..."
                                        disabled={isGeneratingSpec}
                                    />
                                    <button 
                                        className={`spec-generate-btn ${specInput.trim() && !isGeneratingSpec ? 'active' : ''}`}
                                        onClick={handleGenerateSpec}
                                        disabled={!specInput.trim() || isGeneratingSpec}
                                    >
                                        {isGeneratingSpec ? (
                                            <>
                                                <div className="spec-spinner"></div>
                                                生成中...
                                            </>
                                        ) : (
                                            <>
                                                <span>✨</span>
                                                生成 Spec
                                            </>
                                        )}
                                    </button>
                                    {specError && (
                                        <div className="spec-error">
                                            <span className="spec-error-icon">⚠️</span>
                                            {specError}
                                        </div>
                                    )}
                                </div>
                            )}
                            
                            {/* Spec 文档展示 */}
                            {specDocument && (
                                <div className="spec-document">
                                    <div className="spec-card">
                                        <div className="spec-card-header">
                                            <h4>{specDocument.title}</h4>
                                            <span className="spec-steps-count">{specDocument.steps.length} 个步骤</span>
                                        </div>
                                        <p className="spec-description">{specDocument.description}</p>
                                        
                                        {specDocument.requirements.length > 0 && (
                                            <div className="spec-requirements">
                                                <h5>需求列表</h5>
                                                <ul>
                                                    {specDocument.requirements.map((req, idx) => (
                                                        <li key={idx}>{req}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* ThinkingChain 思考链 */}
                                    {thinkingChain.length > 0 && (
                                        <details className="spec-thinking-chain">
                                            <summary className="spec-thinking-summary">
                                                🧠 思考链 ({thinkingChain.length} 步)
                                            </summary>
                                            <div className="spec-thinking-list">
                                                {thinkingChain.map((t, idx) => (
                                                    <div key={idx} className="spec-thinking-item">
                                                        <span className="spec-thinking-step">{idx + 1}. {t.step}</span>
                                                        <span className="spec-thinking-content">{t.content}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </details>
                                    )}

                                    {/* Loop 步骤列表 */}
                                    <div className="spec-steps-section">
                                        <div className="spec-steps-header">
                                            <h4>执行步骤</h4>
                                            <button 
                                                className="spec-execute-all-btn"
                                                onClick={handleExecuteAllSteps}
                                                disabled={isExecutingLoop || specDocument.steps.every(s => s.status === 'completed')}
                                            >
                                                {isExecutingLoop ? '执行中...' : '执行全部'}
                                            </button>
                                        </div>
                                        
                                        <div className="spec-steps-list">
                                            {specDocument.steps.map((step, idx) => (
                                                <div key={step.id} className={`spec-step spec-step-${step.status}`}>
                                                    <div className="spec-step-header">
                                                        <div className="spec-step-number">
                                                            {step.status === 'completed' ? '✅' : 
                                                             step.status === 'running' ? '⏳' : 
                                                             step.status === 'needs_review' ? '🧐' :
                                                             step.status === 'failed' ? '❌' : `${idx + 1}`}
                                                        </div>
                                                        <div className="spec-step-info">
                                                            <h5>{step.title}</h5>
                                                            <p>{step.description}</p>
                                                        </div>
                                                        {step.status === 'pending' && (
                                                            <button 
                                                                className="spec-step-execute-btn"
                                                                onClick={() => handleExecuteLoopStep(step.id)}
                                                                disabled={isExecutingLoop}
                                                            >
                                                                执行
                                                            </button>
                                                        )}
                                                        {step.status === 'needs_review' && (
                                                            <div className="spec-review-btns">
                                                                <button 
                                                                    className="spec-review-approve-btn"
                                                                    onClick={() => handleReviewStep(step.id, true)}
                                                                >
                                                                    ✓ 通过
                                                                </button>
                                                                <button 
                                                                    className="spec-review-reject-btn"
                                                                    onClick={() => handleReviewStep(step.id, false)}
                                                                >
                                                                    ✕ 驳回
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                    
                                                    {step.result && (
                                                        <div className="spec-step-result">
                                                            <div className="spec-step-result-header">执行结果</div>
                                                            <div className="spec-step-result-content markdown-body" 
                                                                dangerouslySetInnerHTML={{ __html: renderMarkdown(step.result) }} 
                                                            />
                                                        </div>
                                                    )}
                                                    
                                                    {step.error && (
                                                        <div className="spec-step-error">
                                                            <span className="spec-step-error-icon">⚠️</span>
                                                            {step.error}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 右键菜单 - 新建文件/文件夹 */}
            {addMenuPos && (
                <div
                    className="context-menu-overlay"
                    onClick={() => setAddMenuPos(null)}
                />
            )}
            {addMenuPos && (
                <div
                    className="folder-context-menu"
                    style={{
                        left: addMenuPos.x,
                        top: addMenuPos.y,
                    }}
                >
                    <div
                        className="context-menu-item"
                        onClick={() => handleNewFolderIn(addMenuPos.folderPath)}
                    >
                        <span className="context-menu-icon">📁</span>
                        <span>新建文件夹</span>
                    </div>
                    <div
                        className="context-menu-item"
                        onClick={() => handleNewFileIn(addMenuPos.folderPath)}
                    >
                        <span className="context-menu-icon">📄</span>
                        <span>新建文件</span>
                    </div>
                </div>
            )}

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


