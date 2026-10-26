// Global quick switcher (Ctrl/Cmd+K) across all SiteOps pages.
(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const typeLabel = { customer: 'Kunde', project: 'Projekt', task: 'Task', site: 'Website', invoice: 'Rechnung' };
  const typeIcon = { customer: '◎', project: '▤', task: '☑', site: '◈', invoice: '▧' };

  const header = document.querySelector('.siteops-topbar') || document.querySelector('.crm-topbar') || document.querySelector('.ops-workspace-bar');
  if (!header) return;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'workspace-search-trigger';
  trigger.innerHTML = '<span class="workspace-search-icon" aria-hidden="true">⌕</span><span>Alles durchsuchen</span><kbd>Ctrl K</kbd>';
  trigger.setAttribute('aria-label', 'Globale Suche öffnen (Strg+K)');
  // Keep search inside the right-hand topbar actions on both mobile and desktop.
  const actions = header.querySelector('.crm-top-actions, .ops-top-actions');
  if (actions) actions.prepend(trigger);
  else header.appendChild(trigger);

  const dialog = document.createElement('dialog');
  dialog.className = 'workspace-search-dialog';
  dialog.setAttribute('aria-label', 'SiteOps Suche');
  dialog.innerHTML = '<div class="workspace-search-field"><span aria-hidden="true">⌕</span>' +
    '<input type="search" id="workspaceSearchInput" placeholder="Kunden, Projekte, Tasks, Websites, Rechnungen …"' +
    ' autocomplete="off" aria-label="Alle Bereiche durchsuchen" aria-controls="workspaceSearchResults">' +
    '<button type="button" class="workspace-search-close" aria-label="Schließen">ESC</button></div>' +
    '<div id="workspaceSearchResults" class="workspace-search-results" role="listbox" aria-label="Suchergebnisse">' +
    '<p class="workspace-search-empty">Gib mindestens zwei Zeichen ein, um SiteOps zu durchsuchen.</p></div>' +
    '<div class="workspace-search-footer">↑↓ Auswählen <span>↵ Öffnen</span><span>ESC Schließen</span></div>';
  document.body.appendChild(dialog);

  const input = dialog.querySelector('#workspaceSearchInput');
  const results = dialog.querySelector('#workspaceSearchResults');
  const close = () => dialog.close();
  dialog.querySelector('.workspace-search-close').addEventListener('click', close);
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  let hits = [];
  let selected = 0;
  let generation = 0;
  let debounce;

  function choose(index) {
    const url = hits[index]?.url;
    if (!url || !url.startsWith('/')) return;
    close();
    window.location.assign(url);
  }
  function updateActive() {
    results.querySelectorAll('[data-index]').forEach(button => {
      const active = Number(button.dataset.index) === selected;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-selected', String(active));
    });
  }
  function draw() {
    if (!hits.length) {
      results.innerHTML = '<p class="workspace-search-empty">Keine passenden Einträge gefunden.</p>';
      return;
    }
    results.innerHTML = hits.map((row, index) =>
      '<a role="option" aria-selected="false" id="workspaceHit' + index + '" data-index="' + index +
      '" class="workspace-search-hit" href="' + esc(row.url) + '">' +
      '<span class="workspace-search-hit-icon" aria-hidden="true">' + (typeIcon[row.type] || '•') + '</span>' +
      '<span class="workspace-search-hit-content"><strong>' + esc(row.title) + '</strong>' +
      '<small>' + esc(row.subtitle) + '</small></span>' +
      '<span class="workspace-search-hit-type">' + esc(typeLabel[row.type] || row.type) + '</span></a>'
    ).join('');
    updateActive();
  }
  function reset() {
    clearTimeout(debounce);
    generation++;
    hits = [];
    selected = 0;
    results.innerHTML = '<p class="workspace-search-empty">Gib mindestens zwei Zeichen ein, um SiteOps zu durchsuchen.</p>';
  }
  async function search(term) {
    const run = ++generation;
    results.innerHTML = '<p class="workspace-search-empty">Suche läuft …</p>';
    try {
      const response = await fetch('/api/workspace/search?q=' + encodeURIComponent(term), { credentials: 'same-origin' });
      if (!response.ok) throw Error('HTTP ' + response.status);
      const result = await response.json();
      if (run !== generation || !dialog.open) return;
      hits = Array.isArray(result.results) ? result.results : [];
      selected = 0;
      draw();
    } catch (error) {
      if (run !== generation) return;
      results.innerHTML = '<p class="workspace-search-empty is-error">Suche derzeit nicht verfügbar: ' + esc(error.message) + '</p>';
    }
  }
  function open() {
    if (dialog.open) return;
    input.value = '';
    reset();
    dialog.showModal();
    input.focus();
  }

  trigger.addEventListener('click', open);
  dialog.addEventListener('close', reset);
  input.addEventListener('input', () => {
    const value = input.value.trim();
    reset();
    if (value.length < 2) return;
    debounce = setTimeout(() => search(value), 160);
  });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return;
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      updateActive();
      results.querySelector('[data-index="' + selected + '"]')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && hits.length) {
      e.preventDefault();
      choose(selected);
    }
  });
  results.addEventListener('click', e => {
    const link = e.target.closest('[data-index]');
    if (link && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      choose(Number(link.dataset.index));
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dialog.open) close();
      else open();
    }
  });
})();
