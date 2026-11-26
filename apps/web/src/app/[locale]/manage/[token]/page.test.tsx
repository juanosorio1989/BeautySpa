import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/manage/manage-view", () => ({
  ManageView: ({ token }: { token: string }) => <p>token:{token}</p>,
}));

import ManagePage, { metadata } from "./page";

describe("/manage/[token]", () => {
  it("is not indexed", () => {
    expect(metadata.robots).toEqual({ index: false });
  });

  it("renders the view with the token", async () => {
    render(await ManagePage({ params: Promise.resolve({ token: "abc" }) }));
    expect(screen.getByText("token:abc")).toBeInTheDocument();
  });
});
