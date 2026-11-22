import { generateKeyPairSync, randomBytes } from "node:crypto";

export type SecretGenerators = Record<string, () => string>;

/** Keys that must be generated together (one key pair). */
export type SecretGroups = readonly (readonly string[])[];

/** The VAPID public and private key come from one key pair, so they are only ever generated together. */
export const SECRET_GROUPS: SecretGroups = [["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]];

/** A fresh P-256 VAPID pair: public = raw uncompressed point `0x04||x||y`, private = scalar `d`, both base64url. */
function vapidPair(): { publicKey: string; privateKey: string } {
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" });
  const x = Buffer.from(jwk.x!, "base64url");
  const y = Buffer.from(jwk.y!, "base64url");
  return {
    publicKey: Buffer.concat([Buffer.from([0x04]), x, y]).toString("base64url"),
    privateKey: jwk.d!,
  };
}

/**
 * Generators for the secrets `secrets:gen` fills in. Both VAPID generators read one lazily created
 * pair (whichever runs first creates it), so the two keys always match within one call of this function.
 */
export function defaultGenerators(): SecretGenerators {
  let vapid: { publicKey: string; privateKey: string } | undefined;
  const pair = () => (vapid ??= vapidPair());
  return {
    JWT_PRIVATE_KEY_B64: () =>
      generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    DATA_ENCRYPTION_KEY: () => randomBytes(32).toString("base64"),
    MANAGE_LINK_SECRET: () => randomBytes(32).toString("base64"),
    VAPID_PUBLIC_KEY: () => pair().publicKey,
    VAPID_PRIVATE_KEY: () => pair().privateKey,
  };
}

/**
 * Adds a `KEY=value` line for each generator key that is absent from `envText`
 * or present with an empty value (`KEY=`, replaced in place). Lines with a
 * value, comments and other keys are never changed.
 *
 * A key in a `groups` entry is filled only when every key of that group is missing:
 * if some are set (e.g. only `VAPID_PUBLIC_KEY`), generating the others would produce
 * a mismatched pair, so the missing ones are left alone and returned in `skipped`.
 */
export function addMissingSecrets(
  envText: string,
  gen: SecretGenerators,
  groups: SecretGroups = [],
): { text: string; added: string[]; skipped: string[] } {
  const lines = envText.split("\n");
  const indexOf = (key: string) => lines.findIndex((l) => l.startsWith(`${key}=`));
  const isMissing = (key: string) => {
    const idx = indexOf(key);
    return idx < 0 || lines[idx]!.slice(key.length + 1).trim() === "";
  };
  const partial = new Set(groups.filter((g) => !g.every(isMissing)).flat());

  const added: string[] = [];
  const skipped: string[] = [];
  const append: string[] = [];
  for (const [key, make] of Object.entries(gen)) {
    if (!isMissing(key)) continue;
    if (partial.has(key)) {
      skipped.push(key);
      continue;
    }
    const idx = indexOf(key);
    const line = `${key}=${make()}`;
    if (idx >= 0) lines[idx] = line;
    else append.push(line);
    added.push(key);
  }
  if (added.length === 0) return { text: envText, added, skipped };
  let text = lines.join("\n");
  if (append.length > 0) {
    if (text !== "" && !text.endsWith("\n")) text += "\n";
    text += append.join("\n") + "\n";
  }
  return { text, added, skipped };
}
