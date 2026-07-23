import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import "./TranslatorComponent.css";

type YoudaoConfig = {
    appKey: string;
    appSecret: string;
    baseUrl: string;
};

type TranslationPanel = {
    id: string;
    sourceLanguage: string;
    targetLanguage: string;
    sourceText: string;
    translatedText: string;
    isTranslating: boolean;
};

type Language = {
    code: string;
    name: string;
};

const SUPPORTED_LANGUAGES: Language[] = [
    { code: 'auto', name: '自动检测' },
    { code: 'zh-CHS', name: '中文简体' },
    { code: 'zh-CHT', name: '中文繁体' },
    { code: 'en', name: '英文' },
    { code: 'ja', name: '日文' },
    { code: 'ko', name: '韩文' },
    { code: 'fr', name: '法文' },
    { code: 'de', name: '德文' },
    { code: 'ru', name: '俄文' },
    { code: 'es', name: '西班牙文' },
    { code: 'pt', name: '葡萄牙文' },
    { code: 'it', name: '意大利文' },
    { code: 'ar', name: '阿拉伯文' },
    { code: 'hi', name: '印地文' },
    { code: 'th', name: '泰文' },
    { code: 'vi', name: '越南文' },
    { code: 'id', name: '印尼文' },
    { code: 'ms', name: '马来文' },
    { code: 'tr', name: '土耳其文' },
];

