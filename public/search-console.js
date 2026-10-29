(() => {
  const root = document.getElementById('gsc');
  if (!root) return;
  const site = root.dataset.site, $ = id => document.getElementById('gsc-' + id);
  let preview = null, offset = 0, next = null;
  const domain = root.dataset.domain;
  const propertyInput = $('link').elements.property;
  const choice = $('choice');
  function setPropertyMode() {
    const mode = choice.value;
    $('existing-area').hidden = mode !== 'existing';
    $('manual-area').hidden = mode !== 'custom';
    $('proposed').hidden = !['domain', 'prefix'].includes(mode);
    if (mode === 'domain') propertyInput.value = 'sc-domain:' + domain;
    if (mode === 'prefix') propertyInput.value = 'https://' + domain + '/';
    if (mode === 'existing') propertyInput.value = $('existing').value;
    $('proposed').textContent = mode === 'domain'
      ? 'Gesamte Domain (einschließlich Subdomains): sc-domain:' + domain
      : 'Nur diese HTTPS-Website: https://' + domain + '/';
    propertyInput.required = mode === 'custom';
  }
  choice.addEventListener('change', setPropertyMode);
  const message = value => { $('message').textContent = value; };
  async function api(path, body) {
    const response = await fetch('/api/search-console/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || 'Anfrage fehlgeschlagen');
    return result;
  }
  function option(value, text) { const el = document.createElement('option'); el.value = value; el.textContent = text; return el; }
  const action = (el, fn) => el.addEventListener('click', async e => { e.preventDefault(); el.disabled = true; try { await fn(); } catch (error) { message(error.message); } finally { el.disabled = false; } });
  const form = (el, fn) => el.addEventListener('submit', async e => { e.preventDefault(); try { await fn(Object.fromEntries(new FormData(el))); } catch (error) { message(error.message); } });
  async function load() {
    const s = await api('status?site=' + encodeURIComponent(site));
    $('redirect').textContent = s.redirect_uri;
    $('oauth-source').textContent = s.oauth_source === 'youtube' ? 'YouTube OAuth-Client wird wiederverwendet. Redirect-URI in Google Cloud ergänzen.' : '';
    $('config').elements.client_id.value = s.client_id;
    $('hostinger').textContent = s.hostinger_configured ? 'Hostinger API-Token gespeichert.' : 'Kein Hostinger API-Token gespeichert.';
    const selected = $('account').value;
    $('account').replaceChildren(...s.accounts.map(a => option(a.id, a.email)));
    if (selected && s.accounts.some(a => a.id === selected)) $('account').value = selected;
    const l = s.linkage;
    const states = { Property: l?.property || 'Nicht verknüpft', Livegang: l?.live_approved_at || 'Nicht freigegeben', 'Google-Eigentum': l?.verified_at || 'Nicht bestätigt', 'Google-Berechtigung': l?.permission_level || 'Keine', Sitemap: l?.sitemap_status || 'Nicht eingereicht', 'Letzter Sync': l?.last_sync_at || 'Noch nicht', 'Letzter vollständiger Datentag': l?.last_complete_date || 'Keine Daten', Fehler: l?.reason || l?.sync_error || 'Keine' };
    $('states').replaceChildren(...Object.entries(states).flatMap(([key, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; return [dt, dd]; }));
    if (l?.property) { choice.value = 'custom'; propertyInput.value = l.property; }
    setPropertyMode();
    message('Verbindung geladen.');
    if (l?.property && !l.invalidated) await performance();
    else { $('range').textContent = 'Projekt zuerst lokal verknüpfen.'; $('rows').replaceChildren(); $('metrics').replaceChildren(); $('opportunities').replaceChildren(); }
  }
  async function performance() {
    const result = await api('sites/' + encodeURIComponent(site) + '/performance?dimension=' + $('dimension').value + '&offset=' + offset);
    next = result.next_offset ?? null;
    $('previous').disabled = offset === 0; $('next').disabled = next === null;
    $('rows').replaceChildren(); $('metrics').replaceChildren(); $('opportunities').replaceChildren();
    if (!result.available) { $('range').textContent = result.reason; return; }
    $('range').textContent = result.range.startDate + ' bis ' + result.range.endDate + ' · Sync: ' + result.synced_at + (result.truncated ? ' · Zeilen begrenzt' : '');
    const number = value => Number(value || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 });
    for (const [key, label] of Object.entries({ clicks: 'Klicks', impressions: 'Impressionen', ctr: 'CTR', position: 'Position' })) {
      const el = document.createElement('span'), caption = document.createElement('em');
      const format = n => key === 'ctr' ? number(n * 100) + ' %' : number(n);
      el.textContent = format(result.totals[key]); caption.textContent = label + ' · zuvor ' + format(result.previous_totals[key]); el.append(caption); $('metrics').append(el);
    }
    for (const row of result.rows) { const tr = document.createElement('tr'); for (const value of [row.keys.join(' · '), number(row.clicks), number(row.impressions), number(row.ctr * 100) + ' %', number(row.position)]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } $('rows').append(tr); }
    for (const item of result.opportunities) { const li = document.createElement('li'); li.textContent = item.value + ': ' + item.suggestion; $('opportunities').append(li); }
  }
  form($('config'), async data => { await api('configure', data); $('config').elements.client_secret.value = ''; $('config').elements.hostinger_token.value = ''; await load(); });
  action($('connect'), async () => { location.assign((await api('oauth/start', {})).url); });
  async function loadProperties() {
    if (!$('account').value) {
      $('existing').replaceChildren(option('', 'Zuerst Google-Konto verbinden'));
      return;
    }
    const rows = await api('properties?site=' + encodeURIComponent(site) + '&account_id=' + encodeURIComponent($('account').value));
    $('existing').replaceChildren(option('', rows.length ? 'Website auswählen' : 'Keine passende Website gefunden'), ...rows.map(p => option(p.siteUrl, p.siteUrl + ' (' + p.permissionLevel + ')')));
  }
  action($('properties'), loadProperties);
  $('account').addEventListener('change', () => loadProperties().catch(e => message(e.message)));
  $('existing').addEventListener('change', setPropertyMode);
  form($('link'), async data => { setPropertyMode(); if (!propertyInput.value) throw new Error('Bitte eine Website auswählen.'); data.property = propertyInput.value; await api('link', { site, ...data }); preview = null; $('preview').hidden = true; await load(); });
  root.querySelectorAll('[data-preview]').forEach(el => action(el, async () => {
    const data = { site, action: el.dataset.preview };
    if (['dns', 'verify'].includes(data.action) && $('allinkl').value) data.allinkl_account_id = $('allinkl').value;
    if (data.action === 'sitemap') data.sitemap_url = $('sitemap').value;
    preview = await api('previews', data); $('preview-summary').textContent = el.textContent.trim() + ' für ' + domain + '. Details prüfen und danach ausdrücklich freigeben.'; $('preview-text').textContent = JSON.stringify(preview, null, 2); $('confirmation').value = ''; $('approved').checked = false; $('preview').hidden = false;
  }));
  action($('execute'), async () => {
    if (!preview || !$('approved').checked) throw new Error('Konkrete Vorschau prüfen und die Freigabe bestätigen.');
    $('execute').disabled = true;
    const result = await api('execute', { preview_token: preview.preview_token, approved: true, confirmation: $('confirmation').value });
    $('preview-text').textContent = JSON.stringify(result, null, 2); await load();
  });
  action($('change-status'), async () => { if (preview) $('preview-text').textContent = JSON.stringify(await api('change-status', { preview_token: preview.preview_token }), null, 2); });
  action($('sync'), async () => { message('Google-Daten werden synchronisiert…'); await api('sites/' + encodeURIComponent(site) + '/sync', {}); await load(); });
  action($('unlink'), async () => { if (confirm('Lokale Verknüpfung für ' + site + ' entfernen? Google und DNS bleiben bestehen.')) { await api('sites/' + encodeURIComponent(site) + '/unlink', {}); await load(); } });
  action($('disconnect'), async () => { if (confirm('Gewähltes Google-Konto und seine lokalen Projektverknüpfungen trennen?')) { await api('accounts/' + encodeURIComponent($('account').value) + '/disconnect', {}); await load(); } });
  form($('inspect'), async data => { $('inspection').textContent = JSON.stringify(await api('sites/' + encodeURIComponent(site) + '/inspect', data), null, 2); });
  $('dimension').addEventListener('change', () => { offset = 0; performance().catch(e => message(e.message)); });
  action($('previous'), async () => { offset = Math.max(0, offset - 100); await performance(); });
  action($('next'), async () => { if (next !== null) offset = next; await performance(); });
  fetch('/api/hosting/allinkl/accounts').then(r => r.ok ? r.json() : []).then(rows => { for (const a of rows) $('allinkl').append(option(a.id, a.name)); }).catch(() => {});
  setPropertyMode();
  load().then(loadProperties).catch(e => message(e.message));
})();
