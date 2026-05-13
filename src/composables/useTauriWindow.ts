import { getAllWindows } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

interface WindowConfig {
  devUrl: string;
  prodUrl: string;
  options: any;
}

const openingLocks = new Map<string, boolean>();

export function useTauriWindow() {
  async function createOrShowWindow(label: string, config: WindowConfig): Promise<any | null> {
    if (openingLocks.get(label)) {
      console.log(`[useTauriWindow] ${label} opening in progress, skip`);
      return null;
    }
    openingLocks.set(label, true);

    const cleanupLockTimeout = setTimeout(() => {
      if (openingLocks.get(label)) {
        console.warn(`[useTauriWindow] Forcing reset of opening lock for ${label}`);
        openingLocks.set(label, false);
      }
    }, 20000);

    try {
      // Try to find existing window
      const windows = await getAllWindows();
      const existing = windows.find((w) => w.label === label);

      if (existing) {
        try {
          await existing.show();
          await existing.setFocus();
          return existing;
        } catch (e) {
          console.warn(`[useTauriWindow] Existing ${label} show/setFocus failed, trying recreate:`, e);
          try {
            await existing.close();
          } catch (closeErr) {
            console.warn(`[useTauriWindow] Close zombie ${label} failed:`, closeErr);
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      const url = import.meta.env.DEV ? config.devUrl : config.prodUrl;

      const webview = new WebviewWindow(label, {
        url,
        ...config.options,
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Waiting for ${label} window creation timeout`));
        }, 5000);

        webview.once("tauri://created", () => {
          clearTimeout(timeout);
          resolve();
        });

        webview.once("tauri://error", (e) => {
          clearTimeout(timeout);
          reject(new Error(`Create ${label} window error: ${JSON.stringify(e)}`));
        });
      });

      await webview.show();
      await webview.setFocus();
      return webview;
    } catch (err) {
      console.error(`[useTauriWindow] Create ${label} window failed:`, err);
      return null;
    } finally {
      clearTimeout(cleanupLockTimeout);
      openingLocks.set(label, false);
    }
  }

  async function closeWindowIfOpen(label: string): Promise<boolean> {
    try {
      const windows = await getAllWindows();
      const existing = windows.find((w) => w.label === label);
      if (existing) {
        await existing.close();
        return true;
      }
    } catch (e) {
      console.warn(`[useTauriWindow] Close ${label} failed:`, e);
    }
    return false;
  }

  return {
    createOrShowWindow,
    closeWindowIfOpen,
  };
}
