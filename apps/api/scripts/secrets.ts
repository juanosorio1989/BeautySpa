import { generateKeyPairSync, randomBytes } from "node:crypto";

export type SecretGenerators = Record<string, () => string>;

/** Generators for the secrets `secrets:gen` fills in. */
export function defaultGenerators(): SecretGenerators {
  return {
    JWT_PRIVATE_KEY_B64: () =>
      generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    DATA_ENCRYPTION_KEY: () => randomBytes(32).toString("base64"),
  };
}

/**
 * Adds a `KEY=value` line for each generator key that is absent from `envText`
 * or present with an empty value (`KEY=`, replaced in place). Lines with a
 * value, comments and other keys are never changed.
 */
export function addMissingSecrets(envText: string, gen: SecretGenerators): { text: string; added: string[] } {
  const lines = envText.split("\n");
  const added: string[] = [];
  const append: string[] = [];
  for (const [key, make] of Object.entries(gen)) {
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (idx >= 0 && lines[idx]!.slice(key.length + 1).trim() !== "") continue;
    const line = `${key}=${make()}`;
    if (idx >= 0) lines[idx] = line;
    else append.push(line);
    added.push(key);
  }
  if (added.length === 0) return { text: envText, added };
  let text = lines.join("\n");
  if (append.length > 0) {
    if (text !== "" && !text.endsWith("\n")) text += "\n";
    text += append.join("\n") + "\n";
  }
  return { text, added };
}
