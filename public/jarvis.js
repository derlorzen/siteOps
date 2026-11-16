(() => {
  const find = id => document.getElementById('jarvis-' + id);
  const root = document.getElementById('jarvis');
  if (!root) return;

  const input = find('input');
  const viewport = find('conversation');
  const feedback = find('feedback');
  const menu = find('menu');
  const dialog = find('project-dialog');
  const send = find('send');
  const options = find('options');
  const messages = find('messages');
  const mobile = matchMedia('(max-width: 850px)');
  let workspace, chat, poller, installPrompt;
  let project = 'general';
  let online = false;
  let busy = false;
  let loadedRequest = 0;
  let draftId = crypto.randomUUID();

  async function api(path, payload) {
    const response = await fetch(
      '/api/jarvis/' + path,
      payload === undefined
        ? { cache: 'no-store' }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        response.status === 401 ? 'Melde dich erneut in SiteOps an.' : data.message || 'Die Anfrage ist fehlgeschlagen.'
      );
    return data;
  }

  function setNavigation(open, focus = true) {
    root.toggleAttribute('data-nav-open', open);
    menu.setAttribute('aria-expanded', String(open));
    if (focus && mobile.matches) (open ? find('close') : menu).focus();
  }

  function button(text, className, onClick) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = className;
    item.textContent = text;
    item.addEventListener('click', onClick);
    return item;
  }

  function navItem(id, label, active, onClick, detail) {
    const item = button(label, 'jarvis-nav-item', onClick);
    item.dataset.id = id;
    item.title = label;
    if (active) item.setAttribute('aria-current', 'true');
    if (detail && detail !== label) {
      const small = document.createElement('small');
      small.textContent = detail;
      item.append(small);
    }
    return item;
  }

  function projects() {
    return [{ id: 'general', name: 'Allgemein' }, ...(workspace?.sites || []), ...(workspace?.projects || [])];
  }

  function renderNav() {
    find('projects').replaceChildren(
      ...projects().map(item => navItem(item.id, item.name, project === item.id, () => resetChat(item.id), item.domain))
    );
    const chats = (workspace?.chats || []).filter(item => item.project === project);
    find('chats').replaceChildren(
      ...chats.map(item => navItem(item.id, item.title, chat?.id === item.id, () => void openChat(item.id)))
    );
  }

  function controls() {
    const phase = chat?.phase || 'idle';
    const canCompose = Boolean(workspace) && phase === 'idle' && !busy;
    input.disabled = !canCompose;
    send.disabled = !canCompose || !online || !input.value.trim();
    send.hidden = phase !== 'idle';
    find('stop').hidden = phase !== 'running';
    find('stop').disabled = busy;
    find('retry').hidden = !['interrupted', 'stopped'].includes(phase);
    find('retry').disabled = !online || busy;
    find('new').disabled = !workspace || busy;
    find('new-project').disabled = !workspace || busy;
    find('dictate').disabled = !canCompose;
    for (const option of options.querySelectorAll('button')) option.disabled = !online || busy;
  }

  function renderChat() {
    const phase = chat?.phase || 'idle';
    const transcript = chat?.messages || [];
    const active = projects().find(item => item.id === project);
    find('title').textContent = project === 'general' ? 'Jarvis' : active?.name || 'Archiviertes Projekt';
    find('model').textContent = chat?.recommendations?.options?.find(item => item.id === chat.model)?.label || '';
    find('empty').hidden = transcript.length > 0;
    messages.replaceChildren();
    for (const { role, content } of transcript) renderMessage(role, content);
    if (chat?.partial) renderMessage('assistant', chat.partial);
    options.hidden = phase !== 'choosing';
    options.replaceChildren();
    if (phase === 'choosing') {
      const heading = document.createElement('h2');
      heading.textContent = 'Mit welchem Modell soll Hermes antworten?';
      const list = document.createElement('div');
      list.className = 'jarvis-options-list';
      for (const item of chat.recommendations.options) {
        const choice = button('', 'jarvis-option', () => void act('model', { model: item.id }));
        const name = document.createElement('strong');
        name.textContent = item.label;
        const reason = document.createElement('small');
        reason.textContent = item.reason;
        choice.append(name, reason);
        list.append(choice);
      }
      options.append(heading, list);
    }
    feedback.textContent =
      {
        running: 'Hermes arbeitet …',
        choosing:
          chat?.recommendations?.source === 'local'
            ? workspace?.catalogInvalid
              ? 'Modellkonfiguration prüfen. Derzeit ist der Hermes-Standard verfügbar.'
              : workspace?.models < 3
                ? 'Für drei Vorschläge müssen weitere Hermes-Modelle hinterlegt sein.'
                : 'Vorschläge aus dem lokalen Modellkatalog.'
            : 'Vorschläge vom kostenlosen Modellberater.',
        interrupted: 'Die Antwort wurde unterbrochen.',
        stopped: 'SiteOps hat die Verbindung zu diesem Lauf beendet.'
      }[phase] || '';
    controls();
  }

  function renderMessage(role, content) {
    const row = document.createElement('article');
    row.className = 'jarvis-message';
    row.dataset.role = role;
    row.setAttribute('aria-label', role === 'user' ? 'Deine Nachricht' : 'Hermes-Antwort');
    row.textContent = content;
    messages.append(row);
  }

  function rememberChat() {
    const url = new URL(location.href);
    if (chat) url.searchParams.set('chat', chat.id);
    else url.searchParams.delete('chat');
    history.replaceState(null, '', url);
  }

  function updateChat(value) {
    const nearEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100;
    const newPhase = value.phase !== chat?.phase || value.id !== chat?.id;
    chat = value;
    project = value.project;
    if (value.messages.length) {
      workspace.chats = [
        { id: value.id, project: value.project, title: value.title, phase: value.phase },
        ...workspace.chats.filter(item => item.id !== value.id)
      ];
    }
    if (newPhase) renderNav();
    renderChat();
    if (nearEnd || newPhase) viewport.scrollTop = viewport.scrollHeight;
    if (value.phase === 'choosing' && newPhase) options.querySelector('button')?.focus({ preventScroll: true });
    schedulePoll();
  }

  function schedulePoll() {
    clearTimeout(poller);
    if (chat?.phase === 'running' && !document.hidden) poller = setTimeout(() => void poll(), 1300);
  }

  async function poll() {
    const current = chat;
    if (current?.phase !== 'running' || document.hidden) return;
    const request = loadedRequest;
    try {
      const value = await api('chats/' + current.id);
      if (request !== loadedRequest || chat !== current) return;
      if (value.phase !== current.phase || value.partial !== current.partial) updateChat(value);
    } catch (error) {
      if (request === loadedRequest && current === chat) feedback.textContent = error.message;
    } finally {
      if (request === loadedRequest) schedulePoll();
    }
  }

  function resetChat(target = project) {
    if (busy) return;
    loadedRequest++;
    chat = undefined;
    project = target;
    input.value = '';
    draftId = crypto.randomUUID();
    rememberChat();
    renderNav();
    renderChat();
    setNavigation(false);
    schedulePoll();
    if (!mobile.matches) input.focus();
  }

  async function openChat(id) {
    if (busy) return;
    const request = ++loadedRequest;
    try {
      const value = await api('chats/' + id);
      if (request !== loadedRequest) return;
      input.value = '';
      updateChat(value);
      rememberChat();
      setNavigation(false);
    } catch (error) {
      if (request === loadedRequest) feedback.textContent = error.message;
    }
  }

  async function act(action, data) {
    if (busy || !workspace) return;
    loadedRequest++;
    busy = true;
    controls();
    let submitted;
    try {
      if (!chat) {
        chat = await api('chats', { id: draftId, project });
        rememberChat();
      }
      submitted = chat;
      if (action === 'messages' && !chat.model) feedback.textContent = 'Passende Modelle werden gesucht …';
      const payload = action === 'messages' ? { ...data, revision: submitted.revision } : data;
      const value = await api('chats/' + chat.id + '/' + action, payload);
      if (action === 'messages') input.value = '';
      busy = false;
      updateChat(value);
      rememberChat();
    } catch (error) {
      const current = submitted && (await api('chats/' + submitted.id).catch(() => null));
      if (current && current.revision !== submitted.revision) {
        if (action === 'messages' && current.messages[submitted.messages.length]?.content === data.prompt)
          input.value = '';
        updateChat(current);
      } else {
        feedback.textContent = error.message;
        schedulePoll();
      }
    } finally {
      busy = false;
      controls();
    }
  }

  const status = find('status');
  async function checkStatus() {
    const labels = {
      online: 'Hermes verbunden',
      unconfigured: 'Hermes einrichten',
      misconfigured: 'Konfiguration prüfen',
      model_unavailable: 'Standardmodell fehlt',
      unavailable: 'Hermes nicht erreichbar'
    };
    const { state } = await api('status').catch(() => ({ state: 'unavailable' }));
    online = state === 'online';
    status.dataset.state = state;
    status.textContent = labels[state] || labels.unavailable;
    controls();
  }

  find('form').addEventListener('submit', event => {
    event.preventDefault();
    const prompt = input.value.trim();
    if (!send.disabled && prompt) void act('messages', { prompt });
  });
  input.addEventListener('input', controls);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !mobile.matches) {
      event.preventDefault();
      if (!send.disabled) find('form').requestSubmit();
    }
  });
  find('new').addEventListener('click', () => resetChat());
  find('stop').addEventListener('click', () => void act('stop', {}));
  find('retry').addEventListener('click', () => void act('retry', {}));
  menu.addEventListener('click', () => setNavigation(true));
  find('close').addEventListener('click', () => setNavigation(false));
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && root.hasAttribute('data-nav-open') && !dialog.open) setNavigation(false);
  });
  root.querySelectorAll('[data-prompt]').forEach(item =>
    item.addEventListener('click', () => {
      if (input.disabled) return;
      input.value = item.dataset.prompt;
      controls();
      input.focus();
    })
  );
  find('new-project').addEventListener('click', () => {
    find('project-name').value = '';
    find('project-error').textContent = '';
    dialog.showModal();
  });
  find('project-cancel').addEventListener('click', () => dialog.close());
  find('project-form').addEventListener('submit', async event => {
    event.preventDefault();
    const submitter = event.submitter || find('project-form').querySelector('[type=submit]');
    if (submitter.disabled) return;
    submitter.disabled = true;
    try {
      const created = await api('projects', { name: find('project-name').value });
      workspace.projects.push(created);
      workspace.projects.sort((a, b) => a.name.localeCompare(b.name, 'de'));
      dialog.close();
      resetChat(created.id);
    } catch (error) {
      find('project-error').textContent = error.message;
    } finally {
      submitter.disabled = false;
    }
  });

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Recognition) {
    const dictate = find('dictate');
    const recognition = new Recognition();
    recognition.lang = 'de-DE';
    dictate.hidden = false;
    recognition.onstart = () => dictate.setAttribute('aria-pressed', 'true');
    recognition.onend = () => dictate.setAttribute('aria-pressed', 'false');
    recognition.onerror = () => {
      feedback.textContent = 'Diktat nicht verfügbar. Du kannst die Nachricht eintippen.';
    };
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript && !input.disabled) {
        input.value = (input.value ? input.value + ' ' : '') + transcript;
        input.value = input.value.slice(0, input.maxLength);
        controls();
      }
    };
    dictate.addEventListener('click', () => {
      try {
        if (dictate.getAttribute('aria-pressed') === 'true') recognition.stop();
        else recognition.start();
      } catch {
        feedback.textContent = 'Diktat konnte nicht gestartet werden.';
      }
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    find('install').hidden = false;
  });
  find('install').addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    find('install').hidden = true;
    installPrompt = undefined;
  });

  async function enableNotifications() {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.register('/assets/jarvis-sw.js', { scope: '/jarvis' });
    if (!workspace?.pushPublicKey || !('PushManager' in window)) return;
    await navigator.serviceWorker.ready;
    const toggle = find('notify');
    const sync = active => {
      toggle.textContent = active ? 'Benachrichtigungen deaktivieren' : 'Benachrichtigungen aktivieren';
      toggle.hidden = false;
    };
    sync(Boolean(await registration.pushManager.getSubscription()));
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        const current = await registration.pushManager.getSubscription();
        if (current) {
          await api('push/remove', { endpoint: current.endpoint });
          await current.unsubscribe();
          sync(false);
        } else {
          if ((await Notification.requestPermission()) !== 'granted')
            throw new Error('Benachrichtigungen sind im Browser blockiert.');
          const key = workspace.pushPublicKey.replace(/-/g, '+').replace(/_/g, '/');
          const applicationServerKey = Uint8Array.from(atob(key), byte => byte.charCodeAt(0));
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey
          });
          try {
            await api('push', subscription.toJSON());
          } catch (error) {
            await subscription.unsubscribe();
            throw error;
          }
          sync(true);
        }
      } catch (error) {
        feedback.textContent = error.message;
      } finally {
        toggle.disabled = false;
      }
    });
  }

  void checkStatus();
  api('workspace')
    .then(async value => {
      workspace = value;
      renderNav();
      controls();
      const chatId = new URL(location.href).searchParams.get('chat');
      if (chatId && /^[a-f0-9-]{36}$/i.test(chatId)) await openChat(chatId);
      void enableNotifications().catch(() => {});
    })
    .catch(error => {
      feedback.textContent = error.message;
    });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    void poll();
    void checkStatus();
  });
})();
