import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StaffContext, useStaff } from "./use-staff";

describe("useStaff", () => {
  it("throws outside the gate", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useStaff())).toThrow();
  });
  it("returns the staff member inside the provider", () => {
    const me = { id: "1", name: "Ana", email: "a@x.dev", role: "OWNER" as const };
    const { result } = renderHook(() => useStaff(), {
      wrapper: ({ children }) => <StaffContext.Provider value={me}>{children}</StaffContext.Provider>,
    });
    expect(result.current).toBe(me);
  });
});
