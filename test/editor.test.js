import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

// Create a shadowed version of editor.js with absolute browser paths mapped to relative paths
const editorJsPath = path.resolve('public/editor/editor.js');
let editorJsContent = fs.readFileSync(editorJsPath, 'utf8');
editorJsContent = editorJsContent
  .replaceAll("'/shared/", "'../public/shared/")
  .replaceAll('"/shared/', '"../public/shared/')
  .replaceAll("'/editor/", "'../public/editor/")
  .replaceAll('"/editor/', '"../public/editor/');

const shadowPath = path.resolve('test/editor.test.shadow.js');
fs.writeFileSync(shadowPath, editorJsContent, 'utf8');

test.after(() => {
  try {
    fs.unlinkSync(shadowPath);
  } catch {}
});

function getHtmlContent() {
  const htmlPath = path.resolve('public/editor/index.html');
  return fs.readFileSync(htmlPath, 'utf8');
}

test('editor.js: setup password gate when unconfigured', async (t) => {
  const dom = new JSDOM(getHtmlContent());

  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle.bind(dom.window), configurable: true, writable: true });

  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {}
  };

  globalThis.location = {
    pathname: '/editor/',
    host: 'localhost',
    protocol: 'http:'
  };

  let setupCalled = false;
  let setupBody = null;
  globalThis.fetch = async (url, opts = {}) => {
    if (url === '/api/auth/status') {
      return {
        ok: true,
        json: async () => ({ configured: false, authenticated: false })
      };
    }
    if (url === '/api/auth/setup' && opts.method === 'POST') {
      setupCalled = true;
      setupBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error('unexpected fetch: ' + url);
  };

  const fileUrl = pathToFileURL(path.resolve('public/editor/auth-gate.js')).href + '?t=' + Date.now();
  const { ensureAuthenticated } = await import(fileUrl);

  const authPromise = ensureAuthenticated();

  // Allow nextTick for status check promise chain
  await new Promise((resolve) => setTimeout(resolve, 10));

  const overlay = dom.window.document.getElementById('auth-overlay');
  assert.ok(!overlay.classList.contains('hidden'), 'setup overlay should be visible');

  const title = dom.window.document.getElementById('auth-title');
  assert.ok(title.textContent.includes('비밀번호') || title.textContent.includes('password'));

  const confirmField = dom.window.document.getElementById('auth-confirm-field');
  assert.equal(confirmField.hidden, false, 'confirm password field should be visible');

  // Fill in form and submit
  dom.window.document.getElementById('auth-password').value = 'new-secure-password';
  dom.window.document.getElementById('auth-password-confirm').value = 'new-secure-password';

  const form = dom.window.document.getElementById('auth-form');
  form.dispatchEvent(new dom.window.Event('submit'));

  await authPromise;

  assert.ok(setupCalled, 'setup api endpoint should be called');
  assert.equal(setupBody.password, 'new-secure-password');
  assert.ok(overlay.classList.contains('hidden'), 'setup overlay should be hidden after success');
});

test('editor.js: login password gate when configured but unauthenticated', async (t) => {
  const dom = new JSDOM(getHtmlContent());

  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle.bind(dom.window), configurable: true, writable: true });

  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {}
  };

  globalThis.location = {
    pathname: '/editor/',
    host: 'localhost',
    protocol: 'http:'
  };

  let loginCalled = false;
  let loginBody = null;
  globalThis.fetch = async (url, opts = {}) => {
    if (url === '/api/auth/status') {
      return {
        ok: true,
        json: async () => ({ configured: true, authenticated: false })
      };
    }
    if (url === '/api/auth/login' && opts.method === 'POST') {
      loginCalled = true;
      loginBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error('unexpected fetch: ' + url);
  };

  const fileUrl = pathToFileURL(path.resolve('public/editor/auth-gate.js')).href + '?t=' + (Date.now() + 1);
  const { ensureAuthenticated } = await import(fileUrl);

  const authPromise = ensureAuthenticated();

  // Allow nextTick
  await new Promise((resolve) => setTimeout(resolve, 10));

  const overlay = dom.window.document.getElementById('auth-overlay');
  assert.ok(!overlay.classList.contains('hidden'), 'login overlay should be visible');

  const title = dom.window.document.getElementById('auth-title');
  assert.ok(title.textContent.includes('로그인') || title.textContent.includes('Log in'));

  const confirmField = dom.window.document.getElementById('auth-confirm-field');
  assert.equal(confirmField.hidden, true, 'confirm password field should be hidden');

  // Fill in password and submit
  dom.window.document.getElementById('auth-password').value = 'correct-password';

  const form = dom.window.document.getElementById('auth-form');
  form.dispatchEvent(new dom.window.Event('submit'));

  await authPromise;

  assert.ok(loginCalled, 'login api endpoint should be called');
  assert.equal(loginBody.password, 'correct-password');
  assert.ok(overlay.classList.contains('hidden'), 'login overlay should be hidden after success');
});

test('editor.js: initializes editor and handles logout when authenticated', async (t) => {
  const dom = new JSDOM(getHtmlContent());

  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle.bind(dom.window), configurable: true, writable: true });

  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {}
  };

  let reloadCalled = false;
  globalThis.location = {
    hash: '',
    pathname: '/editor/',
    host: 'localhost',
    protocol: 'http:',
    reload: () => { reloadCalled = true; }
  };

  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };

  let logoutCalled = false;
  globalThis.fetch = async (url, opts = {}) => {
    if (url === '/api/auth/status') {
      return { ok: true, json: async () => ({ configured: true, authenticated: true }) };
    }
    if (url === '/api/brand') {
      return { ok: true, json: async () => ({ name: 'Paneo' }) };
    }
    if (url === '/api/version') {
      return { ok: true, json: async () => ({ components: { server: { version: '1.0.0' }, display: '1.0.0' } }) };
    }
    if (url === '/api/plugins') {
      return { ok: true, json: async () => ([]) };
    }
    if (url === '/api/devices') {
      return { ok: true, json: async () => ([{ id: 'dev1', name: 'Kiosk Pi' }]) };
    }
    if (url === '/api/devices/dev1') {
      return {
        ok: true,
        json: async () => ({
          id: 'dev1',
          name: 'Kiosk Pi',
          locale: 'ko-KR',
          resolutionW: 1920,
          resolutionH: 1080,
          performanceProfile: 'high',
          draft: { pages: [{ id: 'page-0', widgets: [] }] }
        })
      };
    }
    if (url === '/api/settings/ha') {
      return { ok: true, json: async () => ({ url: '', token: '' }) };
    }
    if (url === '/api/groups') {
      return { ok: true, json: async () => ([]) };
    }
    if (url === '/api/devices/dev1/update-status') {
      return { ok: true, json: async () => ({ status: 'idle' }) };
    }
    if (url === '/api/auth/logout' && opts.method === 'POST') {
      logoutCalled = true;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error('unexpected fetch: ' + url);
  };

  const fileUrl = pathToFileURL(shadowPath).href + '?t=' + (Date.now() + 2);
  await import(fileUrl);

  const overlay = dom.window.document.getElementById('auth-overlay');
  assert.ok(overlay.classList.contains('hidden'), 'authenticated overlay should be hidden');

  const logoutBtn = dom.window.document.getElementById('logout-btn');
  logoutBtn.dispatchEvent(new dom.window.MouseEvent('click'));

  // Allow nextTick for promise chain to execute
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.ok(logoutCalled, 'logout API endpoint should be called');
  assert.ok(reloadCalled, 'page should be reloaded after logout');
});
