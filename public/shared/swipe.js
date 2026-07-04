// Shared horizontal-swipe-to-switch-page detector for the editor's canvas preview
// and the real kiosk display — one implementation so both feel identical, and a
// real touchscreen never double-fires. Pointer Events already cover touch input
// in every browser this project targets (Chromium/WebKit kiosk + any modern
// editing device), so there is exactly one listener set here, not a second
// "touch fallback" reacting to the same physical gesture a second time.
export function attachSwipeNavigation(el, onSwipe, opts = {}) {
  const threshold = opts.threshold ?? 60;
  const verticalDominanceRatio = opts.verticalDominanceRatio ?? 1.5;
  // Editor's canvas also handles mouse-drag for moving/resizing widgets — swipe
  // there must stay touch-only or a mouse drag across empty canvas would trigger
  // an unrelated page switch. The kiosk display has no competing mouse
  // interaction, so it listens to every pointer type (mouse included, e.g. for
  // testing with a trackpad).
  const touchOnly = !!opts.touchOnly;

  let startX = null;
  let startY = null;

  const onDown = (e) => {
    if (touchOnly && e.pointerType !== 'touch') return;
    startX = e.clientX;
    startY = e.clientY;
  };
  const onUp = (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * verticalDominanceRatio) {
      onSwipe(dx > 0 ? -1 : 1);
    }
    startX = null;
    startY = null;
  };
  const onCancel = () => { startX = null; startY = null; };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);

  return () => {
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
  };
}
