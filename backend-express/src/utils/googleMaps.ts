/**
 * Google Maps short links (maps.app.goo.gl, goo.gl, g.co/maps) only carry coordinates after
 * the redirect is followed, so the server fetches them. To avoid SSRF the hostname must match
 * exactly — a substring check would also accept e.g. "https://maps.app.goo.gl.attacker.com".
 */
const SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

export const isGoogleMapsShortLink = (link: string): boolean => {
  try {
    const url = new URL(link.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (SHORT_LINK_HOSTS.has(host)) return true;
    return host === 'g.co' && url.pathname.startsWith('/maps');
  } catch {
    return false;
  }
};
