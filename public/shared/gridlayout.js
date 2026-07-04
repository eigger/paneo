// Shared CSS Grid sizing — the editor canvas and the display stage must compute
// the exact same effective row count from the same layout data, or a widget's
// vertical position drifts between the editor preview and the real display.
//
// Previously each renderer positioned widgets with hand-computed pixel math and
// a *fixed* row height (e.g. 80px). Column width scaled with the container
// (`clientWidth / cols`) but row height did not scale with container height —
// so the same layout looked right in a 720px-tall editor preview and wrong on
// a display with a different resolution/aspect ratio (docs/design.md §14 risk #7).
// Using real CSS Grid with `1fr` tracks for both axes makes both dimensions
// scale proportionally to whatever the container's actual size is.

// Total rows to lay the grid out with: at least the configured minimum, but
// grown automatically if any widget's own y+h extends past it.
export function effectiveRows(layout) {
  const configured = layout?.grid?.rows || 7;
  // Support both page object ({widgets}) and full layout ({pages, widgets})
  const widgets = layout?.widgets || [];
  const used = widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
  return Math.max(configured, used, 1);
}

export function applyGridContainer(el, layout) {
  const cols = layout.grid?.cols || 12;
  const rows = effectiveRows(layout);
  const gap = layout.grid?.gap ?? 8;
  el.style.display = 'grid';
  el.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  el.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  el.style.gap = `${gap}px`;
  // Outer edge-to-widget inset matches the inter-widget gap, so the screen border
  // doesn't look tighter/looser than the spacing between widgets themselves.
  el.style.padding = `${gap}px`;
}

export function applyGridItem(el, w) {
  el.style.gridColumn = `${w.x + 1} / span ${w.w}`;
  el.style.gridRow = `${w.y + 1} / span ${w.h}`;
}

// Per-instance style override (docs/design.md D16): `css` is a CSS *declaration
// list* (e.g. "border-radius:12px; opacity:.9;"), not a stylesheet with selectors.
// Applying it as inline style on the widget's own content element means it can only
// ever affect that one widget — there's no selector to leak into other widgets or
// the app chrome, so no sandboxing/escaping is needed beyond what inline style already is.
export function applyCustomCss(el, css) {
  el.style.cssText = css || '';
}
