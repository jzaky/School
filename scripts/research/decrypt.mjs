// Decrypts page snapshots written by fetch-pages.mjs into plain text files for extraction.
// The private key lives outside the repository. Output goes to a local folder that is never committed.
//
// Usage: node scripts/research/decrypt.mjs --key <private key pem> --in research/cache/<label> --out <folder>
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createDecipheriv, createHash, privateDecrypt, constants } from "node:crypto";
import { gunzipSync } from "node:zlib";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
);
const privateKey = readFileSync(args.key, "utf8");
mkdirSync(args.out, { recursive: true });
const indexPath = join(args.out, "index.json");
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
const id = (url) => createHash("sha1").update(url).digest("hex").slice(0, 16);
let n = 0;
for (const f of readdirSync(args.in).filter((x) => x.endsWith(".json"))) {
  const box = JSON.parse(readFileSync(join(args.in, f), "utf8"));
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(box.ek, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(box.iv, "base64"));
  d.setAuthTag(Buffer.from(box.tag, "base64"));
  const plain = gunzipSync(Buffer.concat([d.update(Buffer.from(box.data, "base64")), d.final()]));
  const { records } = JSON.parse(plain.toString("utf8"));
  for (const r of records) {
    const pid = id(r.url);
    const head = [`URL: ${r.url}`, `FINAL: ${r.finalUrl ?? ""}`, `STATUS: ${r.status}${r.via ? ` (${r.via}, live site returned ${r.liveStatus})` : ""}`, `FETCHED: ${r.fetchedAt}`, `TITLE: ${r.title ?? ""}`, `HASH: ${r.hash ?? ""}`, "---", ""].join("\n");
    writeFileSync(join(args.out, `${pid}.txt`), head + (r.text ?? ""));
    if (r.links?.length) writeFileSync(join(args.out, `${pid}.links.txt`), r.links.map(([t, h]) => `${t || "(no text)"} | ${h}`).join("\n"));
    const w = r.wayback && r.wayback.text ? r.wayback : null;
    if (w) {
      const wh = [`URL: ${r.url}`, `WAYBACK: ${w.snapshotUrl}`, `TIMESTAMP: ${w.timestamp}`, `HASH: ${w.hash}`, "---", ""].join("\n");
      writeFileSync(join(args.out, `${pid}.wayback.txt`), wh + w.text);
    }
    index[r.url] = { id: pid, file: `${pid}.txt`, links: r.links?.length ? `${pid}.links.txt` : null, status: r.status, finalUrl: r.finalUrl ?? null, chars: (r.text ?? "").length, fetchedAt: r.fetchedAt, hash: r.hash ?? null, via: r.via ?? null, error: r.error ?? null, wayback: w ? { file: `${pid}.wayback.txt`, timestamp: w.timestamp, hash: w.hash } : null };
    n++;
  }
}
writeFileSync(indexPath, JSON.stringify(index, null, 2));
console.log(`decrypted ${n} pages into ${args.out}`);
