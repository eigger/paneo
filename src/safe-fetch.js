// Follow only same-origin redirects for user-configured feed/Immich URLs.
// Direct private-LAN URLs remain supported; redirects cannot pivot to another
// host (for example, a public feed redirecting the server to localhost).
export async function fetchSameOrigin(input, options = {}, maxRedirects = 5) {
  const original = new URL(input);
  if (!['http:', 'https:'].includes(original.protocol)) throw new Error('Only HTTP(S) URLs are supported');
  let current = original;
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const response = await fetch(current, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    if (redirects === maxRedirects) throw new Error('Too many redirects');
    const next = new URL(location, current);
    if (next.origin !== original.origin) throw new Error('Cross-origin redirects are not allowed');
    current = next;
  }
  throw new Error('Too many redirects');
}
