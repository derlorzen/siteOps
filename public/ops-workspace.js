// Shared SiteOps workspace: modern navigation, websites portfolio and project assignment.
// Existing monitoring, backup, deployment, SEO, CMS and settings forms remain untouched.
(() => {
  'use strict';
  if (!document.body.classList.contains('ops-mode') && !document.body.classList.contains('crm-mode')) return;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const path=location.pathname;
  const main=$('#siteopsMain');
  if(!main)return;
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
    if(['/video-suite','/video-studio'].includes(current))return '/video-suite';
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
    if(!box){box=document.createElement('div');box.className='ops-toast';box.setAttribute('role','status');box.setAttribute('aria-live','polite');document.body.appendChild(box);}
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
  let projects=[],links=[],searchConsoleStatuses=[],searchConsoleAvailable=false;
  const searchConsoleStatus=site=>searchConsoleStatuses.find(item=>item.site_id===site.id);
  const assignment=site=>links.find(link=>link.site_id===site.id);
  function gscBadge(site){
    const state=searchConsoleStatus(site);
    const label=!searchConsoleAvailable?'Status unbekannt':state?.invalidated?'Zuordnung prüfen':state?.verified?'Bei Google bestätigt':state?.connected?'Verknüpft':'Noch nicht verbunden';
    return '<a href="/sites/'+encodeURIComponent(site.slug)+'/search-console">'+esc(label)+'</a>';
  }
  async function fetchRelations(){
    [projects,links]=await Promise.all([
      fetchJSON('/api/billing/projects'),fetchJSON('/api/site-projects')
    ]);
    try { searchConsoleStatuses=await fetchJSON('/api/search-console/overview'); searchConsoleAvailable=true; }
    catch (error) { searchConsoleStatuses=[]; searchConsoleAvailable=false; console.warn('Search Console status unavailable',error); }
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
        if(/^\/sites\/[^/]+$/.test(path))renderSiteAssignment(site);
      }catch(error){notice('Zuordnung fehlgeschlagen: '+error.message,true);}
      finally{btn.disabled=false;}
    });
    dlg.showModal();
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
    box.innerHTML='<div><strong>'+
      (link?'Teil des Kundenprojekts':'Eigenständige Website')+'</strong><p>'+
      (link?'<a href="/billing/projects/'+link.project_id+'">'+esc(link.customer_name)+' / '+esc(link.project_name)+'</a>':
      'Monitoring, SEO, Backups und Deployments werden unabhängig verwaltet.')+
      '</p><p>Google Search Console: '+gscBadge(site)+'</p></div><button type="button" class="ghost" id="opsSiteProjectEdit">Zuordnung ändern</button>';
    $('#opsSiteProjectEdit')?.addEventListener('click',()=>assignmentDialog(site));
  }
  function siteTabs(){
    const match=path.match(/^\/sites\/([^/]+)(?:\/(files|seo|search-console|tests|report))?$/);
    if(!match)return;
    const slug=match[1], sub=match[2]||'overview';
    const tabs=[['overview','Übersicht',''],['files','Dateien','/files'],['seo','SEO','/seo'],['search-console','Search Console','/search-console'],['tests','Browser-Tests','/tests'],['report','Bericht','/report']];
    const bar=document.createElement('nav');bar.className='ops-site-tabs';bar.setAttribute('aria-label','Website-Bereiche');
    bar.innerHTML=tabs.map(([key,label,tail])=>'<a href="/sites/'+esc(slug)+tail+'"'+
      (key===sub?' aria-current="page" class="is-active"':'')+'>'+label+'</a>').join('');
    $('.ops-main').insertBefore(bar,$('.ops-main').firstChild);
  }
  siteTabs();
  if(/^\/sites\/[^/]+$/.test(path)){
    void Promise.all([fetchRelations(),fetchJSON('/api/sites/'+decodeURIComponent(path.split('/')[2]))])
      .then(([,site])=>renderSiteAssignment(site))
      .catch(error=>notice('Projektzuordnung konnte nicht geladen werden: '+error.message,true));
  }
})();
