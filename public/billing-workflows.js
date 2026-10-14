// Task collaboration, recurring maintenance and invoice exports.
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  if (!el('billingRoot')) return;
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api = async (url,method='GET',body) => {
    const r=await fetch(url,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw Error(data.message||data.error||'HTTP '+r.status);
    return data;
  };
  const show=(text,err=false)=>{el('billingWorkflowMessage').textContent=text;el('billingWorkflowMessage').classList.toggle('kb-error',err);};
  const context=()=>window.SiteOpsBillingContext?.()||{};
  let activeTask='';
  el('kanbanSection').insertAdjacentHTML('afterend',[
    '<section class="kb-workflow-panel"><div class="kb-toolbar"><div><h2>Vorlagen & Wartung</h2><p>Standardaufgaben und regelmäßige Arbeiten für das ausgewählte Projekt.</p></div></div>',
    '<p id="billingWorkflowMessage" role="status"></p><div class="kb-workflow-split"><div>',
    '<h3>Projektvorlage</h3><div class="buttonrow"><select id="billingTemplate"><option value="website">Neue Website (6 Tasks)</option><option value="maintenance">Wartung (4 Tasks)</option></select><button type="button" id="billingApplyTemplate">Vorlage anlegen</button></div>',
    '<h3>Wiederkehrende Wartungsaufgabe</h3><form id="billingRecurringForm" class="inner-form"><label>Task-Titel<input name="task_name" maxlength="255" required></label><label>Intervall<select name="every_days"><option value="7">7 Tage</option><option value="30">30 Tage</option><option value="90">90 Tage</option><option value="365">365 Tage</option></select></label><label>Beschreibung<input name="description" maxlength="3000"></label><button>Wartungsregel speichern</button></form><div id="billingRecurringList" class="kb-workflow-list"></div>',
    '</div></div></section>',
    '<dialog id="billingTaskDetail" class="kb-dialog kb-detail-dialog"><div class="kb-detail-content"><div class="kb-toolbar"><h2 id="billingDetailTitle">Task</h2><button id="billingDetailClose" class="ghost" type="button">Schließen</button></div><p id="billingTaskContext"></p><div class="kb-workflow-split"><div>',
    '<h3>Checkliste</h3><div id="billingChecklist"></div><form id="billingChecklistForm" class="kb-row-form"><input name="text" maxlength="500" placeholder="Neuer Checklistenpunkt" required><button>+</button></form>',
    '<h3>Verlauf</h3><div id="billingActivity" class="kb-workflow-list"></div>',
    '<h3>Kommentare</h3><form id="billingCommentForm" class="inner-form"><textarea name="text" maxlength="4000" rows="3" required placeholder="Arbeitsschritt dokumentieren"></textarea><button>Kommentar speichern</button></form><div id="billingComments" class="kb-workflow-list"></div></div><div>',
    '<h3>Zeit erfassen</h3><form id="billingQuickTime" class="inner-form"><label>Minuten<input name="duration_minutes" type="number" min=".01" step=".01" required></label><label>Beschreibung<input name="description" maxlength="1000"></label><label class="check"><input name="billable" type="checkbox" checked>Abrechenbar</label><button>Zeit buchen</button></form>',
    '<h3>Anhänge (max. 2 MB je Datei)</h3><form id="billingFileForm" class="inner-form"><input type="file" name="file" required><button>Datei anhängen</button></form><div id="billingFiles" class="kb-workflow-list"></div>',
    '</div></div></div></dialog>'
  ].join(''));
  // Dialog is shared with the overview, so it must not live inside a hidden board page.
  el('billingModalHost').appendChild(el('billingTaskDetail'));
  el('billingInvoices').closest('section').insertAdjacentHTML('beforeend',[
    '<div class="kb-finance-panel"><h3>Export & Langzeitarchivierung</h3><p>Rechnungsversand über den SiteOps-SMTP-Server; DATEV-Vorbereitung (SKR03) ist vor Import fachlich zu prüfen.</p>',
    '<div class="buttonrow"><label>Jahr<input id="billingFinanceYear" type="number" min="2000" max="2100"></label>',
    '<a id="billingDatevLink" class="btn ghost">DATEV-CSV</a><a id="billingArchiveLink" class="btn ghost">Archiv-Manifest JSON</a></div>',
    '<p>Das Archiv-Manifest enthält Prüfsummen und Git-Referenzen. Es ersetzt kein separat abgesichertes WORM-Archiv.</p></div>'
  ].join(''));

  async function reloadDue(){
    try {
      const items=await api('/api/billing/due');
      el('billingDueList').innerHTML=items.length?items.map(t=>
        '<button type="button" class="kb-workflow-item" data-workflow-detail="'+esc(t.id)+'"><strong>'+esc(t.name)+'</strong><small>'+esc(t.customer_name)+' / '+esc(t.project_name)+' · '+esc(String(t.due_date).slice(0,10))+'</small></button>'
      ).join(''):'<p>Keine Fälligkeiten innerhalb der nächsten sieben Tage.</p>';
    } catch(e){show(e.message,true);}
  }
  async function reloadRules(){
    const id=context().project_id;
    if(!id){el('billingRecurringList').textContent='Projekt auswählen.';return;}
    try{
      const rules=await api('/api/billing/projects/'+id+'/recurring');
      if(context().project_id!==id)return;
      el('billingRecurringList').innerHTML=rules.length?rules.map(r=>
        '<div class="kb-workflow-item"><strong>'+esc(r.task_name)+'</strong><small>Alle '+Number(r.every_days)+' Tage · nächster Termin '+esc(String(r.next_run_at).slice(0,10))+'</small>'+
        '<button type="button" class="ghost" data-toggle-rule="'+esc(r.id)+'" data-enabled="'+(r.enabled?'1':'0')+'">'+(r.enabled?'Pausieren':'Aktivieren')+'</button></div>'
      ).join(''):'<p>Noch keine Wartungsregeln.</p>';
    }catch(e){show(e.message,true);}
  }
  async function detail(taskId){
    const task=await api('/api/billing/tasks/'+taskId+'/detail');
    activeTask=taskId;
    el('billingDetailTitle').textContent=task.task.name;
    el('billingTaskContext').textContent='Status: '+task.task.status;
    el('billingChecklist').innerHTML=task.checklist.length?task.checklist.map(i=>
      '<div class="kb-check-item"><label><input type="checkbox" data-check="'+esc(i.id)+'" '+(i.completed?'checked':'')+'> '+esc(i.text)+'</label><button type="button" class="ghost" data-remove-check="'+esc(i.id)+'">×</button></div>'
    ).join(''):'<p>Keine Checklistenpunkte.</p>';
    el('billingComments').innerHTML=task.comments.length?task.comments.map(c=>
      '<div class="kb-workflow-item"><strong>'+esc(c.actor)+'</strong> <small>'+esc(String(c.created_at).slice(0,16))+'</small><p>'+esc(c.text)+'</p></div>'
    ).join(''):'<p>Keine Kommentare.</p>';
    el('billingActivity').innerHTML=task.events?.length?task.events.map(e=>
      '<div class="kb-workflow-item"><strong>'+esc(e.event_type)+'</strong><small>'+esc(String(e.created_at).slice(0,16))+'</small><p>'+esc(e.details)+'</p></div>'
    ).join(''):'<p>Keine protokollierten Änderungen.</p>';
    el('billingFiles').innerHTML=task.files.length?task.files.map(f=>
      '<div class="kb-workflow-item"><a href="/api/billing/tasks/'+esc(taskId)+'/files/'+esc(f.id)+'">'+esc(f.filename)+'</a> <small>'+Math.round(f.size_bytes/1024)+' KB</small> <button type="button" class="ghost" data-remove-file="'+esc(f.id)+'">Löschen</button></div>'
    ).join(''):'<p>Keine Anhänge.</p>';
    if(!el('billingTaskDetail').open)el('billingTaskDetail').showModal();
  }
  const submit=fn=>async e=>{e.preventDefault();try{await fn(e);}catch(err){show(err.message,true);}};
  const change=async fn=>{await fn(activeTask);await detail(activeTask);};
  const timer=async taskId=>{
    const entries=await api('/api/billing/entries'),running=entries.find(x=>x.started_at);
    if(running&&running.task_id!==taskId)throw Error('Ein anderer Timer läuft bereits. Bitte zuerst stoppen.');
    if(running){
      await api('/api/billing/timer/'+running.id+'/stop','POST',{});
      show('Timer gestoppt.');
    } else {
      const title=el('kanbanBoard').querySelector('[data-task-id="'+CSS.escape(taskId)+'"] .kb-title')?.textContent||'Kanban-Task';
      await api('/api/billing/timer/start','POST',{task_id:taskId,kind:'work',description:title,billable:true});
      show('Timer gestartet.');
    }
    await window.SiteOpsBillingRefresh?.();
  };
  el('billingRoot').addEventListener('click',async event=>{
    const d=event.target.closest('[data-workflow-detail]'),t=event.target.closest('[data-workflow-timer]');
    if(!d&&!t)return;
    try{if(d)await detail(d.dataset.workflowDetail);else await timer(t.dataset.workflowTimer);}
    catch(e){show(e.message,true);}
  });
  el('billingDetailClose').onclick=()=>el('billingTaskDetail').close();
  el('billingTaskDetail').addEventListener('close',()=>{activeTask='';});
  el('billingChecklistForm').addEventListener('submit',submit(async e=>{
    await change(id=>api('/api/billing/tasks/'+id+'/checklist','POST',{text:e.currentTarget.elements.namedItem('text').value}));
    e.currentTarget.reset();
  }));
  el('billingChecklist').addEventListener('change',async e=>{
    const input=e.target.closest('[data-check]');
    if(!input)return;
    try{await change(id=>api('/api/billing/tasks/'+id+'/checklist/'+input.dataset.check,'PATCH',{completed:input.checked}));}
    catch(err){show(err.message,true);}
  });
  el('billingChecklist').addEventListener('click',async e=>{
    const btn=e.target.closest('[data-remove-check]');if(!btn)return;
    try{await change(id=>api('/api/billing/tasks/'+id+'/checklist/'+btn.dataset.removeCheck,'DELETE'));}
    catch(err){show(err.message,true);}
  });
  el('billingCommentForm').addEventListener('submit',submit(async e=>{
    await change(id=>api('/api/billing/tasks/'+id+'/comments','POST',{text:e.currentTarget.elements.namedItem('text').value}));
    e.currentTarget.reset();
  }));
  el('billingQuickTime').addEventListener('submit',submit(async e=>{
    const f=e.currentTarget;
    await api('/api/billing/entries','POST',{
      task_id:activeTask,entry_date:new Date().toLocaleDateString('sv-SE'),
      duration_minutes:Number(f.elements.namedItem('duration_minutes').value),
      description:f.elements.namedItem('description').value,
      billable:f.elements.namedItem('billable').checked,
      kind:'work'
    });
    f.reset();show('Zeit gebucht.');await window.SiteOpsBillingRefresh?.();
  }));
  el('billingFileForm').addEventListener('submit',submit(async e=>{
    const f=e.currentTarget,file=f.elements.namedItem('file').files[0];
    if(!file)return;
    if(file.size>2*1024*1024)throw Error('Dateigröße maximal 2 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    await change(id=>api('/api/billing/tasks/'+id+'/files','POST',{
      filename:file.name,mime_type:file.type||'application/octet-stream',data_base64:btoa(binary)
    }));
    f.reset();
  }));
  el('billingFiles').addEventListener('click',async e=>{
    const btn=e.target.closest('[data-remove-file]');if(!btn||!confirm('Datei löschen?'))return;
    try{await change(id=>api('/api/billing/tasks/'+id+'/files/'+btn.dataset.removeFile,'DELETE'));}
    catch(err){show(err.message,true);}
  });
  el('billingApplyTemplate').onclick=async()=>{
    const id=context().project_id;
    if(!id)return show('Projekt auswählen.',true);
    if(!confirm('Projektvorlage vollständig anlegen?'))return;
    try{
      const result=await api('/api/billing/projects/'+id+'/template','POST',{key:el('billingTemplate').value});
      show(result.created.length+' Tasks angelegt.');
      await window.SiteOpsBillingRefresh?.();
    }catch(e){show(e.message,true);}
  };
  el('billingRecurringForm').addEventListener('submit',submit(async e=>{
    const projectId=context().project_id;
    if(!projectId)throw Error('Projekt auswählen.');
    const f=e.currentTarget;
    await api('/api/billing/projects/'+projectId+'/recurring','POST',{
      task_name:f.elements.namedItem('task_name').value,
      description:f.elements.namedItem('description').value,
      every_days:Number(f.elements.namedItem('every_days').value)
    });
    f.reset();show('Wartungsregel gespeichert; die erste Aufgabe wird beim nächsten Worker-Lauf angelegt.');await reloadRules();
  }));
  el('billingRecurringList').addEventListener('click',async e=>{
    const btn=e.target.closest('[data-toggle-rule]');if(!btn)return;
    try{await api('/api/billing/recurring/'+btn.dataset.toggleRule,'PATCH',{enabled:btn.dataset.enabled!=='1'});await reloadRules();}
    catch(err){show(err.message,true);}
  });
  el('billingDueReload').onclick=reloadDue;
  el('billingProject').addEventListener('change',reloadRules);
  el('billingCustomer').addEventListener('change',reloadRules);
  document.addEventListener('siteops:billing-data', reloadRules);
  const links=()=>{
    const year=Number(el('billingFinanceYear').value);
    el('billingDatevLink').href='/api/billing/datev/'+year+'.csv';
    el('billingArchiveLink').href='/api/billing/archive-manifest/'+year;
  };
  el('billingFinanceYear').value=new Date().getFullYear();
  el('billingFinanceYear').addEventListener('change',links);
  links();void reloadRules();void reloadDue();
})();
