import { MINUTE } from "@beautyspa/datetime";

export interface Span {
  start: number;
  end: number;
}

const MIN_GAP = 15 * MINUTE;

/** `ranges` minus `busy` (epoch ms), sorted by start; gaps shorter than 15 minutes are dropped. */
export function freeGaps(ranges: Span[], busy: Span[]): Span[] {
  const blocks = [...busy].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    let cursor = range.start;
    for (const block of blocks) {
      if (block.end <= cursor) continue;
      if (block.start >= range.end) break;
      if (block.start > cursor) out.push({ start: cursor, end: block.start });
      cursor = Math.max(cursor, block.end);
    }
    if (cursor < range.end) out.push({ start: cursor, end: range.end });
  }
  return out.filter((g) => g.end - g.start >= MIN_GAP);
}
