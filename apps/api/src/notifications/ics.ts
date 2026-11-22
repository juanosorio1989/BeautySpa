/** Hand-written RFC 5545 generator: CRLF, 75-octet folding, text escaping. No dependencies. */

export interface IcsEvent {
  uid: string;
  sequence: number;
  dtstamp: Date;
  start: Date;
  end: Date;
  summary: string;
  location: string;
  description: string;
  url: string;
  status: "CONFIRMED" | "CANCELLED";
}

export interface IcsOptions {
  method: "REQUEST" | "CANCEL" | "PUBLISH";
  organizerEmail?: string;
  attendeeEmail?: string;
}

/** UTC basic format `YYYYMMDDTHHMMSSZ`. */
function utc(d: Date): string {
  return d
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds at 75 octets, never splitting a multibyte character; continuation lines start with one space. */
function fold(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (curBytes + n > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74; // the leading space counts as one octet
    }
    cur += ch;
    curBytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcs(event: IcsEvent, opts: IcsOptions): string {
  const withParties = opts.method === "REQUEST" || opts.method === "CANCEL";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BeautySpa//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${opts.method}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${utc(event.dtstamp)}`,
    `DTSTART:${utc(event.start)}`,
    `DTEND:${utc(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `LOCATION:${escapeText(event.location)}`,
    `DESCRIPTION:${escapeText(`${event.description}\n${event.url}`)}`,
  ];
  if (withParties && opts.organizerEmail) lines.push(`ORGANIZER:mailto:${opts.organizerEmail}`);
  if (withParties && opts.attendeeEmail) lines.push(`ATTENDEE;RSVP=FALSE:mailto:${opts.attendeeEmail}`);
  lines.push(`STATUS:${event.status}`, "END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
