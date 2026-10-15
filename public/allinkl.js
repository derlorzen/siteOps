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
  const url=()=>'/api/hosting/allinkl/accounts/'+encodeURIComponent(state.accountId)+'/dns';
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
      if(['A','AAAA','CNAME','TXT'].includes(r.type) && r.id && !['@',state.zone,state.zone+'.'].includes(r.name)) {
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
        const del=document.createElement('button');del.textContent='Löschen';del.type='button';del.className='ghost';
        del.addEventListener('click',async ()=>{
          if(!confirm('DNS-Record '+r.name+' ('+r.type+') unwiderruflich löschen?'))return;
          try{
            await api(url()+'/'+encodeURIComponent(r.id)+'?zone='+encodeURIComponent(state.zone),{method:'DELETE'});
            await refresh();show('DNS-Eintrag entfernt.');
          }catch(error){show(error.message,true);}
        });td.append(del);
      }
      tr.append(td);tbody.append(tr);
    }
    table.append(tbody);records.replaceChildren(table);
    editor.hidden=false;
  }
  load?.addEventListener('submit',async event=>{
    event.preventDefault();
    const d=new FormData(load);state.accountId=d.get('accountId');state.zone=String(d.get('zone')).trim().replace(/\.$/,'').toLowerCase();
    if(!state.accountId)return;
    try{await refresh();show('DNS-Einstellungen geladen. Bestehende Einträge wurden nicht geändert.');}
    catch(error){show(error.message,true);}
  });
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
