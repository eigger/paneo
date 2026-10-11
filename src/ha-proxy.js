// Home Assistant access available to paired displays is scoped to entities in
// that device's published layout. Legacy flat layouts are still supported.
export function layoutWidgets(layout) {
  if (Array.isArray(layout?.pages)) return layout.pages.flatMap((page) => Array.isArray(page?.widgets) ? page.widgets : []);
  return Array.isArray(layout?.widgets) ? layout.widgets : [];
}

export function deviceAllowsEntity(device, entityId, { toggle = false } = {}) {
  if (!device || !entityId) return false;
  return layoutWidgets(device.published).some((widget) =>
    widget?.type === 'paneo.homeassistant' && widget.config?.entityId === entityId && (!toggle || widget.config?.showToggle));
}

// Construct outbound bodies from an explicit allowlist. Never forward pairing
// tokens or caller-supplied fields (especially HA target selectors).
export function homeAssistantPayload(domain, service, body = {}) {
  if (domain === 'homeassistant' && service === 'toggle') {
    return { entity_id: String(body.entity_id || '') };
  }
  if (domain === 'weather' && service === 'get_forecasts') {
    return { entity_id: String(body.entity_id || ''), type: String(body.type || 'daily') };
  }
  return null;
}
