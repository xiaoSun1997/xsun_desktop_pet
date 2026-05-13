import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./QuickFileSearch.css";

interface FileResult {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
}

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const iconMap: Record<string, string> = {
    pdf: "📃", doc: "📃", docx: "📃", txt: "📃", rtf: "📃",
xls: "📈", xlsx: "📈", csv: "📈",
jpg: "📸", jpeg: "📸", png: "📸", gif: "📸", svg: "📸", webp: "📸", bmp: "📸", ico: "📸",
mp3: "🎧", wav: "🎧", flac: "🎧", ogg: "🎧",
mp4: "🎬", avi: "🎬", mkv: "🎬", mov: "🎬",
zip: "🗃️", rar: "🗃️", "7z": "🗃️", tar: "🗃️", gz: "🗃️",
exe: "🖥️", dll: "🖥️", msi: "💿", lnk: "🔗",
html: "🌐", htm: "🌐", css: "🎨", js: "📘", ts: "📘", jsx: "📘", tsx: "📘",
json: "🗂️", xml: "🗂️", yaml: "🗂️", yml: "🗂️",
rs: "🦀", go: "🐹", py: "🐍", java: "☕", cpp: "🔧", c: "🔧", h: "🔧", cs: "🔧",
sql: "💾", db: "💾",
md: "📓",
  };
  return iconMap[ext] || "📄";
}

// 判断是否为可提取图标的可执行文件类型
const EXECUTABLE_EXTS = new Set(["exe", "lnk", "msi"]);
function isExecutableFile(name: string, isDir: boolean): boolean {
  if (isDir) return false;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return EXECUTABLE_EXTS.has(ext);
}

// 可执行文件图标组件：异步加载真实图标，回退显示 emoji
function ExecutableIcon({ file }: { file: FileResult }) {
  const [iconSrc, setIconSrc] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    invoke<string | null>("get_file_icon", { filePath: file.path })
      .then((dataUri) => {
        if (dataUri) {
          setIconSrc(dataUri);
        }
      })
      .catch(() => {});
  }, [file.path]);

  const fallback = getFileIcon(file.name, file.is_dir);
  if (!iconSrc) {
    return <span className="quick-file-icon">{fallback}</span>;
  }
  return (
    <span className="quick-file-icon">
      <img src={iconSrc} alt="" className="quick-app-icon" />
    </span>
  );
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  // 找到所有匹配位置
  let searchFrom = 0;
  while (true) {
    const idx = lowerText.indexOf(lowerQuery, searchFrom);
    if (idx === -1) break;

    if (idx > lastIndex) {
      parts.push(<span key={`${lastIndex}-pre`}>{text.slice(lastIndex, idx)}</span>);
    }
    parts.push(
      <mark key={idx} className="quick-match-highlight">
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    lastIndex = idx + query.length;
    searchFrom = idx + 1;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`${lastIndex}-post`}>{text.slice(lastIndex)}</span>);
  }

  return <>{parts}</>;
}

