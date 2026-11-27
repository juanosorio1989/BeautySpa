import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./use-polling";

let visibility: "visible" | "hidden" = "visible";
const setVisibility = (v: "visible" | "hidden") => {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("pauses while hidden and fires on focus", () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn, 1000));
    act(() => void vi.advanceTimersByTime(2500));
    expect(fn).toHaveBeenCalledTimes(2);

    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(5000));
    expect(fn).toHaveBeenCalledTimes(2);
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(fn).toHaveBeenCalledTimes(2); // still hidden

    act(() => setVisibility("visible"));
    expect(fn).toHaveBeenCalledTimes(3);
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(fn).toHaveBeenCalledTimes(4);
    act(() => void vi.advanceTimersByTime(1000));
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("stops on unmount", () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => usePolling(fn, 1000));
    unmount();
    act(() => void vi.advanceTimersByTime(5000));
    expect(fn).not.toHaveBeenCalled();
  });
});
