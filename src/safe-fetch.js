import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

function isPrivateIpv4(address) {
  const [a, b, c] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113);
}

function ipv4MappedAddress(address) {
  const lower = address.toLowerCase();
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(lower)) return lower.slice(7);
  const halves = lower.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (words.length !== 8 || words.slice(0, 5).some((word) => word !== '0') || words[5] !== 'ffff') return null;
  const high = Number.parseInt(words[6], 16);
  const low = Number.parseInt(words[7], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function isPublicAddress(address) {
  if (isIP(address) === 4) return !isPrivateIpv4(address);
  if (isIP(address) === 6) {
    const mapped = ipv4MappedAddress(address);
    if (mapped) return !isPrivateIpv4(mapped);
    // Permit global unicast (2000::/3), excluding the documentation prefix.
    const firstWord = Number.parseInt(address.split(':')[0] || '0', 16);
    return firstWord >= 0x2000 && firstWord <= 0x3fff && !address.toLowerCase().startsWith('2001:db8:');
  }
  return false;
}

async function resolvePublicRedirectTarget(url) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Redirect to a private network is not allowed');
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Redirect to a private network is not allowed');
  }
  return addresses;
}

function pinnedAgent(addresses) {
  return new Agent({ connect: { lookup: (_hostname, options, callback) => {
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  } } });
}

function withoutSensitiveHeaders(headers) {
  const safe = new Headers(headers);
  for (const name of ['authorization', 'cookie', 'cookie2', 'proxy-authorization', 'x-api-key']) {
    safe.delete(name);
  }
  return safe;
}

// Direct private-LAN URLs remain supported. Cross-origin redirects are allowed
// only to public hosts, with their resolved address pinned to prevent DNS rebinding.
export async function fetchSameOrigin(input, options = {}, maxRedirects = 5) {
  const original = new URL(input);
  if (!['http:', 'https:'].includes(original.protocol)) throw new Error('Only HTTP(S) URLs are supported');
  let current = original;
  let dispatcher = undefined;
  const dispatchers = new Set();
  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      const response = await fetch(current, { ...options, ...(dispatcher ? { dispatcher } : {}), redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        if (!dispatchers.size) return response;
        const body = response.body ? await response.arrayBuffer() : null;
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      const location = response.headers.get('location');
      if (!location) {
        if (!dispatchers.size) return response;
        const body = response.body ? await response.arrayBuffer() : null;
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      // Release the connection before waiting on DNS or issuing the next hop.
      await response.body?.cancel();
      if (redirects === maxRedirects) throw new Error('Too many redirects');
      const next = new URL(location, current);
      if (!['http:', 'https:'].includes(next.protocol)) throw new Error('Only HTTP(S) URLs are supported');
      if (next.origin !== current.origin) {
        const resolved = await resolvePublicRedirectTarget(next);
        dispatcher = pinnedAgent(resolved);
        dispatchers.add(dispatcher);
        const headers = withoutSensitiveHeaders(options.headers);
        current = next;
        options = { ...options, headers };
      } else {
        current = next;
      }
    }
    throw new Error('Too many redirects');
  } finally {
    await Promise.all([...dispatchers].map((item) => item.close().catch(() => {})));
  }
}
