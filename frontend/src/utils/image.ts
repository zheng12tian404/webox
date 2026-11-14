export function resolveImage(src?: string | null): string | null {
  if (!src) return null;
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/')) return src;
  return `/images/${src.replace(/^images\//, '')}`;
}
