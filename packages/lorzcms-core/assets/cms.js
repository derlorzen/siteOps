function initRichEditors(root = document) {
root.querySelectorAll('[data-rich-editor]').forEach((source) => {
  if (source.dataset.initialized) return;
  source.dataset.initialized = '1';
  const wrapper = document.createElement('div');
  wrapper.className = 'rich-editor';
  const toolbar = document.createElement('div');
  toolbar.className = 'rich-toolbar';
  toolbar.setAttribute('aria-label', 'Text formatieren');
  const editor = document.createElement('div');
  editor.className = 'rich-surface';
  editor.contentEditable = 'true';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-multiline', 'true');
  editor.setAttribute('aria-label', source.getAttribute('aria-label') || 'Inhalt');
  editor.innerHTML = source.value; // The server has already sanitized stored content.
  const sync = () => { source.value = editor.innerHTML; };
  const commands = [['Fett', 'bold'], ['Kursiv', 'italic'], ['Liste', 'insertUnorderedList'], ['Absatz', 'formatBlock', 'p'], ['Überschrift', 'formatBlock', 'h2'], ['Untertitel', 'formatBlock', 'h3'], ['Link entfernen', 'unlink']];
  commands.forEach(([label, command, value]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label;
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => { editor.focus(); document.execCommand(command, false, value); sync(); });
    toolbar.append(button);
  });
  let range;
  const remember = () => { const selection = window.getSelection(); if (selection.rangeCount && editor.contains(selection.anchorNode)) range = selection.getRangeAt(0).cloneRange(); };
  editor.addEventListener('keyup', remember); editor.addEventListener('mouseup', remember);
  const link = document.createElement('input'); link.type = 'text'; link.placeholder = 'Link-Adresse'; link.setAttribute('aria-label', 'Link-Adresse');
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Link setzen';
  button.addEventListener('click', () => {
    const url = link.value.trim();
    if (!/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(url) || !range) return;
    editor.focus(); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.execCommand('createLink', false, url); sync(); link.value = '';
  });
  toolbar.append(link, button);
  const catalogNode=document.querySelector('[data-placeholder-catalog]');
  if(catalogNode){
    const catalog=JSON.parse(catalogNode.textContent);const select=document.createElement('select');select.setAttribute('aria-label','Modul auswählen');select.add(new Option('Modul auswählen',''));Object.entries(catalog.modules).forEach(([key,definition])=>select.add(new Option(definition.label,key)));
    const insert=document.createElement('button');insert.type='button';insert.textContent='Modul einfügen';
    const panel=document.createElement('div');panel.className='shortcode-panel';panel.hidden=true;
    insert.addEventListener('click',()=>{const definition=catalog.modules[select.value];if(!definition)return;panel.replaceChildren();panel.append(Object.assign(document.createElement('strong'),{textContent:definition.label}));const inputs={};
      Object.entries(definition.fields).forEach(([key,field])=>{const label=document.createElement('label');label.textContent=field.label;const input=document.createElement(field.kind==='select'?'select':'input');if(field.kind==='select')field.options.forEach(option=>input.add(new Option(option,option)));else input.type='text';input.value=field.default||'';label.append(input);panel.append(label);inputs[key]=input;});
      const confirm=document.createElement('button');confirm.type='button';confirm.textContent='Platzhalter einsetzen';confirm.addEventListener('click',()=>{const attrs=Object.entries(inputs).filter(([key,input])=>input.value!=='').map(([key,input])=>key+'="'+input.value.replaceAll('"','').replaceAll('[','').replaceAll(']','')+'"').join(' ');const token='['+select.value+(attrs?' '+attrs:'')+']';editor.focus();if(range){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}document.execCommand('insertHTML',false,'<p>'+token.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')+'</p><p><br></p>');sync();panel.hidden=true;editor.dispatchEvent(new Event('input',{bubbles:true}));});
      panel.append(confirm);panel.hidden=false;
    });
    toolbar.append(select,insert);wrapper.append(panel);
    const fields=document.createElement('select');fields.setAttribute('aria-label','Inhaltsplatzhalter auswählen');fields.add(new Option('Inhaltsplatzhalter',''));Object.entries(catalog.fields).forEach(([key,label])=>fields.add(new Option(label,key)));const addField=document.createElement('button');addField.type='button';addField.textContent='Feld einsetzen';addField.addEventListener('click',()=>{if(!fields.value)return;editor.focus();if(range){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}document.execCommand('insertText',false,'{{'+fields.value+'}}');sync();editor.dispatchEvent(new Event('input',{bubbles:true}));});toolbar.append(fields,addField);
  }
  editor.addEventListener('input', sync);
  editor.addEventListener('paste', (event) => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); sync(); });
  editor.addEventListener('drop', (event) => event.preventDefault());
  source.form.addEventListener('submit', sync);
  wrapper.prepend(toolbar); wrapper.append(editor); source.after(wrapper); source.hidden = true;
});
}
initRichEditors();

