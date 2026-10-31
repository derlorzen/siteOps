(() => {
  'use strict';
  const $=id=>document.getElementById(id),root=$('websiteFiles');if(!root)return;
  const base='/api/sites/'+encodeURIComponent(root.dataset.site);let path='',original='',previewId=null,generation=0;
  const dirty=()=>$('fileContent').value!==original;
  const status=message=>{$('fileStatus').textContent=message;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(url,body){const response=await fetch(url,{credentials:'same-origin',...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.message||'Die Datei konnte nicht verarbeitet werden. Prüfe Verbindung, Dateityp und Pfad.');return data;}
  async function list(){
    const current=++generation;status('Ordner wird geladen …');
    try{const data=await api(base+'/files?path='+encodeURIComponent($('fileDirectory').value));if(current!==generation)return;
      $('fileList').innerHTML=data.items.length?data.items.map(item=>'<li><button class="ghost" type="button" data-name="'+esc(item.name)+'" data-directory="'+(item.type==='directory')+'">'+esc(item.name)+(item.type==='directory'?' /':'')+'</button><small>'+esc(item.type==='directory'?'Ordner':item.size==null?'Datei':new Intl.NumberFormat('de-DE').format(item.size)+' Byte')+'</small></li>').join(''):'<li>Dieser Ordner enthält keine Einträge.</li>';
      $('fileList').querySelectorAll('button').forEach(button=>button.onclick=async()=>{
        if(dirty()&&!confirm('Die ungespeicherten Änderungen an dieser Datei verwerfen?'))return;
        const next=[$('fileDirectory').value.replace(/\/$/,''),button.dataset.name].filter(Boolean).join('/');
        if(button.dataset.directory==='true'){$('fileDirectory').value=next;await list();return;}
        status('Datei wird geladen …');
        try{const content=await api(base+'/file?path='+encodeURIComponent(next));path=next;original=content.content;$('fileContent').value=original;$('fileContent').disabled=false;$('fileEditorHeading').textContent=next;$('filePreview').disabled=false;$('fileReset').disabled=false;$('fileChangePreview').hidden=true;previewId=null;status('Datei geladen. Änderungen werden erst nach Vorschau und Freigabe ausgeführt.');}
        catch(error){status(error.message);}
      });status(data.items.length+' Einträge. Wähle einen Ordner oder eine Textdatei.');
    }catch(error){status(error.message);}
  }
  $('filePathForm').onsubmit=event=>{event.preventDefault();list();};
  $('fileParent').onclick=()=>{$('fileDirectory').value=$('fileDirectory').value.replace(/\/$/,'').split('/').slice(0,-1).join('/');list();};
  $('fileContent').oninput=()=>{previewId=null;$('fileChangePreview').hidden=true;};
  $('fileReset').onclick=()=>{$('fileContent').value=original;previewId=null;$('fileChangePreview').hidden=true;status('Ungespeicherte Änderungen verworfen.');};
  $('filePreview').onclick=async()=>{
    if(!dirty()){status('Der Dateiinhalt ist unverändert.');return;}
    $('filePreview').disabled=true;status('Datei wird geprüft und Vorschau vorbereitet …');
    const planned=$('fileContent').value;
    try{const preview=await api(base+'/file-preview',{path,content:planned});if($('fileContent').value!==planned){status('Der Inhalt wurde während der Prüfung geändert. Erstelle die Vorschau erneut.');return;}previewId=preview.previewId;$('fileBefore').textContent=original;$('fileAfter').textContent=planned;$('fileChangePreview').hidden=false;status('Vorschau erstellt. Die Website wurde noch nicht geändert.');}
    catch(error){status(error.message);}finally{$('filePreview').disabled=false;}
  };
  $('fileApply').onclick=async()=>{
    if(!previewId)return;$('fileApply').disabled=true;status('Freigabe wird angefordert …');
    try{await api('/api/previews/'+encodeURIComponent(previewId)+'/apply',{});const content=await api(base+'/file?path='+encodeURIComponent(path));if(content.content!==$('fileAfter').textContent)throw Error('Die Ausführung wurde angenommen, der erwartete Dateiinhalt konnte anschließend nicht bestätigt werden. Prüfe den Änderungsverlauf.');original=content.content;$('fileContent').value=original;$('fileChangePreview').hidden=true;previewId=null;status('Änderung ausgeführt und Dateiinhalt erneut geprüft.');}
    catch(error){status(error.message);}finally{$('fileApply').disabled=false;}
  };
  window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
  list();
})();
