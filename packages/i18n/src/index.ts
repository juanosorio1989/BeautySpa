import { en } from "./en";
import { es } from "./es";

export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> };
/** Deep string shape of the English catalog; `es: Messages` makes a missing key a type error. */
export type Messages = DeepString<typeof en>;

export { en, es };
