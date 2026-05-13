<script setup lang="ts">
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

interface YoudaoConfig {
  appKey: string;
  appSecret: string;
  baseUrl: string;
}

interface TranslationPanel {
  id: string;
  targetLanguage: string;
  sourceText: string;
  translatedText: string;
  isTranslating: boolean;
}

interface Language {
  code: string;
  name: string;
}

const SUPPORTED_LANGUAGES: Language[] = [
  { code: "auto", name: "Auto" },
  { code: "zh-CHS", name: "Chinese Simplified" },
  { code: "zh-CHT", name: "Chinese Traditional" },
  { code: "en", name: "English" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ru", name: "Russian" },
  { code: "es", name: "Spanish" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "ar", name: "Arabic" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
];

const config = ref<YoudaoConfig>({ appKey: "", appSecret: "", baseUrl: "https://openapi.youdao.com/api" });
const showSettings = ref(false);
const tempConfig = ref<YoudaoConfig>({ appKey: "", appSecret: "", baseUrl: "https://openapi.youdao.com/api" });
const configError = ref<string | null>(null);
const inputText = ref("");
const inputLanguage = ref("auto");
const translationPanels = ref<TranslationPanel[]>([
  { id: "1", targetLanguage: "en", sourceText: "", translatedText: "", isTranslating: false },
]);

onMounted(() => {
  checkConfig();
  const globalText = (window as any).__TRANSLATE_TEXT__;
  if (globalText) {
    inputText.value = globalText;
    delete (window as any).__TRANSLATE_TEXT__;
  }
  listen<string>("translator://fill-text", (event) => {
    inputText.value = event.payload;
  });
});

const checkConfig = async () => {
  try {
    const loadedConfig = await invoke<YoudaoConfig>("load_youdao_config");
    if (loadedConfig && loadedConfig.appKey) {
      config.value = loadedConfig;
      tempConfig.value = { ...loadedConfig };
      configError.value = null;
    } else {
      configError.value = "Please configure Youdao API key";
    }
  } catch (error) {
    console.error("Config check failed:", error);
    configError.value = String(error);
  }
};

const saveConfig = async () => {
  try {
    await invoke("save_youdao_config", { config: tempConfig.value });
    config.value = { ...tempConfig.value };
    showSettings.value = false;
    configError.value = null;
    await checkConfig();
  } catch (error) {
    console.error("Save config failed:", error);
    alert(`Save config failed: ${error}`);
  }
};

const handleSettingsClose = () => {
  tempConfig.value = { ...config.value };
  showSettings.value = false;
};

const handleClose = async () => {
  try { await getCurrentWindow().close(); }
  catch (error) { console.error("Close window failed:", error); }
};

const addTranslationPanel = () => {
  translationPanels.value.push({
    id: Date.now().toString(),
    targetLanguage: "en",
    sourceText: "",
    translatedText: "",
    isTranslating: false,
  });
};

const removeTranslationPanel = (panelId: string) => {
  if (translationPanels.value.length > 1) {
    translationPanels.value = translationPanels.value.filter((p) => p.id !== panelId);
  }
};

const updatePanel = (panelId: string, updates: Partial<TranslationPanel>) => {
  const idx = translationPanels.value.findIndex((p) => p.id === panelId);
  if (idx >= 0) translationPanels.value[idx] = { ...translationPanels.value[idx], ...updates };
};

const translateText = async (panelId: string) => {
  const panel = translationPanels.value.find((p) => p.id === panelId);
  if (!panel || !inputText.value.trim()) return;
  updatePanel(panelId, { isTranslating: true, sourceText: inputText.value });
  try {
    const result = await invoke<string>("youdao_translate", {
      text: inputText.value,
      from: inputLanguage.value,
      to: panel.targetLanguage,
    });
    updatePanel(panelId, { translatedText: result, isTranslating: false });
  } catch (error) {
    console.error("Translate failed:", error);
    updatePanel(panelId, { translatedText: `Translation failed: ${error}`, isTranslating: false });
  }
};

const batchTranslate = async () => {
  if (!inputText.value.trim()) return;
  for (const panel of translationPanels.value) {
    await translateText(panel.id);
  }
};
</script>

<template>
  <div class="translator-container">
    <div class="translator-header" data-tauri-drag-region>
      <div class="header-left">
        <h1 class="translator-title">Youdao Translator</h1>
      </div>
      <div class="header-actions">
        <button class="settings-button" @click="showSettings = true" title="Settings">Settings</button>
        <button class="close-button" @click="handleClose">Close</button>
      </div>
    </div>

    <div class="translator-content">
      <div class="input-section">
        <div class="input-header">
          <select v-model="inputLanguage" class="language-select">
            <option v-for="lang in SUPPORTED_LANGUAGES" :key="lang.code" :value="lang.code">{{ lang.name }}</option>
          </select>
          <button class="batch-translate-button" @click="batchTranslate">Batch Translate</button>
        </div>
        <textarea v-model="inputText" class="input-textarea" placeholder="Enter text to translate..."></textarea>
      </div>

      <div class="translation-panels">
        <div v-for="(panel, index) in translationPanels" :key="panel.id" class="translation-panel">
          <div class="panel-header">
            <select v-model="panel.targetLanguage" class="language-select" @change="updatePanel(panel.id, { targetLanguage: panel.targetLanguage })">
              <option v-for="lang in SUPPORTED_LANGUAGES.filter(l => l.code !== 'auto')" :key="lang.code" :value="lang.code">{{ lang.name }}</option>
            </select>
            <button v-if="translationPanels.length > 1" class="remove-panel-button" @click="removeTranslationPanel(panel.id)">x</button>
          </div>
          <div class="panel-content">
            <div class="translation-result">
              <div v-if="panel.isTranslating" class="translating-indicator">
                <span>Translating...</span>
              </div>
              <div v-else class="translated-text">{{ panel.translatedText || "Translation will appear here" }}</div>
            </div>
            <button v-if="index === translationPanels.length - 1" class="add-panel-button" @click="addTranslationPanel">+</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="showSettings" class="settings-overlay" @click.self="handleSettingsClose">
      <div class="settings-modal">
        <div class="settings-header">
          <h3>Youdao Translate Config</h3>
          <button class="settings-close" @click="handleSettingsClose">x</button>
        </div>
        <div class="settings-content">
          <div class="setting-item">
            <label>App Key:</label>
            <input type="text" v-model="tempConfig.appKey" placeholder="Enter your Youdao App Key" />
          </div>
          <div class="setting-item">
            <label>App Secret:</label>
            <input type="password" v-model="tempConfig.appSecret" placeholder="Enter your Youdao App Secret" />
          </div>
          <div class="setting-item">
            <label>API URL:</label>
            <input type="text" v-model="tempConfig.baseUrl" placeholder="API base URL" />
          </div>
        </div>
        <div class="settings-actions">
          <button @click="handleSettingsClose">Cancel</button>
          <button @click="saveConfig">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.translator-container { display: flex; flex-direction: column; height: 100vh; background: #1a1a2e; color: #e0e0e0; }
.translator-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; background: #16213e; border-bottom: 1px solid rgba(255,255,255,0.08); cursor: grab; }
.translator-title { font-size: 16px; font-weight: 600; margin: 0; color: #fff; }
.header-actions { display: flex; gap: 6px; }
.settings-button, .close-button { background: rgba(255,255,255,0.08); border: none; border-radius: 6px; padding: 4px 10px; color: rgba(255,255,255,0.6); font-size: 11px; cursor: pointer; }
.translator-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.input-section { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.input-header { display: flex; gap: 8px; margin-bottom: 8px; }
.language-select { background: #0f0f23; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #e0e0e0; padding: 4px 8px; font-size: 12px; }
.batch-translate-button { background: #e94560; border: none; border-radius: 6px; padding: 4px 12px; color: #fff; font-size: 11px; cursor: pointer; }
.input-textarea { width: 100%; height: 120px; background: #0f0f23; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #e0e0e0; padding: 10px; font-size: 13px; font-family: inherit; resize: vertical; outline: none; box-sizing: border-box; }
.translation-panels { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.translation-panel { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 10px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.remove-panel-button { background: none; border: none; color: rgba(255,255,255,0.4); cursor: pointer; font-size: 16px; }
.panel-content { }
.translation-result { min-height: 60px; }
.translating-indicator { display: flex; align-items: center; gap: 8px; color: rgba(255,255,255,0.5); font-size: 13px; }
.translated-text { font-size: 14px; color: #e0e0e0; line-height: 1.5; }
.add-panel-button { display: block; width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.15); border-radius: 8px; color: rgba(255,255,255,0.4); font-size: 18px; cursor: pointer; margin-top: 8px; }
.settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.settings-modal { background: #1a1a2e; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; width: 400px; max-width: 90vw; }
.settings-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }
.settings-header h3 { margin: 0; font-size: 15px; color: #fff; }
.settings-close { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; font-size: 18px; }
.settings-content { padding: 16px; }
.setting-item { margin-bottom: 12px; }
.setting-item label { display: block; font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 4px; }
.setting-item input { width: 100%; background: #0f0f23; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: #e0e0e0; padding: 8px; font-size: 13px; box-sizing: border-box; }
.settings-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.08); }
.settings-actions button { padding: 6px 16px; border: none; border-radius: 6px; font-size: 12px; cursor: pointer; }
.settings-actions button:first-child { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); }
.settings-actions button:last-child { background: #e94560; color: #fff; }
</style>