function initBlocks(root = document) {
  root.querySelectorAll('[data-collection="blocks"] [data-row]').forEach(row => {
    const kind = row.querySelector('select[name$="[kind]"]');
    if (!kind || kind.dataset.blockReady) return;
    kind.dataset.blockReady = '1';
    const update = () => row.querySelectorAll('.field').forEach(label => {
      const field = label.querySelector('[name]');
      const key = field?.name.match(/\[([^\]]+)\]$/)?.[1];
      label.hidden = (['image','alt'].includes(key) && kind.value !== 'image') || (['label','url'].includes(key) && kind.value !== 'cta');
    });
    kind.addEventListener('change', update); update();
  });
}
initBlocks();

function refreshParents(collection) {
  if (collection.dataset.collection !== 'values') return;
  const records = Array.from(collection.children).filter(el => el.matches('[data-row]'));
  records.forEach(row => {
    const parent = row.querySelector('select[name$="[parent]"]');
    if (!parent) return;
    const selected = parent.value;
    const ownId = row.querySelector('input[name$="[id]"]').value;
    parent.replaceChildren(new Option('Keine übergeordnete Zuordnung', ''));
    records.forEach(other => {
      const id = other.querySelector('input[name$="[id]"]')?.value;
      const label = other.querySelector('input[name$="[label]"], input[name$="[name]"]')?.value;
      if (id && id !== ownId) parent.add(new Option(label || 'Neuer Eintrag', id));
    });
    parent.value = selected;
  });
}
document.addEventListener('click', event => {
  const add = event.target.closest('[data-add-row]');
  if (add) {
    const key = add.dataset.addRow;
    const collection = Array.from(document.querySelectorAll('[data-collection]')).find(el => el.dataset.collection === key);
    const template = Array.from(document.querySelectorAll('template[data-collection-template]')).find(el => el.dataset.collectionTemplate === key);
    const fragment = template.content.cloneNode(true);
    const index = 'new' + crypto.randomUUID().replaceAll('-', '');
    fragment.querySelectorAll('[name]').forEach(field => { field.name = field.name.replaceAll('__INDEX__', index); if (field.value === '__ID__') field.value = crypto.randomUUID().replaceAll('-', ''); });
    collection.append(fragment); initRichEditors(collection); initBlocks(document); refreshParents(collection);
    collection.lastElementChild.querySelector('input:not([type=hidden]), select, textarea')?.focus();
    collection.dispatchEvent(new Event('input', {bubbles:true}));
  }
  const control = event.target.closest('[data-row-up], [data-row-down], [data-row-remove]');
  if (control) {
    const row = control.closest('[data-row]'); const collection = row.parentElement;
    if (control.hasAttribute('data-row-remove')) row.remove();
    else if (control.hasAttribute('data-row-up') && row.previousElementSibling) collection.insertBefore(row, row.previousElementSibling);
    else if (control.hasAttribute('data-row-down') && row.nextElementSibling) collection.insertBefore(row.nextElementSibling, row);
    refreshParents(collection); collection.dispatchEvent(new Event('input', {bubbles:true}));
  }
  const copy = event.target.closest('[data-copy-url]');
  if (copy) navigator.clipboard.writeText(copy.dataset.copyUrl).then(() => { copy.textContent = 'URL kopiert'; }).catch(() => { copy.textContent = 'URL unten markieren und kopieren'; });
});
document.querySelectorAll('[data-collection]').forEach(collection => {
  collection.addEventListener('input', event => {
    if (event.target.matches('input[name$="[label]"], input[name$="[name]"]')) refreshParents(collection);
    const row = event.target.closest('[data-row]'); const slug = row?.querySelector('input[name$="[slug]"]');
    if (slug && event.target.matches('input[name$="[name]"]') && (!slug.value || slug.value === slug.dataset.generated)) {
      const value = event.target.value.toLowerCase().replaceAll('ä','ae').replaceAll('ö','oe').replaceAll('ü','ue').replaceAll('ß','ss').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      slug.value = value; slug.dataset.generated = value;
    }
    const title = row?.querySelector('input[name$="[name]"], input[name$="[label]"], input[name$="[from]"]');
    const detail = row?.querySelector('input[name$="[slug]"], input[name$="[url]"], input[name$="[to]"]');
    if(row?.querySelector('[data-row-summary]')) row.querySelector('[data-row-summary]').textContent = title?.value || 'Neuer Eintrag';
    if(row?.querySelector('[data-row-detail]')) row.querySelector('[data-row-detail]').textContent = detail?.value || '';
  });
  collection.closest('form').addEventListener('submit', () => {
    Array.from(collection.children).filter(el => el.matches('[data-row]')).forEach((row,index) => row.querySelectorAll('[name]').forEach(field => {
      const prefix = collection.dataset.collection;
      if (field.name.startsWith(prefix + '[')) field.name = prefix + field.name.slice(prefix.length).replace(/^\[[^\]]+\]/, '[' + index + ']');
    }));
  });
});
document.addEventListener('invalid', event => {const details=event.target.closest('details[data-row]');if(details)details.open=true;},true);

