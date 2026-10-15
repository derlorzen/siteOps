// SiteOps CRM workspace — projects first, project board second, time directly on tasks.
// No UI framework or third-party browser dependencies.
(() => {
  'use strict';
  const root = document.getElementById('crmRoot');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const eur = cents => (Number(cents || 0)/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
  const day = value => String(value || '').slice(0,10);
  const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const hour = seconds => {
    const s = Math.max(0,Math.floor(Number(seconds)||0));
    return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');
  };
  const statusOrder = ['backlog','open','in_progress','review','done'];
  const statusName = {backlog:'Ideen',open:'Offen',in_progress:'In Arbeit',review:'Abnahme',done:'Erledigt'};
  const priorityName = {low:'Niedrig',normal:'Normal',high:'Hoch',urgent:'Dringend'};
  const state = {
    customers:[],projects:[],tasks:[],entries:[],invoices:[],sites:[],settings:{},
    board:null,boardLoading:false,boardError:'',projectId:'',token:0,saving:false,
    search:'',customerFilter:'',statusFilter:'all',view:'board',mobileColumn:'open',
    dialog:'',taskId:'',taskDetail:null,loading:true,recurring:[]
  };
  let noticeTimer = 0;
  const userError = error => error?.message || String(error);
  async function api(url, method = 'GET', payload) {
    const response = await fetch(url,{
      method,credentials:'same-origin',
      headers:payload === undefined ? {} : {'content-type':'application/json'},
      body:payload === undefined ? undefined : JSON.stringify(payload)
    });
    const content = await response.json().catch(()=>({}));
    if (!response.ok) throw Error(content.message || content.error || 'HTTP '+response.status);
    return content;
  }
  function notice(message, error=false) {
    const slot=$('crmNotice');
    if (!slot) return;
    slot.textContent=message;
    slot.classList.toggle('is-error',error);
    clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>{slot.textContent='';slot.classList.remove('is-error');},6500);
  }
  const findProject = id => state.projects.find(p=>p.id===id);
  const findCustomer = id => state.customers.find(c=>c.id===id);
  const findTask = id => state.tasks.find(t=>t.id===id);
  const projectTasks = id => state.tasks.filter(t=>t.project_id===id);
  const tracked = id => state.entries.filter(e=>projectTasks(id).some(t=>t.id===e.task_id))
    .reduce((n,e)=>n+Number(e.duration_seconds||0),0);
  function currentRoute() {
    const path=window.location.pathname.replace(/\/$/,'')||'/billing';
    const found=path.match(/^\/billing\/projects\/([a-f0-9-]{36})$/i);
    if(found)return {section:'project',id:found[1]};
    if(path==='/billing/customers')return {section:'customers'};
    if(path==='/billing/time')return {section:'time'};
    if(path==='/billing/invoices')return {section:'invoices'};
    if(path==='/billing/settings')return {section:'settings'};
    return {section:'projects'};
  }
  function navigation() {
    const active=currentRoute().section;
    const items=[
      ['projects','/billing','▦','Projekte'],
      ['customers','/billing/customers','◎','Kunden'],
      ['time','/billing/time','◷','Zeiten'],
      ['invoices','/billing/invoices','▤','Rechnungen'],
      ['settings','/billing/settings','⚙','Einstellungen']
    ];
    return items.map(([section,path,icon,label])=>'<a class="crm-nav-link'+
      ((section==='projects'&&active==='project')||active===section?' is-active':'')+
      '" href="'+path+'" data-route="'+path+'"'+
      ((section==='projects'&&active==='project')||active===section?' aria-current="page"':'')+
      '><span class="crm-nav-icon" aria-hidden="true">'+icon+'</span><span>'+label+'</span></a>').join('');
  }
  root.innerHTML=[
    '<div class="crm-app"><aside class="crm-sidebar"><div class="crm-brand"><span class="crm-brand-mark">S</span><div><strong>SiteOps</strong><small>Workspace</small></div></div>',
    '<nav class="crm-nav" aria-label="Kundenverwaltung">'+navigation()+'</nav>',
    '<p class="crm-nav-foot">Kunden <span aria-hidden="true">›</span> Projekte <span aria-hidden="true">›</span> Tasks</p></aside>',
    '<div class="crm-content"><header class="crm-topbar"><div class="crm-topbar-label"><span class="crm-topbar-mark">S</span><strong>Kunden-Workspace</strong></div>',
    '<div id="crmTopActions" class="crm-top-actions"></div></header>',
    '<div id="crmGlobalTimer" class="crm-global-timer" hidden></div>',
    '<div id="crmNotice" class="crm-notice" role="status" aria-live="polite"></div>',
    '<main id="crmMain" class="crm-main"><div class="crm-loading">Projekte werden geladen …</div></main>',
    '<dialog id="crmDialog" class="crm-dialog" aria-label="Bearbeiten"><div id="crmDialogContent"></div></dialog>',
    '</div></div>'
  ].join('');
  const dom = content => $('crmMain').innerHTML=content;
  const heading = (eyebrow,title,sub,actions='') =>
    '<div class="crm-heading"><div><span class="crm-kicker">'+eyebrow+'</span><h1>'+esc(title)+'</h1><p>'+esc(sub)+'</p></div>'+
    '<div class="crm-heading-actions">'+actions+'</div></div>';
  const button = (label,action,extra='',variant='') =>
    '<button type="button" class="crm-btn '+variant+'" data-action="'+action+'" '+extra+'>'+label+'</button>';
  const formVal = (form,name) => form.elements.namedItem(name)?.value || '';
  const field = (label,name,value='',opts='') =>
    '<label class="crm-field"><span>'+label+'</span><input name="'+name+'" value="'+esc(value)+'" '+opts+'></label>';
  const select = (name,items,value='',options='') =>
    '<select name="'+name+'" '+options+'>'+items.map(([key,label])=>'<option value="'+esc(key)+'"'+
    (String(key)===String(value)?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';
  const customerOptions = () => state.customers.map(c=>[c.id,c.name]);
  function badge(value,type='') {return '<span class="crm-badge '+type+'">'+esc(value)+'</span>';}
  const taskColor = priority => priority==='urgent'?'danger':priority==='high'?'warning':'';
  const isOverdue = t => t.due_date && day(t.due_date)<today() && t.status!=='done';
  const timer = () => state.entries.find(e=>e.started_at);
  function durationStarted(started) {
    const str=String(started);
    const parsed = started instanceof Date ? started : new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(str)?str:str.replace(' ','T')+'Z');
    return Math.max(0,Math.floor((Date.now()-parsed.getTime())/1000));
  }
  function updateTimer() {
    const running=timer(),target=$('crmGlobalTimer');
    if (!target) return;
    if(!running){target.hidden=true;target.innerHTML='';return;}
    target.hidden=false;
    if(target.dataset.entryId!==running.id){
      target.dataset.entryId=running.id;
      target.innerHTML='<span class="crm-live-dot"></span><div class="crm-timer-info"><strong>Zeiterfassung läuft</strong><small>'+
        esc(running.customer_name||'')+' · '+esc(running.task_name||'Task')+'</small></div>'+
        '<strong id="crmTimerClock" class="crm-clock">00:00:00</strong>'+
        button('Stoppen','stop-timer','','crm-btn-danger');
    }
    const clock=$('crmTimerClock');if(clock)clock.textContent=hour(durationStarted(running.started_at));
    root.querySelectorAll('[data-running-clock]').forEach(e=>{e.textContent=hour(durationStarted(running.started_at));});
  }
  async function reload() {
    const [customers,projects,tasks,entries,invoices,sites,settings]=await Promise.all([
      api('/api/billing/customers'),api('/api/billing/projects'),api('/api/billing/tasks'),
      api('/api/billing/entries'),api('/api/billing/invoices'),api('/api/sites'),api('/api/billing/settings')
    ]);
    Object.assign(state,{customers,projects,tasks,entries,invoices,sites,settings,loading:false});
    updateTimer();
    render();
  }
  async function reloadAfterChange(reloadBoard=false) {
    await reload();
    if(reloadBoard&&state.projectId)await loadBoard(state.projectId);
  }
  async function loadBoard(id) {
    const token=++state.token;
    state.projectId=id;state.board=null;state.boardError='';state.boardLoading=true;
    render();
    try {
      const [board,recurring]=await Promise.all([
        api('/api/billing/boards/'+encodeURIComponent(id)),
        api('/api/billing/projects/'+encodeURIComponent(id)+'/recurring').catch(()=>[])
      ]);
      if(token!==state.token)return;
      state.board=board;state.recurring=recurring;
    } catch(error){
      if(token!==state.token)return;
      state.boardError=userError(error);
    } finally {
      if(token===state.token){state.boardLoading=false;render();}
    }
  }
  function navigate(path) {
    if(window.location.pathname!==path)history.pushState({},'',path);
    render();
    const route=currentRoute();
    if(route.section==='project'&&route.id!==state.projectId)void loadBoard(route.id);
    window.scrollTo(0,0);
  }
  function render() {
    const route=currentRoute();
    root.querySelector('.crm-nav').innerHTML=navigation();
    $('crmTopActions').innerHTML=route.section==='project'
      ?'<a class="crm-btn crm-btn-ghost" href="/billing" data-route="/billing">← Alle Projekte</a>':'';
    if(state.loading){dom('<div class="crm-loading">Workspace wird geladen …</div>');return;}
    if(route.section==='project')dom(projectPage(route.id));
    else if(route.section==='projects')dom(projectListPage());
    else if(route.section==='customers')dom(customerPage());
    else if(route.section==='time')dom(timePage());
    else if(route.section==='invoices')dom(invoicePage());
    else dom(settingsPage());
    updateTimer();
  }
  function projectListPage() {
    const visible=state.projects.filter(p=>{
      const customer=findCustomer(p.customer_id);
      const phrase=(p.name+' '+(customer?.name||'')+' '+(p.description||'')).toLocaleLowerCase('de-DE');
      return phrase.includes(state.search.toLocaleLowerCase('de-DE')) &&
        (!state.customerFilter||p.customer_id===state.customerFilter) &&
        (state.statusFilter==='all'||p.status===state.statusFilter);
    });
    const cards=visible.map(p=>{
      const tasks=projectTasks(p.id),complete=tasks.filter(t=>t.status==='done').length;
      const progress=tasks.length?Math.round(complete/tasks.length*100):0;
      const active=tasks.filter(t=>t.status!=='done').length;
      const customer=findCustomer(p.customer_id);
      return '<a class="crm-project-card" href="/billing/projects/'+p.id+'" data-route="/billing/projects/'+p.id+'">'+
        '<div class="crm-project-card-head"><span class="crm-project-icon">'+esc(p.name.charAt(0).toUpperCase())+'</span>'+
        badge(p.status==='completed'?'Abgeschlossen':p.status==='paused'?'Pausiert':'Aktiv',p.status==='active'?'positive':'')+'</div>'+
        '<span class="crm-card-caption">'+esc(customer?.name||'Kunde')+'</span>'+
        '<h3>'+esc(p.name)+'</h3><p>'+esc(p.description||p.site_domain||'Aufgaben, Zeiten und Projektfortschritt verwalten.')+'</p>'+
        '<div class="crm-project-progress"><div class="crm-progress-caption"><span>'+complete+' von '+tasks.length+' erledigt</span><strong>'+progress+' %</strong></div>'+
        '<div class="crm-progress-track"><span style="width:'+progress+'%"></span></div></div>'+
        '<div class="crm-project-card-footer"><span>'+active+' offen</span><span>'+Math.round(tracked(p.id)/3600*10)/10+' Std.</span>'+
        '<strong>Öffnen →</strong></div></a>';
    }).join('');
    return heading('ARBEITSBEREICH','Alle Projekte',state.projects.length+' Projekte über alle Kunden hinweg.',
      button('+ Neues Projekt','new-project','','crm-btn-primary')+button('+ Kunde','new-customer','','crm-btn-ghost'))+
      '<div class="crm-summary-grid">'+[
        [state.projects.length,'Projekte'],[state.tasks.filter(t=>t.status!=='done').length,'Offene Tasks'],
        [state.tasks.filter(isOverdue).length,'Überfällig'],[Math.round(state.entries.reduce((s,e)=>s+Number(e.duration_seconds),0)/3600*10)/10+' h','Erfasste Zeit']
      ].map(([value,label])=>'<div class="crm-stat"><strong>'+value+'</strong><span>'+label+'</span></div>').join('')+'</div>'+
      '<div class="crm-filters"><label class="crm-search"><span>⌕</span><input type="search" id="crmProjectSearch" placeholder="Projekte oder Kunden suchen" value="'+esc(state.search)+'" autocomplete="off"></label>'+
      '<label class="crm-filter-label">Kunde '+select('crmCustomerFilter',[['','Alle Kunden'],...customerOptions()],state.customerFilter,'id="crmCustomerFilter"')+'</label>'+
      '<label class="crm-filter-label">Status '+select('crmStatusFilter',[['all','Alle'],['active','Aktiv'],['paused','Pausiert'],['completed','Abgeschlossen']],state.statusFilter,'id="crmStatusFilter"')+'</label></div>'+
      '<div id="crmProjectCards" class="crm-project-grid">'+(cards||'<div class="crm-empty"><h3>Keine passenden Projekte</h3><p>Filter anpassen oder ein neues Projekt anlegen.</p></div>')+'</div>';
  }
  function projectPage(id) {
    const project=findProject(id);
    if(!project)return heading('PROJEKT','Projekt nicht gefunden','Bitte zur Projektübersicht zurückkehren.')+
      '<a class="crm-btn" href="/billing" data-route="/billing">Alle Projekte</a>';
    const customer=findCustomer(project.customer_id);
    const taskList=projectTasks(id),complete=taskList.filter(t=>t.status==='done').length;
    const totalSeconds=tracked(id),progress=taskList.length?Math.round(100*complete/taskList.length):0;
    const stats='<div class="crm-project-stats"><div><strong>'+taskList.length+'</strong><span>Tasks</span></div>'+
      '<div><strong>'+complete+'</strong><span>Erledigt</span></div>'+
      '<div><strong>'+progress+' %</strong><span>Fortschritt</span></div>'+
      '<div><strong>'+Math.round(totalSeconds/3600*10)/10+' h</strong><span>Arbeitszeit</span></div></div>';
    const tabs='<div class="crm-view-tabs" role="group" aria-label="Projektansicht">'+
      '<button type="button" class="'+(state.view==='board'?'selected':'')+'" data-action="view-board">▦ Board</button>'+
      '<button type="button" class="'+(state.view==='list'?'selected':'')+'" data-action="view-list">☷ Liste</button></div>';
    const board=state.boardLoading?'<div class="crm-loading">Kanban wird geladen …</div>':
      state.boardError?'<div class="crm-empty is-error"><h3>Board konnte nicht geladen werden</h3><p>'+esc(state.boardError)+
      '</p>'+button('Erneut versuchen','retry-board','','crm-btn-primary')+'</div>':
      !state.board?'<div class="crm-loading">Board wird vorbereitet …</div>':state.view==='list'?listView():boardView();
    return '<div class="crm-breadcrumb"><a href="/billing" data-route="/billing">Projekte</a><span>›</span><span>'+esc(customer?.name||'')+'</span></div>'+
      heading('PROJEKT',project.name,customer?.name||'',
        button('+ Task','new-task','','crm-btn-primary')+button('Projekt bearbeiten','edit-project','','crm-btn-ghost'))+
      stats+'<div class="crm-project-toolbar"><div>'+tabs+'</div><div class="crm-project-tools">'+
      button('↻','retry-board','aria-label="Board neu laden"','crm-btn-ghost')+'</div></div>'+
      board+'<details class="crm-project-maintenance"><summary>Wartungsaufgaben & Vorlagen</summary>'+maintenanceView()+'</details>';
  }
  function statusOptions(value) {return select('status',statusOrder.map(s=>[s,statusName[s]]),value,'data-status-select');}
  function card(task) {
    const sec=Number(task.tracked_seconds||0),running=timer();
    const isRunning=running?.task_id===task.id;
    return '<article class="crm-task-card" draggable="true" data-task-id="'+esc(task.id)+'">'+
      '<div class="crm-card-top">'+badge(priorityName[task.priority]||'Normal',taskColor(task.priority))+
      (task.due_date?badge('◷ '+day(task.due_date),isOverdue(task)?'danger':''):'')+
      '</div><button type="button" class="crm-task-title" data-action="open-task" data-task-id="'+esc(task.id)+'">'+esc(task.name)+'</button>'+
      (task.description?'<p class="crm-task-excerpt">'+esc(task.description)+'</p>':'')+
      '<div class="crm-task-meta"><span>◷ '+Math.round(sec/3600*10)/10+' h erfasst</span>'+
      (isRunning?badge('● Läuft','positive'):'')+'</div>'+
      '<div class="crm-task-actions">'+
      '<label class="crm-task-status-label">Status '+statusOptions(task.status)+'</label>'+
      '<button type="button" class="crm-icon-action '+(isRunning?'recording':'')+'" data-action="task-timer" data-task-id="'+esc(task.id)+'" title="'+(isRunning?'Timer stoppen':'Timer starten')+'" aria-label="'+(isRunning?'Timer stoppen':'Timer starten')+'">'+(isRunning?'■':'▶')+'</button>'+
      '<button type="button" class="crm-icon-action" data-action="open-task" data-task-id="'+esc(task.id)+'" title="Task öffnen" aria-label="Task öffnen">↗</button>'+
      '</div></article>';
  }
  function boardView(){
    const columns=state.board?.columns||{};
    const mobile=state.mobileColumn;
    const tabs='<div class="crm-mobile-columns" aria-label="Kanban-Spalte">'+statusOrder.map(status=>
      '<button type="button" class="'+(mobile===status?'active':'')+'" data-action="column" data-column="'+status+'">'+statusName[status]+' <span>'+(columns[status]?.length||0)+'</span></button>'
    ).join('')+'</div>';
    return tabs+'<div class="crm-kanban">'+statusOrder.map(status=>{
      const tasks=columns[status]||[];
      return '<section class="crm-kanban-lane'+(mobile===status?' mobile-active':'')+'" data-lane="'+status+'">'+
        '<div class="crm-lane-heading"><h2>'+statusName[status]+'</h2><span>'+tasks.length+'</span>'+
        '<button type="button" data-action="new-task" data-status="'+status+'" title="Task in dieser Spalte erstellen" aria-label="Task in '+statusName[status]+' hinzufügen">+</button></div>'+
        '<div class="crm-lane-list">'+tasks.map(card).join('')+'</div></section>';
    }).join('')+'</div>';
  }
  function listView(){
    const tasks=statusOrder.flatMap(s=>state.board?.columns[s]||[]);
    return '<div class="crm-list">'+(tasks.map(t=>
      '<div class="crm-list-item"><button type="button" data-action="open-task" data-task-id="'+esc(t.id)+'"><strong>'+esc(t.name)+
      '</strong><small>'+statusName[t.status]+' · '+priorityName[t.priority]+'</small></button>'+
      (t.due_date?'<span>'+day(t.due_date)+'</span>':'')+
      '<button type="button" class="crm-icon-action" data-action="task-timer" data-task-id="'+esc(t.id)+'">▶ Zeit</button></div>'
    ).join('')||'<div class="crm-empty">Noch keine Tasks. Über + Task kannst du starten.</div>')+'</div>';
  }
  function maintenanceView(){
    return '<div class="crm-maintenance"><div><h3>Projektvorlagen</h3><p>Standardaufgaben für neue Websites oder Wartung erzeugen.</p>'+
      '<div class="crm-inline-row">'+select('template',[['website','Neue Website'],['maintenance','Website-Wartung']],'website','id="crmTemplateKey"')+
      button('Vorlage anwenden','apply-template','','crm-btn-ghost')+'</div></div>'+
      '<div><h3>Regelmäßige Tasks</h3><p>Automatisch neue Aufgaben im Projekt erstellen lassen.</p>'+
      '<form class="crm-stack" data-form="recurring">'+field('Aufgabe','task_name','','maxlength="255" required')+
      '<label class="crm-field"><span>Intervall</span>'+select('every_days',[[7,'Wöchentlich'],[30,'Alle 30 Tage'],[90,'Alle 90 Tage'],[365,'Jährlich']],30)+'</label>'+
      button('Wartung einrichten','submit-recurring','','crm-btn-primary')+'</form>'+
      '<div class="crm-rule-list">'+state.recurring.map(r=>
      '<div class="crm-rule"><span><strong>'+esc(r.task_name)+'</strong><small>Alle '+r.every_days+' Tage</small></span>'+
      button(r.enabled?'Pausieren':'Aktivieren','toggle-recurring','data-id="'+r.id+'" data-enabled="'+(r.enabled?'1':'0')+'"','crm-btn-ghost')+'</div>').join('')+'</div></div></div>';
  }

  function customerPage(){
    return heading('CRM','Kunden','Kontakte und Stammdaten pflegen. Projekte findest du im Arbeitsbereich.',
      button('+ Kunde','new-customer','','crm-btn-primary'))+
      '<div class="crm-customer-grid">'+state.customers.map(c=>{
        const projects=state.projects.filter(p=>p.customer_id===c.id);
        return '<section class="crm-customer-card"><div class="crm-customer-heading"><div class="crm-avatar">'+
          esc(c.name.slice(0,1).toUpperCase())+'</div><div><h3>'+esc(c.name)+'</h3><p>'+esc(c.contact_name||c.email||'')+'</p></div>'+
          button('Bearbeiten','edit-customer','data-id="'+c.id+'"','crm-btn-ghost')+'</div>'+
          '<div class="crm-customer-projects"><strong>'+projects.length+' Projekte</strong>'+
          projects.slice(0,7).map(p=>'<a data-route="/billing/projects/'+p.id+'" href="/billing/projects/'+p.id+'">'+esc(p.name)+' <span>→</span></a>').join('')+
          '</div>'+button('Neues Projekt','new-project','data-customer-id="'+c.id+'"','crm-btn-primary')+'</section>';
      }).join('')+'</div>';
  }
  function timePage(){
    const entries=state.entries;
    return heading('ZEITERFASSUNG','Meine Zeiten','Alle Zeitbuchungen und der aktuell laufende Timer.',
      button('+ Zeit erfassen','manual-time','','crm-btn-primary'))+
      '<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Datum</th><th>Kunde / Projekt</th><th>Task & Leistung</th><th>Dauer</th><th>Status</th><th></th></tr></thead><tbody>'+
      entries.map(e=>'<tr><td>'+day(e.entry_date)+'</td><td><strong>'+esc(e.customer_name)+'</strong><small>'+esc(e.project_name)+'</small></td>'+
        '<td>'+esc(e.task_name)+'<small>'+esc(e.description)+'</small></td><td>'+hour(e.duration_seconds)+
        (e.started_at?' <span class="crm-live-dot"></span>':'')+'</td><td>'+
        badge(e.invoice_id?'Abgerechnet':e.billable?'Abrechenbar':'Intern',e.invoice_id?'positive':'')+'</td><td>'+
        (!e.invoice_id&&!e.started_at?button('Bearbeiten','edit-time','data-id="'+e.id+'"','crm-btn-ghost'):'' )+
        (!e.invoice_id&&!e.started_at?button('✕','delete-time','data-id="'+e.id+'" aria-label="Eintrag löschen"','crm-btn-text'):'')+'</td></tr>').join('')+
      '</tbody></table></div>'+(entries.length?'':'<div class="crm-empty">Noch keine Zeitbuchungen.</div>');
  }
  function invoicePage(){
    const customerId=state.invoiceCustomer||state.customers[0]?.id||'';
    const from=state.invoiceFrom||today().slice(0,8)+'01';
    const to=state.invoiceTo||today();
    const available=state.entries.filter(e=>e.customer_id===customerId&&e.billable&&!e.invoice_id&&!e.started_at&&Number(e.duration_seconds)>0&&day(e.entry_date)>=from&&day(e.entry_date)<=to);
    const invoices=state.invoices.filter(i=>!state.invoiceCustomer||i.customer_id===state.invoiceCustomer);
    const options=customerOptions();
    return heading('ABRECHNUNG','Rechnungen','Zeitbuchungen abrechnen, versenden und Zahlungseingänge nachhalten.')+
      '<section class="crm-panel"><div class="crm-panel-head"><h2>Rechnung vorbereiten</h2><p>Wähle Kunde, Zeitraum und die abrechenbaren Zeiten aus.</p></div>'+
      '<div class="crm-form-cols"><label class="crm-field"><span>Kunde</span>'+select('customer_id',options,customerId,'id="crmInvoiceCustomer"')+'</label>'+
      field('Von','from',from,'id="crmInvoiceFrom" type="date"')+
      field('Bis','to',to,'id="crmInvoiceTo" type="date"')+'</div>'+
      '<div class="crm-invoice-candidates">'+(available.length?available.map(e=>
      '<label class="crm-candidate"><input type="checkbox" data-bill-entry="'+esc(e.id)+'" checked><span><strong>'+
        esc(e.task_name)+'</strong><small>'+day(e.entry_date)+' · '+hour(e.duration_seconds)+' · '+esc(e.description)+'</small></span>'+
        '<b>'+eur(Math.round(Number(e.duration_seconds)*Number(e.hourly_cents)/3600))+'</b></label>'
      ).join(''):'<p class="crm-muted">Keine offenen abrechenbaren Zeiten in diesem Zeitraum.</p>')+'</div>'+
      '<div class="crm-panel-foot"><span id="crmInvoiceDraftTotal">'+available.length+' Einträge</span>'+
      button('Entwurf erstellen','draft-invoice',available.length?'':'disabled','crm-btn-primary')+'</div></section>'+
      '<section class="crm-panel"><div class="crm-panel-head"><h2>Rechnungsübersicht</h2><p>Bereits ausgestellte Rechnungen bleiben unverändert archiviert.</p></div>'+
      '<div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>Rechnung</th><th>Kunde</th><th>Brutto</th><th>Status</th><th>Aktionen</th></tr></thead><tbody>'+
      invoices.map(i=>'<tr><td><strong>'+esc(i.invoice_number||'Entwurf')+'</strong><small>'+day(i.service_from)+' – '+day(i.service_to)+'</small></td>'+
      '<td>'+esc(i.customer_name)+'</td><td>'+eur(i.gross_cents)+'</td><td>'+
      badge({draft:'Entwurf',archiving:'Archivierung',issued:'Offen',paid:'Bezahlt',cancelled:'Storniert'}[i.status]||i.status,
        i.status==='paid'?'positive':i.status==='issued'?'warning':'')+'</td><td class="crm-actions">'+
      (['draft','archiving'].includes(i.status)?button(i.status==='archiving'?'Archivierung erneut versuchen':'Ausstellen','issue-invoice','data-id="'+i.id+'"','crm-btn-primary'):'')+
      (['issued','paid','cancelled'].includes(i.status)?'<a class="crm-btn crm-btn-ghost" href="/api/billing/invoices/'+i.id+'/pdf">PDF</a>':'')+
      (['issued','paid'].includes(i.status)?button('E-Mail','send-invoice','data-id="'+i.id+'"','crm-btn-ghost'):'')+
      (i.status==='issued'?button('Bezahlt','pay-invoice','data-id="'+i.id+'"','crm-btn-ghost'):'')+
      (i.status==='issued'&&day(i.due_at)<today()?button('Erinnern','remind-invoice','data-id="'+i.id+'"','crm-btn-ghost'):'')+
      (['issued','paid'].includes(i.status)?button('Storno','cancel-invoice','data-id="'+i.id+'"','crm-btn-text'):'')+
      (i.cancellation_status==='issued'?'<a class="crm-btn crm-btn-ghost" href="/api/billing/invoices/'+i.id+'/cancellation-pdf">Stornobeleg</a>':'')+
      (i.status==='draft'?button('Löschen','discard-invoice','data-id="'+i.id+'"','crm-btn-text'):'')+
      '</td></tr>').join('')+'</tbody></table></div></section>'+
      '<section class="crm-panel"><div class="crm-panel-head"><h2>Exporte</h2><p>Prüfbare Unterlagen für die Buchhaltung herunterladen.</p></div>'+
      '<div class="crm-inline-row">'+field('Jahr','year',String(new Date().getFullYear()),'type="number" min="2000" max="2100" id="crmExportYear"')+
      '<a id="crmExportDatev" class="crm-btn crm-btn-ghost" href="/api/billing/datev/'+new Date().getFullYear()+'.csv">DATEV-CSV</a>'+
      '<a id="crmExportArchive" class="crm-btn crm-btn-ghost" href="/api/billing/archive-manifest/'+new Date().getFullYear()+'">Archiv-Manifest</a></div>'+
      '<p class="crm-muted">DATEV-Datei vor der Übernahme prüfen. Das GitHub-Archiv ersetzt kein unveränderliches Langzeitarchiv.</p></section>';
  }
  function settingsPage(){
    const keys=[
      ['name','Firma / Name'],['street','Straße'],['postal_code','PLZ'],['city','Ort'],['email','E-Mail'],
      ['tax_id','Steuernummer'],['vat_id','USt-ID'],['iban','IBAN'],['bic','BIC'],['payment_note','Zahlungshinweise']
    ];
    return heading('VERWALTUNG','Rechnungseinstellungen','Absenderdaten, Bankverbindung und Rechnungsangaben.')+
      '<section class="crm-panel"><form data-form="settings"><div class="crm-form-cols">'+
      keys.map(([name,label])=>field(label,name,state.settings[name]||'','maxlength="500"')).join('')+
      '</div><div class="crm-form-footer"><button class="crm-btn crm-btn-primary">Einstellungen speichern</button></div></form></section>'+
      '<section class="crm-panel"><h2>Archivierung</h2><p>Ausgestellte Rechnungen werden in SiteOps und im GitHub-Rechnungsarchiv gespeichert. Für die langfristige revisionssichere Aufbewahrung wird ein zusätzliches externes Archiv benötigt.</p></section>';
  }
  function modal(html,kind){
    state.dialog=kind;
    $('crmDialogContent').innerHTML=html;
    const dialog=$('crmDialog');
    if(!dialog.open)dialog.showModal();
    dialog.querySelector('input:not([type=hidden]),select,textarea')?.focus();
  }
  function closeModal(){
    if($('crmDialog').open)$('crmDialog').close();
    state.dialog='';state.taskId='';state.taskDetail=null;
  }
  function modalFrame(title,sub,content,buttonText='Speichern'){
    return '<div class="crm-modal-top"><div><h2>'+esc(title)+'</h2><p>'+esc(sub||'')+'</p></div>'+
      button('×','close-modal','aria-label="Schließen"','crm-close')+'</div>'+
      '<div class="crm-modal-main">'+content+'</div>';
  }
  function customerModal(id=''){
    const c=findCustomer(id);
    modal(modalFrame(c?'Kunde bearbeiten':'Neuer Kunde','Kundenstammdaten für Projekte und Rechnungen.',
      '<form class="crm-stack" data-form="customer" data-id="'+esc(id)+'">'+
      field('Name / Firma','name',c?.name,'required maxlength="255"')+
      '<div class="crm-form-cols">'+field('Kontakt','contact_name',c?.contact_name)+
      field('E-Mail','email',c?.email,'type="email"')+
      field('Straße','street',c?.street)+field('PLZ','postal_code',c?.postal_code)+
      field('Ort','city',c?.city)+field('Stundensatz €','rate_eur',c?Number(c.default_hourly_cents)/100:75,'type="number" min="0" step=".01"')+
      '</div><button class="crm-btn crm-btn-primary">Kunde speichern</button></form>'
    ),'customer');
  }
  function projectModal(id='',customerPref=''){
    const p=findProject(id);
    const customerId=p?.customer_id||customerPref||state.customers[0]?.id||'';
    const sites=[['','Keine Website'],...state.sites.map(s=>[s.id,s.domain||s.name])];
    if(!state.customers.length){notice('Bitte zuerst einen Kunden anlegen.',true);customerModal();return;}
    modal(modalFrame(p?'Projekt bearbeiten':'Neues Projekt','Projekte gehören immer zu einem Kunden.',
      '<form class="crm-stack" data-form="project" data-id="'+esc(id)+'"><label class="crm-field"><span>Kunde</span>'+
      select('customer_id',customerOptions(),customerId,p?'disabled':'required')+'</label>'+
      field('Projektname','name',p?.name,'required maxlength="255"')+
      '<label class="crm-field"><span>Beschreibung</span><textarea name="description" rows="3" maxlength="5000">'+esc(p?.description||'')+'</textarea></label>'+
      '<div class="crm-form-cols"><label class="crm-field"><span>Überwachte Website (optional)</span>'+
      select('site_id',sites,p?.site_id||'')+'</label>'+
      field('Stundensatz € (optional)','rate_eur',p?.hourly_cents==null?'':Number(p.hourly_cents)/100,'type="number" min="0" step=".01"')+'</div>'+
      (p?'<label class="crm-field"><span>Projektstatus</span>'+select('project_status',[['active','Aktiv'],['paused','Pausiert'],['completed','Abgeschlossen']],p.status)+'</label>':'')+
      '<button class="crm-btn crm-btn-primary">Projekt speichern</button></form>'
    ),'project');
  }
  function taskModal(id='',status='open'){
    const t=findTask(id);
    const projectId=t?.project_id||currentRoute().id;
    if(!projectId){notice('Bitte zuerst ein Projekt öffnen.',true);return;}
    state.taskId=id;
    const running=timer();
    const isRunning=running?.task_id===id;
    const header=modalFrame(t?'Task bearbeiten':'Neuer Task',
      esc(findProject(projectId)?.name||'Projekt')+' · Status, Details und Zeit an einer Stelle.',
      '<form class="crm-stack" data-form="task" data-id="'+esc(id)+'" data-project-id="'+esc(projectId)+'">'+
      field('Titel','name',t?.name,'required maxlength="255"')+
      '<label class="crm-field"><span>Beschreibung</span><textarea name="description" rows="4" maxlength="3000">'+esc(t?.description||'')+'</textarea></label>'+
      '<div class="crm-form-cols"><label class="crm-field"><span>Status</span>'+statusOptions(t?.status||status)+'</label>'+
      '<label class="crm-field"><span>Priorität</span>'+
      select('priority',[['low','Niedrig'],['normal','Normal'],['high','Hoch'],['urgent','Dringend']],t?.priority||'normal')+'</label>'+
      field('Fällig am','due_date',day(t?.due_date),'type="date"')+
      field('Stundensatz € (optional)','rate_eur',t?.hourly_cents==null?'':Number(t.hourly_cents)/100,'type="number" step=".01" min="0"')+
      '</div><button class="crm-btn crm-btn-primary">Task speichern</button></form>'+
      (t?'<div class="crm-task-timebox"><div><strong>Zeit direkt am Task erfassen</strong><p>Erfasste Zeit bleibt mit dem Projekt und der Rechnung verknüpft.</p></div>'+
      button(isRunning?'■ Timer stoppen':'▶ Timer starten','task-timer','data-task-id="'+esc(id)+'"',isRunning?'crm-btn-danger':'crm-btn-primary')+
      '<form data-form="quick-time" class="crm-inline-time">'+
      field('Minuten','duration_minutes','','type="number" min="0.01" step="0.01" required')+
      field('Tätigkeit','description','','placeholder="Was wurde erledigt?" maxlength="1000"')+
      '<label class="crm-checkbox"><input type="checkbox" name="billable" checked> Abrechenbar</label>'+
      '<button class="crm-btn crm-btn-ghost">Zeit buchen</button></form></div>'+
      '<div class="crm-detail-extra" id="crmTaskDetailExtra"><p class="crm-muted">Details werden geladen …</p></div>':''));
    modal(header,'task');
    if(id)void loadTaskExtras(id);
  }
  async function loadTaskExtras(id){
    try {
      const details=await api('/api/billing/tasks/'+id+'/detail');
      if(state.dialog!=='task'||state.taskId!==id)return;
      state.taskDetail=details;
      const extra=$('crmTaskDetailExtra');
      if(!extra)return;
      extra.innerHTML=[
        '<section class="crm-detail-section"><h3>Checkliste <span>'+details.checklist.filter(x=>x.completed).length+'/'+details.checklist.length+'</span></h3>',
        details.checklist.map(x=>'<label class="crm-check-item"><input type="checkbox" data-action="toggle-check" data-id="'+x.id+'"'+(x.completed?' checked':'')+'><span>'+esc(x.text)+'</span>'+
          button('×','remove-check','data-id="'+x.id+'" aria-label="Eintrag entfernen"','crm-btn-text')+'</label>').join(''),
        '<form class="crm-inline-row" data-form="checklist">'+field('Neuer Punkt','text','','required maxlength="500" placeholder="Aufgabe ergänzen"')+
        '<button class="crm-btn crm-btn-ghost">Hinzufügen</button></form></section>',
        '<section class="crm-detail-section"><h3>Kommentare</h3>'+
        details.comments.map(c=>'<div class="crm-comment"><strong>'+esc(c.actor)+'</strong><small>'+esc(day(c.created_at))+'</small><p>'+esc(c.text)+'</p></div>').join('')+
        '<form data-form="comment" class="crm-stack"><label class="crm-field"><span>Kommentar</span><textarea name="text" maxlength="4000" rows="2" required></textarea></label>'+
        '<button class="crm-btn crm-btn-ghost">Kommentar hinzufügen</button></form></section>',
        '<section class="crm-detail-section"><h3>Anhänge</h3>'+
        details.files.map(f=>'<div class="crm-file"><a href="/api/billing/tasks/'+id+'/files/'+f.id+'">'+esc(f.filename)+'</a>'+
        button('×','remove-file','data-id="'+f.id+'"','crm-btn-text')+'</div>').join('')+
        '<form data-form="attachment" class="crm-inline-row"><input type="file" name="file" aria-label="Datei (maximal 2 MB)" required>'+
        '<button class="crm-btn crm-btn-ghost">Hochladen</button></form><small>Maximal 2 MB je Datei.</small></section>',
        '<section class="crm-detail-section"><h3>Aktivität</h3>'+
        details.events.map(e=>'<div class="crm-comment"><small>'+esc(day(e.created_at))+'</small><p>'+esc(e.details||e.event_type)+'</p></div>').join('')+
        '</section>'
      ].join('');
    } catch(error){
      if(state.dialog==='task'&&state.taskId===id){
        $('crmTaskDetailExtra').innerHTML='<p class="crm-error">Details konnten nicht geladen werden: '+esc(userError(error))+'</p>';
      }
    }
  }
  function manualTimeModal(entryId=''){
    const e=state.entries.find(x=>x.id===entryId);
    const taskOptions=state.tasks.map(t=>[t.id,(findProject(t.project_id)?.name||'Projekt')+' / '+t.name]);
    modal(modalFrame(e?'Zeit korrigieren':'Zeit erfassen','Arbeitszeit einem Task zuordnen.',
      '<form class="crm-stack" data-form="time" data-id="'+esc(entryId)+'">'+
      (e?'<p><strong>'+esc(e.task_name)+'</strong></p>':'<label class="crm-field"><span>Task</span>'+select('task_id',taskOptions,taskOptions[0]?.[0])+'</label>')+
      '<div class="crm-form-cols">'+field('Datum','entry_date',day(e?.entry_date)||today(),'type="date" required')+
      field('Dauer (Min.)','duration_minutes',e?Number(e.duration_seconds)/60:'','type="number" min="0.01" step="0.01" required')+'</div>'+
      field('Leistung','description',e?.description||'','maxlength="1000"')+
      '<label class="crm-checkbox"><input type="checkbox" name="billable" '+(e&&!e.billable?'':'checked')+'> Abrechenbar</label>'+
      '<button class="crm-btn crm-btn-primary">Zeit speichern</button></form>'),'time');
  }
