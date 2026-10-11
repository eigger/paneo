// Home Assistant access available to paired displays is scoped to entities in
// that device's published layout. Legacy flat layouts are still supported.
export function layoutWidgets(layout) {
  if (Array.isArray(layout?.pages)) return layout.pages.flatMap((page) => Array.isArray(page?.widgets) ? page.widgets : []);
  return Array.isArray(layout?.widgets) ? layout.widgets : [];
}

export function deviceAllowsEntity(device, entityId, { toggle = false } = {}) {
  const requestedEntityId = String(entityId || '').trim();
  if (!device || !requestedEntityId) return false;
  if (toggle && !/^(switch|light|input_boolean)\./.test(requestedEntityId)) return false;
  return layoutWidgets(device.published).some((widget) =>
    widget?.type === 'paneo.homeassistant' && String(widget.config?.entityId || '').trim() === requestedEntityId && (!toggle || widget.config?.showToggle));
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
