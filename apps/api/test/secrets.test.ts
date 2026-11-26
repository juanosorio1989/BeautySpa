import { createECDH, createPrivateKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addMissingSecrets, defaultGenerators, SECRET_GROUPS } from "../scripts/secrets.js";

const gens = {
  JWT_PRIVATE_KEY_B64: () => "jwtvalue",
  DATA_ENCRYPTION_KEY: () => "deckvalue",
};

describe("addMissingSecrets", () => {
  it("fills empty and absent keys without touching other lines", () => {
    const { text, added } = addMissingSecrets("A=1\nJWT_PRIVATE_KEY_B64=\n", gens);
    expect(added).toEqual(["JWT_PRIVATE_KEY_B64", "DATA_ENCRYPTION_KEY"]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("A=1");
    expect(lines[1]).toBe("JWT_PRIVATE_KEY_B64=jwtvalue");
    expect(lines).toContain("DATA_ENCRYPTION_KEY=deckvalue");
    expect(lines.filter((l) => l.startsWith("JWT_PRIVATE_KEY_B64="))).toHaveLength(1);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("is idempotent", () => {
    const first = addMissingSecrets("A=1\nJWT_PRIVATE_KEY_B64=\n", gens);
    const second = addMissingSecrets(first.text, gens);
    expect(second.added).toEqual([]);
    expect(second.text).toBe(first.text);
  });

  it("keeps existing non-empty values and ignores commented keys", () => {
    const input = "# DATA_ENCRYPTION_KEY=old\nJWT_PRIVATE_KEY_B64=keep\nB=2";
    const { text, added } = addMissingSecrets(input, gens);
    expect(added).toEqual(["DATA_ENCRYPTION_KEY"]);
    expect(text).toBe("# DATA_ENCRYPTION_KEY=old\nJWT_PRIVATE_KEY_B64=keep\nB=2\nDATA_ENCRYPTION_KEY=deckvalue\n");
  });
});

describe("addMissingSecrets groups", () => {
  const pairGens = { P: () => "pub", Q: () => "priv", S: () => "solo" };
  const groups = [["P", "Q"]];

  it("fills a group only when every key in it is missing", () => {
    const { text, added, skipped } = addMissingSecrets("P=\n", pairGens, groups);
    expect(added).toEqual(["P", "Q", "S"]);
    expect(skipped).toEqual([]);
    expect(text).toBe("P=pub\nQ=priv\nS=solo\n");
  });

  it("leaves a partial group alone and reports the missing key as skipped", () => {
    const { text, added, skipped } = addMissingSecrets("P=keep\nQ=\n", pairGens, groups);
    expect(added).toEqual(["S"]);
    expect(skipped).toEqual(["Q"]);
    expect(text).toBe("P=keep\nQ=\nS=solo\n");
  });
});

describe("defaultGenerators", () => {
  it("generates MANAGE_LINK_SECRET and a VAPID pair", () => {
    const gen = defaultGenerators();
    expect(Buffer.from(gen.MANAGE_LINK_SECRET!(), "base64")).toHaveLength(32);

    const pub = gen.VAPID_PUBLIC_KEY!();
    const priv = gen.VAPID_PRIVATE_KEY!();
    expect(pub).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(priv).toMatch(/^[A-Za-z0-9_-]+$/);
    const pubRaw = Buffer.from(pub, "base64url");
    const privRaw = Buffer.from(priv, "base64url");
    expect(pubRaw).toHaveLength(65);
    expect(pubRaw[0]).toBe(0x04);
    expect(privRaw).toHaveLength(32);
    // Same key pair: the public point derived from the private scalar matches.
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(privRaw);
    expect(ecdh.getPublicKey().equals(pubRaw)).toBe(true);
  });

  it("the VAPID pair matches when the private key is generated first", () => {
    const gen = defaultGenerators();
    const priv = gen.VAPID_PRIVATE_KEY!();
    const pub = gen.VAPID_PUBLIC_KEY!();
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(priv, "base64url"));
    expect(ecdh.getPublicKey("base64url")).toBe(pub);
  });

  it("each defaultGenerators() call yields a fresh VAPID pair", () => {
    expect(defaultGenerators().VAPID_PUBLIC_KEY!()).not.toBe(defaultGenerators().VAPID_PUBLIC_KEY!());
  });

  it("SECRET_GROUPS keeps the VAPID keys together", () => {
    expect(SECRET_GROUPS).toContainEqual(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]);
  });

  it("DATA_ENCRYPTION_KEY decodes to 32 bytes", () => {
    expect(Buffer.from(defaultGenerators().DATA_ENCRYPTION_KEY!(), "base64")).toHaveLength(32);
  });

  it("JWT_PRIVATE_KEY_B64 is a PKCS#8 DER Ed25519 key", () => {
    const v = defaultGenerators().JWT_PRIVATE_KEY_B64!();
    const key = createPrivateKey({ key: Buffer.from(v, "base64"), format: "der", type: "pkcs8" });
    expect(key.asymmetricKeyType).toBe("ed25519");
  });
});
