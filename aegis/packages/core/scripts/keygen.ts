import { generateKeyPairSync, randomBytes } from "node:crypto";
const { privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
console.log("AEGIS_MASTER_KEY=" + randomBytes(32).toString("base64"));
console.log("AEGIS_SESSION_SECRET=" + randomBytes(32).toString("base64"));
console.log("EVIDENCE_SIGNING_KEY=" + Buffer.from(pem).toString("base64"));
