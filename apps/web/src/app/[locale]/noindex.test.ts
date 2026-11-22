import { describe, expect, it } from "vitest";
import * as book from "./book/layout";
import * as login from "./login/layout";
import * as me from "./me/layout";

describe("private route groups", () => {
  it.each([
    ["book", book],
    ["me", me],
    ["login", login],
  ])("/%s is not indexed", (_name, mod) => {
    expect(mod.metadata.robots).toEqual({ index: false });
  });
});
