// §12 보안: blocks the rest of editor.js (via top-level await) until the
// admin session cookie is valid. Kept separate from editor.js/api() below
// because this runs *before* any device/layout state exists — it only needs
// the DOM shell (#auth-overlay, index.html) and i18n.
import { t } from './i18n.js';

async function post(path, body) {
  return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

export async function ensureAuthenticated() {
  const status = await (await fetch('/api/auth/status')).json();
  if (status.authenticated) return;

  const overlay = document.getElementById('auth-overlay');
  const title = document.getElementById('auth-title');
  const hint = document.getElementById('auth-hint');
  const form = document.getElementById('auth-form');
  const pwInput = document.getElementById('auth-password');
  const confirmField = document.getElementById('auth-confirm-field');
  const confirmInput = document.getElementById('auth-password-confirm');
  const errorEl = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit');

  const isSetup = !status.configured;
  title.textContent = t(isSetup ? 'authSetupTitle' : 'authLoginTitle');
  hint.textContent = t(isSetup ? 'authSetupHint' : 'authLoginHint');
  pwInput.placeholder = t('authPasswordPlaceholder');
  confirmInput.placeholder = t('authPasswordConfirmPlaceholder');
  submitBtn.textContent = t('authSubmitBtn');
  confirmField.hidden = !isSetup;
  overlay.classList.remove('hidden');
  pwInput.focus();

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.classList.add('hidden');
      const password = pwInput.value;
      if (isSetup && password.length < 8) {
        errorEl.textContent = t('authErrorTooShort');
        errorEl.classList.remove('hidden');
        return;
      }
      if (isSetup && password !== confirmInput.value) {
        errorEl.textContent = t('authErrorMismatch');
        errorEl.classList.remove('hidden');
        return;
      }
      submitBtn.disabled = true;
      try {
        const res = await post(isSetup ? '/api/auth/setup' : '/api/auth/login', { password });
        if (!res.ok) {
          errorEl.textContent = res.status === 429 ? t('authErrorRateLimited') : (isSetup ? t('authErrorGeneric') : t('authErrorInvalid'));
          errorEl.classList.remove('hidden');
          submitBtn.disabled = false;
          return;
        }
        overlay.classList.add('hidden');
        resolve();
      } catch {
        errorEl.textContent = t('authErrorGeneric');
        errorEl.classList.remove('hidden');
        submitBtn.disabled = false;
      }
    });
  });
}
