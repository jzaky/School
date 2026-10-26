// Optional malware scan of uploads through a ClamAV daemon (clamd) over TCP. Off unless CLAMD_HOST is set.
//
//   CLAMD_HOST         host name or address of clamd (unset: scanning is off)
//   CLAMD_PORT         port (default 3310)
//   CLAMD_TIMEOUT_MS   how long one scan may take (default 15000)
//   CLAMD_FAIL_CLOSED  "true" refuses uploads while the scanner cannot be reached (default: accept and log)
//
// The file is streamed with the INSTREAM command; nothing is written to disk. Only the verdict is logged, never
// the file name or contents.
import net from "node:net";

export type ScanResult = { verdict: "clean" } | { verdict: "infected"; signature: string } | { verdict: "skipped" } | { verdict: "error"; failClosed: boolean };

export function scanConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.CLAMD_HOST);
}

const CHUNK = 64 * 1024;

/** Scan one file. "skipped" when no scanner is configured. */
export async function scanBytes(bytes: Uint8Array, env: Record<string, string | undefined> = process.env): Promise<ScanResult> {
  if (!scanConfigured(env)) return { verdict: "skipped" };
  const failClosed = env.CLAMD_FAIL_CLOSED === "true";
  const port = Number(env.CLAMD_PORT ?? 3310) || 3310;
  const timeout = Number(env.CLAMD_TIMEOUT_MS ?? 15000) || 15000;
  try {
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ host: env.CLAMD_HOST!, port });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => socket.destroy(new Error("timeout")), timeout);
      socket.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      socket.on("data", (d) => chunks.push(d));
      socket.on("end", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim());
      });
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        for (let i = 0; i < bytes.length; i += CHUNK) {
          const part = bytes.subarray(i, Math.min(bytes.length, i + CHUNK));
          const size = Buffer.alloc(4);
          size.writeUInt32BE(part.length, 0);
          socket.write(size);
          socket.write(part);
        }
        socket.write(Buffer.alloc(4));
      });
    });
    // "stream: OK" or "stream: Eicar-Signature FOUND".
    if (/:\s*OK$/.test(reply)) return { verdict: "clean" };
    const found = /:\s*(.+)\s+FOUND$/.exec(reply);
    if (found) {
      console.warn(`[scan] upload refused: ${found[1].slice(0, 80)}`);
      return { verdict: "infected", signature: found[1].slice(0, 120) };
    }
    console.error(`[scan] unexpected scanner reply`);
    return { verdict: "error", failClosed };
  } catch (e) {
    console.error(`[scan] scanner unreachable: ${(e as Error)?.name ?? "Error"}`);
    return { verdict: "error", failClosed };
  }
}

/** True when an upload must be refused on the scan result. */
export function scanRefuses(r: ScanResult): boolean {
  return r.verdict === "infected" || (r.verdict === "error" && r.failClosed);
}