document.querySelectorAll('[data-editor-form]').forEach(form => {
  const links = Array.from(form.querySelectorAll('.editor-tabs a'));
  const panels = Array.from(form.querySelectorAll('.editor-panel'));
  const activate = id => { if (!panels.some(p => p.id === id)) id = 'tab-content'; panels.forEach(p => {p.hidden = p.id !== id;}); links.forEach(a => {if(a.hash === '#' + id) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current');}); };
  links.forEach(a => a.addEventListener('click', event => { event.preventDefault(); activate(a.hash.slice(1)); history.replaceState(null, '', a.hash); }));
  const initial = new URLSearchParams(location.search).get('tab'); activate(initial ? 'tab-' + initial : location.hash.slice(1));
  form.addEventListener('invalid', event => { const panel = event.target.closest('.editor-panel'); if(panel) activate(panel.id); }, true);
  let dirty = false; const status = form.querySelector('[data-dirty-status]');
  form.addEventListener('input', () => {dirty = true; status.textContent = 'Ungespeicherte Änderungen';});
  form.addEventListener('submit', () => {dirty = false;});
  window.addEventListener('beforeunload', event => {if(dirty){event.preventDefault();event.returnValue='';}});
  const update = () => {
    const title = form.querySelector('[name=seo_title]').value || form.querySelector('[name=title]').value;
    const description = form.querySelector('[name=seo_description]').value;
    form.querySelector('[data-seo-preview-title]').textContent = title || 'Seitentitel';
    form.querySelector('[data-seo-preview-description]').textContent = description || 'Die globale Beschreibung wird verwendet.';
    form.querySelector('[data-seo-url]').textContent = form.querySelector('[name=path]').value || '/deine-seite/';
  };
  form.addEventListener('input', update); update();
});
