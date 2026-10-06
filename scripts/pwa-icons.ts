// Generates the installable app icons in public/ from the brand mark. Run: npx tsx scripts/pwa-icons.ts
import sharp from "sharp";
import path from "node:path";

const OUT = path.join(process.cwd(), "public");
const MARK = `<path d="M160 136h48v96h96v-96h48v240h-48v-100h-96v100h-48z" fill="#E9C46A"/>`;
const GRADIENT = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#123A63"/><stop offset="1" stop-color="#1d5a93"/></linearGradient></defs>`;

// Rounded tile (same as icon.svg) for "any" purpose icons.
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${GRADIENT}<rect width="512" height="512" rx="112" fill="url(#g)"/>${MARK}</svg>`;
// Full-bleed square with the mark inside the 80% safe zone, for maskable icons and the iOS home screen.
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${GRADIENT}<rect width="512" height="512" fill="url(#g)"/><g transform="translate(76.8 76.8) scale(0.7)">${MARK}</g></svg>`;
// Monochrome badge for the Android status bar (white on transparent).
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M120 96h72v128h128v-128h72v320h-72v-128h-128v128h-72z" fill="#fff"/></svg>`;

async function png(svg: string, size: number, file: string) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(path.join(OUT, file));
  console.log(`wrote public/${file}`);
}

async function main() {
  await png(rounded, 192, "icon-192.png");
  await png(rounded, 512, "icon-512.png");
  await png(square, 512, "icon-maskable-512.png");
  await png(square, 192, "icon-maskable-192.png");
  await png(square, 180, "apple-touch-icon.png");
  await png(badge, 72, "badge-72.png");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
