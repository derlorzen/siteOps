(() => {
  'use strict';
  const form = document.getElementById('installationForm');
  if (!form) return;
  const byId = id => document.getElementById(id),
    field = name => form.elements.namedItem(name);
  let plan = null,
    targetsRequest = 0,
    loading = false;
  const message = text => {
    byId('deployerNotice').textContent = text;
  };
  function syncSource() {
    const kind = field('sourceKind').value;
    for (const section of form.querySelectorAll('[data-source-kind]'))
      section.hidden = !section.dataset.sourceKind.split(' ').includes(kind);
    byId('analyzeApplication').disabled = kind !== 'git';
  }
  field('sourceKind').addEventListener('change', syncSource);
  syncSource();
  async function api(path, body) {
    const r = await fetch('/api/coolify/' + path, {
      credentials: 'same-origin',
      ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.message || result.error || 'HTTP ' + r.status);
    return result;
  }
  function input() {
    const value = Object.fromEntries(new FormData(form));
    for (const k of ['containerPort', 'memoryMb', 'cpus', 'diskMb', 'healthStatus'])
      if (value[k]) value[k] = Number(value[k]);
    value.environment = value.environmentText
      .split('\n')
      .filter(x => x.trim())
      .map(line => {
        const i = line.indexOf('=');
        if (i < 1) throw new Error('Umgebungsvariablen als NAME=WERT eingeben.');
        return { key: line.slice(0, i).trim(), value: line.slice(i + 1), buildTime: false };
      });
    value.volumes = value.volumesText
      .split('\n')
      .filter(x => x.trim())
      .map(line => {
        const i = line.indexOf('=');
        if (i < 1) throw new Error('Volumes als Name=/Container/Pfad eingeben.');
        return { name: line.slice(0, i).trim(), mountPath: line.slice(i + 1).trim() };
      });
    if (value.sourceKind === 'compose') value.compose = value.definition;
    if (value.sourceKind === 'dockerfile') value.dockerfile = value.definition;
    if (
      value.url &&
      (value.sourceType !== 'public' ||
        (value.gitCommit && value.reviewEvidence && new URL(value.url).hostname !== 'github.com'))
    ) {
      value.gitRepository = value.url;
      delete value.url;
    }
    delete value.definition;
    delete value.environmentText;
    delete value.volumesText;
    for (const k of Object.keys(value)) if (value[k] === '') delete value[k];
    return value;
  }
  function options(select, entries, first) {
    select.replaceChildren(new Option(first, ''), ...entries.map(x => new Option(x.name, x.uuid)));
  }
  async function loadTargets() {
    const seq = ++targetsRequest,
      connection = field('connectionId').value;
    options(field('serverUuid'), [], 'Standard / automatisch');
    options(field('coolifyProjectUuid'), [], 'Projektname suchen / erstellen');
    options(field('sourceUuid'), [], 'Keine');
    if (!connection) return;
    try {
      const [data, sources] = await Promise.all([
        api('connections/' + connection + '/targets'),
        api('connections/' + connection + '/sources').catch(() => [])
      ]);
      if (seq !== targetsRequest) return;
      options(field('serverUuid'), data.servers, 'Standard / automatisch');
      options(field('coolifyProjectUuid'), data.projects, 'Projektname suchen / erstellen');
      options(field('sourceUuid'), sources, 'Keine');
      byId('deployerCapabilities').textContent =
        'Coolify ' +
        data.capabilities.version +
        ' · Build-Methoden: ' +
        data.capabilities.buildPacks.join(', ') +
        ' · ' +
        data.capabilities.contract;
    } catch (e) {
      if (seq === targetsRequest) message(e.message);
    }
  }
  field('connectionId').addEventListener('change', loadTargets);
  field('coolifyProjectUuid').addEventListener('change', async () => {
    const p = field('coolifyProjectUuid').value,
      c = field('connectionId').value;
    byId('deployerEnvironments').replaceChildren();
    if (!p || !c) return;
    try {
      const envs = await api('connections/' + c + '/projects/' + p + '/environments');
      byId('deployerEnvironments').replaceChildren(...envs.map(x => new Option(x.name, x.name)));
    } catch (e) {
      message(e.message);
    }
  });
  field('siteopsProjectId').addEventListener('change', () => {
    if (field('siteopsProjectId').value)
      field('projectName').value = field('siteopsProjectId').selectedOptions[0].textContent;
  });
  form.addEventListener('input', () => {
    plan = null;
    byId('deploymentPlan').hidden = true;
  });
  byId('analyzeApplication').onclick = async () => {
    message('Prüfe offizielle Quellen und Repository-Dateien …');
    try {
      const result = await api('analyze', {
        url: field('url').value,
        ...(field('gitBranch').value ? { branch: field('gitBranch').value } : {})
      });
      byId('analysisResult').hidden = false;
      byId('analysisResult').textContent = JSON.stringify(result, null, 2);
      if (result.buildPack) field('buildPack').value = result.buildPack;
      if (result.ports?.[0]) field('containerPort').value = result.ports[0];
      if (result.dockerfileLocation) field('dockerfileLocation').value = result.dockerfileLocation;
      if (result.dockerComposeLocation) field('dockerComposeLocation').value = result.dockerComposeLocation;
      if (result.composeServices?.length === 1) field('composeService').value = result.composeServices[0];
      message('Analyse abgeschlossen: ' + result.suitability + '. Nachweise und Risiken prüfen.');
    } catch (e) {
      message(e.message);
    }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    byId('deploymentPlan').hidden = true;
    message('Erstelle gespeicherten Plan; noch kein Deployment …');
    try {
      plan = await api('plans', input());
      byId('deploymentPlanText').textContent = JSON.stringify(plan.plan, null, 2);
      byId('deploymentPlan').hidden = false;
      byId('approveDeploymentRisks').checked = false;
      byId('deploymentRiskNote').value = '';
      message('Plan gespeichert. Prüfung und Freigabe erforderlich.');
      await refresh();
    } catch (e) {
      message(e.message);
    }
  };
  byId('executeDeployment').onclick = async () => {
    if (!plan) return;
    try {
      const result = await api('installations/' + plan.id + '/execute', {
        approve: true,
        approveRisks: byId('approveDeploymentRisks').checked,
        ...(byId('deploymentRiskNote').value.trim()
          ? { riskAcknowledgement: byId('deploymentRiskNote').value.trim() }
          : {})
      });
      message('Auftrag ' + result.state + '. Der Worker führt den freigegebenen Plan aus.');
      // Remove local secret values after the immutable plan is approved.
      field('authPassword').value = '';
      field('environmentText').value = '';
      field('definition').value = '';
      byId('deploymentPlan').hidden = true;
      plan = null;
      await refresh();
    } catch (e) {
      message(e.message);
    }
  };
  function button(label, run) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = async () => {
      b.disabled = true;
      try {
        await run();
      } catch (e) {
        message(e.message);
      } finally {
        b.disabled = false;
      }
    };
    return b;
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      const items = await api('installations');
      const cards = byId('installationCards');
      cards.replaceChildren();
      if (!items.length) cards.textContent = 'Noch keine Anwendungen geplant.';
      for (const item of items) {
        const card = document.createElement('article');
        card.className = 'deployer-card';
        card.id = 'installation-' + item.id;
        const title = document.createElement('h3');
        title.textContent = item.plan.name + ' · ' + item.domain;
        const state = document.createElement('p');
        state.textContent = item.state + (item.lastError ? ' · ' + item.lastError : '');
        const progress = document.createElement('progress');
        progress.max = 8;
        progress.value = Object.values(item.progress).filter(x => x.state === 'done').length;
        progress.setAttribute('aria-label', 'Deployment-Fortschritt');
        const ol = document.createElement('ol');
        for (const step of item.plan.steps) {
          const li = document.createElement('li'),
            p = item.progress[step];
          li.textContent =
            step + ': ' + p.state + (p.detail ? ' · ' + p.detail : '') + (p.error ? ' · ' + p.error : '');
          ol.append(li);
        }
        const actions = document.createElement('div');
        actions.className = 'buttonrow';
        if (['planned', 'needs_attention'].includes(item.state))
          actions.append(
            button(item.state === 'planned' ? 'Plan prüfen' : 'Prüfen & fortsetzen', async () => {
              plan = item;
              byId('deploymentPlanText').textContent = JSON.stringify(item.plan, null, 2);
              byId('deploymentPlan').hidden = false;
              byId('approveDeploymentRisks').checked = false;
              byId('deploymentRiskNote').value = '';
              byId('deploymentPlan').scrollIntoView({ behavior: 'smooth' });
            })
          );
        if (item.resourceUuid)
          actions.append(
            button('Logs', async () => {
              const r = await api('installations/' + item.id + '/logs');
              byId('installationLogs').hidden = false;
              byId('installationLogs').textContent = r.output;
            })
          );
        if (item.state === 'online')
          actions.append(
            button('Redeployment', async () => {
              const note = prompt(
                'Denselben geprüften Plan erneut deployen? Schutzmaßnahmen bestätigen (mind. 10 Zeichen):'
              );
              if (!note || note.trim().length < 10) return;
              await api('installations/' + item.id + '/redeploy', {
                approve: true,
                approveRisks: true,
                riskAcknowledgement: note.trim()
              });
              await refresh();
            })
          );
        if (item.siteId) {
          const link = document.createElement('a');
          link.className = 'btn';
          link.href = '/sites/' + encodeURIComponent(item.siteId);
          link.textContent = 'Website in SiteOps öffnen';
          actions.append(link);
        }
        card.append(title, state, progress, ol, actions);
        cards.append(card);
      }
    } catch (e) {
      message(e.message);
    } finally {
      loading = false;
    }
  }
  byId('refreshInstallations').onclick = refresh;
  const initial = new URLSearchParams(location.search).get('projectId');
  if (initial && [...field('siteopsProjectId').options].some(x => x.value === initial)) {
    field('siteopsProjectId').value = initial;
    field('siteopsProjectId').dispatchEvent(new Event('change'));
  }
  if (field('connectionId').options.length === 2) {
    field('connectionId').selectedIndex = 1;
    void loadTargets();
  }
  void refresh();
  setInterval(refresh, 10000);
})();
