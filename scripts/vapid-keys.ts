// Prints a new VAPID key pair for web push. Run: npx tsx scripts/vapid-keys.ts
// Put the values in WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY (Railway variables, never in git),
// and set WEB_PUSH_SUBJECT to a mailto: or https: contact for the push services.
import { generateVapidKeys } from "../src/server/notify/web-push";

const k = generateVapidKeys();
console.log(`WEB_PUSH_PUBLIC_KEY=${k.publicKey}`);
console.log(`WEB_PUSH_PRIVATE_KEY=${k.privateKey}`);
console.log("WEB_PUSH_SUBJECT=mailto:it@your-school.example");
