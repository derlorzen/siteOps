(() => {
  let control;
  let images = [];
  const dialog = document.createElement('dialog');
  dialog.className = 'image-picker-dialog';
  dialog.setAttribute('aria-label', 'Mitarbeiterfoto auswählen');
  dialog.innerHTML = '<div class="image-picker-heading"><h2>Mitarbeiterfoto auswählen</h2><button type="button" class="secondary" data-close-picker>Schließen</button></div><label class="field">Fotos suchen<input type="search" data-image-search placeholder="Name oder Dateiname"></label><label class="field">Neues Foto hochladen (JPG, PNG, WebP; bis 10 MB)<input type="file" accept="image/jpeg,image/png,image/webp" data-image-upload></label><p role="status" data-picker-status></p><div class="image-picker-grid"></div>';
  document.body.append(dialog);
  const status = dialog.querySelector('[data-picker-status]');
  const search = dialog.querySelector('[data-image-search]');
  const grid = dialog.querySelector('.image-picker-grid');
  const apply = url => {
    const input = control.querySelector('[data-image-url]');
    input.value = url;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const preview = control.querySelector('.image-field-preview');
    preview.src = url;
    preview.hidden = !url;
  };
  const render = () => {
    grid.replaceChildren();
    const query = search.value.toLocaleLowerCase('de');
    const matches = images.filter(image => image.name.toLocaleLowerCase('de').includes(query));
    matches.forEach(image => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'image-picker-option';
      const preview = document.createElement('img');
      preview.src = image.url;
      preview.alt = '';
      preview.loading = 'lazy';
      const label = document.createElement('span');
      label.textContent = image.name;
      button.append(preview, label);
      button.addEventListener('click', () => { apply(image.url); dialog.close(); });
      grid.append(button);
    });
    status.textContent = matches.length ? matches.length + ' Fotos gefunden. Die Auswahl wird beim Speichern des Inhalts übernommen.' : 'Keine Fotos gefunden. Sie können ein neues Foto hochladen.';
  };
  document.addEventListener('click', async event => {
    const opener = event.target.closest('[data-open-image-picker]');
    const clearer = event.target.closest('[data-clear-image]');
    if (clearer) { control = clearer.closest('[data-image-control]'); apply(''); return; }
    if (!opener) return;
    control = opener.closest('[data-image-control]');
    search.value = '';
    dialog.showModal();
    search.focus();
    status.textContent = 'Fotos werden geladen …';
    try {
      const response = await fetch('/admin/media-picker/', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Die Mediathek konnte nicht geladen werden. Bitte Zugriffsrechte prüfen.');
      images = (await response.json()).images;
      render();
    } catch (error) { status.textContent = error.message; }
  });
  dialog.querySelector('[data-close-picker]').addEventListener('click', () => dialog.close());
  search.addEventListener('input', render);
  dialog.querySelector('[data-image-upload]').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { status.textContent = 'Das Foto ist größer als 10 MB.'; return; }
    const uploadControl = control;
    const payload = new FormData();
    payload.set('file', file);
    payload.set('csrf', document.querySelector('input[name="csrf"]').value);
    event.target.disabled = true;
    status.textContent = 'Foto wird hochgeladen …';
    try {
      const response = await fetch('/admin/media-picker/', { method: 'POST', credentials: 'same-origin', body: payload });
      if (!response.ok) throw new Error('Hochladen fehlgeschlagen. Bitte Dateiformat, Größe und Zugriffsrechte prüfen.');
      const image = await response.json();
      images.unshift(image);
      if (dialog.open && control === uploadControl) {
        apply(image.url);
        dialog.close();
      }
    } catch (error) { status.textContent = error.message; }
    finally { event.target.disabled = false; event.target.value = ''; }
  });
})();
