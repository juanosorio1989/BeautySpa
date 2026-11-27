import { describe, expect, it } from "vitest";
import { freeGaps } from "./gaps";

const m = (n: number) => n * 60_000;

describe("freeGaps", () => {
  it("subtracts busy and drops short gaps", () => {
    const out = freeGaps(
      [{ start: m(0), end: m(240) }],
      [
        { start: m(60), end: m(120) },
        { start: m(130), end: m(200) }, // 10 min gap before: dropped
        { start: m(100), end: m(125) }, // overlaps
      ],
    );
    expect(out).toEqual([
      { start: m(0), end: m(60) },
      { start: m(200), end: m(240) },
    ]);
  });

  it("keeps whole ranges when nothing is busy and ignores busy outside", () => {
    expect(freeGaps([{ start: m(10), end: m(60) }], [{ start: m(100), end: m(120) }])).toEqual([
      { start: m(10), end: m(60) },
    ]);
  });
});
