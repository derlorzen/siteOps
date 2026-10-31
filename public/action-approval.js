// Shared REST adapter for existing module clients. Only SiteOps responses asking
// for a bound approval open a dialog; no arbitrary request is retried or changed.
(() => {
  'use strict';
  const originalFetch = window.fetch.bind(window);
  let queue = Promise.resolve();
  function confirmAction(approval) {
    return new Promise(resolve => {
      const previous = document.activeElement;
      const dialog = document.createElement('dialog'); dialog.className='ui-action-dialog';
      dialog.setAttribute('aria-labelledby','actionApprovalTitle');
      const title=document.createElement('h2');title.id='actionApprovalTitle';title.textContent='Änderung prüfen und freigeben';
      const description=document.createElement('p');description.textContent='Prüfe das Ziel und die Parameter. Diese Freigabe gilt nur für die angezeigte Änderung und läuft nach zehn Minuten ab.';
      const effect=document.createElement('p');effect.textContent=approval.effect;
      const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Parameter der Änderung';
      const pre=document.createElement('pre');pre.textContent=JSON.stringify(approval.arguments,null,2);details.append(summary,pre);
      const target=document.createElement('p');target.textContent=approval.tool;
      const actions=document.createElement('div');actions.className='actions';
      const cancel=document.createElement('button');cancel.type='button';cancel.className='ghost';cancel.textContent='Abbrechen';
      const accept=document.createElement('button');accept.type='button';accept.textContent='Diese Änderung ausführen';
      actions.append(cancel,accept);dialog.append(title,description,target,effect,details,actions);document.body.append(dialog);
      let accepted=false;accept.onclick=()=>{accepted=true;dialog.close();};cancel.onclick=()=>dialog.close();
      dialog.addEventListener('close',()=>{dialog.remove();previous?.focus();resolve(accepted);},{once:true});dialog.showModal();cancel.focus();
    });
  }
  window.fetch = async (input, options) => {
    const request=new Request(input,options);
    const url=new URL(request.url);
    const eligible=url.origin===location.origin && url.pathname.startsWith('/api/') && !['GET','HEAD'].includes(request.method);
    if (!eligible) return originalFetch(request);
    const response=await originalFetch(request.clone());
    if(response.status!==428)return response;
    const data=await response.clone().json().catch(()=>({}));
    if(data.error!=='APPROVAL_REQUIRED'||!data.approval?.id)return response;
    const decision=queue.then(()=>confirmAction(data.approval));queue=decision.catch(()=>false);
    if(!await decision)return response;
    const approved=await originalFetch('/api/mcp/approvals/'+encodeURIComponent(data.approval.id)+'/approve',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'});
    if(!approved.ok)return approved;
    const headers=new Headers(request.headers);headers.set('x-siteops-approval',data.approval.id);
    return originalFetch(new Request(request,{headers}));
  };
})();
