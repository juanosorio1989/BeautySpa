import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./use-media-query";

describe("useMediaQuery", () => {
  it("follows matchMedia changes", () => {
    let matches = false;
    let listener: () => void = () => undefined;
    window.matchMedia = vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, fn: () => void) => (listener = fn),
      removeEventListener: vi.fn(),
    })) as never;
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);
    matches = true;
    act(() => listener());
    expect(result.current).toBe(true);
  });

  it("renders false on the server", () => {
    function Probe() {
      return <span>{String(useMediaQuery("(min-width: 768px)"))}</span>;
    }
    expect(renderToString(<Probe />)).toContain("false");
  });
});
