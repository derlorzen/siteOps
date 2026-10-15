// Display the build that is actually served by this SiteOps process.
(() => {
  'use strict';
  const content = document.querySelector('.ops-content, #crmRoot .crm-content');
  if (!content) return;

  const footer = document.createElement('footer');
  footer.className = 'siteops-build-footer';
  footer.setAttribute('aria-label', 'SiteOps Versionsstand');
  const label = document.createElement('span');
  label.className = 'siteops-build-label';
  label.textContent = 'SiteOps · Versionsstand wird geladen …';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'siteops-build-refresh';
  refresh.textContent = 'Neu laden';
  refresh.hidden = true;
  refresh.addEventListener('click', () => window.location.reload());
  footer.append(label, refresh);
  content.appendChild(footer);

  const side = document.querySelector('.ops-side-footer, #crmRoot .crm-nav-foot');
  const sideVersion = document.createElement('span');
  sideVersion.className = 'siteops-build-sidebar';
  if (side) side.appendChild(sideVersion);

  const loadedBuild = document.querySelector('meta[name="siteops-build"]')?.content || '';
  fetch('/api/build-info', { cache: 'no-store', credentials: 'same-origin' })
    .then(async response => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(info => {
      if (!/^[a-f0-9]{12}$/.test(info.build) || typeof info.version !== 'string') {
        throw new Error('Ungültige Versionsdaten');
      }
      const summary = 'SiteOps v' + info.version + ' · Build ' + info.build;
      const git = /^[a-f0-9]{40}$/.test(info.commit || '') ? ' · Git ' + info.commit.slice(0, 12) : '';
      const outdated = Boolean(loadedBuild && loadedBuild !== info.build);
      label.textContent = outdated
        ? 'Geladene Ansicht: ' + loadedBuild + ' · Neuer Build: ' + info.build
        : summary + git;
      label.title = 'Build-Fingerabdruck: ' + (info.fingerprint || info.build) +
        (info.commit ? '\nGit-Commit: ' + info.commit : '');
      sideVersion.textContent = outdated ? 'Neuer Build verfügbar' : 'v' + info.version + ' · ' + info.build;
      sideVersion.title = label.title;
      if (outdated) {
        footer.classList.add('siteops-build-outdated');
        refresh.hidden = false;
      }
    })
    .catch(() => {
      label.textContent = 'SiteOps · Versionsstand nicht verfügbar';
      sideVersion.textContent = 'Build nicht verfügbar';
    });
})();
