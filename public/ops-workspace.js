// Shared SiteOps workspace: modern navigation, websites portfolio and project assignment.
// Existing monitoring, backup, deployment, SEO, CMS and settings forms remain untouched.
(() => {
  'use strict';
  if (!document.body.classList.contains('ops-mode') && !document.body.classList.contains('crm-mode')) return;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pages=[
    ['/','Übersicht','▦'],['/websites','Websites','◎'],['/tools','Tools','⌘'],
    ['/billing','Kunden & Projekte','▤'],
    ['/billing','Projekte','▤','Kunden & Projekte'],['/billing/customers','Kunden','◎','Kunden & Projekte'],
    ['/billing/time','Zeiterfassung','◷','Kunden & Projekte'],['/billing/invoices','Rechnungen','▧','Kunden & Projekte'],
    ['/billing/activity','Aktivitäten','◷','Kunden & Projekte'],['/billing/settings','Abrechnung','⚙','Kunden & Projekte'],
    ['/lorzcms','LorzCMS','◈'],['/video-suite','Video Suite','▶'],
    ['/video-suite#overview','Übersicht','○','Video Suite'],['/video-suite#ideas','Strategie & Ideen','01','Video Suite'],
    ['/video-suite#storyboard','Skript & Storyboard','02','Video Suite'],['/video-suite#editing','Schnitt & Dramaturgie','03','Video Suite'],
    ['/video-suite#script','Skript & Szenen','04','Video Suite'],['/video-suite#production','Full-HD-Produktion','05','Video Suite'],
    ['/video-suite#assets','SEO & Titelbild','06','Video Suite'],['/video-suite#review','Gesamtvorschau','07','Video Suite'],
    ['/video-suite#publish','Hochladen','08','Video Suite'],['/video-suite#repurpose','Shorts & Social Media','09','Video Suite'],
    ['/video-suite#settings','Suite-Einstellungen','⚙','Video Suite'],
    ['/mcp-info','Integrationen','⇄'],
    ['/mcp-info','Übersicht & MCP','⇄','Integrationen'],
    ['/hosting','Hosting & DNS','◎','Integrationen'],
    ['/coolify','Coolify & Supabase','◈','Integrationen'],
    ['/search-console','Google Search Console','◎','Integrationen'],
    ['/youtube','YouTube & Kanäle','▶','Integrationen'],
    ['/settings','Einstellungen','⚙'],
    ['/settings#system','System & Design','⚙','Einstellungen'],
    ['/settings#backups','GitHub & Backups','▤','Einstellungen'],
    ['/settings#defaults','Website-Standards','▤','Einstellungen'],
    ['/settings#alerts','Benachrichtigungen','◷','Einstellungen'],
    ['/settings#seo','SEO & Tests','◎','Einstellungen']
  ];
  const path=location.pathname;
  const suiteRoute = href => href.startsWith('/video-suite#') ? href.split('#')[1] : '';
  const link = ([href,label,icon,parent]) => '<a href="'+href+'" class="ops-nav-item'+(parent?' ops-nav-subitem':'')+'" data-workspace-href="'+href+'"'+
    (parent?' data-nav-parent="'+esc(parent)+'"':'')+(suiteRoute(href)?' data-suite-nav="'+suiteRoute(href)+'"':'')+
    '><span aria-hidden="true" class="ops-nav-icon">'+icon+'</span><span>'+esc(label)+'</span></a>';
  const menu=pages.filter(item=>!item[3]).map(item=>{
    const children=pages.filter(child=>child[3]===item[1]);
    if(!children.length)return link(item);
    return '<details class="siteops-nav-group" data-nav-group="'+esc(item[1])+'"><summary><span class="ops-nav-icon" aria-hidden="true">'+item[2]+'</span><span>'+esc(item[1])+'</span><span class="siteops-nav-chevron" aria-hidden="true">⌄</span></summary><div class="siteops-nav-children">'+children.map(link).join('')+'</div></details>';
  }).join('');
  const main=$('body > main');
  if(!main || $('.siteops-shell'))return;
  document.body.classList.add('siteops-workspace');
  const layout=document.createElement('div');
  layout.className='siteops-shell ops-workspace';
  layout.innerHTML='<a class="siteops-skip" href="#siteopsMain">Zum Inhalt springen</a>'+
    '<header class="siteops-topbar ops-workspace-bar"><button type="button" class="siteops-menu-toggle" aria-controls="siteopsSidebar" aria-expanded="false" aria-label="Hauptmenü öffnen"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>'+
    '<a class="siteops-brand" href="/"><span class="siteops-brand-mark">S</span><span>SiteOps<small>YOUR DIGITAL WORKSPACE</small></span></a>'+
    '<div class="siteops-breadcrumb"><span>Workspace</span><span aria-hidden="true">/</span><strong id="siteopsCurrentPage">Übersicht</strong></div>'+
    '<div class="ops-top-actions"><a href="/setup" class="ops-top-new">+ Website</a></div></header>'+
    '<aside class="siteops-sidebar ops-sidebar" id="siteopsSidebar"><span class="siteops-menu-label">WORKSPACE</span><nav class="ops-side-links" aria-label="SiteOps-Navigation">'+menu+'</nav>'+
    '<div class="ops-side-footer"><a href="/logout" class="siteops-logout">Abmelden ↗</a></div></aside>'+
    '<button type="button" class="siteops-nav-backdrop" aria-label="Hauptmenü schließen" hidden></button>'+
    '<div class="siteops-content ops-content"></div>';
  const oldNav=$('.topnav');
  document.body.insertBefore(layout,oldNav||main);oldNav?.remove();
  main.classList.add('ops-main');main.id='siteopsMain';main.tabIndex=-1;
  $('.siteops-content').appendChild(main);
  const sidebar=$('#siteopsSidebar'),toggle=$('.siteops-menu-toggle'),backdrop=$('.siteops-nav-backdrop');
  const mobile=window.matchMedia('(max-width: 900px)');
  function closeMenu(restore=false){
    document.body.classList.remove('siteops-nav-open');toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label','Hauptmenü öffnen');backdrop.hidden=true;
    sidebar.inert=mobile.matches;$('.siteops-content').inert=false;sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');
    if(restore)toggle.focus();
  }
  function openMenu(){
    document.body.classList.add('siteops-nav-open');toggle.setAttribute('aria-expanded','true');
    toggle.setAttribute('aria-label','Hauptmenü schließen');backdrop.hidden=false;sidebar.inert=false;$('.siteops-content').inert=true;
    sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');sidebar.setAttribute('aria-label','Hauptnavigation');
    sidebar.querySelector('[aria-current="page"],a,summary')?.focus();
  }
  toggle.addEventListener('click',()=>document.body.classList.contains('siteops-nav-open')?closeMenu(true):openMenu());
  backdrop.addEventListener('click',()=>closeMenu(true));
  mobile.addEventListener('change',()=>closeMenu());closeMenu();
  document.addEventListener('keydown',event=>{
    if(!document.body.classList.contains('siteops-nav-open'))return;
    if(event.key==='Escape'){event.preventDefault();closeMenu(true);}
    if(event.key==='Tab'){
      const nodes=[...sidebar.querySelectorAll('a,summary,button')].filter(el=>el.getClientRects().length);
      const first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  function currentHref(){
    const current=location.pathname;
    if(['/video-suite','/video-studio'].includes(current))return '/video-suite#'+(['overview','agent','ideas','storyboard','editing','script','production','assets','review','publish','repurpose','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'overview');
    if(current==='/youtube')return '/youtube';
    if(current==='/settings')return '/settings'+(['system','backups','defaults','alerts','seo'].includes(location.hash.slice(1))?location.hash:'#system');
    if(current.startsWith('/billing/projects'))return '/billing';
    if(current.startsWith('/sites/'))return '/websites';
    if(current.startsWith('/lorzcms'))return '/lorzcms';
    if(current.startsWith('/hosting'))return '/hosting';
    if(current==='/setup')return '/websites';
    return current;
  }
  function syncNavigation(){
    const href=currentHref();
    let selected;
    document.querySelectorAll('[data-workspace-href]').forEach(a=>{
      const active=a.dataset.workspaceHref===href;
      a.classList.toggle('is-active',active);
      if(active){a.setAttribute('aria-current','page');selected=a;}else a.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-nav-group]').forEach(group=>{
      const active=Boolean(group.querySelector('[aria-current="page"]'));
      group.classList.toggle('is-section-active',active);if(active)group.open=true;
    });
    const label=selected?.querySelector('span:last-child')?.textContent || 'Workspace';
    const parent=selected?.dataset.navParent;
    $('#siteopsCurrentPage').textContent=parent?parent+' / '+label:label;
    const video=href.startsWith('/video-suite')||href==='/youtube';
    const action=$('.ops-top-new');action.href=video?'/video-suite#ideas':'/setup';action.textContent=video?'+ Neues Video':'+ Website';
  }
  // Settings uses one established page; anchors expose its existing sections
  // without duplicating forms or creating conflicting configuration endpoints.
  if(path==='/settings'){
    const sectionIds = new Map([
      ['Design & Farben','system'],['GitHub','backups'],
      ['Standardwerte','defaults'],['Benachrichtigungen','alerts'],
      ['SEO-Audits','seo']
    ]);
    document.querySelectorAll('main h2').forEach(heading=>{
      const id=sectionIds.get(heading.textContent.trim());
      if(id){const section=heading.closest('section');if(section)section.id='settings-'+id;}
    });
    const scrollToSetting=()=>{
      const name=location.hash.slice(1);
      if(!name)return;
      document.getElementById('settings-'+name)?.scrollIntoView({block:'start'});
    };
    window.addEventListener('hashchange',scrollToSetting);
    if(location.hash)requestAnimationFrame(scrollToSetting);
  }
  sidebar.addEventListener('click',event=>{if(event.target.closest('a')&&mobile.matches){closeMenu();main.focus({preventScroll:true});}});
  window.addEventListener('hashchange',syncNavigation);window.addEventListener('popstate',syncNavigation);
  document.addEventListener('siteops:navigation',syncNavigation);syncNavigation();

  const notice=(msg,error=false)=>{
    let box=$('.ops-toast');
    if(!box){box=document.createElement('div');box.className='ops-toast';document.body.appendChild(box);}
    box.textContent=msg;
    box.classList.toggle('is-error',error);
    setTimeout(()=>{if(box.textContent===msg)box.textContent='';},5500);
  };
  const fetchJSON=async(url,method='GET',body)=>{
    const res=await fetch(url,{method,credentials:'same-origin',headers:body?{'content-type':'application/json'}:{},
      body:body?JSON.stringify(body):undefined});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(data.message||data.error||'HTTP '+res.status);
    return data;
  };
  let projects=[],links=[],sites=[],searchConsoleStatuses=[];
  const searchConsoleStatus=site=>searchConsoleStatuses.find(item=>item.site_id===site.id);
  const assignment=site=>links.find(link=>link.site_id===site.id);
  async function fetchRelations(){
    [projects,links,sites]=await Promise.all([
      fetchJSON('/api/billing/projects'),fetchJSON('/api/site-projects'),fetchJSON('/api/sites')
    ]);
    try { searchConsoleStatuses=await fetchJSON('/api/search-console/overview'); }
    catch (error) { searchConsoleStatuses=[]; console.warn('Search Console status unavailable',error); }
  }
  function assignmentDialog(site){
    const linked=assignment(site);
    const options=projects.map(project=>
      '<option value="'+esc(project.id)+'"'+(linked?.project_id===project.id?' selected':'')+'>'+
      esc(project.customer_name+' / '+project.name)+'</option>').join('');
    let dlg=$('#opsAssignmentDialog');
    if(!dlg){
      dlg=document.createElement('dialog');
      dlg.id='opsAssignmentDialog';dlg.className='ops-assignment-dialog';
      document.body.appendChild(dlg);
    }
    dlg.innerHTML='<form id="opsAssignmentForm" class="ops-assign-form"><div class="ops-assign-heading">'+
      '<div><strong>Website zuordnen</strong><p>'+esc(site.name)+' · '+esc(site.domain)+'</p></div>'+
      '<button type="button" data-ops-close aria-label="Schließen">×</button></div>'+
      '<label>Zuordnung<select name="project_id"><option value="">Eigenständige Website / kein Projekt</option>'+options+
      '</select></label><p>Eine Website gehört zu höchstens einem Kundenprojekt. Ein Projekt kann mehrere Websites enthalten.</p>'+
      '<div class="ops-assignment-actions"><button type="button" data-ops-close class="ghost">Abbrechen</button>'+
      '<button type="submit">Zuordnung speichern</button></div></form>';
    dlg.querySelectorAll('[data-ops-close]').forEach(b=>b.addEventListener('click',()=>dlg.close()));
    dlg.querySelector('form').addEventListener('submit',async event=>{
      event.preventDefault();
      const btn=dlg.querySelector('[type="submit"]');btn.disabled=true;
      try{
        const projectId=dlg.querySelector('select').value||null;
        await fetchJSON('/api/sites/'+encodeURIComponent(site.id)+'/project','PUT',{project_id:projectId});
        await fetchRelations();
        dlg.close();
        notice(projectId?'Website mit Projekt verknüpft.':'Website ist jetzt eigenständig.');
        if(path==='/'||path==='/websites')renderPortfolio();
        else if(/^\/sites\/[^/]+$/.test(path))renderSiteAssignment(site);
      }catch(error){notice('Zuordnung fehlgeschlagen: '+error.message,true);}
      finally{btn.disabled=false;}
    });
    dlg.showModal();
  }
  function websiteStatus(site){
    const row=[...document.querySelectorAll('#dashboardFocus tbody tr')].find(tr=>{
      const a=tr.querySelector('a[href^="/sites/"]');
      return a?.getAttribute('href')==='/sites/'+site.slug;
    });
    const pill=row?.querySelector('.pill');
    const label=pill?.textContent?.trim();
    if(label==='ONLINE')return ['Online','positive'];
    if(label==='ALARM')return ['Alarm','danger'];
    return [site.monitor_enabled?'Monitoring aktiv':'Monitoring aus','neutral'];
  }
  function gscBadge(site){
    const state=searchConsoleStatus(site);
    const name=state?.invalidated?'GSC · Zuordnung prüfen':state?.sitemap_submitted?'GSC · Sitemap eingereicht':state?.verified?'GSC · bestätigt':state?.connected?'GSC · verknüpft':'GSC · nicht verbunden';
    const tone=state?.invalidated?'danger':state?.verified?'positive':'neutral';
    return '<a class="ops-site-badge '+tone+'" href="/sites/'+encodeURIComponent(site.slug)+'/search-console" title="Google Search Console für diese Website verwalten">'+esc(name)+'</a>';
  }
  function portfolioCard(site){
    const link=assignment(site),status=websiteStatus(site);
    let publicUrl='';
    try{
      const url=new URL(/^https?:\/\//i.test(site.domain)?site.domain:'https://'+site.domain);
      if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)publicUrl=url.href;
    }catch{}
    const mode=site.deployment_mode==='hostinger_git'?'Git Deployment':(site.protocol||'Webspace').toUpperCase();
    return '<article class="ops-website-card">'+
      '<div class="ops-website-head"><span class="ops-website-logo">'+esc(site.name.slice(0,1).toUpperCase())+'</span>'+
      '<span class="ops-site-badge '+status[1]+'">'+status[0]+'</span></div>'+
      '<span class="ops-site-kicker">'+esc(link?.customer_name||'EIGENSTÄNDIGE WEBSITE')+'</span>'+
      '<h3><a href="/sites/'+encodeURIComponent(site.slug)+'">'+esc(site.name)+'</a></h3>'+
      '<p>'+(publicUrl?'<a href="'+esc(publicUrl)+'" target="_blank" rel="noopener noreferrer" title="Website in neuem Tab aufrufen">'+esc(site.domain)+' ↗</a>':esc(site.domain))+'</p><div class="ops-website-details">'+
      '<span>'+esc(mode)+'</span><span>'+esc(site.site_type||'Website')+'</span>'+gscBadge(site)+'</div>'+
      '<div class="ops-website-association">'+
      (link?'<span>Projekt: <a href="/billing/projects/'+encodeURIComponent(link.project_id)+'">'+esc(link.project_name)+'</a></span>':
        '<span>Unabhängig verwaltet</span>')+'</div>'+
      '<div class="ops-website-actions">'+
      (publicUrl?'<a href="'+esc(publicUrl)+'" target="_blank" rel="noopener noreferrer" aria-label="'+esc(site.name)+' in neuem Tab aufrufen">Seite aufrufen ↗</a>':'')+
      '<a href="/sites/'+encodeURIComponent(site.slug)+'">Verwalten →</a>'+
      '<button type="button" data-manage-site="'+esc(site.id)+'">Zuordnen</button></div></article>';
  }
  function renderPortfolio(){
    let node=$('#opsWebsitePortfolio');
    if(!node){
      node=document.createElement('section');node.id='opsWebsitePortfolio';node.className='ops-portfolio';
      const focus=$('#dashboardFocus');
      const main=$('.ops-main');
      if(focus)main.insertBefore(node,focus);
      else main.appendChild(node);
      const classic=$('#dashboardClassic');
      if(focus&&classic){
        const details=document.createElement('details');details.className='ops-advanced';
        details.innerHTML='<summary>Technische Details, Vorfälle und Änderungsverlauf anzeigen</summary>';
        main.insertBefore(details,focus);
        details.append(focus,classic);
      }
      const toggle=$('.view-toggle');if(toggle)toggle.classList.add('ops-legacy-toggle');
    }
    const unique=new Set(links.map(link=>link.site_id));
    node.innerHTML='<div class="ops-portfolio-head"><div><span class="eyebrow">Website-Portfolio</span>'+
      '<h2>Alle Websites</h2><p>Unabhängige Websites oder Websites innerhalb eines Kundenprojekts.</p></div>'+
      '<a class="ops-primary-action" href="/setup">+ Website hinzufügen</a></div>'+
      '<div class="ops-portfolio-stats">'+
      '<div><strong>'+sites.length+'</strong><span>Websites</span></div>'+
      '<div><strong>'+unique.size+'</strong><span>Mit Projekt</span></div>'+
      '<div><strong>'+(sites.length-unique.size)+'</strong><span>Eigenständig</span></div></div>'+
      '<div class="ops-website-grid">'+sites.map(portfolioCard).join('')+'</div>'+
      (!sites.length?'<div class="ops-empty">Noch keine Websites vorhanden.</div>':'');
    node.querySelectorAll('[data-manage-site]').forEach(button=>button.addEventListener('click',()=>{
      const site=sites.find(s=>s.id===button.dataset.manageSite);
      if(site)assignmentDialog(site);
    }));
  }
  function renderSiteAssignment(site){
    const link=assignment(site);
    let box=$('#opsSiteProject');
    if(!box){
      box=document.createElement('div');box.className='ops-site-project';box.id='opsSiteProject';
      const header=$('.ops-main > header');
      header?.insertAdjacentElement('afterend',box);
    }
    if(!box)return;
    box.innerHTML='<span class="ops-site-project-icon">▤</span><div><strong>'+
      (link?'Teil des Kundenprojekts':'Eigenständige Website')+'</strong><p>'+
      (link?'<a href="/billing/projects/'+link.project_id+'">'+esc(link.customer_name)+' / '+esc(link.project_name)+'</a>':
      'Monitoring, SEO, Backups und Deployments werden unabhängig verwaltet.')+
      '</p></div><button type="button" class="ghost" id="opsSiteProjectEdit">Zuordnung ändern</button>';
    $('#opsSiteProjectEdit')?.addEventListener('click',()=>assignmentDialog(site));
  }
  function siteTabs(){
    const match=path.match(/^\/sites\/([^/]+)(?:\/(seo|tests|report))?$/);
    if(!match)return;
    const slug=match[1], sub=match[2]||'overview';
    const tabs=[['overview','Übersicht',''],['seo','SEO','/seo'],['tests','Browser-Tests','/tests'],['report','Report','/report']];
    const bar=document.createElement('nav');bar.className='ops-site-tabs';bar.setAttribute('aria-label','Website-Bereiche');
    bar.innerHTML=tabs.map(([key,label,tail])=>'<a href="/sites/'+esc(slug)+tail+'"'+
      (key===sub?' aria-current="page" class="is-active"':'')+'>'+label+'</a>').join('');
    $('.ops-main').insertBefore(bar,$('.ops-main').firstChild);
  }
  siteTabs();
  if(path==='/'||path==='/websites'){
    void fetchRelations().then(renderPortfolio).catch(error=>notice('Website-Zuordnungen konnten nicht geladen werden: '+error.message,true));
  } else if(/^\/sites\/[^/]+$/.test(path)){
    void Promise.all([fetchRelations(),fetchJSON('/api/sites/'+decodeURIComponent(path.split('/')[2]))])
      .then(([,site])=>renderSiteAssignment(site))
      .catch(error=>notice('Projektzuordnung konnte nicht geladen werden: '+error.message,true));
  }
})();
