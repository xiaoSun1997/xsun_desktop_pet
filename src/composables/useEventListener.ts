import { onMounted, onUnmounted, type Ref } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function useTauriEvent<T = any>(
  event: string,
  handler: (payload: T) => void
) {
  let unlisten: UnlistenFn | undefined;

  onMounted(async () => {
    unlisten = await listen<T>(event, (eventData) => {
      handler(eventData.payload);
    });
  });

  onUnmounted(() => {
    if (unlisten) unlisten();
  });
}
