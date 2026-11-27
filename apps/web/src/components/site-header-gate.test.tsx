import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let path = "/en";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

import { SiteHeaderGate } from "./site-header-gate";

const show = (p: string) => {
  path = p;
  render(
    <SiteHeaderGate>
      <p>header</p>
    </SiteHeaderGate>,
  );
  return screen.queryByText("header");
};

describe("SiteHeaderGate", () => {
  it.each(["/es/staff", "/en/staff/login"])("hides on %s", (p) => expect(show(p)).toBeNull());
  it.each(["/es", "/es/me", "/en/staffing"])("shows on %s", (p) => expect(show(p)).not.toBeNull());
});
