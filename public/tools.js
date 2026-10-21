(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const list = $('#tools-list');
  if (!list) return;
  const form = $('#tools-edit-form');
  const dialog = $('#tools-dialog');
  let links = [], projects = [], editing = null;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: options.body ? { 'content-type': 'application/json' } : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || data.message || 'HTTP ' + response.status);
    return data;
  }
  function el(tag, attrs = {}, text = null) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'className') element.className = value;
      else element.setAttribute(key, String(value));
    }
    if (text !== null) element.textContent = text;
    return element;
  }
  function announce(message, isError = false) {
    const note = el('p', { className: isError ? 'tools-notice error' : 'tools-notice' }, message);
    const parent = $('.tools-filters');
    parent.parentNode.insertBefore(note, parent);
    setTimeout(() => note.remove(), 5000);
  }
  function selectOptions() {
    const category = $('#tools-category'), value = category.value;
    category.replaceChildren(new Option('Alle Kategorien', ''));
    for (const name of [...new Set(links.map(x => x.category))].sort((a, b) => a.localeCompare(b, 'de')))
      category.add(new Option(name, name));
    category.value = value;
  }
  function card(item) {
    const outer = el('article', { className: 'tools-card' });
    const title = el('h3', {}, item.title);
    const badge = el('span', { className: 'tools-origin' }, item.origin === 'external' ? 'Extern' : 'Eigenes Tool');
    const head = el('div', { className: 'tools-card-head' });
    head.append(badge, el('span', { className: 'tools-star' }, item.favorite ? '★ Favorit' : item.category));
    outer.append(head, title);
    if (item.description) outer.append(el('p', { className: 'tools-desc' }, item.description));
    const address = el('small', { className: 'tools-url' }, item.url);
    outer.append(address);
    if (item.project_name) outer.append(el('span', { className: 'tools-project-pill' }, 'Projekt: ' + item.project_name));
    const actions = el('div', { className: 'tools-card-actions' });
    const open = el('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', className: 'tools-open' }, 'Öffnen ↗');
    const edit = el('button', { type: 'button', className: 'ghost' }, 'Bearbeiten');
    edit.addEventListener('click', () => editTool(item));
    const remove = el('button', { type: 'button', className: 'tools-remove' }, 'Löschen');
    remove.addEventListener('click', async () => {
      if (!confirm('Tool „' + item.title + '“ wirklich aus der Sammlung löschen?')) return;
      try { await api('/api/tools/' + encodeURIComponent(item.id), { method: 'DELETE' }); await refresh(); announce('Tool gelöscht.'); }
      catch (error) { announce(error.message, true); }
    });
    actions.append(open, edit, remove);
    outer.append(actions);
    return outer;
  }
  function render() {
    const query = $('#tools-search').value.trim().toLocaleLowerCase('de');
    const origin = $('#tools-origin').value;
    const category = $('#tools-category').value;
    const filtered = links.filter(item =>
      (!query || [item.title, item.url, item.category, item.description, item.project_name || '']
        .some(value => String(value).toLocaleLowerCase('de').includes(query))) &&
      (!origin || item.origin === origin) &&
      (!category || item.category === category));
    list.replaceChildren();
    if (!filtered.length) {
      list.append(el('div', { className: 'tools-empty' },
        links.length ? 'Keine passenden Tools gefunden.' : 'Noch keine Links gespeichert. Füge dein erstes Tool hinzu.'));
      return;
    }
    filtered.forEach(item => list.append(card(item)));
  }
  async function refresh() {
    [links, projects] = await Promise.all([api('/api/tools'), api('/api/tools/projects')]);
    selectOptions();
    render();
  }
  function editTool(item = null) {
    editing = item?.id || null;
    form.reset();
    $('#tools-dialog-title').textContent = item ? 'Tool bearbeiten' : 'Tool hinzufügen';
    const project = $('#tools-project');
    project.replaceChildren(new Option('Kein Projekt', ''));
    for (const p of projects) project.add(new Option(p.customer_name + ' / ' + p.name, p.id));
    if (item) {
      for (const key of ['title', 'url', 'description', 'category', 'origin'])
        form.elements.namedItem(key).value = item[key] ?? '';
      project.value = item.project_id || '';
      form.elements.namedItem('favorite').checked = Boolean(item.favorite);
    }
    dialog.showModal();
  }
  $('#tools-new').addEventListener('click', () => editTool());
  $('#tools-close').addEventListener('click', () => dialog.close());
  for (const name of ['tools-search', 'tools-origin', 'tools-category'])
    $('#' + name).addEventListener(name === 'tools-search' ? 'input' : 'change', render);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = new FormData(form), save = $('#tools-save');
    const data = {
      title: String(values.get('title') || ''),
      url: String(values.get('url') || ''),
      description: String(values.get('description') || ''),
      category: String(values.get('category') || 'Allgemein'),
      origin: String(values.get('origin') || 'own'),
      project_id: values.get('project_id') ? String(values.get('project_id')) : null,
      favorite: values.has('favorite')
    };
    save.disabled = true;
    try {
      await api(editing ? '/api/tools/' + encodeURIComponent(editing) : '/api/tools', {
        method: editing ? 'PUT' : 'POST', body: JSON.stringify(data)
      });
      dialog.close();
      await refresh();
      announce(editing ? 'Tool aktualisiert.' : 'Tool hinzugefügt.');
    } catch (error) { announce(error.message, true); }
    finally { save.disabled = false; }
  });

  const checkForm = $('#tools-check-form');
  const checkOutput = $('#tools-check-output');
  checkForm.addEventListener('submit', async event => {
    event.preventDefault();
    const btn = $('#tools-check-submit');
    btn.disabled = true;
    btn.textContent = 'Prüfung läuft …';
    checkOutput.hidden = true;
    try {
      const data = await api('/api/tools/phpcheck', {
        method: 'POST', body: JSON.stringify({ url: $('#tools-check-url').value.trim() })
      });
      const result = data.result;
      checkOutput.className = 'tools-check-output ' + result.status;
      checkOutput.replaceChildren(
        el('strong', {}, result.title),
        el('p', {}, result.description),
        el('div', { className: 'tools-check-facts' },
          'Domain: ' + data.domain + ' · PHP: ' + (data.php_version || 'nicht sichtbar') +
          ' · HTTP: ' + data.http_status + (data.version_source ? ' · Header: ' + data.version_source : ''))
      );
      checkOutput.hidden = false;
    } catch (error) {
      checkOutput.className = 'tools-check-output unknown';
      checkOutput.replaceChildren(el('strong', {}, 'Prüfung nicht möglich'), el('p', {}, error.message));
      checkOutput.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'PHP-Version prüfen';
    }
  });
  refresh().catch(error => {
    list.replaceChildren(el('p', { className: 'tools-notice error' }, 'Tools konnten nicht geladen werden: ' + error.message));
  });
  if (location.pathname === '/tools/phpcheck') $('#tools-check-url').focus();
})();
