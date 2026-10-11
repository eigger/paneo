import { isIP } from 'node:net';

function isAddressOrCidr(value) {
  const [address, prefix, ...extra] = value.split('/');
  if (extra.length || !isIP(address)) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const maxPrefix = isIP(address) === 4 ? 32 : 128;
  const numericPrefix = Number(prefix);
  if (numericPrefix > maxPrefix) return false;
  // These ranges mean "trust any possible proxy" and defeat the point of an
  // explicit trust list (as well as allowing spoofed forwarded headers).
  if (numericPrefix === 0) return false;
  return true;
}

// Fastify's trustProxy option accepts proxy-addr trust entries. Keep this
// deliberately explicit: an unset/blank value leaves forwarded headers off.
export function parseTrustedProxies(value) {
  if (value == null || !String(value).trim()) return undefined;
  const entries = String(value).split(',').map((entry) => entry.trim());
  if (entries.some((entry) => !entry || !isAddressOrCidr(entry))) {
    throw new Error('PANEO_TRUST_PROXY must be a comma-separated list of trusted proxy IPs or CIDRs');
  }
  return entries;
}
