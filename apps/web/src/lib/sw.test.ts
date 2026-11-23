// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

function load() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { origin: "https://spa.example" },
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: { matchAll: vi.fn(async () => []), openWindow: vi.fn(async () => undefined) },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
  };
  const src = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  vm.runInNewContext(src, { self, URL, console });
  return { self, listeners };
}

async function click(url: unknown) {
  const { self, listeners } = load();
  let pending: Promise<unknown> = Promise.resolve();
  listeners.notificationclick!({
    notification: { close: vi.fn(), data: { url } },
    waitUntil: (p: Promise<unknown>) => (pending = p),
  });
  await pending;
  return self;
}

describe("sw.js", () => {
  it("shows the notification with the url in data", async () => {
    const { self, listeners } = load();
    let pending: Promise<unknown> = Promise.resolve();
    listeners.push!({
      data: { json: () => ({ title: "T", body: "B", url: "/en/manage/x" }) },
      waitUntil: (p: Promise<unknown>) => (pending = p),
    });
    await pending;
    expect(self.registration.showNotification).toHaveBeenCalledWith("T", {
      body: "B",
      data: { url: "/en/manage/x" },
      icon: "/icons/icon-192.png",
    });
  });

  it("opens only same-origin urls", async () => {
    let self = await click("https://spa.example/en/manage/abc");
    expect(self.clients.openWindow).toHaveBeenCalledWith("https://spa.example/en/manage/abc");
    self = await click("https://evil.example/phish");
    expect(self.clients.openWindow).toHaveBeenCalledWith("/");
    self = await click("/en/me");
    expect(self.clients.openWindow).toHaveBeenCalledWith("https://spa.example/en/me");
  });
});
