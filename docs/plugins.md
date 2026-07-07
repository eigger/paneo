# Paneo Third-Party Widget Plugins (docs/design.md §7, D17)

In addition to built-in widgets, Paneo supports installing **third-party widget plugins**. There are two plugin types with distinct trust boundaries.

| Type | Installation Method | Execution Context | Trust Level |
|---|---|---|---|
| `module` | Install folders directly onto the server's filesystem | Executed directly on the editor/display page (not sandboxed) | The act of placing files on the filesystem is the administrator's trust decision — same level as built-in widgets |
| `iframe` | Register an external URL in the manifest | Executed inside a sandboxed `<iframe>` (same mechanism as `paneo.iframe`) | No filesystem access required — simply register the URL; the most lightweight option |

## Installation

1. Create a directory named `data/plugins/<plugin-id>/` and place `manifest.json` inside. (`data/` is the runtime data directory and is not committed to git — only install the plugins needed for each device.)
2. If using the `module` type, place the entry JavaScript file (e.g., `widget.js`) in the same folder.
3. Restart the server. Plugins are scanned once during server startup (no hot reloading — similar to the companion agent installation).
4. The plugin will appear under the **plugins** category in the editor's "+ Add Widget" popover.

A working example is available at [docs/examples/plugins/hello-badge/](examples/plugins/hello-badge/). You can try copying it to `data/plugins/hello-badge/` and restarting the server.

## manifest.json Schema

```json
{
  "id": "hello-badge",            // Required. Must match the directory name exactly
  "version": "1.0.0",             // Required
  "type": "module",               // Required. "module" | "iframe"
  "entry": "widget.js",           // Required if type=module
  "url": "https://example.com/w", // Required if type=iframe
  "sandboxMode": "scripts",       // For type=iframe only. "strict" | "scripts" | "trusted"
  "label": { "ko": "...", "en": "..." },
  "icon": "🔌",
  "defaultSize": { "w": 3, "h": 2 }, // Required
  "minSize": { "w": 2, "h": 1 },
  "requires": [],                 // Performance profile tags (§4.3)
  "permissions": [],              // Displayed in the editor inspector for review
  "config": [                     // Custom inspector form schema — same fields as built-in widgets
    { "key": "text", "label": { "ko": "문구", "en": "Text" }, "type": "text", "default": "" }
  ]
}
```

The config field `type` supports `text`/`number`/`checkbox`/`enum`/`list`/`textarea` (reusing the inspector rendering logic from `public/shared/widgets.js`).

## Writing `module` Plugins

`widget.js` is an ES module that exports a `render(el, config, ctx)` function — matching the contract of built-in widgets.

```js
export function render(el, config, ctx) {
  // el: The widget instance's content DOM element
  // config: The config values collected from the editor inspector (based on the manifest schema)
  // ctx: { locale, timezone, performanceProfile }
  el.textContent = config.text ?? '';
}
```

**There is no sandbox** — this code executes directly on the editor and display pages. Make sure to escape values or use `textContent` when inserting config values into `innerHTML` (see example). If cleanup is required (e.g., clearing intervals), set `el._cleanup = () => {...}` just like in-tree widgets — `renderWidget()` will automatically invoke it before the next render.

## Writing `iframe` Plugins

You can register an iframe plugin using only a `manifest.json` file without any filesystem installation:

```json
{
  "id": "external-dashboard",
  "version": "1.0.0",
  "type": "iframe",
  "url": "https://example.com/widget",
  "sandboxMode": "scripts",
  "defaultSize": { "w": 5, "h": 4 },
  "config": [{ "key": "room", "label": { "ko": "방", "en": "Room" }, "type": "text", "default": "" }]
}
```

Configuration values are appended to the `url` as a query string and sent to the iframe (e.g., `?room=LivingRoom&locale=en-US`). Read these parameters using `location.search` in your iframe application. These utilize the same sandbox tokens (`strict`/`scripts`/`trusted`) as `paneo.iframe` — `strict` is recommended for untrusted sites.

> A postMessage-based real-time data channel (iframe ⇄ host config/data) is not yet supported. Currently, the config is only passed via the query string at initial load. This is a candidate for future extension.
