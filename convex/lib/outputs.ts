/** Collects every http(s) URL inside a toolkit result, whatever its shape. */
export function collectUrls(value: unknown, found: string[] = [], depth = 0): string[] {
  if (depth > 6 || found.length >= 100) return found;
  if (typeof value === "string") {
    if (/^https?:\/\/\S+$/.test(value) && !found.includes(value)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, found, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectUrls(item, found, depth + 1);
  }
  return found;
}
