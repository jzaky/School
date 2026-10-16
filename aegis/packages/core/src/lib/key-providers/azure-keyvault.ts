import { env } from "../../env.js";
import type { KeyProvider } from "../keyring.js";

/**
 * Azure Key Vault key provider, over Key Vault's REST API (no SDK). The data key is wrapped with an
 * RSA key in the vault (RSA-OAEP-256); the private half never leaves the vault. In the UAE, Azure's
 * regions are UAE North and UAE Central.
 *
 * Authentication, in this order:
 *  - a service principal: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET (client credentials);
 *  - a managed identity on App Service or Container Apps: IDENTITY_ENDPOINT and IDENTITY_HEADER, which
 *    the platform sets.
 */
const API_VERSION = "7.4";
const ALGORITHM = "RSA-OAEP-256";
const SCOPE = "https://vault.azure.net/.default";

type Fetch = typeof fetch;

async function accessToken(doFetch: Fetch): Promise<string> {
  const e = env();
  if (e.AZURE_TENANT_ID && e.AZURE_CLIENT_ID && e.AZURE_CLIENT_SECRET) {
    const res = await doFetch(`${e.AZURE_AUTHORITY_HOST.replace(/\/$/, "")}/${encodeURIComponent(e.AZURE_TENANT_ID)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: e.AZURE_CLIENT_ID, client_secret: e.AZURE_CLIENT_SECRET, scope: SCOPE }).toString(),
    });
    if (!res.ok) throw new Error(`Azure sign-in failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error("Azure sign-in returned no access token");
    return body.access_token;
  }
  const endpoint = process.env.IDENTITY_ENDPOINT;
  const header = process.env.IDENTITY_HEADER;
  if (endpoint && header) {
    const url = new URL(endpoint);
    url.searchParams.set("resource", "https://vault.azure.net");
    url.searchParams.set("api-version", "2019-08-01");
    if (e.AZURE_CLIENT_ID) url.searchParams.set("client_id", e.AZURE_CLIENT_ID);
    const res = await doFetch(url, { headers: { "X-IDENTITY-HEADER": header } });
    if (!res.ok) throw new Error(`Azure managed identity token request failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error("Azure managed identity returned no access token");
    return body.access_token;
  }
  throw new Error("Azure Key Vault needs AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET, or a managed identity");
}

function keyUrl(): URL {
  const raw = env().AEGIS_AZURE_KEY_URL;
  if (!raw) throw new Error("AEGIS_AZURE_KEY_URL is required for the azure-keyvault key provider");
  const url = new URL(raw);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !local) throw new Error("AEGIS_AZURE_KEY_URL must be https");
  return url;
}

async function keyOperation(doFetch: Fetch, op: "wrapkey" | "unwrapkey", value: Buffer): Promise<Buffer> {
  const url = keyUrl();
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${op}`;
  url.searchParams.set("api-version", API_VERSION);
  const res = await doFetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken(doFetch)}`, "content-type": "application/json" },
    body: JSON.stringify({ alg: ALGORITHM, value: value.toString("base64url") }),
  });
  if (!res.ok) throw new Error(`Azure Key Vault ${op} failed (${res.status})`);
  const body = (await res.json()) as { value?: string };
  if (!body.value) throw new Error(`Azure Key Vault ${op} returned no value`);
  return Buffer.from(body.value, "base64url");
}

export function azureKeyVaultProvider(doFetch: Fetch = fetch): KeyProvider {
  return {
    name: "azure-keyvault",
    unwrap: (wrapped) => keyOperation(doFetch, "unwrapkey", wrapped),
    wrap: (dataKey) => keyOperation(doFetch, "wrapkey", dataKey),
  };
}
