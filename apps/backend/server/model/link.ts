/** The site's icon for a web address, or nothing for any other. The icon request 404s for a site without one. */
export function favicon(href: string): string | null {
  if (!/^https?:/i.test(href)) return null;
  try {
    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=64&url=${encodeURIComponent(new URL(href).origin)}`;
  } catch {
    return null;
  }
}
