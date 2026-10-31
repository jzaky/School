/** The request the stubs answer for: the session cookie and headers a server action would see. */
export const request = { cookies: new Map<string, string>(), headers: new Map<string, string>() };

/** A Next.js redirect: thrown with the digest Next uses, so the actions' own handling treats it as a redirect. */
export class RedirectError extends Error {
  digest: string;
  constructor(public url: string) {
    super(`NEXT_REDIRECT ${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}
