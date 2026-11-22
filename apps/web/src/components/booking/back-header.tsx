import { Link } from "@/i18n/navigation";

/** Step header: back arrow (44 px target) and the page title. */
export function BackHeader({ href, backLabel, title }: { href: string; backLabel: string; title: string }) {
  return (
    <header className="flex items-center gap-2 px-3 pb-2 pt-4">
      <Link
        href={href}
        aria-label={backLabel}
        className="flex size-11 items-center justify-center rounded-xl text-ink hover:text-ink"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </Link>
      <h1 className="font-heading text-lg font-semibold">{title}</h1>
    </header>
  );
}
