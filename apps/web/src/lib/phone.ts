const ALLOWED = /^[\d\s().+-]*$/;
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/;

function nationalDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits.startsWith("1") ? digits.slice(1) : digits;
}

/** US only: 10 digits, or 11 starting with 1, valid NANP. Returns E.164 or null. */
export function toE164(input: string): string | null {
  if (!ALLOWED.test(input)) return null;
  // NANP matches exactly 10 digits, so anything but 10, or 11 with a leading 1, is refused here.
  const national = nationalDigits(input);
  return NANP.test(national) ? `+1${national}` : null;
}

/** Formats digits as the user types: (718) 555-0123. A leading country code 1 is dropped. */
export function formatUsPhone(digits: string): string {
  const d = nationalDigits(digits).slice(0, 10);
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
