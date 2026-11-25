const label = {
  sending: 'Unbestätigt',
  accepted: 'SMTP angenommen',
  failed: 'Fehlgeschlagen',
  partial: 'Teilweise angenommen'
};
const sources = {
  monitoring: 'Monitoring',
  backup: 'Backup',
  synthetic: 'Browser-Test',
  invoice: 'Rechnung',
  reminder: 'Zahlungserinnerung',
  tasks: 'Aufgaben',
  test: 'Testnachricht',
  system: 'System'
};

function addressList(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.join(', ') : '';
  } catch {
    return '';
  }
}

export function renderMailArchive({ rows, filters, esc, fmtDateTime, retentionDays }) {
  const query = new URLSearchParams();
  for (const key of ['query', 'source', 'status', 'referenceId']) {
    if (filters[key]) query.set(key, filters[key]);
  }
  const exportUrl = '/api/mail-archive.csv?' + query.toString();
  const limit = 50;
  const offset = Math.max(0, Number(filters.offset) || 0);
  const link = next => {
    const params = new URLSearchParams(query);
    params.set('offset', String(next));
    return '/mail-archive?' + params.toString();
  };
  const options = (items, selected) =>
    Object.entries(items)
      .map(([value, title]) => `<option value="${esc(value)}"${selected === value ? ' selected' : ''}>${esc(title)}</option>`)
      .join('');
  const body = rows
    .map(row => {
      const addresses = addressList(row.recipients);
      const cc = addressList(row.cc);
      const bcc = addressList(row.bcc);
      const files = addressList(row.attachment_names);
      const details = [row.error_code, row.smtp_code ? 'SMTP ' + row.smtp_code : ''].filter(Boolean).join(' · ');
      return `<tr><td>${esc(fmtDateTime(row.created_at))}</td><td><strong>${esc(row.subject)}</strong><br><small>${esc(sources[row.source] || row.source)}${row.reference_id ? ' · ' + esc(row.reference_id) : ''}</small></td><td>${esc(row.sender)}<br><small>An: ${esc(addresses)}${cc ? '<br>CC: ' + esc(cc) : ''}${bcc ? '<br>BCC: ' + esc(bcc) : ''}</small></td><td><span class="pill ${row.status === 'accepted' ? 'ok' : row.status === 'failed' || row.status === 'partial' ? 'bad' : ''}">${esc(label[row.status] || row.status)}</span><br><small>${esc(details)}</small></td><td>${esc(row.message_id || '–')}<br><small>${esc(row.attachment_count)} Anhang/Anhänge${files ? ': ' + esc(files) : ''}</small></td></tr>`;
    })
    .join('');
  return `<header><div><h1>Mailarchiv</h1><p>SMTP-Versandversuche, ohne Nachrichtentext oder Anhangsinhalte. Aufbewahrung: ${esc(retentionDays)} Tage. SMTP-Annahme ist keine Zustellbestätigung.</p></div><div class="actions"><a class="button ghost" href="${esc(exportUrl)}">CSV exportieren (max. 10.000)</a></div></header>
    <section class="form-card"><form method="get" action="/mail-archive" class="formgrid">
      <label>Suche<input name="query" value="${esc(filters.query || '')}" placeholder="Empfänger, Absender oder Betreff"></label>
      <label>Status<select name="status"><option value="">Alle</option>${options(label, filters.status)}</select></label>
      <label>Herkunft<select name="source"><option value="">Alle</option>${options(sources, filters.source)}</select></label>
      <label>Referenz-ID<input name="referenceId" value="${esc(filters.referenceId || '')}"></label>
      <div class="actions"><button type="submit">Filtern</button><a class="button ghost" href="/mail-archive">Zurücksetzen</a></div>
    </form></section>
    <section><div class="tablewrap"><table><thead><tr><th>Zeit (Berlin)</th><th>Betreff / Herkunft</th><th>Absender / Empfänger</th><th>Status</th><th>Message-ID / Anhänge</th></tr></thead><tbody>${body || '<tr><td colspan="5">Keine Versandversuche gefunden.</td></tr>'}</tbody></table></div>
    <div class="actions">${offset ? `<a class="button ghost" href="${esc(link(Math.max(0, offset - limit)))}">Zurück</a>` : ''}<span>Einträge ab ${offset + 1}</span>${rows.length === limit ? `<a class="button ghost" href="${esc(link(offset + limit))}">Weiter</a>` : ''}</div></section>`;
}
