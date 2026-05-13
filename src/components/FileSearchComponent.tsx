import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./FileSearchComponent.css";

interface FileResult {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const iconMap: Record<string, string> = {
    pdf: "📄", doc: "📄", docx: "📄", txt: "📄", rtf: "📄",
    xls: "📊", xlsx: "📊", csv: "📊",
    jpg: "🖼", jpeg: "🖼", png: "🖼", gif: "🖼", svg: "🖼", webp: "🖼", bmp: "🖼", ico: "🖼",
    mp3: "🎵", wav: "🎵", flac: "🎵", ogg: "🎵",
    mp4: "🎥", avi: "🎥", mkv: "🎥", mov: "🎥",
    zip: "📦", rar: "📦", "7z": "📦", tar: "📦", gz: "📦",
    exe: "⚙️", dll: "⚙️", msi: "📦", lnk: "🔗",
    html: "🌐", htm: "🌐", css: "🎨", js: "📜", ts: "📜", jsx: "📜", tsx: "📜",
    json: "📋", xml: "📋", yaml: "📋", yml: "📋",
    rs: "🦀", go: "🐹", py: "🐍", java: "☕", cpp: "🔧", c: "🔧", h: "🔧", cs: "🔧",
    sql: "🗄", db: "🗄",
    md: "📝",
  };
  return iconMap[ext] || "📄";
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let searchFrom = 0;

