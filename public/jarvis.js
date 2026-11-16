(() => {
  const root = document.getElementById('jarvis');
  if (!root) return;

  const find = id => document.getElementById('jarvis-' + id);
  const status = find('status');
  const form = find('form');
  const input = find('input');
  const send = find('send');
  const stop = find('stop');
  const newChat = find('new');
  const feedback = find('feedback');
  const messages = find('messages');
  const viewport = find('conversation');
  const empty = find('empty');
  const encoder = new TextEncoder();
  let history = [];
  let controller;
  let online = false;

  function updateControls() {
    send.disabled = !online || !!controller || !input.value.trim();
    stop.hidden = !controller;
    send.hidden = !!controller;
    newChat.disabled = !!controller || !messages.childElementCount;
  }

  async function checkStatus() {
    const labels = {
      online: 'Hermes verbunden',
      unconfigured: 'Hermes noch nicht eingerichtet',
      misconfigured: 'Hermes-Konfiguration prüfen',
      model_unavailable: 'Hermes-Modell nicht verfügbar',
      unavailable: 'Hermes nicht erreichbar'
    };
    let state = 'unavailable';
    try {
      const response = await fetch('/api/jarvis/status', { cache: 'no-store' });
      if (response.ok) state = (await response.json()).state;
    } catch {
      // Keep the offline status if SiteOps or the network is unavailable.
    }
    online = state === 'online';
    status.dataset.state = state;
    status.lastChild.textContent = labels[state] || labels.unavailable;
    updateControls();
  }

  function appendMessage(role, text) {
    const row = document.createElement('article');
    row.className = 'jarvis-message';
    row.dataset.role = role;
    const label = document.createElement('strong');
    label.textContent = role === 'user' ? 'Du' : 'Jarvis';
    const content = document.createElement('div');
    content.textContent = text;
    row.append(label, content);
    messages.append(row);
    return content;
  }

  async function readAnswer(body, onDelta) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (!frame.startsWith('data: ')) continue;
        const event = JSON.parse(frame.slice(6));
        if (event.error) throw new Error(event.error);
        if (event.done) return;
        if (event.delta) onDelta(event.delta);
      }
    }
    throw new Error('Die Verbindung wurde unterbrochen. Du kannst deine Nachricht erneut senden.');
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const prompt = input.value.trim();
    if (!prompt || controller || !online) return;

    controller = new AbortController();
    input.value = '';
    empty.hidden = true;
    feedback.textContent = 'Hermes antwortet …';
    appendMessage('user', prompt);
    const answer = appendMessage('assistant', '');
    updateControls();

    const recent = [...history.slice(-38), { role: 'user', content: prompt }];
    let body = JSON.stringify({ messages: recent });
    while (encoder.encode(body).byteLength > 180 * 1024 && recent.length > 1) {
      recent.splice(0, 2);
      body = JSON.stringify({ messages: recent });
    }
    viewport.scrollTop = viewport.scrollHeight;
    const answerText = document.createTextNode('');
    answer.append(answerText);
    try {
      const response = await fetch('/api/jarvis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(response.status === 401 ? 'Melde dich erneut in SiteOps an.' : detail.message || 'Die Anfrage ist fehlgeschlagen.');
      }
      await readAnswer(response.body, delta => {
        const follow = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 70;
        answerText.appendData(delta);
        if (follow) viewport.scrollTop = viewport.scrollHeight;
      });
      const content = answerText.data.trim();
      if (!content) throw new Error('Hermes hat keine Textantwort geliefert.');
      history = [...recent, { role: 'assistant', content: Array.from(content).slice(0, 16_000).join('') }];
      feedback.textContent = 'Antwort fertig.';
    } catch (error) {
      if (!answerText.data) answer.closest('article').remove();
      feedback.textContent = error.name === 'AbortError' ? 'Anzeige gestoppt. Hermes kann die Anfrage weiterverarbeiten.' : error.message;
      if (!input.value) input.value = prompt;
    } finally {
      controller = undefined;
      updateControls();
    }
  });

  input.addEventListener('input', updateControls);
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    if (!send.disabled) form.requestSubmit();
  });
  stop.addEventListener('click', () => controller?.abort());
  newChat.addEventListener('click', () => {
    history = [];
    messages.replaceChildren();
    feedback.textContent = '';
    input.value = '';
    empty.hidden = false;
    updateControls();
    input.focus();
  });
  root.querySelectorAll('[data-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      input.value = button.dataset.prompt;
      updateControls();
      input.focus();
    });
  });

  function drawCore(canvas) {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const dpi = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpi);
    canvas.height = Math.round(height * dpi);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpi, dpi);
    const x = width / 2;
    const y = height * 0.48;
    const radius = Math.min(width * 0.29, height * 0.36);
    const glow = ctx.createRadialGradient(x, y, 1, x, y, radius * 1.35);
    glow.addColorStop(0, '#ffcc8d');
    glow.addColorStop(0.09, '#ed9b534d');
    glow.addColorStop(0.65, '#a15e2821');
    glow.addColorStop(1, '#8f522100');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const nodes = Array.from({ length: 106 }, (_, i) => {
      const depth = 1 - (i / 105) * 2;
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const ring = radius * Math.sqrt(1 - depth * depth);
      const a = Math.cos(angle) * ring;
      const b = Math.sin(angle) * ring;
      return { x: x + a * 0.89 + depth * radius * 0.3, y: y + b, depth };
    });
    ctx.strokeStyle = '#e9b47c32';
    for (const tilt of [-0.41, 0.54]) {
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 1.39, radius * 0.43, tilt, 0, 2 * Math.PI);
      ctx.stroke();
    }
    for (const [index, node] of nodes.entries()) {
      for (const next of nodes.slice(index + 1)) {
        const distance = Math.hypot(node.x - next.x, node.y - next.y);
        if (distance < radius * 0.24 && Math.abs(node.depth - next.depth) < 0.33) {
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
        }
      }
      ctx.fillStyle = index % 5 === 0 ? '#ffd8ad' : '#ba9f848f';
      ctx.fillRect(node.x, node.y, index % 5 === 0 ? 2.2 : 1.2, index % 5 === 0 ? 2.2 : 1.2);
    }
  }

  const canvas = find('orb');
  new ResizeObserver(() => drawCore(canvas)).observe(canvas);
  void checkStatus();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkStatus();
  });
})();
