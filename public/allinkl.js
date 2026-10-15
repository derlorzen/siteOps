(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const notice = $('allinklNotice');
  if (!notice) return;
  const state = {accountId:null,zone:null,records:[]};
  const show = (message,error=false) => {
    notice.hidden=false;
    notice.textContent=message;
    notice.style.color=error?'#b91c1c':'inherit';
    notice.scrollIntoView({block:'nearest',behavior:'smooth'});
  };
  async function api(url,opts={}) {
    const res=await fetch(url,{
      credentials:'same-origin',...opts,
      headers:{...(opts.body?{'content-type':'application/json'}:{}),...opts.headers}
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.message||data.error||'HTTP '+res.status);
    return data;
  }
  const add=$('allinklAddAccount');
  add?.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=add.querySelector('[type=submit]');button.disabled=true;
    try{
      const body=Object.fromEntries(new FormData(add));
      await api('/api/hosting/allinkl/accounts',{method:'POST',body:JSON.stringify(body)});
      window.location.reload();
    }catch(error){show(error.message,true);}finally{button.disabled=false;}
  });
  document.querySelectorAll('[data-allinkl-remove]').forEach(button=>button.addEventListener('click',async ()=>{
    if(!confirm('Nur diesen gespeicherten ALL-INKL-Zugang entfernen? Websites und DNS bleiben erhalten.'))return;
    button.disabled=true;
    try{
      await api('/api/hosting/allinkl/accounts/'+encodeURIComponent(button.dataset.allinklRemove),{method:'DELETE'});
      window.location.reload();
    }catch(error){show(error.message,true);button.disabled=false;}
  }));
  const load=$('allinklDnsLoad');
  const records=$('allinklDnsRecords');
  const editor=$('allinklDnsAdd');
  const accountSelect=$('allinklAccountSelect');
  const domainSelect=$('allinklDomainSelect');
  const domainStatus=$('allinklDomainStatus');
  const domainList=$('allinklDomainList');
  const loadButton=$('allinklDnsLoadButton');
  const refreshDomainsButton=$('allinklDomainRefresh');
  const checkButton=$('allinklConnectionCheck');
  let domainRequest=0;
  const url=()=>'/api/hosting/allinkl/accounts/'+encodeURIComponent(state.accountId)+'/dns';
  const baseUrl=()=>'/api/hosting/allinkl/accounts/'+encodeURIComponent(accountSelect.value);
  async function fetchDomains() {
    const request=++domainRequest;
    records.replaceChildren();
    editor.hidden=true;
    domainSelect.replaceChildren(new Option('Lade Domains …',''));
    domainSelect.disabled=true;
    loadButton.disabled=true;
    domainList.replaceChildren();
    refreshDomainsButton.disabled=!accountSelect.value;
    checkButton.disabled=!accountSelect.value;
    state.accountId=null;
    state.zone=null;
    if(!accountSelect.value) {
      domainSelect.replaceChildren(new Option('Zuerst Hosting-Konto auswählen',''));
      domainStatus.textContent='Bitte das ALL-INKL-Konto auswählen.';
      return;
    }
    domainStatus.textContent='Lade Domains direkt von ALL-INKL …';
    try {
      const data=await api(baseUrl()+'/domains');
      if(request!==domainRequest)return;
      if(!Array.isArray(data))throw new Error('KAS hat keine Domainliste geliefert.');
      const names=[...new Set(data.map(row=>
        typeof row==='string'?row:row?.domain_name??row?.domain??row?.hostname
      ).filter(name=>typeof name==='string' && name.length>0)
        .map(name=>name.trim().replace(/\.$/,'').toLowerCase()))].sort();
      domainSelect.replaceChildren(new Option(names.length?'Domain wählen …':'Keine Domains in diesem KAS-Konto',''));
      for(const name of names) {
        domainSelect.add(new Option(name,name));
        const button=document.createElement('button');
        button.type='button';
        button.className='ghost';
        button.textContent=name;
        button.addEventListener('click',()=>{
          domainSelect.value=name;
          load.requestSubmit();
        });
        domainList.append(button);
      }
      domainSelect.disabled=!names.length;
      domainStatus.textContent=names.length+
        (names.length===1?' Domain':' Domains')+' im ALL-INKL-Konto gefunden. Domain auswählen, um DNS zu laden.';
    } catch(error) {
      if(request!==domainRequest)return;
      domainSelect.replaceChildren(new Option('Domains konnten nicht geladen werden',''));
      domainStatus.textContent='Domainabruf fehlgeschlagen: '+String(error.message||error);
      show(domainStatus.textContent,true);
    }
  }
  domainSelect?.addEventListener('change',()=>{
    state.zone=null;
    editor.hidden=true;
    records.replaceChildren();
    loadButton.disabled=!domainSelect.value;
  });
  accountSelect?.addEventListener('change',()=>{void fetchDomains();});
  refreshDomainsButton?.addEventListener('click',()=>{void fetchDomains();});
  checkButton?.addEventListener('click',async ()=>{
    const button=checkButton;
    button.disabled=true;
    domainStatus.textContent='Prüfe Domains, Subdomains und DNS ausschließlich lesend …';
    try {
      const zone=domainSelect.value;
      const result=await api(baseUrl()+'/diagnostics'+(zone?'?zone='+encodeURIComponent(zone):''));
      const parts=[result.domainCount+' Domains'];
      parts.push(result.subdomainsOk?result.subdomainCount+' Subdomains':'Subdomains: '+result.subdomainsError);
      if(zone)parts.push(result.dnsOk?result.dnsRecordCount+' DNS-Einträge für '+zone:
        'DNS für '+zone+': '+result.dnsError);
      domainStatus.textContent='API-Prüfung: '+parts.join(' · ');
    } catch(error) {
      domainStatus.textContent='API-Prüfung fehlgeschlagen: '+String(error.message||error);
      show(domainStatus.textContent,true);
    } finally {button.disabled=!accountSelect.value;}
  });
  async function refresh() {
    state.records=await api(url()+'?zone='+encodeURIComponent(state.zone));
    const table=document.createElement('table');
    const thead=document.createElement('thead');thead.innerHTML='<tr><th>Typ</th><th>Name</th><th>Wert</th><th>Prio</th><th>Aktion</th></tr>';
    table.append(thead);
    const tbody=document.createElement('tbody');
    for(const r of state.records) {
      const tr=document.createElement('tr');
      for(const value of [r.type,r.name,r.value,r.priority]) {
        const td=document.createElement('td');td.textContent=String(value??'');tr.append(td);
      }
      const td=document.createElement('td');
      if(['A','AAAA','CNAME','TXT'].includes(r.type) && r.id && !['@','',state.zone,state.zone+'.'].includes(r.name)) {
        if(r.changeable!==false) {
        const edit=document.createElement('button');edit.textContent='Ändern';edit.type='button';edit.className='ghost';
        edit.addEventListener('click',async ()=>{
          const newValue=prompt('Neuer Wert für '+r.name+' ('+r.type+'):',r.value);
          if(newValue===null || newValue===r.value)return;
          if(!confirm('DNS-Record '+r.name+' tatsächlich ändern?'))return;
          try{
            await api(url()+'/'+encodeURIComponent(r.id),{method:'PUT',body:JSON.stringify({
              zone:state.zone,type:r.type,name:r.name,value:newValue,priority:r.priority
            })});
            await refresh();show('DNS-Eintrag aktualisiert.');
          }catch(error){show(error.message,true);}
        });
        td.append(edit);
        }
        if(r.deleteable!==false) {
        const del=document.createElement('button');del.textContent='Löschen';del.type='button';del.className='ghost';
        del.addEventListener('click',async ()=>{
          if(!confirm('DNS-Record '+r.name+' ('+r.type+') unwiderruflich löschen?'))return;
          try{
            await api(url()+'/'+encodeURIComponent(r.id)+'?zone='+encodeURIComponent(state.zone),{method:'DELETE'});
            await refresh();show('DNS-Eintrag entfernt.');
          }catch(error){show(error.message,true);}
        });td.append(del);
        }
      }
      tr.append(td);tbody.append(tr);
    }
    table.append(tbody);records.replaceChildren(table);
    editor.hidden=false;
  }
  load?.addEventListener('submit',async event=>{
    event.preventDefault();
    const d=new FormData(load);
    state.accountId=String(d.get('accountId')||'');
    state.zone=String(d.get('zone')||'').trim().replace(/\.$/,'').toLowerCase();
    if(!state.accountId || !state.zone)return;
    loadButton.disabled=true;
    domainStatus.textContent='Lade DNS-Einträge für '+state.zone+' …';
    try{
      await refresh();
      domainStatus.textContent=state.records.length+' DNS-Einträge für '+state.zone+' geladen.';
    }catch(error) {
      editor.hidden=true;
      domainStatus.textContent='DNS-Abruf fehlgeschlagen: '+String(error.message||error);
      show(domainStatus.textContent,true);
    }finally{loadButton.disabled=!domainSelect.value;}
  });
  if(accountSelect?.options.length===2) {
    accountSelect.selectedIndex=1;
    void fetchDomains();
  }
  editor?.addEventListener('submit',async event=>{
    event.preventDefault();
    const body={...Object.fromEntries(new FormData(editor)),zone:state.zone};
    const button=editor.querySelector('[type=submit]');button.disabled=true;
    try{
      await api(url(),{method:'POST',body:JSON.stringify(body)});
      await refresh();show('DNS-Eintrag erstellt.');
    }catch(error){show(error.message,true);}finally{button.disabled=false;}
  });
})();
