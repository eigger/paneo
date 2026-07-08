import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

// Create a shadowed version of display.js with absolute browser paths mapped to relative paths
const displayJsPath = path.resolve('public/display/display.js');
let displayJsContent = fs.readFileSync(displayJsPath, 'utf8');
displayJsContent = displayJsContent
  .replaceAll("'/shared/", "'../public/shared/")
  .replaceAll('"/shared/', '"../public/shared/');

const shadowPath = path.resolve('test/display.test.shadow.js');
fs.writeFileSync(shadowPath, displayJsContent, 'utf8');

test.after(() => {
  try {
    fs.unlinkSync(shadowPath);
  } catch {}
});

test('display.js: renders cached layout on startup', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="stage"></div><div id="status"></div><div id="identify-overlay" class="hidden"></div><div id="update-status-banner"></div><div id="notify-stack"></div></body></html>');

  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle.bind(dom.window), configurable: true, writable: true });

  const storage = {};
  storage['paneo:layout:test-token'] = JSON.stringify({
    layout: {
      pages: [
        { id: 'page-0', widgets: [{ id: 'w1', type: 'paneo.text', config: { text: 'Cached Hello' } }] }
      ]
    },
    ctx: { locale: 'en-US' }
  });

  globalThis.localStorage = {
    getItem: (key) => storage[key] || null,
    setItem: (key, val) => { storage[key] = val; }
  };

  globalThis.location = {
    pathname: '/d/test-token',
    host: 'localhost',
    protocol: 'http:'
  };

  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };

  globalThis.requestAnimationFrame = (cb) => { cb(); };

  globalThis.fetch = async (url) => {
    if (url === '/api/version') {
      return {
        json: async () => ({ components: { display: '1.2.3' } })
      };
    }
    throw new Error('unexpected fetch: ' + url);
  };

  let wsInstance = null;
  globalThis.WebSocket = class {
    constructor(url) {
      this.url = url;
      wsInstance = this;
    }
    close() {}
    send() {}
  };

  const fileUrl = pathToFileURL(shadowPath).href + '?t=' + Date.now();
  await import(fileUrl);

  const stage = dom.window.document.getElementById('stage');
  assert.ok(stage.innerHTML.includes('Cached Hello'));

  const statusEl = dom.window.document.getElementById('status');
  assert.equal(statusEl.title, 'Paneo display v1.2.3');

  assert.ok(wsInstance);
  assert.equal(wsInstance.url, 'ws://localhost/ws?role=display&token=test-token');
});

test('display.js: handles WebSocket messages and page switching', async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="stage"></div><div id="status"></div><div id="identify-overlay" class="hidden"></div><div id="update-status-banner"></div><div id="notify-stack"></div></body></html>');

  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle.bind(dom.window), configurable: true, writable: true });

  const storage = {};
  globalThis.localStorage = {
    getItem: (key) => storage[key] || null,
    setItem: (key, val) => { storage[key] = val; }
  };

  globalThis.location = {
    pathname: '/d/test-token2',
    host: 'localhost',
    protocol: 'http:'
  };

  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };

  globalThis.requestAnimationFrame = (cb) => { cb(); };

  globalThis.fetch = async (url) => {
    return { json: async () => ({}) };
  };

  let wsInstance = null;
  globalThis.WebSocket = class {
    constructor(url) {
      this.url = url;
      wsInstance = this;
    }
    close() {}
    send() {}
  };

  const fileUrl = pathToFileURL(shadowPath).href + '?t=' + Date.now() + '-2';
  await import(fileUrl);

  wsInstance.onopen();

  wsInstance.onmessage({
    data: JSON.stringify({
      type: 'layout.set',
      layout: {
        pages: [
          { id: 'page-0', widgets: [{ id: 'w1', type: 'paneo.text', config: { text: 'Page Zero Text' } }] },
          { id: 'page-1', widgets: [{ id: 'w2', type: 'paneo.text', config: { text: 'Page One Text' } }] }
        ],
        background: '#ffffff'
      },
      locale: 'ko-KR',
      timezone: 'Asia/Seoul',
      performanceProfile: 'high'
    })
  });

  const stage = dom.window.document.getElementById('stage');
  assert.ok(stage.innerHTML.includes('Page Zero Text'));
  assert.ok(!stage.innerHTML.includes('Page One Text'));

  const eventRight = new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight' });
  dom.window.document.dispatchEvent(eventRight);

  assert.ok(!stage.innerHTML.includes('Page Zero Text'));
  assert.ok(stage.innerHTML.includes('Page One Text'));

  const eventLeft = new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft' });
  dom.window.document.dispatchEvent(eventLeft);

  assert.ok(stage.innerHTML.includes('Page Zero Text'));
  assert.ok(!stage.innerHTML.includes('Page One Text'));

  const identifyOverlay = dom.window.document.getElementById('identify-overlay');
  assert.ok(identifyOverlay.classList.contains('hidden'));
  wsInstance.onmessage({
    data: JSON.stringify({
      type: 'command',
      action: 'identify',
      deviceName: 'Test Raspberry Pi Device'
    })
  });
  assert.ok(!identifyOverlay.classList.contains('hidden'));
  assert.equal(identifyOverlay.textContent, 'Test Raspberry Pi Device');

  const updateBanner = dom.window.document.getElementById('update-status-banner');
  wsInstance.onmessage({
    data: JSON.stringify({
      type: 'update.status',
      status: 'running',
      mode: 'all',
      progress: 75,
      step: 'install_fonts'
    })
  });
  assert.ok(updateBanner.classList.contains('visible'));
  assert.ok(updateBanner.textContent.includes('75%'));
  assert.ok(updateBanner.textContent.includes('폰트'));

  const notifyStack = dom.window.document.getElementById('notify-stack');
  wsInstance.onmessage({
    data: JSON.stringify({ type: 'notify', id: 'n1', message: 'First alert', duration: 5000 }),
  });
  wsInstance.onmessage({
    data: JSON.stringify({ type: 'notify', id: 'n2', message: 'Second alert', duration: 5000 }),
  });
  assert.equal(notifyStack.children.length, 2);
  assert.equal(notifyStack.children[0].querySelector('.notify-toast-message').textContent, 'First alert');
  assert.equal(notifyStack.children[1].querySelector('.notify-toast-message').textContent, 'Second alert');

  wsInstance.onmessage({
    data: JSON.stringify({
      type: 'notify',
      id: 'n3',
      message: 'With image',
      image: 'https://example.com/snap.jpg',
      duration: 5000,
    }),
  });
  const imgToast = notifyStack.children[2];
  assert.equal(imgToast.querySelector('.notify-toast-message').textContent, 'With image');
  assert.equal(imgToast.querySelector('.notify-toast-thumb').getAttribute('src'), 'https://example.com/snap.jpg');
});
