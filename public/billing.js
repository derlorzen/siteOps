// Customer/project/task/time/invoice UI. All dynamic strings are escaped before rendering.
const byId = id => document.getElementById(id);
const escapeHtml = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const fmtMoney = cents => (Number(cents || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const iso = d => String(d || '').slice(0, 10);
const date = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
const data = { customers: [], projects: [], tasks: [], entries: [], invoices: [], settings: {} };
const message = s => {
  byId('billingMessage').textContent = s;
};
const get = async url => {
  const r = await fetch(url);
  const x = await r.json();
  if (!r.ok) throw Error(x.message || x.error || r.status);
  return x;
};
const write = async (url, method, body) => {
  const r = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const x = await r.json();
  if (!r.ok) throw Error(x.message || x.error || r.status);
  return x;
};
const form = el => Object.fromEntries(new FormData(el));
const rate = val => (val === '' || val == null ? null : Math.round(Number(val) * 100));
const pick = (target, items, label, previous) => {
  target.innerHTML = items.length
    ? items.map(x => '<option value="' + escapeHtml(x.id) + '">' + escapeHtml(label(x)) + '</option>').join('')
    : '<option value="">– Keine Einträge –</option>';
  if (items.some(x => x.id === previous)) target.value = previous;
};
const selectedCustomer = () => byId('billingCustomer').value;
const selectedProject = () => byId('billingProject').value;
const selectedTask = () => byId('billingTask').value;
const errorHandler = e => message('Fehler: ' + (e.message || e));
const request = f => async ev => {
  ev.preventDefault();
  try {
    await f(ev);
    message('Gespeichert.');
    await refresh();
  } catch (e) {
    errorHandler(e);
  }
};
function clearEditForm(formId, buttonLabel) {
  const form = byId(formId);
  if (!form.dataset.editId) return;
  form.reset();
  delete form.dataset.editId;
  const button = form.querySelector('button');
  if (button) button.textContent = buttonLabel;
}
function renderHierarchyContext() {
  const customer = data.customers.find(x => x.id === selectedCustomer());
  const project = data.projects.find(x => x.id === selectedProject() && x.customer_id === customer?.id);
  const task = data.tasks.find(x => x.id === selectedTask() && x.project_id === project?.id);
  byId('projectParentLabel').textContent = customer ? customer.name : 'Bitte zuerst einen Kunden wählen';
  byId('taskParentLabel').textContent = project ? customer.name + ' / ' + project.name : 'Bitte zuerst ein Projekt wählen';
  byId('timeParentLabel').textContent = task
    ? customer.name + ' / ' + project.name + ' / ' + task.name
    : 'Bitte zuerst eine Aufgabe wählen';
  byId('billingHierarchy').textContent =
    'Zuordnung: ' +
    (customer?.name || 'Kunde') +
    ' → ' +
    (project?.name || 'Projekt') +
    ' → ' +
    (task?.name || 'Task');
  byId('projectForm').querySelector('button').disabled = !customer;
  byId('taskForm').querySelector('button').disabled = !project;
  byId('timeForm').querySelector('button').disabled = !task;
  byId('editCustomer').disabled = !customer;
  byId('editProject').disabled = !project;
  byId('editTask').disabled = !task;
}
function renderSelection() {
  const cp = selectedCustomer(),
    pr = selectedProject(),
    tk = selectedTask();
  pick(byId('billingCustomer'), data.customers, x => x.name, cp);
  pick(
    byId('billingProject'),
    data.projects.filter(x => x.customer_id === selectedCustomer()),
    x => x.name,
    pr
  );
  pick(
    byId('billingTask'),
    data.tasks.filter(x => x.project_id === selectedProject()),
    x => x.name,
    tk
  );
}
function updateProject() {
  const current = selectedProject();
  pick(
    byId('billingProject'),
    data.projects.filter(x => x.customer_id === selectedCustomer()),
    x => x.name,
    current
  );
  updateTasks();
}
function updateTasks() {
  const current = selectedTask();
  pick(
    byId('billingTask'),
    data.tasks.filter(x => x.project_id === selectedProject()),
    x => x.name,
    current
  );
  draw();
}
function draw() {
  renderHierarchyContext();
  const entries = data.entries.filter(x => x.customer_id === selectedCustomer()),
    invoices = data.invoices.filter(x => x.customer_id === selectedCustomer());
  const bill = entries.filter(x => x.billable && !x.invoice_id && !x.started_at);
  byId('billingTimeTotal').textContent =
    (entries.reduce((s, e) => s + Number(e.duration_seconds), 0) / 3600).toLocaleString('de-DE', {
      maximumFractionDigits: 2
    }) + ' h';
  byId('billingUnbilled').textContent = fmtMoney(
    bill.reduce((s, e) => s + Math.round((e.duration_seconds * e.hourly_cents) / 3600), 0)
  );
  byId('billingInvoiceTotal').textContent = fmtMoney(
    invoices.filter(i => i.status !== 'draft').reduce((s, i) => s + Number(i.gross_cents), 0)
  );
  byId('billingEntries').innerHTML = entries.length
    ? entries
        .map(
          e =>
            '<tr><td>' +
            escapeHtml(iso(e.entry_date)) +
            '</td><td>' +
            escapeHtml(e.project_name) +
            ' / ' +
            escapeHtml(e.task_name) +
            '</td><td>' +
            escapeHtml(e.kind === 'call' ? 'Telefonat: ' : '') +
            escapeHtml(e.description) +
            '</td><td>' +
            Math.round(Number(e.duration_seconds) / 60) +
            ' Min.</td><td>' +
            fmtMoney(Math.round((e.duration_seconds * e.hourly_cents) / 3600)) +
            '</td><td>' +
            escapeHtml(e.invoice_id ? 'abgerechnet' : e.started_at ? 'läuft' : e.billable ? 'offen' : 'intern') +
            '</td><td>' +
            (e.invoice_id || e.started_at
              ? ''
              : '<button type="button" class="ghost" data-edit-entry="' + escapeHtml(e.id) + '">Bearbeiten</button><button type="button" class="ghost" data-remove-entry="' + escapeHtml(e.id) + '">Löschen</button>') +
            '</td></tr>'
        )
        .join('')
    : '<tr><td colspan="7">Noch keine Zeiteinträge.</td></tr>';
  const from = byId('billingFrom').value,
    to = byId('billingTo').value;
  const candidates = bill.filter(e => iso(e.entry_date) >= from && iso(e.entry_date) <= to);
  byId('billingCandidates').innerHTML = candidates.length
    ? candidates
        .map(
          e =>
            '<tr><td><input type="checkbox" data-bill-entry="' +
            escapeHtml(e.id) +
            '" checked aria-label="Eintrag auswählen"></td><td>' +
            escapeHtml(iso(e.entry_date)) +
            '</td><td>' +
            escapeHtml(e.task_name) +
            ': ' +
            escapeHtml(e.description) +
            '</td><td>' +
            Math.round(e.duration_seconds / 60) +
            ' Min.</td><td>' +
            fmtMoney(Math.round((e.duration_seconds * e.hourly_cents) / 3600)) +
            '</td></tr>'
        )
        .join('')
    : '<tr><td colspan="5">Keine offenen abrechenbaren Zeiten für diesen Zeitraum.</td></tr>';
  drawTotal();
  byId('billingInvoices').innerHTML = invoices.length
    ? invoices
        .map(
          i =>
            '<tr><td>' +
            escapeHtml(i.invoice_number || 'Entwurf') +
            '</td><td>' +
            escapeHtml(iso(i.service_from)) +
            ' – ' +
            escapeHtml(iso(i.service_to)) +
            '</td><td>' +
            fmtMoney(i.net_cents) +
            '</td><td>' +
            fmtMoney(i.gross_cents) +
            '</td><td>' +
            escapeHtml(i.status) +
            (i.archive_commit ? ' · Git ' + escapeHtml(String(i.archive_commit).slice(0, 8)) : '') +
            '</td><td>' +
            (i.status === 'draft' || i.status === 'archiving'
              ? '<button type="button" data-issue="' +
                escapeHtml(i.id) +
                '">' +
                (i.status === 'archiving' ? 'Archivierung wiederholen' : 'Ausstellen') +
                '</button>'
              : '') +
            (i.status === 'issued' || i.status === 'paid' || i.status === 'cancelled'
              ? '<a class="btn ghost" href="/api/billing/invoices/' + escapeHtml(i.id) + '/pdf">PDF</a>'
              : '') +
            (i.status === 'issued'
              ? '<button type="button" class="ghost" data-pay="' + escapeHtml(i.id) + '">Bezahlt</button>'
              : '') +
            (i.status === 'issued' || i.status === 'paid'
              ? '<button type="button" class="ghost" data-cancel="' + escapeHtml(i.id) + '">Storno</button>'
              : '') +
            (i.cancellation_status === 'issued'
              ? '<a class="btn ghost" href="/api/billing/invoices/' +
                escapeHtml(i.id) +
                '/cancellation-pdf">Stornobeleg</a>'
              : '') +
            (i.status === 'draft'
              ? '<button type="button" class="ghost" data-discard="' + escapeHtml(i.id) + '">Verwerfen</button>'
              : '') +
            '</td></tr>'
        )
        .join('')
    : '<tr><td colspan="6">Noch keine Rechnungen.</td></tr>';
  const active = data.entries.find(e => e.started_at);
  byId('timerStart').disabled = Boolean(active) || !selectedTask();
  byId('timerStop').disabled = !active;
  byId('timerStop').dataset.timerId = active?.id || '';
  function renderTimer() {
    const seconds = active ? Math.max(0, Math.floor((Date.now() - new Date(active.started_at).getTime()) / 1000)) : 0;
    const duration = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(n => String(n).padStart(2, '0'))
      .join(':');
    byId('timerClock').textContent = duration + (active ? ' · ' + active.task_name : '');
  }
  renderTimer();
  clearInterval(window.siteopsBillingClock);
  window.siteopsBillingClock = setInterval(renderTimer, 1000);
}
function drawTotal() {
  const ids = new Set(Array.from(document.querySelectorAll('[data-bill-entry]:checked')).map(x => x.dataset.billEntry));
  const rows = data.entries.filter(e => ids.has(e.id));
  const net = rows.reduce((s, e) => s + Math.round((e.duration_seconds * e.hourly_cents) / 3600), 0);
  byId('billingSelection').textContent =
    rows.length + ' Einträge · Netto ' + fmtMoney(net) + ' · Brutto ' + fmtMoney(net + Math.round(net * 0.19));
}
async function refresh() {
  const [customers, projects, tasks, entries, invoices, settings] = await Promise.all([
    get('/api/billing/customers'),
    get('/api/billing/projects'),
    get('/api/billing/tasks'),
    get('/api/billing/entries'),
    get('/api/billing/invoices'),
    get('/api/billing/settings')
  ]);
  Object.assign(data, { customers, projects, tasks, entries, invoices, settings });
  renderSelection();
  draw();
  for (const [key, value] of Object.entries(settings)) {
    const el = byId('billingSettingsForm').elements.namedItem(key);
    if (el) el.value = value;
  }
}
function install() {
  byId('entryDate').value = date();
  byId('billingFrom').value = date().slice(0, 8) + '01';
  byId('billingTo').value = date();
  byId('editCustomer').addEventListener('click', () => {
    const c=data.customers.find(x=>x.id===selectedCustomer()); if(!c)return;
    const f=byId('customerForm'); for(const k of ['name','contact_name','email','street','postal_code','city'])f.elements.namedItem(k).value=c[k]||'';
    f.elements.namedItem('rate_eur').value=(Number(c.default_hourly_cents)/100).toFixed(2);
    f.dataset.editId=c.id;message('Kunde bearbeiten und im Formular speichern.');
  });
  byId('editProject').addEventListener('click', () => {
    const p=data.projects.find(x=>x.id===selectedProject());if(!p)return;
    const f=byId('projectForm');f.elements.namedItem('name').value=p.name;
    f.elements.namedItem('rate_eur').value=p.hourly_cents==null?'':(Number(p.hourly_cents)/100).toFixed(2);
    f.dataset.editId=p.id;message('Projekt bearbeiten und speichern.');
  });
  byId('editTask').addEventListener('click', () => {
    const t=data.tasks.find(x=>x.id===selectedTask());if(!t)return;
    const f=byId('taskForm');f.elements.namedItem('name').value=t.name;
    f.elements.namedItem('rate_eur').value=t.hourly_cents==null?'':(Number(t.hourly_cents)/100).toFixed(2);
    f.dataset.editId=t.id;message('Aufgabe bearbeiten und speichern.');
  });

  byId('billingCustomer').addEventListener('change', () => {
    clearEditForm('customerForm', 'Kunde anlegen');
    clearEditForm('projectForm', 'Projekt anlegen');
    clearEditForm('taskForm', 'Task anlegen');
    updateProject();
  });
  byId('billingProject').addEventListener('change', () => {
    clearEditForm('projectForm', 'Projekt anlegen');
    clearEditForm('taskForm', 'Task anlegen');
    updateTasks();
  });
  byId('billingTask').addEventListener('change', () => {
    clearEditForm('taskForm', 'Task anlegen');
    draw();
  });
  byId('billingFrom').addEventListener('change', draw);
  byId('billingTo').addEventListener('change', draw);
  byId('billingCandidates').addEventListener('change', drawTotal);
  byId('customerForm').addEventListener(
    'submit',
    request(async () => {
      const el = byId('customerForm'),
        x = form(el);
      await write(el.dataset.editId ? '/api/billing/customers/' + el.dataset.editId : '/api/billing/customers', el.dataset.editId ? 'PATCH' : 'POST', {
        name: x.name,
        contact_name: x.contact_name,
        email: x.email,
        street: x.street,
        postal_code: x.postal_code,
        city: x.city,
        default_hourly_cents: rate(x.rate_eur)
      });
      el.reset();
      delete el.dataset.editId;
    })
  );
  byId('projectForm').addEventListener(
    'submit',
    request(async () => {
      const el = byId('projectForm'),
        x = form(el);
      if (!selectedCustomer()) throw Error('Zuerst Kunden wählen.');
      await write(el.dataset.editId ? '/api/billing/projects/' + el.dataset.editId : '/api/billing/projects', el.dataset.editId ? 'PATCH' : 'POST', {
        customer_id: selectedCustomer(),
        name: x.name,
        hourly_cents: rate(x.rate_eur)
      });
      el.reset();
      delete el.dataset.editId;
    })
  );
  byId('taskForm').addEventListener(
    'submit',
    request(async () => {
      const el = byId('taskForm'),
        x = form(el);
      if (!selectedProject()) throw Error('Zuerst Projekt wählen.');
      await write(el.dataset.editId ? '/api/billing/tasks/' + el.dataset.editId : '/api/billing/tasks', el.dataset.editId ? 'PATCH' : 'POST', {
        project_id: selectedProject(),
        name: x.name,
        hourly_cents: rate(x.rate_eur)
      });
      el.reset();
      delete el.dataset.editId;
    })
  );
  byId('timeForm').addEventListener(
    'submit',
    request(async () => {
      const el = byId('timeForm'),
        x = form(el);
      if (!selectedTask()) throw Error('Zuerst Aufgabe wählen.');
      await write('/api/billing/entries', 'POST', {
        task_id: selectedTask(),
        entry_date: x.entry_date,
        kind: x.kind,
        description: x.description,
        contact_name: x.contact_name,
        duration_minutes: Number(x.duration_minutes),
        billable: el.elements.namedItem('billable').checked
      });
      el.elements.namedItem('duration_minutes').value = '';
      el.elements.namedItem('description').value = '';
    })
  );
  byId('billingSettingsForm').addEventListener(
    'submit',
    request(async () => {
      await write('/api/billing/settings', 'POST', form(byId('billingSettingsForm')));
    })
  );
  byId('timerStart').addEventListener(
    'click',
    request(async () => {
      if (!selectedTask()) throw Error('Zuerst Aufgabe wählen.');
      await write('/api/billing/timer/start', 'POST', {
        task_id: selectedTask(),
        kind: byId('timerKind').value,
        description: byId('timerDescription').value
      });
    })
  );
  byId('timerStop').addEventListener(
    'click',
    request(async () => {
      await write('/api/billing/timer/' + byId('timerStop').dataset.timerId + '/stop', 'POST', {});
    })
  );
  byId('selectAllEntries').addEventListener('click', () => {
    document.querySelectorAll('[data-bill-entry]').forEach(x => {
      x.checked = true;
    });
    drawTotal();
  });
  byId('billingDraft').addEventListener(
    'click',
    request(async () => {
      const ids = Array.from(document.querySelectorAll('[data-bill-entry]:checked')).map(x => x.dataset.billEntry);
      if (!selectedCustomer() || !ids.length) throw Error('Abrechenbare Zeiten auswählen.');
      await write('/api/billing/invoices', 'POST', {
        customer_id: selectedCustomer(),
        service_from: byId('billingFrom').value,
        service_to: byId('billingTo').value,
        entry_ids: ids
      });
    })
  );
  byId('billingEntries').addEventListener('click', async ev => {
    const editor=ev.target.closest('[data-edit-entry]');
    if(editor){
      const entry=data.entries.find(e=>e.id===editor.dataset.editEntry);if(!entry)return;
      const value=prompt('Dauer in Minuten', String(Number(entry.duration_seconds)/60));if(value===null)return;
      const description=prompt('Leistungsbeschreibung',entry.description||'');if(description===null)return;
      const when=prompt('Datum (JJJJ-MM-TT)',iso(entry.entry_date));if(when===null)return;
      try{await write('/api/billing/entries/'+entry.id,'PATCH',{duration_minutes:Number(value),description,entry_date:when});message('Eintrag korrigiert.');await refresh();}catch(e){errorHandler(e);}
      return;
    }
    const btn = ev.target.closest('[data-remove-entry]');
    if (!btn || !confirm('Unberechneten Zeiteintrag löschen?')) return;
    try {
      await write('/api/billing/entries/' + btn.dataset.removeEntry, 'DELETE');
      message('Eintrag gelöscht.');
      await refresh();
    } catch (e) {
      errorHandler(e);
    }
  });
  byId('billingInvoices').addEventListener('click', async ev => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    try {
      if (btn.dataset.issue) {
        if (!confirm('Rechnung verbindlich ausstellen und im privaten GitHub-Backup archivieren?')) return;
        await write('/api/billing/invoices/' + btn.dataset.issue + '/issue', 'POST');
      } else if (btn.dataset.cancel) {
        const reason = prompt('Stornierungsgrund (mindestens 5 Zeichen):');
        if (!reason) return;
        if (!confirm('Verbindlichen, nummerierten Stornobeleg ausstellen und archivieren?')) return;
        await write('/api/billing/invoices/' + btn.dataset.cancel + '/cancel', 'POST', { reason });
      } else if (btn.dataset.pay) {
        if (!confirm('Zahlungseingang bestätigen?')) return;
        await write('/api/billing/invoices/' + btn.dataset.pay + '/pay', 'POST');
      } else if (btn.dataset.discard) {
        if (!confirm('Entwurf löschen?')) return;
        await write('/api/billing/invoices/' + btn.dataset.discard, 'DELETE');
      } else return;
      message('Rechnungsstatus aktualisiert.');
      await refresh();
    } catch (e) {
      errorHandler(e);
    }
  });
  refresh().catch(errorHandler);
}
const root = byId('billingRoot');
if (root) {
  root.innerHTML = [
    '<header><div><h2>Kunde auswählen</h2><p id="billingMessage" role="status"></p></div></header>',
    '<section><div class="formgrid"><label>Kunde<select id="billingCustomer"></select></label><label>Projekt<select id="billingProject"></select></label><label>Aufgabe<select id="billingTask"></select></label></div>',
    '<p id="billingHierarchy" role="status"></p>',
    '<div class="buttonrow"><button id="editCustomer" type="button" class="ghost">Kunde bearbeiten</button><button id="editProject" type="button" class="ghost">Projekt bearbeiten</button><button id="editTask" type="button" class="ghost">Aufgabe bearbeiten</button></div>',
    '<div class="metrics"><span id="billingTimeTotal">–<em>Gesamtzeit</em></span><span id="billingUnbilled">–<em>Offener Netto-Wert</em></span><span id="billingInvoiceTotal">–<em>Rechnungsvolumen</em></span></div></section>',
    '<div class="twocol ops-grid"><section><h2>Neuer Kunde</h2><form id="customerForm" class="inner-form">',
    '<label>Name / Firma<input name="name" required></label><label>Kontakt<input name="contact_name"></label><label>E-Mail<input name="email" type="email"></label>',
    '<label>Straße<input name="street"></label><label>PLZ<input name="postal_code"></label><label>Ort<input name="city"></label>',
    '<label>Stundensatz in €<input name="rate_eur" type="number" min="0" step=".01" value="75" required></label><button>Kunde anlegen</button></form></section>',
    '<section><h2>Projekt anlegen</h2><p>Gehört zum Kunden: <strong id="projectParentLabel"></strong></p><form id="projectForm" class="inner-form"><label>Projekt<input name="name" required></label><label>Stundensatz € (optional)<input type="number" min="0" step=".01" name="rate_eur"></label><button>Projekt anlegen</button></form>',
    '<h2>Task anlegen</h2><p>Gehört zum Projekt: <strong id="taskParentLabel"></strong></p><form id="taskForm" class="inner-form"><label>Task<input name="name" required></label><label>Stundensatz € (optional)<input type="number" min="0" step=".01" name="rate_eur"></label><button>Task anlegen</button></form></section></div>',
    '<section><h2>Zeiterfassung</h2><p>Zeiten werden auf den ausgewählten Task gebucht: <strong id="timeParentLabel"></strong></p><div class="twocol ops-grid"><form id="timeForm" class="inner-form">',
    '<label>Datum<input id="entryDate" type="date" name="entry_date" required></label><label>Typ<select name="kind"><option value="work">Arbeit</option><option value="call">Telefonat</option></select></label>',
    '<label>Dauer (Minuten)<input name="duration_minutes" type="number" min="0.01" step="0.01" required></label>',
    '<label>Beschreibung<input name="description"></label><label>Gesprächspartner<input name="contact_name"></label>',
    '<label class="check"><input type="checkbox" name="billable" checked> Abrechenbar</label><button>Zeit eintragen</button></form>',
    '<div class="inner-form"><h3>Timer</h3><label>Tätigkeit<input id="timerDescription"></label><label>Art<select id="timerKind"><option value="work">Arbeit</option><option value="call">Telefonat</option></select></label>',
    '<div class="buttonrow"><button id="timerStart" type="button">Start</button><button id="timerStop" type="button" class="ghost">Stop</button></div><strong id="timerClock">00:00:00</strong></div></div>',
    '<div class="tablewrap"><table><thead><tr><th>Datum</th><th>Projekt / Aufgabe</th><th>Leistung</th><th>Dauer</th><th>Wert</th><th>Status</th><th></th></tr></thead><tbody id="billingEntries"></tbody></table></div></section>',
    '<section><h2>Rechnungen</h2><div class="formgrid"><label>Von<input id="billingFrom" type="date"></label><label>Bis<input id="billingTo" type="date"></label></div>',
    '<div class="buttonrow"><button type="button" class="ghost" id="selectAllEntries">Alle wählen</button><button type="button" id="billingDraft">Entwurf erstellen</button></div>',
    '<p id="billingSelection"></p><div class="tablewrap"><table><thead><tr><th>✓</th><th>Datum</th><th>Leistung</th><th>Zeit</th><th>Netto</th></tr></thead><tbody id="billingCandidates"></tbody></table></div>',
    '<h3>Bisherige Rechnungen</h3><div class="tablewrap"><table><thead><tr><th>Nummer</th><th>Zeitraum</th><th>Netto</th><th>Brutto</th><th>Status / Archiv</th><th>Aktionen</th></tr></thead><tbody id="billingInvoices"></tbody></table></div></section>',
    '<section><details><summary>Absenderdaten / Rechnungsangaben bearbeiten</summary><form id="billingSettingsForm" class="inner-form"><div class="formgrid">',
    ...[
      ['name', 'Firma / Name'],
      ['street', 'Straße'],
      ['postal_code', 'PLZ'],
      ['city', 'Ort'],
      ['email', 'E-Mail'],
      ['tax_id', 'Steuernummer'],
      ['vat_id', 'USt-ID'],
      ['iban', 'IBAN'],
      ['bic', 'BIC'],
      ['payment_note', 'Zahlungshinweise']
    ].map(([k, title]) => '<label>' + title + '<input name="' + k + '" maxlength="500"></label>'),
    '</div><button>Einstellungen speichern</button></form></details></section>',
    '<section><p>Ausgestellte Rechnungen werden als PDF und Datensatz im privaten SiteOps-GitHub-Backup unter invoices/ gespeichert. GitHub allein ist keine garantierte GoBD-konforme Langzeitarchivierung.</p></section>'
  ].join('');
  install();
}
