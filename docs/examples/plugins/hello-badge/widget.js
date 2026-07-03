// Example third-party "module" plugin (docs/plugins.md).
//
// Contract: export a `render(el, config, ctx)` function — identical to every
// in-tree widget in public/shared/widgets.js. `el` is this widget instance's
// own content element, `config` is whatever the editor inspector collected
// from the `config` fields declared in manifest.json, `ctx` is
// { locale, timezone, performanceProfile }.
//
// This runs directly in the editor/display page (not sandboxed) — installing
// it onto the server's filesystem is itself the trust decision, same as the
// server's own code. Escape/validate config the same way you would for any
// other string ending up in innerHTML/style.
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

export function render(el, config, ctx = {}) {
  const text = String(config.text ?? 'Hello, Paneo!');
  const color = HEX_COLOR.test(config.color) ? config.color : '#2563eb';
  const isKo = (ctx.locale || '').startsWith('ko');

  el.innerHTML = `<div class="hello-badge"><div class="hello-badge-tag"></div><div class="hello-badge-text"></div></div>`;
  const wrap = el.firstElementChild;
  wrap.style.cssText = `display:flex;flex-direction:column;align-items:center;justify-content:center;
    width:100%;height:100%;background:${color};color:#fff;border-radius:12px;
    text-align:center;padding:8px;box-sizing:border-box;font-family:inherit;`;

  const tag = el.querySelector('.hello-badge-tag');
  tag.textContent = isKo ? '서드파티 위젯' : 'Third-party widget';
  tag.style.cssText = 'font-size:11px;opacity:.75;letter-spacing:.05em;text-transform:uppercase;';

  const body = el.querySelector('.hello-badge-text');
  body.textContent = text; // textContent, not innerHTML — config comes from whoever edits this dashboard
  body.style.cssText = 'font-size:clamp(14px,3vw,28px);font-weight:600;margin-top:4px;';
}
