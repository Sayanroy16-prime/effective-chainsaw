/**
 * Terminal access gate.
 *
 * Client-side only, as before: this guards the operator console UI, not the
 * API. Credentials are demo values shown on the card itself.
 *
 * Deliberately contains no canvas, shader, video or audio. The previous
 * build ran an animated per-pixel WebGL noise field behind this card and
 * launched a fullscreen stock video on success; both are gone.
 */

(function () {
  'use strict';

  var VALID_ID = 'Envision';
  var VALID_PASS = '1234';
  var AUTH_KEY = 'tn_pds_auth';

  var screen = document.getElementById('login-screen');
  var app = document.getElementById('app');
  var form = document.getElementById('login-form');
  var inputId = document.getElementById('login-id');
  var inputPass = document.getElementById('login-pass');
  var errorBox = document.getElementById('login-error');
  var errorText = document.getElementById('login-error-text');
  var btn = document.getElementById('login-btn');
  var btnText = document.getElementById('login-btn-text');
  var btnLogout = document.getElementById('btn-logout');

  /** Reveal the dashboard. `instant` skips the transition on session restore. */
  function openTerminal(instant) {
    if (instant) {
      screen.hidden = true;
      app.hidden = false;
      document.dispatchEvent(new CustomEvent('terminal:open'));
      return;
    }

    screen.classList.add('leaving');
    window.setTimeout(function () {
      screen.hidden = true;
      screen.classList.remove('leaving');
      app.hidden = false;
      document.dispatchEvent(new CustomEvent('terminal:open'));
    }, 250);
  }

  function showError(message) {
    errorText.textContent = message;
    errorBox.hidden = false;
    inputId.setAttribute('aria-invalid', 'true');
    inputPass.setAttribute('aria-invalid', 'true');
    // Move focus to the summary so a screen reader announces it, then let
    // the operator correct the field directly.
    errorBox.setAttribute('tabindex', '-1');
    errorBox.focus();
  }

  function clearError() {
    errorBox.hidden = true;
    inputId.removeAttribute('aria-invalid');
    inputPass.removeAttribute('aria-invalid');
  }

  function submit(event) {
    event.preventDefault();

    var id = inputId.value.trim();
    var pass = inputPass.value.trim();

    if (!id || !pass) {
      showError('Enter both the administrator ID and the security PIN.');
      return;
    }

    if (id !== VALID_ID || pass !== VALID_PASS) {
      showError('Invalid administrator ID or security PIN.');
      inputPass.value = '';
      return;
    }

    clearError();

    btn.disabled = true;
    btnText.textContent = 'Authorising…';

    window.setTimeout(function () {
      try {
        sessionStorage.setItem(AUTH_KEY, 'true');
      } catch (err) {
        /* Private mode or blocked storage: the session simply won't persist. */
      }

      btnText.textContent = 'Authorised';
      openTerminal(false);

      // Reset for the next lock/unlock cycle.
      window.setTimeout(function () {
        btn.disabled = false;
        btnText.textContent = 'Authorize & Open Terminal';
      }, 400);
    }, 250);
  }

  function lock() {
    try {
      sessionStorage.removeItem(AUTH_KEY);
    } catch (err) {
      /* ignore */
    }
    app.hidden = true;
    screen.hidden = false;
    inputPass.value = '';
    clearError();
    inputId.focus();
  }

  form.addEventListener('submit', submit);
  [inputId, inputPass].forEach(function (el) {
    el.addEventListener('input', clearError);
  });
  if (btnLogout) btnLogout.addEventListener('click', lock);

  var restored = false;
  try {
    restored = sessionStorage.getItem(AUTH_KEY) === 'true';
  } catch (err) {
    restored = false;
  }

  if (restored) {
    openTerminal(true);
  } else {
    inputId.focus();
  }
})();
