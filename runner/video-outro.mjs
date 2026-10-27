const fail=message=>{throw Object.assign(Error(message),{statusCode:422});};
export function outroSettings(raw) {
  if(raw===undefined)return undefined;
  if(!raw || typeof raw!=='object' || ![10,15,20].includes(raw.duration_seconds))fail('Outro-Dauer muss 10, 15 oder 20 Sekunden betragen.');
  if(typeof raw.channel!=='string' || raw.channel.length>80 || typeof raw.website!=='string' || raw.website.length>200)fail('Outro: Kanalname oder Link ist ungültig.');
  if(raw.website){let url;try{url=new URL(raw.website);}catch{fail('Outro-Link benötigt eine vollständige HTTPS-Adresse.');}if(url.protocol!=='https:' || url.username || url.password)fail('Outro-Link benötigt HTTPS ohne Zugangsdaten.');}
  return {duration_seconds:raw.duration_seconds,channel:raw.channel,website:raw.website};
}
export function validateOutroScenes(scenes) {
  const endings=scenes.filter(s=>s.outro!==undefined);
  if(endings.length>1)fail('Nur ein Outro pro Video verwenden.');
  if(endings.length && scenes.at(-1)!==endings[0])fail('Das Outro muss die letzte Szene sein.');
  for(const scene of endings){outroSettings(scene.outro);if(scene.demoUrl || scene.template_id || scene.demoSteps?.length || scene.login_profile_id || (scene.capture_mode && scene.capture_mode!=='text'))fail('Das Outro ist eine eigene Abspannfläche und kann keine Browser-Demo enthalten.');}
}
export function outroDuration(scene,audioDuration) {
  if(!scene.outro)return audioDuration;
  const duration=outroSettings(scene.outro).duration_seconds;
  if(audioDuration>duration)fail('Der Outro-Sprechertext dauert '+Math.ceil(audioDuration)+' Sekunden. Bitte kürzen oder eine längere Outro-Dauer wählen (maximal 20 Sekunden).');
  return duration;
}
const esc=value=>String(value || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function outroPage(scene,orientation='landscape') {
  const options=outroSettings(scene.outro),de=scene.language==='de',vertical=orientation==='portrait';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;overflow:hidden;font-family:Arial,Helvetica,sans-serif;background:#091a30;color:#f4f8ff}
  .stripe{position:absolute;inset:0 auto 0 0;width:18px;background:#ffb574}.brand{position:absolute;top:65px;left:120px;color:#a9c5e0;font-size:26px;letter-spacing:4px}
  h1{position:absolute;left:120px;top:155px;width:820px;margin:0;font-size:${Math.min(86,Math.max(40,5400/(scene.headline?.length || 20)))}px;line-height:1.1;letter-spacing:-2px;overflow-wrap:anywhere}
  .lead{position:absolute;left:120px;top:430px;width:760px;font-size:32px;line-height:1.5;color:#a9c5e0}
  .subscribe{position:absolute;left:145px;top:630px;width:220px;height:220px;border:2px solid #5e82a6;border-radius:50%}
  .subscribe-label{position:absolute;left:410px;top:695px;max-width:480px;font-size:34px;color:#ffb574}
  .video{position:absolute;right:120px;width:640px;height:360px;border:2px solid #507395;border-radius:18px;background:#102940}
  .one{top:145px}.two{top:550px}.watch{position:absolute;right:120px;top:88px;width:640px;font-size:24px;color:#b3cce4;letter-spacing:3px}
  .website{position:absolute;left:120px;bottom:65px;right:120px;font-size:28px;color:#a9c5e0;overflow-wrap:anywhere}
  ${vertical?'.brand{left:70px;top:70px}h1{left:70px;top:190px;width:940px;font-size:78px}.lead{left:70px;top:430px;width:940px}.watch{top:670px;left:70px}.video{left:70px;right:auto;width:940px;height:529px}.one{top:730px}.two{display:none}.subscribe{left:80px;top:1400px}.subscribe-label{left:360px;top:1460px;width:600px}.website{left:70px;right:70px;bottom:100px}':''}
  </style></head><body><div class="stripe"></div><div class="brand">${esc(options.channel)}</div><h1>${esc(scene.headline || (de?'Danke fürs Zuschauen.':'Thanks for watching.'))}</h1><div class="lead">${de?'Mehr praktische Tutorials.<br>Neue Ideen für dein nächstes Projekt.':'More practical tutorials.<br>New ideas for your next project.'}</div><div class="subscribe"></div><div class="subscribe-label">${de?'Für weitere Videos<br>abonnieren':'Subscribe for<br>more videos'}</div><div class="watch">${de?'HIER GEHT ES WEITER':'KEEP EXPLORING'}</div><div class="video one"></div><div class="video two"></div><div class="website">${esc(options.website || (de?'Alle relevanten Links findest du in der Beschreibung.':'Find the relevant links in the description.'))}</div></body></html>`;
}
