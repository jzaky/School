// Finds Tailwind classes that use physical directions (left/right) instead of logical ones (start/end).
export const PHYSICAL_CLASS_RE =
  /(?<![\w-])(?:[a-z0-9-]+:)*-?(?:m[lr]|p[lr]|left|right|border-[lr]|rounded-(?:[lr]|tl|tr|bl|br)|text-left|text-right|float-left|float-right|scroll-m[lr]|scroll-p[lr]|slide-in-from-left|slide-in-from-right|slide-out-to-left|slide-out-to-right)(?:-[\w./[\]%()]+)?(?![\w-])/g;

export function findPhysicalClasses(source: string): Array<{ line: number; match: string }> {
  const out: Array<{ line: number; match: string }> = [];
  const lines = source.split("\n");
  lines.forEach((text, i) => {
    // Only look inside string literals, where class names live.
    const strings = text.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? [];
    for (const raw of strings) {
      // Radix side-aware variants (data-[side=left]:...) describe physical placement and are correct in both directions.
      const s = raw.replace(/data-\[side=(?:left|right)\]:\S*/g, "");
      for (const m of s.matchAll(PHYSICAL_CLASS_RE)) {
        const token = m[0];
        // rtl:/ltr: variants that deliberately use physical sides are allowed.
        if (/(^|:)(rtl|ltr):/.test(token)) continue;
        out.push({ line: i + 1, match: token });
      }
    }
  });
  return out;
}
