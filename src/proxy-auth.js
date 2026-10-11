function widgetsIn(layout) {
  if (Array.isArray(layout?.pages)) return layout.pages.flatMap((page) => Array.isArray(page?.widgets) ? page.widgets : []);
  return Array.isArray(layout?.widgets) ? layout.widgets : [];
}

function canonicalUrl(value, trimTrailingSlash = false) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return trimTrailingSlash ? url.href.replace(/\/+$/, '') : url.href;
  } catch { return null; }
}

export function deviceAllowsFeedUrls(device, type, requestedUrls) {
  if (!device || !Array.isArray(requestedUrls) || requestedUrls.length === 0) return false;
  const field = type === 'rss' ? 'feedUrls' : 'icsUrls';
  const allowed = new Set();
  for (const widget of widgetsIn(device.published)) {
    if (widget?.type !== (type === 'rss' ? 'paneo.rss' : 'paneo.calendar') &&
        !(type === 'ical' && widget?.type === 'paneo.calendar.month')) continue;
    for (const entry of Array.isArray(widget.config?.[field]) ? widget.config[field] : []) {
      const value = type === 'ical' ? String(entry).split('|', 1)[0] : entry;
      const url = canonicalUrl(value);
      if (url) allowed.add(url);
    }
  }
  return requestedUrls.every((url) => {
    const canonical = canonicalUrl(url);
    return canonical && allowed.has(canonical);
  });
}

export function deviceAllowsImmich(device, url, apiKey, albumId = '') {
  const requestedUrl = canonicalUrl(url, true);
  if (!device || !requestedUrl || !apiKey) return false;
  return widgetsIn(device.published).some((widget) =>
    widget?.type === 'paneo.photo' && widget.config?.source === 'immich' &&
    canonicalUrl(widget.config?.immichUrl, true) === requestedUrl && widget.config?.immichApiKey === apiKey &&
    String(widget.config?.immichAlbumId || '') === String(albumId || ''));
}

function localPhotoWidgets(device) {
  return widgetsIn(device?.published).filter((widget) =>
    widget?.type === 'paneo.photo' && widget.config?.source === 'local');
}

export function deviceAllowsLocalPhoto(device, filename) {
  const widgets = localPhotoWidgets(device);
  if (!widgets.length) return false;
  if (filename == null) return true;
  const name = String(filename).split(/[\\/]/).pop();
  return widgets.some((widget) => {
    const selected = Array.isArray(widget.config?.localSelectedFiles)
      ? widget.config.localSelectedFiles.map((entry) => String(entry).split(/[\\/]/).pop())
      : [];
    return selected.length === 0 || selected.includes(name);
  });
}

export function filterLocalPhotoFiles(device, filenames) {
  return (Array.isArray(filenames) ? filenames : []).filter((filename) =>
    deviceAllowsLocalPhoto(device, filename));
}
