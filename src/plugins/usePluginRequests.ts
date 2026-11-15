import { useCallback, useEffect, useRef } from "react";
import { pluginCommand, releaseMedia } from "./client";

/** Own requests for the lifetime of a view, including requests omitting ctx.signal. */
export function usePluginRequests() {
  const mounted = useRef(true), pending = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const requestId of pending.current) void pluginCommand("cancel", { requestId }).catch(() => {});
    };
  }, []);
  const cancelAll = useCallback(() => {
    for (const requestId of pending.current) void pluginCommand("cancel", { requestId }).catch(() => {});
  }, []);
  const request = useCallback(async <T,>(action: string, params: Record<string, unknown> = {}): Promise<T> => {
    if (!mounted.current) throw { code: "CANCELLED", message: "页面已关闭" };
    const requestId = crypto.randomUUID(); pending.current.add(requestId);
    try {
      const result = await pluginCommand<T>(action, { ...params, requestId });
      if (!mounted.current) {
        if (result && typeof result === "object" && "sessionId" in result) releaseMedia(String(result.sessionId));
        const preview = action === "distribution.preview" ? result : action === "updates.check" ? (result as { preview?: unknown })?.preview : null;
        if (preview && typeof preview === "object" && "token" in preview) {
          void pluginCommand("distribution.discard", { token: String(preview.token) }).catch(() => {});
        }
        throw { code: "CANCELLED", message: "页面已关闭" };
      }
      return result;
    } finally { pending.current.delete(requestId); }
  }, []);
  return Object.assign(request, { cancelAll });
}
