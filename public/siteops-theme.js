// Custom SiteOps accent color shared between the CRM and all operational pages.
(() => {
  'use strict';

  const DEFAULT = '#2465E8';
  const STORAGE_KEY = 'siteops-ui-accent-v1';
  const presets = [
    ['Studio', '#2465E8'],
    ['Petrol', '#0F766E'],
    ['Grün', '#15803D'],
    ['Orange', '#B45309'],
    ['Pink', '#BE185D'],
    ['Violett', '#6856DA'],
    ['Graphit', '#374151'],
    ['Blau', '#0369A1']
  ];
  const valid = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const normal = value => value.toUpperCase();

  function foreground(hex) {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lum = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const y = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    return (1.05 / (y + 0.05)) >= ((y + 0.05) / 0.05) ? '#FFFFFF' : '#111827';
  }
  function applyColor(accent) {
    if (!valid(accent)) return;
    const root = document.documentElement;
    root.style.setProperty('--siteops-accent', accent);
    root.style.setProperty('--siteops-on-accent', foreground(accent));
  }
  function getCached() {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      return valid(cached) ? normal(cached) : DEFAULT;
    } catch {
      return DEFAULT;
    }
  }
  function setCached(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Private browsing / restricted browser storage: server persistence still works.
    }
  }

  let saved = getCached();
  let chosen = saved;
  applyColor(saved);
  let editing = false;

  // Appearance controls live in the settings views; the saved color still applies globally.

  const dialog = document.createElement('dialog');
  dialog.className = 'siteops-theme-dialog';
  dialog.setAttribute('aria-label', 'SiteOps Design anpassen');
  const choices = presets.map(([label, hex]) =>
    '<button type="button" class="siteops-theme-preset" data-accent="' + hex +
    '" aria-label="' + label + ', ' + hex + '" aria-pressed="false">' +
    '<span class="siteops-theme-swatch" style="--swatch:' + hex + '" aria-hidden="true"></span>' +
    '<span>' + label + '</span></button>'
  ).join('');
  dialog.innerHTML =
    '<div class="siteops-theme-heading"><div><h2>Farben anpassen</h2>' +
    '<p>Wähle die Akzentfarbe für deinen gesamten SiteOps-Workspace.</p></div>' +
    '<button type="button" class="siteops-theme-close" data-close aria-label="Schließen">×</button></div>' +
    '<form id="siteopsThemeForm" class="siteops-theme-body">' +
    '<label class="siteops-theme-label">Farbvorschläge</label>' +
    '<div class="siteops-theme-presets" role="group" aria-label="Akzentfarben">' + choices + '</div>' +
    '<span class="siteops-theme-label">Eigene Farbe</span>' +
    '<div class="siteops-theme-color-fields">' +
    '<label class="siteops-theme-field">Farbwähler<input class="siteops-theme-picker" type="color" ' +
    'id="siteopsThemePicker" value="' + saved + '"></label>' +
    '<label class="siteops-theme-field">HEX-Code<input class="siteops-theme-hex" type="text" ' +
    'id="siteopsThemeHex" maxlength="7" spellcheck="false" autocomplete="off" ' +
    'aria-describedby="siteopsThemeError" value="' + saved + '"></label></div>' +
    '<div class="siteops-theme-preview"><span class="siteops-theme-label">Live-Vorschau</span>' +
    '<div class="siteops-theme-preview-card"><div class="siteops-theme-preview-title">' +
    '<span class="siteops-theme-preview-mark">S</span>Mein Projekt</div>' +
    '<p>So wirken aktive Elemente, Navigationspunkte und Buttons.</p>' +
    '<div class="siteops-theme-preview-tabs"><span class="siteops-theme-preview-tab">Kanban</span>' +
    '<span class="siteops-theme-preview-button">+ Task erstellen</span></div></div></div>' +
    '<p class="siteops-theme-error" id="siteopsThemeError" role="alert"></p>' +
    '<div class="siteops-theme-actions"><button type="button" class="siteops-theme-reset">Standard</button>' +
    '<div><button type="button" class="siteops-theme-cancel">Abbrechen</button> ' +
    '<button type="submit" class="siteops-theme-save">Speichern</button></div></div>' +
    '</form>';
  document.body.appendChild(dialog);
  const picker = dialog.querySelector('#siteopsThemePicker');
  const hexInput = dialog.querySelector('#siteopsThemeHex');
  const errorText = dialog.querySelector('#siteopsThemeError');
  const saveButton = dialog.querySelector('.siteops-theme-save');
  const presetButtons = [...dialog.querySelectorAll('[data-accent]')];

  function updateControls() {
    picker.value = chosen;
    hexInput.value = chosen;
    errorText.textContent = '';
    presetButtons.forEach(entry =>
      entry.setAttribute('aria-pressed', String(entry.dataset.accent === chosen))
    );
  }
  function preview(value) {
    if (!valid(value)) {
      errorText.textContent = 'Bitte einen vollständigen HEX-Wert eingeben, z. B. #0F766E.';
      return;
    }
    chosen = normal(value);
    applyColor(chosen);
    updateControls();
  }
  function openDialog() {
    editing = true;
    chosen = saved;
    applyColor(chosen);
    updateControls();
    dialog.showModal();
  }
  // CRM routes are client-rendered, so the trigger may be inserted after this script runs.
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-siteops-theme-open]');
    if (!trigger) return;
    event.preventDefault();
    openDialog();
  });
  dialog.querySelectorAll('[data-close],.siteops-theme-cancel').forEach(entry =>
    entry.addEventListener('click', () => dialog.close())
  );
  dialog.addEventListener('close', () => {
    editing = false;
    chosen = saved;
    applyColor(saved); // Leaving without saving restores the stored appearance.
  });
  presetButtons.forEach(entry =>
    entry.addEventListener('click', () => preview(entry.dataset.accent))
  );
  picker.addEventListener('input', () => preview(picker.value));
  hexInput.addEventListener('input', () => {
    const color = hexInput.value.trim();
    if (valid(color)) preview(color);
    else errorText.textContent = 'HEX-Farbe im Format #RRGGBB eingeben.';
  });
  dialog.querySelector('.siteops-theme-reset').addEventListener('click', () => preview(DEFAULT));
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!valid(hexInput.value)) {
      errorText.textContent = 'Ungültiger HEX-Wert. Beispiel: #0F766E.';
      hexInput.focus();
      return;
    }
    const accent = normal(hexInput.value);
    saveButton.disabled = true;
    saveButton.textContent = 'Speichern …';
    try {
      const response = await fetch('/api/ui-theme', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accent })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || data.message || 'HTTP ' + response.status);
      if (!valid(data.accent)) throw Error('Ungültige Serverantwort.');
      saved = normal(data.accent);
      chosen = saved;
      setCached(saved);
      applyColor(saved);
      dialog.close();
    } catch (error) {
      errorText.textContent = 'Farbe konnte nicht gespeichert werden: ' + error.message;
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Speichern';
    }
  });

  // The server value is authoritative across devices; localStorage is just an instant cache.
  fetch('/api/ui-theme', { credentials: 'same-origin' })
    .then(async response => {
      if (!response.ok) throw Error('HTTP ' + response.status);
      return response.json();
    })
    .then(data => {
      if (!valid(data.accent)) return;
      saved = normal(data.accent);
      setCached(saved);
      if (!editing) {
        chosen = saved;
        applyColor(saved);
      }
    })
    .catch(() => { /* Keep cached color if the server temporarily cannot be reached. */ });

  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY || !valid(event.newValue) || editing) return;
    saved = normal(event.newValue);
    chosen = saved;
    applyColor(saved);
  });
})();