export default function TranslatorComponent() {
    const [config, setConfig] = useState<YoudaoConfig>({
        appKey: '',
        appSecret: '',
        baseUrl: 'https://openapi.youdao.com/api'
    });
    const [showSettings, setShowSettings] = useState(false);
    const [tempConfig, setTempConfig] = useState<YoudaoConfig>({
        appKey: '',
        appSecret: '',
        baseUrl: 'https://openapi.youdao.com/api'
    });
    const [configError, setConfigError] = useState<string | null>(null);
    const [translationPanels, setTranslationPanels] = useState<TranslationPanel[]>([
        {
            id: '1',
            sourceLanguage: 'auto',
            targetLanguage: 'en',
            sourceText: '',
            translatedText: '',
            isTranslating: false
        }
    ]);
    const [inputText, setInputText] = useState('');
    const [inputLanguage, setInputLanguage] = useState('auto');
    const [isAutoTranslating, setIsAutoTranslating] = useState(false);

    // 检测文本是否包含中文
    const containsChinese = (text: string): boolean => {
        return /[一-鿿]/.test(text);
    };

    // 智能设置语言并自动翻译
    const autoDetectAndTranslate = async (text: string) => {
        if (!text.trim() || !config.appKey) return;
        
        const hasChinese = containsChinese(text);
        const fromLang = hasChinese ? 'zh-CHS' : 'en';
        const toLang = hasChinese ? 'en' : 'zh-CHS';
        
        setInputLanguage(fromLang);
        
        // 更新第一个翻译面板的目标语言
        if (translationPanels.length > 0) {
            updatePanel(translationPanels[0].id, { targetLanguage: toLang });
        }
        
        setIsAutoTranslating(true);
        
        // 延迟一下等待状态更新，然后自动翻译
        setTimeout(async () => {
            try {
                await translateText(translationPanels[0]?.id || '1', text, fromLang, toLang);
            } catch (error) {
                console.error('自动翻译失败:', error);
            } finally {
                setIsAutoTranslating(false);
            }
        }, 100);
    };

    useEffect(() => {
        checkConfig();
    
        // 检查是否为通过初始化脚本注入的文本（从快捷菜单创建新窗口时）
        const globalText = (window as any).__TRANSLATE_TEXT__;
        if (globalText) {
            setInputText(globalText);
            delete (window as any).__TRANSLATE_TEXT__;
        }
    
        // 监听外部填充文本事件（从快捷菜单注入到已有窗口）
        const unlisten = listen<string>("translator://fill-text", (event) => {
            setInputText(event.payload);
        });
    
        return () => {
            unlisten.then(fn => fn());
        };
    }, []);

    const checkConfig = async () => {
        try {
            const loadedConfig = await invoke<YoudaoConfig>('load_youdao_config');
            if (loadedConfig) {
                setConfig(loadedConfig);
                setTempConfig(loadedConfig);
                setConfigError(null);
            } else {
                setConfigError("请配置有道翻译API密钥");
            }
        } catch (error) {
            console.error('配置检查失败:', error);
            setConfigError(error as string);
        }
    };

    const saveConfig = async () => {
        try {
            await invoke('save_youdao_config', { config: tempConfig });
            setConfig(tempConfig);
            setShowSettings(false);
            setConfigError(null);
            await checkConfig();
        } catch (error) {
            console.error('保存配置失败:', error);
            alert(`保存配置失败: ${error}`);
        }
    };

    const handleSettingsClose = () => {
        setTempConfig(config);
        setShowSettings(false);
    };

    const handleClose = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.close();
        } catch (error) {
            console.error('关闭窗口失败:', error);
        }
    };

    const addTranslationPanel = () => {
        const newPanel: TranslationPanel = {
            id: Date.now().toString(),
            sourceLanguage: inputLanguage,
            targetLanguage: 'en',
            sourceText: '',
            translatedText: '',
            isTranslating: false
        };
        setTranslationPanels([...translationPanels, newPanel]);
    };

    const removeTranslationPanel = (panelId: string) => {
        if (translationPanels.length > 1) {
            setTranslationPanels(translationPanels.filter(panel => panel.id !== panelId));
        }
    };

    const updatePanel = (panelId: string, updates: Partial<TranslationPanel>) => {
        setTranslationPanels(panels =>
            panels.map(panel =>
                panel.id === panelId ? { ...panel, ...updates } : panel
            )
        );
    };

    const translateText = async (panelId: string, text?: string, fromLang?: string, toLang?: string) => {
        const panel = translationPanels.find(p => p.id === panelId);
        if (!panel) return;

        const sourceText = text || inputText;
        if (!sourceText.trim()) return;

        updatePanel(panelId, { isTranslating: true, sourceText });

        try {
            const translatedText = await invoke<string>('youdao_translate', {
                text: sourceText,
                from: fromLang || inputLanguage,
                to: toLang || panel.targetLanguage
            });
            updatePanel(panelId, { translatedText, isTranslating: false });
        } catch (error) {
            console.error('翻译失败:', error);
            updatePanel(panelId, {
                translatedText: `翻译失败: ${error}`,
                isTranslating: false
            });
        }
    };

    const batchTranslate = async () => {
        if (!inputText.trim()) return;

        for (const panel of translationPanels) {
            await translateText(panel.id, inputText);
        }
    };

    // const getLanguageName = (code: string) => {
    //     const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
    //     return lang ? lang.name : code;
    // };

    if (configError && !config.appKey) {
        return (
            <div className="translator-container">
                <div className="translator-header" data-tauri-drag-region>
                    <h1 className="translator-title">有道翻译</h1>
                    <button className="close-button" onClick={handleClose}>
                        <div className="close-icon"></div>
                    </button>
                </div>
                <div className="config-error">
                    <div className="error-icon">🔑</div>
                    <h3>需要配置API密钥</h3>
                    <p>{configError}</p>
                    <button className="config-button" onClick={() => setShowSettings(true)}>
                        配置有道翻译
                    </button>
                </div>
                {showSettings && (
                    <div className="settings-overlay">
                        <div className="settings-modal">
                            <div className="settings-header">
                                <h3>有道翻译配置</h3>
                                <button className="settings-close" onClick={handleSettingsClose}>
                                    <div className="close-icon"></div>
                                </button>
                            </div>
                            <div className="settings-content">
                                <div className="setting-item">
                                    <label>应用ID (App Key):</label>
                                    <input
                                        type="text"
                                        value={tempConfig.appKey}
                                        onChange={(e) => setTempConfig(prev => ({ ...prev, appKey: e.target.value }))}
                                        placeholder="输入你的有道翻译App Key"
                                    />
                                </div>
                                <div className="setting-item">
                                    <label>应用密钥 (App Secret):</label>
                                    <input
                                        type="password"
                                        value={tempConfig.appSecret}
                                        onChange={(e) => setTempConfig(prev => ({ ...prev, appSecret: e.target.value }))}
                                        placeholder="输入你的有道翻译App Secret"
                                    />
                                </div>
                                <div className="setting-item">
                                    <label>API地址:</label>
                                    <input
                                        type="text"
                                        value={tempConfig.baseUrl}
                                        onChange={(e) => setTempConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                                        placeholder="API基础URL"
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
        <div className="translator-container">
            <div className="translator-header" data-tauri-drag-region>
                <div className="header-left">
                    <div className="translator-icon"></div>
                    <h1 className="translator-title">有道翻译</h1>
                </div>
                <div className="header-actions">
                    <button
                        className="settings-button"
                        onClick={() => setShowSettings(true)}
                        title="设置"
                    >
                        <div className="settings-icon"></div>
                    </button>
                    <button className="close-button" onClick={handleClose}>
                        <div className="close-icon"></div>
                    </button>
                </div>
            </div>

            <div className="translator-content">
                <div className="input-section">
                    <div className="input-header">
                        <select
                            value={inputLanguage}
                            onChange={(e) => setInputLanguage(e.target.value)}
                            className="language-select"
                        >
                            {SUPPORTED_LANGUAGES.map(lang => (
                                <option key={lang.code} value={lang.code}>
                                    {lang.name}
                                </option>
                            ))}
                        </select>
                        <button className="batch-translate-button" onClick={batchTranslate}>
                            批量翻译
                        </button>
                    </div>
                    <textarea
                        className="input-textarea"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onPaste={(e) => {
                            // 获取粘贴的文本
                            const pastedText = e.clipboardData.getData('text');
                            if (pastedText) {
                                // 延迟一下等待state更新
                                setTimeout(() => {
                                    autoDetectAndTranslate(pastedText);
                                }, 50);
                            }
                        }}
                        placeholder={isAutoTranslating ? "正在翻译..." : "请输入要翻译的内容..."}
                    />
                </div>

                <div className="translation-panels">
                    {translationPanels.map((panel, index) => (
                        <div key={panel.id} className="translation-panel">
                            <div className="panel-header">
                                <select
                                    value={panel.targetLanguage}
                                    onChange={(e) => updatePanel(panel.id, { targetLanguage: e.target.value })}
                                    className="language-select"
                                >
                                    {SUPPORTED_LANGUAGES.filter(lang => lang.code !== 'auto').map(lang => (
                                        <option key={lang.code} value={lang.code}>
                                            {lang.name}
                                        </option>
                                    ))}
                                </select>
                                {translationPanels.length > 1 && (
                                    <button
                                        className="remove-panel-button"
                                        onClick={() => removeTranslationPanel(panel.id)}
                                        title="删除翻译区域"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                            <div className="panel-content">
                                <div className="translation-result">
                                    {panel.isTranslating ? (
                                        <div className="translating-indicator">
                                            <div className="spinner"></div>
                                            <span>翻译中...</span>
                                        </div>
                                    ) : (
                                        <div className="translated-text">
                                            {panel.translatedText || '翻译结果将在此显示'}
                                        </div>
                                    )}
                                </div>
                                {index === translationPanels.length - 1 && (
                                    <button
                                        className="add-panel-button"
                                        onClick={addTranslationPanel}
                                        title="添加翻译区域"
                                    >
                                        +
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {showSettings && (
                <div className="settings-overlay">
                    <div className="settings-modal">
                        <div className="settings-header">
                            <h3>有道翻译配置</h3>
                            <button className="settings-close" onClick={handleSettingsClose}>
                                <div className="close-icon"></div>
                            </button>
                        </div>
                        <div className="settings-content">
                            <div className="setting-item">
                                <label>应用ID (App Key):</label>
                                <input
                                    type="text"
                                    value={tempConfig.appKey}
                                    onChange={(e) => setTempConfig(prev => ({ ...prev, appKey: e.target.value }))}
                                    placeholder="输入你的有道翻译App Key"
                                />
                            </div>
                            <div className="setting-item">
                                <label>应用密钥 (App Secret):</label>
                                <input
                                    type="password"
                                    value={tempConfig.appSecret}
                                    onChange={(e) => setTempConfig(prev => ({ ...prev, appSecret: e.target.value }))}
                                    placeholder="输入你的有道翻译App Secret"
                                />
                            </div>
                            <div className="setting-item">
                                <label>API地址:</label>
                                <input
                                    type="text"
                                    value={tempConfig.baseUrl}
                                    onChange={(e) => setTempConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                                    placeholder="API基础URL"
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