export default function QuickFileSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [useIndex, setUseIndex] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ current: 0, total: 0, message: "" });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<FileResult[]>([]);
  const hasAutoBuiltRef = useRef(false);
  const indexGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto focus on mount & check index status
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);

    // 检查索引状态，未建立则自动构建
    invoke("get_index_status").then((status: any) => {
      if (status && status.indexed_count > 0) {
        setUseIndex(true);
      } else if (!hasAutoBuiltRef.current) {
        hasAutoBuiltRef.current = true;
        setIsIndexing(true);
        // 启动索引，并设置120秒超时保护
        invoke("build_file_index").catch(() => setIsIndexing(false));
        indexGuardRef.current = setTimeout(() => {
          if (isIndexing) {
            console.warn('[QuickSearch] 索引超时保护触发，隐藏进度条');
            setIsIndexing(false);
          }
        }, 120000);
      }
    }).catch(() => {});

    return () => {
      if (indexGuardRef.current) clearTimeout(indexGuardRef.current);
    };
  }, []);

  // Listen for file search results & index events
  useEffect(() => {
    let unlistenResult: UnlistenFn | undefined;
    let unlistenDone: UnlistenFn | undefined;
    let unlistenIndexStatus: UnlistenFn | undefined;
    let unlistenIndexProgress: UnlistenFn | undefined;

    const setupListeners = async () => {
      unlistenResult = await listen<FileResult[]>("file-search://result", (event) => {
        resultsRef.current = [...resultsRef.current, ...event.payload];
        setResults([...resultsRef.current]);
      });

      unlistenDone = await listen<string>("file-search://done", () => {
        setIsSearching(false);
      });

      unlistenIndexStatus = await listen<any>("file-index://status", (event) => {
        const { phase } = event.payload;
        if (phase === "building") {
          setIsIndexing(true);
        } else if (phase === "done") {
          setIsIndexing(false);
          setUseIndex(true);
          setIndexProgress({ current: 0, total: 0, message: "" });
        } else if (phase === "error") {
          setIsIndexing(false);
        }
      });

      unlistenIndexProgress = await listen<any>("file-index://progress", (event) => {
        const { current, total, message } = event.payload;
        setIndexProgress({ current, total, message });
      });
    };

    setupListeners();

    return () => {
      if (unlistenResult) unlistenResult();
      if (unlistenDone) unlistenDone();
      if (unlistenIndexStatus) unlistenIndexStatus();
      if (unlistenIndexProgress) unlistenIndexProgress();
    };
  }, []);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      resultsRef.current = [];
      setIsSearching(false);
      setSelectedIndex(-1);
      return;
    }
    setIsSearching(true);
    setResults([]);
    resultsRef.current = [];
    setSelectedIndex(-1);
    try {
      await invoke("search_files", { query: trimmed });
    } catch (e) {
      console.error("搜索文件失败:", e);
      setIsSearching(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 80);
  };

  const openFile = async (file: FileResult) => {
    try {
      await invoke("open_file", { path: file.path });
      getCurrentWindow().close();
    } catch (e) {
      console.error("打开文件失败:", e);
    }
  };

  const revealInFolder = async (file: FileResult) => {
    try {
      await invoke("reveal_in_folder", { path: file.path });
      getCurrentWindow().close();
    } catch (e) {
      console.error("打开所在文件夹失败:", e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+1~9 快速打开
    if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
      e.preventDefault();
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < results.length) {
        openFile(results[idx]);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        if (e.ctrlKey) {
          revealInFolder(results[selectedIndex]);
        } else {
          openFile(results[selectedIndex]);
        }
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      getCurrentWindow().close();
    }
  };

  // Auto-scroll to selected item
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll(".quick-result-item");
      if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  const handleItemClick = (file: FileResult) => {
    openFile(file);
  };

  const handleItemContextMenu = (e: React.MouseEvent, file: FileResult) => {
    e.preventDefault();
    revealInFolder(file);
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    resultsRef.current = [];
    setIsSearching(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const visibleResults = results.slice(0, 15);

  return (
    <div className="quick-search-container">
      <div className="quick-search-box">
        {/* 索引状态提示 */}
        {isIndexing && (
          <div className="quick-index-bar">
            <div className="quick-spinner-small" />
            <span>
              {indexProgress.message || "正在建立索引..."}
              {indexProgress.total > 0 && ` (${indexProgress.current} / ${indexProgress.total})`}
              {indexProgress.total === 0 && indexProgress.current > 0 && ` (已索引 ${indexProgress.current} 个)`}
            </span>
          </div>
        )}
        {!useIndex && !isIndexing && (
          <div className="quick-index-bar quick-index-hint">
            <span>⚡ 首次使用，正在后台建立索引，请稍候...</span>
          </div>
        )}

        {/* 搜索输入区 */}
        <div className="quick-input-wrapper">
          <span className="quick-search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="quick-input"
            placeholder="搜索文件..."
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button className="quick-clear-btn" onClick={clearSearch} title="清除">
              ×
            </button>
          )}
        </div>

        {/* 结果列表 */}
        <div className="quick-results" ref={listRef}>
          {isSearching && results.length === 0 && (
            <div className="quick-status">
              <div className="quick-spinner" />
            </div>
          )}

          {!isSearching && query.trim() && results.length === 0 && (
            <div className="quick-status">
              <span>未找到匹配文件</span>
            </div>
          )}

          {visibleResults.map((file, index) => (
            <div
              key={`${file.path}-${index}`}
              className={`quick-result-item ${index === selectedIndex ? "selected" : ""}`}
              onClick={() => handleItemClick(file)}
              onContextMenu={(e) => handleItemContextMenu(e, file)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {isExecutableFile(file.name, file.is_dir) ? (
                <ExecutableIcon file={file} />
              ) : (
                <span className="quick-file-icon">{getFileIcon(file.name, file.is_dir)}</span>
              )}
              <div className="quick-file-info">
                <div className="quick-file-name" title={file.name}>
                  {highlightMatch(file.name, query)}
                </div>
                <div className="quick-file-path" title={file.path}>
                  {file.path}
                </div>
              </div>
              {index < 9 && (
                <span className="quick-shortcut-hint">Ctrl+{index + 1}</span>
              )}
            </div>
          ))}

          {results.length > 15 && (
            <div className="quick-more-hint">
              还有 {results.length - 15} 个结果...
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="quick-footer">
          <span className="quick-footer-hint">
            {isIndexing
              ? "索引构建完成后搜索将秒级响应"
              : results.length > 0
              ? `共 ${results.length} 个结果`
              : isSearching
              ? "搜索中..."
              : "输入关键词开始搜索"}
          </span>
          <span className="quick-footer-keys">
            ↑↓ 选择 · Enter 打开 · Ctrl+Enter 打开文件夹 · Esc 关闭
          </span>
        </div>
      </div>
    </div>
  );
}
