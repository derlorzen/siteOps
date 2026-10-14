// SiteOps: Trello-like board for the selected customer's project.
// Desktop: drag & drop. Touch: drag by handle. Keyboard: status select + arrow buttons.
(() => {
  'use strict';

  const lanes = [
    ['backlog', 'Ideen'],
    ['open', 'Offen'],
    ['in_progress', 'In Arbeit'],
    ['review', 'Abnahme'],
    ['done', 'Erledigt']
  ];
  const statuses = lanes.map(([key]) => key);
  const priorities = { low: 'Niedrig', normal: 'Normal', high: 'Hoch', urgent: 'Dringend' };
  const state = { projectId: '', revision: 0, columns: {}, active: false, requestId: 0, saving: false };
  const element = id => document.getElementById(id);
  const escape = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const date = value => (value ? String(value).slice(0, 10) : '');
  const projectUrl = () => '/api/billing/boards/' + encodeURIComponent(state.projectId);
  const allTasks = () => statuses.flatMap(status => state.columns[status] || []);
  const statusText = status => lanes.find(([key]) => key === status)?.[1] || status;
  const show = msg => {
    element('kanbanHint').textContent = msg;
  };
  async function json(url, method = 'GET', body) {
    const response = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json();
    if (!response.ok) throw Error(payload.message || payload.error || 'HTTP ' + response.status);
    return payload;
  }
  function currentColumns() {
    return Object.fromEntries(
      statuses.map(status => [
        status,
        [...element('kanbanBoard').querySelectorAll('.kb-lane[data-status="' + status + '"] .kb-card')]
          .map(card => card.dataset.taskId)
      ])
    );
  }
  function findTask(taskId) {
    return allTasks().find(task => task.id === taskId);
  }
  function isDue(task) {
    return task.due_date && date(task.due_date) < new Date().toLocaleDateString('sv-SE') && task.status !== 'done';
  }
  function card(task) {
    const current = task.priority || 'normal';
    const options = lanes
      .map(([key, label]) => '<option value="' + key + '"' + (task.status === key ? ' selected' : '') + '>' + label + '</option>')
      .join('');
    const time = task.tracked_seconds > 0 ? Math.round(task.tracked_seconds / 60) + ' Min. erfasst' : 'Noch keine Zeit';
    return (
      '<article class="kb-card" data-task-id="' + escape(task.id) + '" draggable="true" tabindex="0" aria-label="' +
      escape(task.name) + '">' +
      '<div class="kb-card-head"><span class="kb-drag-handle" title="Zum Verschieben ziehen" aria-hidden="true">⋮⋮</span>' +
      '<span class="kb-priority kb-' + escape(current) + '">' + escape(priorities[current] || 'Normal') + '</span>' +
      '<button type="button" class="kb-edit" data-kanban-edit="' + escape(task.id) + '" aria-label="' + escape(task.name) + ' bearbeiten">⋯</button></div>' +
      '<strong class="kb-title">' + escape(task.name) + '</strong>' +
      (task.description ? '<p class="kb-description">' + escape(task.description) + '</p>' : '') +
      '<div class="kb-card-meta"><span>' + escape(time) + '</span>' +
      (task.due_date ? '<span class="' + (isDue(task) ? 'kb-overdue' : '') + '">Bis ' + escape(date(task.due_date)) + '</span>' : '') +
      '</div>' +
      '<div class="kb-card-workflow"><button type="button" class="ghost" data-workflow-detail="' + escape(task.id) + '">Details</button>' +
      '<button type="button" class="ghost" data-workflow-timer="' + escape(task.id) + '">Timer</button></div>' +
      '<div class="kb-card-controls"><label class="kb-status-label">Spalte<select data-kanban-status="' + escape(task.id) + '" aria-label="Status für ' + escape(task.name) + '">' +
      options + '</select></label>' +
      '<button type="button" class="kb-step" data-kanban-step="up" data-task="' + escape(task.id) + '" title="Eine Position nach oben" aria-label="Nach oben">↑</button>' +
      '<button type="button" class="kb-step" data-kanban-step="down" data-task="' + escape(task.id) + '" title="Eine Position nach unten" aria-label="Nach unten">↓</button></div>' +
      '</article>'
    );
  }
  function draw() {
    const projectId = state.projectId;
    element('kanbanReload').disabled = !projectId || state.saving;
    element('kanbanNew').disabled = !projectId || state.saving;
    const container = element('kanbanBoard');
    if (!projectId) {
      container.innerHTML = '';
      show('Wähle zuerst einen Kunden und ein Projekt aus.');
      return;
    }
    const count = allTasks().length;
    show(count + ' Tasks im ausgewählten Projekt · Ziehen zum Verschieben oder Status per Auswahl ändern.');
    container.innerHTML = lanes
      .map(([status, label]) => {
        const items = state.columns[status] || [];
        return (
          '<div class="kb-lane" data-status="' + status + '">' +
          '<div class="kb-lane-heading"><h3>' + label + '</h3><span class="kb-count">' + items.length + '</span>' +
          '<button type="button" class="kb-lane-add" data-kanban-add="' + status + '" title="Task in dieser Spalte anlegen" aria-label="Task in ' + label + ' anlegen">+</button></div>' +
          '<div class="kb-lane-cards">' + items.map(card).join('') + '</div>' +
          '</div>'
        );
      })
      .join('');
  }
  async function reload() {
    const projectId = state.projectId;
    const requestId = ++state.requestId;
    if (!projectId) {
      state.columns = {};
      state.revision = 0;
      draw();
      return;
    }
    try {
      const result = await json(projectUrl());
      if (state.projectId !== projectId || requestId !== state.requestId) return;
      state.columns = result.columns;
      state.revision = result.revision;
      draw();
    } catch (err) {
      if (state.projectId === projectId && requestId === state.requestId) show('Board konnte nicht geladen werden: ' + err.message);
    }
  }
  function setProject(projectId) {
    if (state.projectId === projectId) return;
    state.projectId = projectId || '';
    state.columns = {};
    state.revision = 0;
    if (!state.projectId) draw();
    else {
      show('Board wird geladen …');
      void reload();
    }
  }
  async function persist() {
    if (state.saving || !state.projectId) return;
    state.saving = true;
    const projectId = state.projectId;
    const columns = currentColumns();
    element('kanbanBoard').classList.add('kb-saving');
    try {
      const response = await json(projectUrl(), 'PUT', { revision: state.revision, columns });
      if (projectId !== state.projectId) return;
      state.revision = response.revision;
      state.columns = response.columns;
      draw();
      show('Reihenfolge gespeichert.');
    } catch (e) {
      show('Verschieben nicht gespeichert: ' + e.message + ' – Board wird neu geladen.');
      await reload();
    } finally {
      state.saving = false;
      element('kanbanBoard').classList.remove('kb-saving');
    }
  }
  function placeCard(dragged, target, pointerY) {
    if (!dragged || !target) return;
    const lane = target.closest('.kb-lane');
    if (!lane) return;
    const list = lane.querySelector('.kb-lane-cards');
    const above = target.closest('.kb-card');
    if (above && above !== dragged) {
      const before = pointerY < above.getBoundingClientRect().top + above.offsetHeight / 2;
      list.insertBefore(dragged, before ? above : above.nextSibling);
    } else if (!above) {
      list.appendChild(dragged);
    }
  }
  function openDialog(taskId, status = 'open') {
    if (!state.projectId || state.saving) return;
    const task = taskId ? findTask(taskId) : null;
    const form = element('kanbanForm');
    form.reset();
    form.dataset.taskId = task?.id || '';
    form.elements.namedItem('name').value = task?.name || '';
    form.elements.namedItem('description').value = task?.description || '';
    form.elements.namedItem('due_date').value = date(task?.due_date);
    form.elements.namedItem('priority').value = task?.priority || 'normal';
    form.elements.namedItem('status').value = task?.status || status;
    form.elements.namedItem('rate_eur').value =
      task?.hourly_cents == null ? '' : (Number(task.hourly_cents) / 100).toFixed(2);
    element('kanbanDialogTitle').textContent = task ? 'Task bearbeiten' : 'Neuer Task';
    element('kanbanDialog').showModal();
    form.elements.namedItem('name').focus();
  }
  function install() {
    const board = element('kanbanBoard');
    let draggedId = '';
    board.addEventListener('dragstart', event => {
      const el = event.target.closest('.kb-card');
      if (!el || state.saving) return event.preventDefault();
      draggedId = el.dataset.taskId;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedId);
      el.classList.add('kb-dragging');
    });
    board.addEventListener('dragend', () => {
      draggedId = '';
      board.querySelectorAll('.kb-dragging').forEach(x => x.classList.remove('kb-dragging'));
    });
    board.addEventListener('dragover', event => {
      if (!draggedId || !event.target.closest('.kb-lane') || state.saving) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    board.addEventListener('drop', event => {
      if (!draggedId || state.saving) return;
      event.preventDefault();
      const dragged = board.querySelector('.kb-card[data-task-id="' + draggedId + '"]');
      placeCard(dragged, event.target, event.clientY);
      draggedId = '';
      void persist();
    });

    // Browsers on touch devices often do not implement HTML drag/drop.
    let touch = null;
    board.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || state.saving || !event.target.closest('.kb-drag-handle')) return;
      const source = event.target.closest('.kb-card');
      if (!source) return;
      touch = { source, x: event.clientX, y: event.clientY, moved: false, projectId: state.projectId };
      event.preventDefault();
    });
    window.addEventListener('pointermove', event => {
      if (!touch) return;
      if (touch.projectId !== state.projectId) { touch = null; return; }
      if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8) touch.moved = true;
      if (!touch.moved) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (target && board.contains(target)) placeCard(touch.source, target, event.clientY);
      touch.source.classList.add('kb-touch-drag');
    }, { passive: false });
    window.addEventListener('pointerup', () => {
      if (!touch) return;
      const moved = touch.moved;
      touch.source.classList.remove('kb-touch-drag');
      touch = null;
      if (moved) void persist();
    });
    window.addEventListener('pointercancel', () => {
      if (!touch) return;
      touch.source.classList.remove('kb-touch-drag');
      touch = null;
      void reload();
    });
    board.addEventListener('click', event => {
      const edit = event.target.closest('[data-kanban-edit]');
      const add = event.target.closest('[data-kanban-add]');
      const step = event.target.closest('[data-kanban-step]');
      if (edit) openDialog(edit.dataset.kanbanEdit);
      if (add) openDialog('', add.dataset.kanbanAdd);
      if (step && !state.saving) {
        const el = board.querySelector('.kb-card[data-task-id="' + step.dataset.task + '"]');
        if (!el) return;
        const list = el.parentElement;
        if (step.dataset.kanbanStep === 'up' && el.previousElementSibling)
          list.insertBefore(el, el.previousElementSibling);
        if (step.dataset.kanbanStep === 'down' && el.nextElementSibling)
          list.insertBefore(el.nextElementSibling, el);
        void persist();
      }
    });
    board.addEventListener('change', event => {
      const input = event.target.closest('[data-kanban-status]');
      if (!input || state.saving) return;
      const el = board.querySelector('.kb-card[data-task-id="' + input.dataset.kanbanStatus + '"]');
      const lane = board.querySelector('.kb-lane[data-status="' + input.value + '"] .kb-lane-cards');
      if (!el || !lane) return;
      lane.appendChild(el);
      void persist();
    });
    element('kanbanReload').addEventListener('click', () => void reload());
    element('kanbanNew').addEventListener('click', () => openDialog(''));
    element('kanbanCancel').addEventListener('click', () => element('kanbanDialog').close());
    element('kanbanForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const name = form.elements.namedItem('name').value.trim();
      if (!name || !state.projectId || state.saving) return;
      const taskId = form.dataset.taskId;
      const rate = form.elements.namedItem('rate_eur').value;
      const payload = {
        name,
        description: form.elements.namedItem('description').value,
        due_date: form.elements.namedItem('due_date').value || null,
        priority: form.elements.namedItem('priority').value,
        status: form.elements.namedItem('status').value,
        hourly_cents: rate === '' ? null : Math.round(Number(rate) * 100)
      };
      form.querySelector('[type="submit"]').disabled = true;
      try {
        if (taskId) {
          await json('/api/billing/tasks/' + encodeURIComponent(taskId), 'PATCH', payload);
        } else {
          await json('/api/billing/tasks', 'POST', { ...payload, project_id: state.projectId });
        }
        element('kanbanDialog').close();
        if (typeof window.SiteOpsBillingRefresh === 'function') await window.SiteOpsBillingRefresh();
        else await reload();
        show('Task gespeichert.');
      } catch (err) {
        element('kanbanDialogError').textContent = err.message;
      } finally {
        form.querySelector('[type="submit"]').disabled = false;
      }
    });
    element('kanbanDialog').addEventListener('close', () => {
      element('kanbanDialogError').textContent = '';
    });
  }
  window.SiteOpsKanban = { setProject, reload };
  install();
})();
