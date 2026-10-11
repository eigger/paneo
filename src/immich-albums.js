const CACHE_TTL_MS = 5 * 60 * 1000;
const albumAssetCache = new Map();

function cacheKey(url, apiKey, albumId) {
  return `${String(url).replace(/\/+$/, '')}\n${apiKey}\n${albumId}`;
}

export function rememberAlbumAssets(url, apiKey, albumId, assets, now = Date.now()) {
  if (!url || !apiKey || !albumId) return;
  const ids = new Set((Array.isArray(assets) ? assets : []).map((asset) => String(asset?.id ?? asset)));
  albumAssetCache.set(cacheKey(url, apiKey, albumId), { ids, expiresAt: now + CACHE_TTL_MS });
}

// null means there is no fresh membership snapshot; true/false is a verified result.
export function albumContainsAsset(url, apiKey, albumId, assetId, now = Date.now()) {
  const key = cacheKey(url, apiKey, albumId);
  const cached = albumAssetCache.get(key);
  if (!cached || cached.expiresAt <= now) {
    albumAssetCache.delete(key);
    return null;
  }
  return cached.ids.has(String(assetId));
}
