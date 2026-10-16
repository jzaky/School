import { env, resetEnvForTests } from "../env.js";

/**
 * The data keys that encrypt stored secrets (AES-256-GCM, see crypto.ts), and where they come from.
 *
 * Envelope encryption: a 32-byte data key encrypts the rows. Where that data key is held depends on
 * AEGIS_KEY_PROVIDER:
 *  - "env" (default): AEGIS_MASTER_KEY is the data key itself, base64. Simple, and what development
 *    and the demo use. Anyone who can read the environment can read the key.
 *  - "aws-kms" or "azure-keyvault": AEGIS_MASTER_KEY is the data key WRAPPED (encrypted) by a key that
 *    never leaves the vault. Each process asks the vault to unwrap it once at startup (initKeyring) and
 *    keeps the plain data key only in memory. Reading the environment is no longer enough to decrypt.
 *
 * Every key has an id. New envelopes record the id of the key that wrote them (v2), so a rotation can
 * add a new current key while the previous ones (AEGIS_PREVIOUS_MASTER_KEYS, "id:value,id:value", in
 * the same form as AEGIS_MASTER_KEY) still decrypt older rows until they are re-encrypted
 * (reencryptStoredSecrets). Rotating the vault key alone needs no row changes: re-wrap the same data key.
 */
export type KeyProviderName = "env" | "aws-kms" | "azure-keyvault";

export interface KeyProvider {
  readonly name: KeyProviderName;
  /** Returns the 32-byte data key inside a wrapped blob. */
  unwrap(wrapped: Buffer): Promise<Buffer>;
  /** Wraps a 32-byte data key so it can be stored in AEGIS_MASTER_KEY. */
  wrap(dataKey: Buffer): Promise<Buffer>;
}

export interface DataKey {
  id: string;
  key: Buffer;
}

interface Keyring {
  current: DataKey;
  all: DataKey[];
}

let ring: Keyring | null = null;
let providerOverride: KeyProvider | null = null;

const KEY_ID = /^[A-Za-z0-9_-]{1,32}$/;

function parsePrevious(raw: string | undefined): { id: string; value: string }[] {
  if (!raw || raw.trim() === "") return [];
  return raw.split(",").map((part) => {
    const i = part.indexOf(":");
    if (i <= 0) throw new Error("AEGIS_PREVIOUS_MASTER_KEYS entries must be id:value");
    const id = part.slice(0, i).trim();
    if (!KEY_ID.test(id)) throw new Error(`Invalid key id in AEGIS_PREVIOUS_MASTER_KEYS: ${id}`);
    return { id, value: part.slice(i + 1).trim() };
  });
}

function asDataKey(id: string, key: Buffer, source: string): DataKey {
  if (key.length !== 32) throw new Error(`${source} must decode to a 32-byte data key`);
  return { id, key };
}

function configured(): { provider: KeyProviderName; currentId: string; current: string; previous: { id: string; value: string }[] } {
  const e = env();
  const currentId = e.AEGIS_MASTER_KEY_ID;
  if (!KEY_ID.test(currentId)) throw new Error("AEGIS_MASTER_KEY_ID must be 1 to 32 letters, digits, _ or -");
  const previous = parsePrevious(e.AEGIS_PREVIOUS_MASTER_KEYS);
  if (previous.some((p) => p.id === currentId)) throw new Error("A previous master key reuses the current key id");
  return { provider: e.AEGIS_KEY_PROVIDER, currentId, current: e.AEGIS_MASTER_KEY, previous };
}

function build(keys: DataKey[]): Keyring {
  return { current: keys[0]!, all: keys };
}

/**
 * Loads the keys. With the env provider this is synchronous work and happens on first use anyway;
 * with a vault provider it must run once at process startup, before any secret is read or written.
 */
export async function initKeyring(): Promise<void> {
  const c = configured();
  if (c.provider === "env") {
    ring = envRing();
    return;
  }
  const provider = providerOverride ?? (await loadProvider(c.provider));
  const keys: DataKey[] = [];
  for (const { id, value } of [{ id: c.currentId, value: c.current }, ...c.previous]) {
    const unwrapped = await provider.unwrap(Buffer.from(value, "base64"));
    keys.push(asDataKey(id, unwrapped, `The data key ${id} unwrapped by ${provider.name}`));
  }
  ring = build(keys);
}

function envRing(): Keyring {
  const c = configured();
  const keys = [{ id: c.currentId, value: c.current }, ...c.previous].map(({ id, value }) => asDataKey(id, Buffer.from(value, "base64"), id === c.currentId ? "AEGIS_MASTER_KEY" : `Previous master key ${id}`));
  return build(keys);
}

function loaded(): Keyring {
  if (ring) return ring;
  const c = configured();
  if (c.provider !== "env") throw new Error(`AEGIS_KEY_PROVIDER is ${c.provider}: call initKeyring() at process startup before reading or writing secrets`);
  ring = envRing();
  return ring;
}

/** The key new envelopes are written with. */
export function currentDataKey(): DataKey {
  return loaded().current;
}

/** Every key that may decrypt a stored envelope, current first. */
export function dataKeys(): DataKey[] {
  return loaded().all;
}

export function dataKeyById(id: string): DataKey | undefined {
  return loaded().all.find((k) => k.id === id);
}

/** Tests only: forget the loaded keys (after changing the environment) and optionally inject a provider. */
export function resetKeyringForTests(provider: KeyProvider | null = null): void {
  resetEnvForTests();
  ring = null;
  providerOverride = provider;
}

export async function loadProvider(name: KeyProviderName): Promise<KeyProvider> {
  if (name === "aws-kms") return (await import("./key-providers/aws-kms.js")).awsKmsProvider();
  if (name === "azure-keyvault") return (await import("./key-providers/azure-keyvault.js")).azureKeyVaultProvider();
  throw new Error("The env provider does not wrap keys");
}
