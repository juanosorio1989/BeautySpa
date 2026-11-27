"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `fn` every `intervalMs` while the tab is visible, and right away when the tab becomes
 * visible again or the window gets focus. Paused while hidden.
 */
export function usePolling(fn: () => void, intervalMs = 30_000): void {
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = setInterval(() => fnRef.current(), intervalMs);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fnRef.current();
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => {
      if (document.visibilityState === "visible") fnRef.current();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [intervalMs]);
}
