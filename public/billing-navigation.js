// Organizes the existing billing controls into focused, directly addressable pages.
(() => {
  'use strict';
  const root = document.getElementById('billingRoot');
  if (!root) return;
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const pages = [
    { key: 'overview', label: 'Übersicht', title: 'Dein Überblick', intro: 'Projekte, Aufgaben, Zeiten und offene Vorgänge auf einen Blick.', icon: '◫', href: '/billing' },
    { key: 'customers', label: 'Kunden & Projekte', title: 'Kunden & Projekte', intro: 'Stammdaten pflegen, Websites zuordnen und Kundenprojekte verwalten.', icon: '▤', href: '/billing/customers' },
    { key: 'board', label: 'Kanban-Board', title: 'Kanban-Board', intro: 'Tasks im ausgewählten Projekt planen und bearbeiten.', icon: '▦', href: '/billing/board' },
    { key: 'time', label: 'Zeiterfassung', title: 'Zeiterfassung', intro: 'Arbeitszeiten erfassen, Timer steuern und Buchungen prüfen.', icon: '◷', href: '/billing/time' },
    { key: 'invoices', label: 'Rechnungen', title: 'Rechnungen', intro: 'Offene Zeiten abrechnen, Rechnungen verwalten und exportieren.', icon: '▧', href: '/billing/invoices' },
    { key: 'settings', label: 'Einstellungen', title: 'Rechnungseinstellungen', intro: 'Absender, Bankverbindung und Hinweise zum Rechnungsarchiv.', icon: '⚙', href: '/billing/settings' }
  ];
  const existing = {
    header: root.querySelector(':scope > header'),
    context: root.querySelector(':scope > section'),
    management: root.querySelector(':scope > .twocol.ops-grid'),
    board: el('kanbanSection'),
    boardDialog: el('kanbanDialog'),
    time: el('timeForm')?.closest('section'),
    invoices: el('billingInvoices')?.closest('section'),
    settings: el('billingSettingsForm')?.closest('section'),
    archive: root.querySelector(':scope > section:last-child')
  };
  if (Object.values(existing).some(value => !value)) return;

  const sidebar = pages.map(page =>
    '<a class="billing-nav-link" data-billing-link href="' + page.href + '">' +
    '<span class="billing-nav-icon" aria-hidden="true">' + page.icon + '</span><span>' + esc(page.label) + '</span></a>'
  ).join('');
  const shortcuts = pages.filter(page => page.key !== 'overview' && page.key !== 'settings').map(page =>
    '<a class="billing-shortcut" href="' + page.href + '" data-billing-link><strong>' + esc(page.label) +
    ' <span aria-hidden="true">↗</span></strong><span>' + esc(page.intro) + '</span></a>'
  ).join('');
  root.insertAdjacentHTML('afterbegin', [
    '<div class="billing-layout">',
    '<aside class="billing-sidebar"><div class="billing-sidebar-heading"><span class="eyebrow">SiteOps</span><strong>Kunden & Abrechnung</strong></div>',
    '<nav aria-label="Kundenverwaltung" class="billing-side-nav">' + sidebar + '</nav>',
    '<p class="billing-sidebar-note">Kunde → Projekt → Task. Deine Auswahl gilt für alle Bereiche.</p></aside>',
    '<div class="billing-workspace-content">',
    '<header class="billing-content-heading"><div><span class="eyebrow">Kundenverwaltung</span>',
    '<h1 id="billingPageTitle"></h1><p class="lead" id="billingPageDescription"></p></div>',
    '<p id="billingStatusSlot" role="status"></p></header>',
    '<div id="billingContextSlot"></div>',
    '<div class="billing-page" data-billing-page="overview" hidden>',
    '<section class="billing-overview-hero"><div><span class="eyebrow">Übersicht</span><h2>Was steht an?</h2>',
    '<p>Deine wichtigsten Zahlen beziehen sich auf den ausgewählten Kunden. Fälligkeiten zeigen alle Kunden.</p></div>',
    '<a class="btn" href="/billing/board" data-billing-link>Zum Kanban-Board →</a></section>',
    '<div id="billingOverviewMetrics" class="billing-overview-metrics"></div>',
    '<div class="billing-overview-counts" id="billingOverviewCounts"></div>',
    '<section class="billing-overview-due"><div class="billing-panel-heading"><div><h2>Fällige Aufgaben</h2>',
    '<p>Überfällige und bald fällige Tasks aus allen Kundenprojekten.</p></div>',
    '<button type="button" class="ghost" id="billingDueReload">Aktualisieren</button></div>',
    '<div id="billingDueList" class="kb-workflow-list"></div></section>',
    '<section><h2>Direkt zu …</h2><div class="billing-shortcuts">' + shortcuts + '</div></section></div>',
    '<div class="billing-page" data-billing-page="customers" hidden>',
    '<section><div class="billing-panel-heading"><div><h2>Kunden & Projekte im Überblick</h2>',
    '<p>Eintrag auswählen, um ihn im ganzen Arbeitsbereich zu öffnen.</p></div></div>',
    '<div class="billing-directory-columns"><div><h3>Kunden</h3><div id="billingCustomerDirectory" class="billing-directory"></div></div>',
    '<div><h3>Projekte des ausgewählten Kunden</h3><div id="billingProjectDirectory" class="billing-directory"></div></div></div></section>',
    '<div id="billingEditActions"></div><div id="billingManagementSlot"></div></div>',
    '<div class="billing-page" data-billing-page="board" hidden><div id="billingBoardSlot"></div></div>',
    '<div class="billing-page" data-billing-page="time" hidden><div id="billingTimeSlot"></div></div>',
    '<div class="billing-page" data-billing-page="invoices" hidden><div id="billingInvoiceSlot"></div></div>',
    '<div class="billing-page" data-billing-page="settings" hidden><div id="billingSettingsSlot"></div></div>',
    '<div id="billingModalHost"></div></div></div>'
  ].join(''));

  const message = el('billingMessage');
  if (message) el('billingStatusSlot').appendChild(message);
  existing.header.remove();
  const metrics = existing.context.querySelector('.metrics');
  if (metrics) el('billingOverviewMetrics').appendChild(metrics);
  const editActions = existing.context.querySelector('.buttonrow');
  if (editActions) el('billingEditActions').appendChild(editActions);
  el('billingContextSlot').appendChild(existing.context);
  el('billingManagementSlot').appendChild(existing.management);
  el('billingBoardSlot').append(existing.board, existing.boardDialog);
  el('billingTimeSlot').appendChild(existing.time);
  el('billingInvoiceSlot').appendChild(existing.invoices);
  el('billingSettingsSlot').append(existing.settings, existing.archive);

  let active = '';
  const byPath = path => pages.find(page => page.href === path.replace(/\/$/, '') || (page.href === '/billing' && path === '/billing/')) || pages[0];
  function showPage(path) {
    const page = byPath(path);
    if (active !== page.key) {
      active = page.key;
      root.querySelectorAll('[data-billing-page]').forEach(node => {
        node.hidden = node.dataset.billingPage !== active;
      });
    }
    el('billingPageTitle').textContent = page.title;
    el('billingPageDescription').textContent = page.intro;
    root.querySelectorAll('[data-billing-link]').forEach(link => {
      const isCurrent = link.getAttribute('href') === page.href;
      if (link.classList.contains('billing-nav-link')) {
        link.classList.toggle('active', isCurrent);
        if (isCurrent) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    });
    document.title = page.title + ' · SiteOps';
  }
  function navigate(href) {
    if (window.location.pathname !== href) window.history.pushState({ billingPage: href }, '', href);
    showPage(href);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  root.addEventListener('click', event => {
    const link = event.target.closest('a[data-billing-link]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(link.getAttribute('href'));
  });
  window.addEventListener('popstate', () => showPage(window.location.pathname));
  showPage(window.location.pathname);

  function renderDirectories() {
    const state = window.SiteOpsBillingState?.();
    if (!state) return;
    const customers = state.customers || [];
    const projects = state.projects || [];
    const tasks = state.tasks || [];
    const selectedCustomer = el('billingCustomer').value;
    const currentProjects = projects.filter(project => project.customer_id === selectedCustomer);
    el('billingCustomerDirectory').innerHTML = customers.length
      ? customers.map(customer =>
        '<button type="button" class="billing-directory-item' + (customer.id === selectedCustomer ? ' chosen' : '') +
        '" data-customer-open="' + esc(customer.id) + '"><strong>' + esc(customer.name) +
        '</strong><span>' + Number(projects.filter(p => p.customer_id === customer.id).length) + ' Projekte</span></button>'
      ).join('')
      : '<p class="billing-empty-state">Noch keine Kunden vorhanden. Unten kannst du den ersten anlegen.</p>';
    el('billingProjectDirectory').innerHTML = currentProjects.length
      ? currentProjects.map(project =>
        '<button type="button" class="billing-directory-item' + (project.id === el('billingProject').value ? ' chosen' : '') +
        '" data-project-open="' + esc(project.id) + '"><strong>' + esc(project.name) +
        '</strong><span>' + Number(tasks.filter(t => t.project_id === project.id).length) +
        ' Tasks · ' + esc(project.status || 'active') +
        (project.site_domain ? ' · ' + esc(project.site_domain) : '') + '</span></button>'
      ).join('')
      : '<p class="billing-empty-state">Noch keine Projekte für diesen Kunden vorhanden.</p>';
    const entries = state.entries || [];
    const invoices = state.invoices || [];
    const openTasks = tasks.filter(t => t.status !== 'done').length;
    const activeTimer = entries.find(entry => entry.started_at);
    const counters = [
      [customers.length, 'Kunden', '/billing/customers'],
      [projects.length, 'Projekte', '/billing/customers'],
      [openTasks, 'Offene Tasks', '/billing/board'],
      [invoices.filter(i => i.status === 'issued').length, 'Unbezahlte Rechnungen', '/billing/invoices']
    ];
    el('billingOverviewCounts').innerHTML = counters.map(([value,label,href]) =>
      '<a class="billing-count-card" href="' + href + '" data-billing-link><strong>' +
      value + '</strong><span>' + label + '</span></a>'
    ).join('');
    const hero = root.querySelector('.billing-overview-hero p');
    if (hero) hero.textContent = activeTimer
      ? 'Ein Timer läuft gerade für „' + activeTimer.task_name + '“. Du kannst ihn unter Zeiterfassung stoppen.'
      : 'Deine wichtigsten Zahlen beziehen sich auf den ausgewählten Kunden. Fälligkeiten zeigen alle Kunden.';
  }
  root.addEventListener('click', event => {
    const customer = event.target.closest('[data-customer-open]');
    const project = event.target.closest('[data-project-open]');
    if (customer) {
      el('billingCustomer').value = customer.dataset.customerOpen;
      el('billingCustomer').dispatchEvent(new Event('change', { bubbles: true }));
      renderDirectories();
    }
    if (project) {
      el('billingProject').value = project.dataset.projectOpen;
      el('billingProject').dispatchEvent(new Event('change', { bubbles: true }));
      renderDirectories();
    }
  });
  el('billingCustomer').addEventListener('change', renderDirectories);
  el('billingProject').addEventListener('change', renderDirectories);
  document.addEventListener('siteops:billing-data', renderDirectories);
  window.SiteOpsBillingNavigate = navigate;
  renderDirectories();
})();
