/* Shared interactions: lists, recoverable states and MCP administration. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value ? new Intl.DateTimeFormat('de-DE', {timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : 'Noch keine Prüfung';
  async function api(url, options = {}) {
    const response = await fetch(url, {credentials:'same-origin', ...options});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.message || 'Die Anfrage konnte nicht abgeschlossen werden. Prüfe die Verbindung und versuche es erneut.');
    return data;
  }
  document.addEventListener('click', event => { if (event.target.closest('[data-reload]')) location.reload(); });
  const initial = $('websiteInitialData');
  if (initial) {
    let data = JSON.parse(initial.textContent), request, timer;
    const form = $('websiteFilters');
    const errorBox = $('websiteLoadError');
    const render = value => {
      data = value;
      $('websiteRows').innerHTML = data.items.map(site => {
        const url = '/sites/' + encodeURIComponent(site.slug);
        return '<tr><td data-label="Website"><a class="ui-identity" href="'+url+'">'+esc(site.name)+'</a><small>'+esc(site.domain)+'</small></td><td data-label="Status"><span class="ui-status" data-tone="'+esc(site.status.tone)+'">'+esc(site.status.label)+'</span><small>'+esc(date(site.last_checked_at))+'</small></td><td data-label="Kunde / Projekt">'+(site.project_id ? '<a href="/billing/projects/'+encodeURIComponent(site.project_id)+'">'+esc(site.project_name)+'</a><small>'+esc(site.customer_name)+'</small>' : '<span class="ui-muted">Eigenständige Website</span>')+'</td><td data-label="Nächster Schritt"><a class="ui-row-action" href="'+url+'">'+(site.status.code==='attention' ? 'Problem prüfen' : site.status.code==='unknown' ? 'Status prüfen' : 'Website öffnen')+' <span aria-hidden="true">→</span></a></td></tr>';
      }).join('');
      $('websiteEmpty').hidden = data.items.length > 0;
      $('websiteResultCount').textContent = data.total + ' von ' + data.total_sites + ' Websites';
      $('websiteRange').textContent = (data.total ? data.filters.offset + 1 : 0) + '–' + Math.min(data.filters.offset + data.items.length, data.total) + ' von ' + data.total;
      $('websitePrevious').disabled = data.filters.offset === 0;
      $('websiteNext').disabled = data.next_offset == null;
    };
    async function load(offset = 0, updateUrl = true) {
      request?.abort();
      const current = new AbortController(); request = current;
      const params = new URLSearchParams(new FormData(form)); params.set('offset', offset);
      $('websiteCollection').setAttribute('aria-busy','true'); errorBox.hidden = true;
      try {
        const value = await api('/api/workspace/websites?' + params, {signal:current.signal});
        if (current.signal.aborted) return;
        render(value);
        if (updateUrl) history.replaceState(null,'','/websites?' + params);
      } catch (error) {
        if (error.name === 'AbortError') return;
        errorBox.hidden = false; errorBox.setAttribute('role','alert');
        errorBox.innerHTML = '<div class="ui-feedback"><strong>Websites konnten nicht aktualisiert werden.</strong><p>Die letzte geladene Ansicht bleibt sichtbar. Prüfe die Verbindung und versuche es erneut.</p><button class="ghost" type="button" id="websiteRetry">Erneut versuchen</button></div>';
        $('websiteRetry').onclick = () => load(offset);
      } finally { if (request === current) $('websiteCollection').removeAttribute('aria-busy'); }
    }
    form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); load(); });
    form.addEventListener('input', event => { if (event.target.name === 'query') { clearTimeout(timer); timer = setTimeout(() => load(), 180); } });
    form.addEventListener('change', () => { clearTimeout(timer); load(); });
    $('websitePrevious').onclick = () => load(Math.max(0, data.filters.offset - data.filters.limit));
    $('websiteNext').onclick = () => load(data.next_offset || 0);
    window.addEventListener('popstate', () => {
      const params = new URLSearchParams(location.search);
      for (const name of ['query','status','sort']) form.elements[name].value = params.get(name) || ({status:'all',sort:'name'}[name] || '');
      load(Number(params.get('offset')) || 0, false);
    });
  }
  if ($('mcpAdmin')) {
    const error = () => '<div class="ui-feedback" role="status"><strong>Laden fehlgeschlagen.</strong><p>Prüfe die Verbindung und lade die Ansicht erneut.</p><button type="button" class="ghost" data-reload>Erneut laden</button></div>';
    async function loadConnections() {
      const box = $('oauthConnections');
      try {
        const rows = await api('/api/oauth/connections');
        box.innerHTML = rows.length ? rows.map(row => '<div class="oauth-connection"><div><strong>'+esc(row.clientName || 'MCP-Client')+'</strong><small>'+esc(row.clientId)+'</small></div><span>'+Number(row.activeAccess || 0)+' Zugriffsrechte · '+Number(row.activeRefresh || 0)+' Erneuerungen</span><button type="button" class="ghost" data-revoke="'+esc(row.clientId)+'">Zugriff widerrufen</button></div>').join('') : '<p>Noch keine OAuth-Verbindung. Verbinde ChatGPT oder Claude mit dem MCP-Endpunkt.</p>';
        box.querySelectorAll('[data-revoke]').forEach(button => button.onclick = async () => {
          button.disabled = true;
          try { await api('/api/oauth/revoke-client', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientId:button.dataset.revoke})}); await loadConnections(); }
          catch { box.innerHTML = error(); }
        });
      } catch { box.innerHTML = error(); }
    }
    async function loadCatalog() {
      const box = $('mcpTools');
      try {
        const data = await api('/api/mcp/capabilities');let offset=0;const limit=25;
        const render = () => {
          const query = $('mcpToolSearch').value.toLocaleLowerCase('de-DE');
          const visible = data.items.filter(tool => [tool.name,tool.description,tool.module].some(value => value.toLocaleLowerCase('de-DE').includes(query)));
          $('mcpToolCount').textContent = visible.length + ' von ' + data.items.length + ' Funktionen';
          $('mcpToolsPrevious').disabled=offset===0;$('mcpToolsNext').disabled=offset+limit>=visible.length;$('mcpToolsRange').textContent=(visible.length?offset+1:0)+'–'+Math.min(offset+limit,visible.length)+' von '+visible.length;
          box.innerHTML = '<table class="ui-data-table ui-tool-list"><thead><tr><th scope="col">Funktion</th><th scope="col">Modul</th><th scope="col">Zugriff</th></tr></thead><tbody>'+visible.slice(offset,offset+limit).map(tool => '<tr><td><code>'+esc(tool.name)+'</code><small>'+esc(tool.description)+'</small></td><td>'+esc(tool.module)+'</td><td>'+ (tool.access==='read'?'Lesen':tool.approval?'Ändern · Freigabe nötig':'Ändern')+'</td></tr>').join('')+'</tbody></table>'+(visible.length?'':'<p>Keine passenden Funktionen. Ändere den Suchbegriff.</p>');
        };
        $('mcpToolSearch').oninput = ()=>{offset=0;render();};$('mcpToolsPrevious').onclick=()=>{offset=Math.max(0,offset-limit);render();};$('mcpToolsNext').onclick=()=>{offset+=limit;render();};render();
      } catch { box.innerHTML = error(); }
    }
    async function loadApprovals() {
      const box = $('mcpApprovals');
      try {
        const rows = await api('/api/mcp/approvals');
        box.innerHTML = rows.length ? rows.map(row => '<article><h3>'+esc(row.tool_name)+'</h3><p>Prüfe Ziel, Parameter und Auswirkungen vor der Freigabe. Externe Änderungen können nicht immer rückgängig gemacht werden.</p><pre>'+esc(JSON.stringify(row.arguments,null,2))+'</pre><p>Gültig bis '+esc(date(row.expires_at))+'</p><button type="button" data-approve="'+esc(row.id)+'">Diese Aktion freigeben</button><p role="status" aria-live="polite"></p></article>').join('') : '<p>Keine offenen Freigaben. Kritische Aktionen werden zuerst als Vorschau vorbereitet.</p>';
        box.querySelectorAll('[data-approve]').forEach(button => button.onclick = async () => {
          button.disabled = true;
          const result = button.parentElement.querySelector('[role=status]');
          try { const data = await api('/api/mcp/approvals/'+encodeURIComponent(button.dataset.approve)+'/approve', {method:'POST',headers:{'content-type':'application/json'},body:'{}'}); result.textContent=data.message; button.textContent='Freigegeben'; }
          catch { result.textContent='Die Freigabe ist abgelaufen oder konnte nicht gespeichert werden. Erstelle eine neue Vorschau.'; }
        });
      } catch { box.innerHTML = error(); }
    }
    async function loadAudit() {
      const box = $('auditLog');
      try {
        const rows = await api('/api/audit-log?limit=100');
        box.innerHTML = rows.length ? '<table><thead><tr><th>Zeit</th><th>Aktion</th><th>Verantwortlich</th><th>Ergebnis</th></tr></thead><tbody>'+rows.map(row => '<tr><td>'+esc(date(row.created_at))+'</td><td>'+esc(row.mcp_tool || row.path)+'</td><td>'+esc(row.actor || row.actor_type)+'</td><td>'+esc(row.status_code)+'</td></tr>').join('')+'</tbody></table>' : '<p>Noch keine Audit-Einträge.</p>';
      } catch { box.innerHTML=error(); }
    }
    $('mcpSelfTest').onclick = async event => {
      const button=event.currentTarget; button.disabled=true; $('mcpTestResult').textContent='Prüfe Metadaten, Zugriffsschutz, Discovery und ungefährlichen Lesezugriff …';
      try { const data=await api('/api/mcp/self-test',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); $('mcpTestResult').innerHTML='<p>'+esc(data.verification)+'</p><ul>'+data.checks.map(check => '<li>'+esc(check.label)+' · '+(check.ok?'Bestanden':'Fehlgeschlagen')+'</li>').join('')+'</ul><p>ChatGPT und Claude wurden dadurch nicht extern verbunden.</p>'; }
      catch { $('mcpTestResult').textContent='Der Selbsttest konnte nicht abgeschlossen werden. Prüfe den Serververlauf und lade die Ansicht erneut.'; }
      finally { button.disabled=false; }
    };
    loadConnections(); loadCatalog(); loadApprovals(); loadAudit();
  }
})();