  while (true) {
    const idx = lowerText.indexOf(lowerQuery, searchFrom);
    if (idx === -1) break;
    if (idx > lastIndex) {
      parts.push(<span key={`${lastIndex}-pre`}>{text.slice(lastIndex, idx)}</span>);
    }
    parts.push(
      <mark key={idx} className="search-match-highlight">
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    lastIndex = idx + query.length;
    searchFrom = idx + 1;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`${lastIndex}-post`}>{text.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

export default function FileSearchComponent() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [displayCount, setDisplayCount] = useState(50);
  // 索引状态
  const [indexCount, setIndexCount] = useState(0);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState({ current: 0, total: 0, message: "" });
  const [useIndex, setUseIndex] = useState(false);
  const [loadMoreOffset, setLoadMoreOffset] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<FileResult[]>([]);
  const searchModeRef = useRef<"walkdir" | "index">("walkdir");

  // Check index status on mount
  useEffect(() => {
    invoke("get_index_status").then((status: any) => {
      if (status && status.indexed_count > 0) {
        setIndexCount(status.indexed_count);
        setUseIndex(true);
        searchModeRef.current = "index";
      }
    }).catch(() => {});
  }, []);

  // Auto focus on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Listen for file search results
  useEffect(() => {
    let unlistenResult: UnlistenFn | undefined;
    let unlistenDone: UnlistenFn | undefined;

    const setupListeners = async () => {
      unlistenResult = await listen<FileResult[]>("file-search://result", (event) => {
        resultsRef.current = [...resultsRef.current, ...event.payload];
        setResults([...resultsRef.current]);
      });

      unlistenDone = await listen<string>("file-search://done", () => {
        setIsSearching(false);
      });
    };

    setupListeners();

    // Listen for index events
    let unlistenIndexStatus: UnlistenFn | undefined;
    let unlistenIndexProgress: UnlistenFn | undefined;
    let unlistenMoreDone: UnlistenFn | undefined;

    const setupIndexListeners = async () => {
      unlistenIndexStatus = await listen<any>("file-index://status", (event) => {
        const { phase, count, message } = event.payload;
        if (phase === "building") {
          setIsIndexing(true);
          setIndexProgress({ current: 0, total: 0, message });
        } else if (phase === "done") {
          setIsIndexing(false);
          setIndexCount(count);
          setUseIndex(true);
          searchModeRef.current = "index";
          setIndexProgress({ current: 0, total: 0, message: "" });
        } else if (phase === "error") {
          setIsIndexing(false);
          setIndexProgress({ current: 0, total: 0, message: "" });
          console.error("索引构建失败:", message);
        }
      });

      unlistenIndexProgress = await listen<any>("file-index://progress", (event) => {
        const { current, total, message } = event.payload;
        setIndexProgress({ current, total, message });
      });

      unlistenMoreDone = await listen<string>("file-search://more-done", () => {
        // 没有更多结果
      });
    };

    setupIndexListeners();

    // Listen for Escape key to close
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        getCurrentWindow().close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (unlistenResult) unlistenResult();
      if (unlistenDone) unlistenDone();
      if (unlistenIndexStatus) unlistenIndexStatus();
      if (unlistenIndexProgress) unlistenIndexProgress();
      if (unlistenMoreDone) unlistenMoreDone();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults([]);
      resultsRef.current = [];
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setResults([]);
    resultsRef.current = [];
    setDisplayCount(50);
    setLoadMoreOffset(0);
    setSelectedIndex(-1);
    // 检测搜索模式
    if (useIndex) {
      searchModeRef.current = "index";
    } else {
      searchModeRef.current = "walkdir";
    }
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
    debounceRef.current = setTimeout(() => doSearch(val), 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        if (e.ctrlKey) {
          revealInFolder(results[selectedIndex]);
        } else {
          openFile(results[selectedIndex]);
        }
      }
    }
  };

  // Auto-scroll to selected item
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll(".file-search-item");
      if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  const openFile = async (file: FileResult) => {
    try {
      await invoke("open_file", { path: file.path });
    } catch (e) {
      console.error("打开文件失败:", e);
    }
  };

  const revealInFolder = async (file: FileResult) => {
    try {
      await invoke("reveal_in_folder", { path: file.path });
    } catch (e) {
      console.error("打开所在文件夹失败:", e);
    }
  };

  const handleItemClick = (file: FileResult) => {
    revealInFolder(file);
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    resultsRef.current = [];
    setIsSearching(false);
    setDisplayCount(50);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const buildIndex = async () => {
    try {
      await invoke("build_file_index");
    } catch (e) {
      console.error("构建索引失败:", e);
    }
  };

  const loadMore = async () => {
    if (searchModeRef.current === "index") {
      // 索引模式：从后端加载更多
      const newOffset = loadMoreOffset + 50;
      setLoadMoreOffset(newOffset);
      try {
        await invoke("search_files_load_more", { query: query.trim(), offset: newOffset });
      } catch (e) {
        console.error("加载更多失败:", e);
      }
    } else {
      // WalkDir模式：本地已有全部结果
      setDisplayCount((prev) => Math.min(prev + 50, results.length));
    }
  };

  const visibleResults = searchModeRef.current === "index"
    ? results  // 索引模式：所有已加载的结果都显示
    : results.slice(0, displayCount);  // WalkDir模式：本地分页
  const hasMore = searchModeRef.current === "index"
    ? !isSearching && results.length > 0  // 索引模式：由后端控制
    : displayCount < results.length;

  return (
    <div className="file-search-container">
      {/* 索引状态栏 */}
      {!useIndex && !isIndexing && (
        <div className="index-status-bar index-status-hint">
          <span>⚡ 首次使用请先建立索引，之后搜索将秒级响应</span>
          <button className="build-index-btn" onClick={buildIndex}>建立索引</button>
        </div>
      )}
      {isIndexing && (
        <div className="index-status-bar index-status-building">
          <div className="spinner-small" />
          <span>{indexProgress.message || "正在建立索引..."}</span>
          {indexProgress.total > 0 && (
            <span className="index-progress-text">
              ({indexProgress.current} / {indexProgress.total})
            </span>
          )}
          {indexProgress.total === 0 && indexProgress.current > 0 && (
            <span className="index-progress-text">
              (已索引 {indexProgress.current} 个文件)
            </span>
          )}
        </div>
      )}
      {useIndex && !isIndexing && (
        <div className="index-status-bar index-status-ready">
          <span>📋 已索引 {indexCount.toLocaleString()} 个文件</span>
          <button className="rebuild-index-btn" onClick={buildIndex} title="重建索引">🔄</button>
        </div>
      )}
      <div className="file-search-header">
        <div className="search-input-wrapper">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="输入文件名搜索..."
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button className="clear-btn" onClick={clearSearch} title="清除">
              ×
            </button>
          )}
        </div>
        <button className="close-btn" onClick={() => getCurrentWindow().close()} title="关闭 (Esc)">
          ×
        </button>
      </div>

      <div className="file-search-body" ref={listRef}>
        {isSearching && results.length === 0 && (
          <div className="search-status">
            <div className="spinner" />
            <span>正在搜索...</span>
          </div>
        )}

        {!isSearching && query.trim() && results.length === 0 && (
          <div className="search-status">
            <span className="no-results-icon">👻</span>
            <span>没有找到匹配的文件</span>
          </div>
        )}

        {!query.trim() && (
          <div className="search-status hint">
            <span className="hint-icon">🔍</span>
            <span>输入关键词搜索文件</span>
          </div>
        )}

        {visibleResults.map((file, index) => (
          <div
            key={`${file.path}-${index}`}
            className={`file-search-item ${index === selectedIndex ? "selected" : ""}`}
            onClick={() => handleItemClick(file)}
            onDoubleClick={() => revealInFolder(file)}
            onContextMenu={(e) => { e.preventDefault(); revealInFolder(file); }}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <span className="file-icon">{getFileIcon(file.name, file.is_dir)}</span>
            <div className="file-info">
              <div className="file-name" title={file.name}>
                {highlightMatch(file.name, query)}
              </div>
              <div className="file-path" title={file.path}>{file.path}</div>
            </div>
            <span className="file-size">{formatSize(file.size)}</span>
          </div>
        ))}
      </div>

      {hasMore && !isSearching && (
        <button className="load-more-btn" onClick={loadMore}>
          加载更多 (还有 {results.length - displayCount} 条)
        </button>
      )}

      <div className="file-search-footer">
        {results.length > 0 && (
          <span className="result-count">
            {isSearching ? `已找到 ${results.length}+ 个结果...` : `共 ${results.length} 个结果`}
          </span>
        )}
        <span className="shortcut-hint">↑↓ 导航 · Enter 打开文件 · Ctrl+Enter 打开文件夹 · Esc 关闭</span>
      </div>
    </div>
  );
}
