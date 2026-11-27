import type { StaffMe } from "@beautyspa/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@beautyspa/i18n";
import { StaffContext } from "@/lib/staff/use-staff";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { RoleGuard } from "./role-guard";

const mount = (role: StaffMe["role"]) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StaffContext.Provider value={{ id: "1", name: "Ana", email: "a@x.dev", role }}>
        <RoleGuard allow={["OWNER", "RECEPTION"]}>
          <p>secret clients</p>
        </RoleGuard>
      </StaffContext.Provider>
    </NextIntlClientProvider>,
  );

describe("RoleGuard", () => {
  afterEach(cleanup);

  it("hides content from EMPLOYEE", () => {
    mount("EMPLOYEE");
    expect(screen.queryByText("secret clients")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the agenda" })).toHaveAttribute("href", "/staff");
  });

  it("shows content to RECEPTION", () => {
    mount("RECEPTION");
    expect(screen.getByText("secret clients")).toBeInTheDocument();
  });
});
