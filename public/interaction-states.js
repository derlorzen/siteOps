/* Shared accessibility for dynamic scroll regions and native form validation. */
(() => {
 'use strict';
 let scheduled=false,fieldNumber=0;
 function update(){
  scheduled=false;
  for(const wrapper of document.querySelectorAll('.tablewrap,[class*="table-wrap"],.coolify-table')){
   const scrolls=wrapper.scrollWidth>wrapper.clientWidth+1;
   if(scrolls){wrapper.tabIndex=0;wrapper.setAttribute('role','region');wrapper.setAttribute('aria-label',(wrapper.closest('section')?.querySelector('h2')?.textContent||'Tabelle')+' – horizontal scrollen');}
   else if(wrapper.getAttribute('role')==='region'&&wrapper.getAttribute('aria-label')?.endsWith('– horizontal scrollen')){wrapper.removeAttribute('tabindex');wrapper.removeAttribute('role');wrapper.removeAttribute('aria-label');}
  }
 }
 function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(update);}}
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
 const dirtyForms=new Set();
 document.addEventListener('input',event=>{const form=event.target.closest('form[data-unsaved-guard]');if(form)dirtyForms.add(form.id);});
 document.addEventListener('change',event=>{const form=event.target.closest('form[data-unsaved-guard]');if(form)dirtyForms.add(form.id);});
 document.addEventListener('siteops:form-saved',event=>dirtyForms.delete(event.detail));
 window.addEventListener('beforeunload',event=>{if(dirtyForms.size){event.preventDefault();event.returnValue='';}});
 window.addEventListener('resize',schedule,{passive:true});schedule();
 document.addEventListener('invalid',event=>{
  const field=event.target;if(!field.id){do{field.id='siteops-field-'+(++fieldNumber);}while(document.querySelectorAll('#'+field.id).length>1);}
  const id=field.id+'-validation';let error=document.getElementById(id);
  if(!error){error=document.createElement('p');error.id=id;error.className='ui-field-error';field.insertAdjacentElement('afterend',error);}
  error.textContent=field.validity.valueMissing?'Fülle dieses Pflichtfeld aus.':'Prüfe den eingegebenen Wert und das erwartete Format.';
  field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',[...(field.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean),id].filter((value,index,all)=>all.indexOf(value)===index).join(' '));
 },true);
 document.addEventListener('input',event=>{const field=event.target;if(field.validity?.valid&&field.getAttribute('aria-invalid')==='true'){field.removeAttribute('aria-invalid');document.getElementById(field.id+'-validation')?.remove();const refs=(field.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==field.id+'-validation');if(refs.length)field.setAttribute('aria-describedby',refs.join(' '));else field.removeAttribute('aria-describedby');}});
})();
