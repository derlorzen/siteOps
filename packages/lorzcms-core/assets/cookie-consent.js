(() => {
  const panel = document.querySelector('[data-consent-dialog]');
  const opener = document.querySelector('[data-consent-open]');
  if (!panel || !opener || typeof panel.showModal !== 'function') return;

  const key = 'lorzcms.cookie-consent';
  const revision = panel.dataset.revision;
  const inputs = Array.from(panel.querySelectorAll('input[type="checkbox"]'));
  const consentScripts = Array.from(document.querySelectorAll('script[type="text/plain"][data-lorzcms-consent][data-src]'));
  const activated = new Set();

  function savedChoices() {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value?.revision === revision && value.choices && typeof value.choices === 'object'
        ? value.choices
        : null;
    } catch {
      return null;
    }
  }

  function enableScripts(choices) {
    for (const placeholder of consentScripts) {
      const category = placeholder.dataset.lorzcmsConsent;
      if (!inputs.some(input => input.name === category) || choices[category] !== true || activated.has(placeholder)) continue;

      let url;
      try {
        url = new URL(placeholder.dataset.src, location.href);
      } catch {
        continue;
      }
      if (url.origin !== location.origin) continue;

      const script = document.createElement('script');
      script.src = url.href;
      script.async = false;
      placeholder.after(script);
      activated.add(placeholder);
    }
  }

  let choices = savedChoices();
  if (choices) enableScripts(choices);

  function openSettings() {
    for (const input of inputs) input.checked = choices?.[input.name] === true;
    panel.returnValue = '';
    panel.showModal();
  }

  opener.hidden = false;
  opener.addEventListener('click', openSettings);
  panel.addEventListener('close', () => {
    const action = panel.returnValue;
    if (!['accept', 'reject', 'save'].includes(action)) return;

    const next = Object.fromEntries(inputs.map(input => [input.name, action === 'accept' || (action === 'save' && input.checked)]));
    const revoked = inputs.some(input => choices?.[input.name] === true && !next[input.name]);
    choices = next;
    try {
      localStorage.setItem(key, JSON.stringify({ revision, choices }));
    } catch {
      if (!revoked) enableScripts(choices);
      if (revoked) location.reload();
      return;
    }
    if (revoked) {
      location.reload();
    } else {
      enableScripts(choices);
    }
  });

  if (!choices) openSettings();
})();
