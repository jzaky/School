// fontkit ships no type declarations. Only create() is used (src/server/documents/pdf.ts): it parses a font file
// into the object pdfkit accepts in place of a file path.
declare module "fontkit" {
  export function create(buffer: Uint8Array, postscriptName?: string): { layout: (...args: unknown[]) => unknown };
}
