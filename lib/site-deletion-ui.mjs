export function renderSiteDeletion(site, accounts, esc) {
  return String.raw`<a href="/sites/${esc(site.slug)}">← Zur Website</a>
  <h1>Website löschen: ${esc(site.name)}</h1>
  <p>Was soll gelöscht werden? Bitte den Umfang ausdrücklich auswählen.</p>
  <form id="deleteSite"><fieldset><legend>Löschumfang</legend>
  <label><input type="radio" name="scope" value="entry" required> Nur SiteOps-Eintrag und zugehörige Verläufe</label>
  <label><input type="radio" name="scope" value="folder" required> Eintrag und FTP-Ordner mit allen Dateien</label>
  <label><input type="radio" name="scope" value="domain" required> Eintrag und ALL-INKL-Domain / Subdomain</label>
  <label><input type="radio" name="scope" value="both" required> Eintrag, FTP-Ordner und ALL-INKL-Domain / Subdomain</label>
  </fieldset><label>ALL-INKL-Konto (bei Domain-Löschung)<select name="accountId"><option value="">Bitte auswählen</option>${accounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select></label>
  <p>Die KAS-Domain wird aus dem Hosting entfernt. Die Domainregistrierung wird dadurch nicht gekündigt. Externe Dateien und Datenbanken anderer Dienste werden nur im angegebenen Umfang entfernt.</p>
  <button>Vorschau prüfen</button></form>
  <section id="deletePreview" hidden><h2>Löschung bestätigen</h2><pre id="deleteTargets" style="white-space:pre-wrap"></pre>
  <form id="deleteConfirm"><label><span id="deleteConfirmationLabel">Website-Kennung oder vollständigen Website-Namen eingeben</span><input id="deleteConfirmation" required autocomplete="off"></label><button>Jetzt endgültig löschen</button></form></section>
  <p id="deleteMessage" role="status"></p>
  <script>
  (()=>{
    const form=document.getElementById('deleteSite'), section=document.getElementById('deletePreview'), message=document.getElementById('deleteMessage');
    let plan=null;
    form.addEventListener('change',()=>{plan=null;section.hidden=true;});
    form.addEventListener('submit',async e=>{
      e.preventDefault();plan=null;section.hidden=true;message.textContent='Prüfe Löschumfang…';
      const data=new FormData(form), scope=data.get('scope'), button=form.querySelector('button');button.disabled=true;
      try {
        const r=await fetch('/api/sites/'+${JSON.stringify(encodeURIComponent(site.slug))}+'/delete-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deleteFolder:['folder','both'].includes(scope),deleteDomain:['domain','both'].includes(scope),...(data.get('accountId')?{accountId:data.get('accountId')}:{})})});
        const x=await r.json();if(!r.ok)throw Error(x.message||'Vorschau fehlgeschlagen');plan=x;
        document.getElementById('deleteTargets').textContent='Website: '+x.site+'\nSiteOps-Eintrag und Verläufe: löschen\nFTP-Ordner: '+(x.folder||'behalten')+'\nALL-INKL-Domain: '+(x.domain?.hostname||'behalten')+'\n'+x.warning+'\nZur Bestätigung eingeben: '+x.confirmation;
        document.getElementById('deleteConfirmationLabel').textContent='Zur Bestätigung „'+x.confirmation+'“ oder „'+x.site+'“ eingeben';
        document.getElementById('deleteConfirmation').value='';section.hidden=false;message.textContent='';
      }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
    });
    document.getElementById('deleteConfirm').addEventListener('submit',async e=>{
      e.preventDefault();if(!plan)return;const confirmation=document.getElementById('deleteConfirmation').value.trim();
      if(![plan.confirmation,plan.site].includes(confirmation)){message.textContent='Bitte „'+plan.confirmation+'“ oder den vollständigen Website-Namen eingeben.';return;}
      const button=e.target.querySelector('button');button.disabled=true;
      try{
        const r=await fetch('/api/site-deletions/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:plan.token,confirmation})});
        const x=await r.json();if(!r.ok||!x.ok)throw Error([x.message||x.error,x.completed?.length?'Bereits gelöscht: '+x.completed.join(', '):''].filter(Boolean).join(' · '));location.href='/';
      }catch(error){message.textContent=error.message;plan=null;section.hidden=true;}finally{button.disabled=false;}
    });
  })();
  </script>`;
}
