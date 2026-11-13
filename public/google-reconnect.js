// Notice shown in the YouTube and Search Console workspaces when Google no longer accepts a
// stored connection. One button per affected service starts Google's consent screen and
// returns to the page the user was on.
(() => {
  'use strict';
  const box = document.getElementById('google-reconnect');
  if (!box) return;
  const START = {
    youtube: account => ['/api/youtube/oauth/start', { account_id: account.id, return_to: here() }],
    search_console: () => ['/api/search-console/oauth/start', { return_to: here() }]
  };
  // Marks the return from Google so the page can confirm the reconnect once.
  const DONE = 'google_reconnected';
  const here = () => {
    const url = new URL(location.href);
    url.searchParams.set(DONE, '1');
    return url.pathname + url.search;
  };
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  async function start(button, service, account) {
    const [url, body] = START[service](account);
    button.disabled = true;
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw Error(data.message || data.error || 'HTTP ' + response.status);
      location.assign(data.url);
    } catch (error) {
      button.disabled = false;
      box.querySelector('.google-reconnect-error')?.remove();
      box.append(el('p', 'Die Anmeldung konnte nicht gestartet werden: ' + error.message, 'google-reconnect-error'));
    }
  }
  function render(connections, returned) {
    const expired = connections.filter(connection => connection.reconnect_required);
    box.replaceChildren();
    box.removeAttribute('data-state');
    if (!expired.length) {
      if (!returned) return void (box.hidden = true);
      box.dataset.state = 'done';
      box.append(
        el('h2', 'Google ist wieder verbunden'),
        el('p', 'Alle Freigaben sind aktiv. Du kannst weiterarbeiten.')
      );
      box.hidden = false;
      return;
    }
    box.setAttribute('role', 'alert');
    box.append(
      el(
        'h2',
        expired.length > 1
          ? 'Die Google-Freigaben für YouTube und Search Console sind abgelaufen'
          : 'Die Google-Freigabe für ' + expired[0].label + ' ist abgelaufen'
      ),
      el(
        'p',
        (returned ? 'Ein Dienst ist wieder verbunden, es fehlt noch einer. ' : '') +
          'Melde dich erneut bei Google an. Einstellungen, Zuordnungen und Daten bleiben erhalten.'
      )
    );
    const actions = el('div', undefined, 'google-reconnect-actions');
    for (const connection of expired)
      for (const account of connection.accounts.filter(row => row.reconnect_required)) {
        const button = el(
          'button',
          connection.label + ' neu verbinden' + (account.name ? ' (' + account.name + ')' : '')
        );
        button.type = 'button';
        button.addEventListener('click', () => start(button, connection.service, account));
        actions.append(button);
      }
    box.append(actions);
    const help = el('details');
    help.append(el('summary', 'Warum läuft das ab, und wie verhindere ich es?'));
    const text = el('p');
    text.append(
      'Solange die Google-App im Status „Test“ steht, verfällt jede Freigabe nach sieben Tagen. Stelle sie in der Google Cloud Console unter ',
      Object.assign(el('a', 'Google Auth Platform → Zielgruppe'), {
        href: 'https://console.cloud.google.com/auth/audience',
        target: '_blank',
        rel: 'noopener noreferrer'
      }),
      ' auf „In Produktion“, dann bleibt die Verbindung dauerhaft bestehen.'
    );
    help.append(text);
    box.append(help);
    box.hidden = false;
  }
  // Stays true for this page view: the workspace may ask for a refresh after the first load.
  let returned = false;
  async function load() {
    const url = new URL(location.href);
    if (url.searchParams.has(DONE)) {
      returned = true;
      url.searchParams.delete(DONE);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    try {
      const response = await fetch('/api/google-connections', { credentials: 'same-origin' });
      if (!response.ok) return;
      render((await response.json()).connections || [], returned);
    } catch {
      // The notice is an aid; the workspaces report their own connection errors.
    }
  }
  // Workspaces call this when a request comes back with "access expired".
  window.SiteOpsGoogleReconnect = { refresh: load };
  load();
})();
