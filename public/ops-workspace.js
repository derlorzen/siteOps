// Shared SiteOps workspace: modern navigation, websites portfolio and project assignment.
// Existing monitoring, backup, deployment, SEO, CMS and settings forms remain untouched.
(() => {
  'use strict';
  if (!document.body.classList.contains('ops-mode')) return;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pages=[
    ['/','Übersicht','▦'],['/websites','Websites','◎'],['/billing','Projekte','▤'],
    ['/lorzcms','LorzCMS','◈'],['/setup','Website hinzufügen','+'],
    ['/settings','Einstellungen','⚙'],['/mcp-info','Integrationen','⇄']
  ];
  const path=location.pathname;
  const active=path.startsWith('/sites/')||path==='/websites'?'Websites':
    path.startsWith('/lorzcms')?'LorzCMS':path.startsWith('/billing')?'Projekte':
    path==='/setup'?'Website hinzufügen':path==='/settings'?'Einstellungen':
    path.startsWith('/mcp-info')?'Integrationen':'Übersicht';
  const currentPage=pages.find(([,title])=>title===active);
  const menu=pages.map(([href,label,icon])=>
    '<a href="'+href+'" class="ops-nav-item'+(label===active?' is-active':'')+
    '"'+(label===active?' aria-current="page"':'')+'><span aria-hidden="true" class="ops-nav-icon">'+icon+
    '</span><span>'+label+'</span></a>').join('');
  const layout=document.createElement('div');
  layout.className='ops-workspace';
  layout.innerHTML='<aside class="ops-sidebar"><div class="ops-identity"><span class="ops-mark">S</span>'+
    '<div><strong>SiteOps</strong><small>Workspace</small></div></div>'+
    '<nav class="ops-side-links" aria-label="SiteOps-Navigation">'+menu+'</nav>'+
    '<div class="ops-side-footer">Monitoring · Deployments · Kundenprojekte</div></aside>'+
    '<div class="ops-content"><div class="ops-workspace-bar"><div><span class="ops-mobile-mark">S</span>'+
    '<span>SiteOps</span><span class="ops-chevron">›</span><strong>'+esc(active)+'</strong></div>'+
    '<a href="/setup" class="ops-top-new">+ Website</a></div></div>';
  const oldNav=$('.topnav');
  const main=$('body > main');
  if(!main)return;
  document.body.insertBefore(layout,oldNav||main);
  oldNav?.remove();
  main.classList.add('ops-main');
  $('.ops-content').appendChild(main);

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
  let projects=[],links=[],sites=[];
  const assignment=site=>links.find(link=>link.site_id===site.id);
  async function fetchRelations(){
    [projects,links,sites]=await Promise.all([
      fetchJSON('/api/billing/projects'),fetchJSON('/api/site-projects'),fetchJSON('/api/sites')
    ]);
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
  function portfolioCard(site){
    const link=assignment(site),status=websiteStatus(site);
    const mode=site.deployment_mode==='hostinger_git'?'Git Deployment':(site.protocol||'Webspace').toUpperCase();
    return '<article class="ops-website-card">'+
      '<div class="ops-website-head"><span class="ops-website-logo">'+esc(site.name.slice(0,1).toUpperCase())+'</span>'+
      '<span class="ops-site-badge '+status[1]+'">'+status[0]+'</span></div>'+
      '<span class="ops-site-kicker">'+esc(link?.customer_name||'EIGENSTÄNDIGE WEBSITE')+'</span>'+
      '<h3><a href="/sites/'+encodeURIComponent(site.slug)+'">'+esc(site.name)+'</a></h3>'+
      '<p>'+esc(site.domain)+'</p><div class="ops-website-details">'+
      '<span>'+esc(mode)+'</span><span>'+esc(site.site_type||'Website')+'</span></div>'+
      '<div class="ops-website-association">'+
      (link?'<span>Projekt: <a href="/billing/projects/'+encodeURIComponent(link.project_id)+'">'+esc(link.project_name)+'</a></span>':
        '<span>Unabhängig verwaltet</span>')+'</div>'+
      '<div class="ops-website-actions"><a href="/sites/'+encodeURIComponent(site.slug)+'">Website öffnen →</a>'+
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
