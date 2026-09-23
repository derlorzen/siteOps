import * as dns from 'node:dns/promises';

export const ISSUE_LIBRARY = Object.freeze({
  fetch_error:{category:'crawlability',level:'error',title:'Seite nicht abrufbar',fix:'Server, DNS, Firewall und URL prüfen. Die Seite muss stabil erreichbar sein.'},
  not_html:{category:'crawlability',level:'info',title:'Kein HTML-Dokument',fix:'Nur indexierbare HTML-Seiten gehören in den normalen SEO-Crawl.'},
  http_status:{category:'crawlability',level:'error',title:'Fehlerhafter HTTP-Status',fix:'Interne URLs sollten direkt mit HTTP 200 antworten. Fehlerseite, Routing oder Ziel-URL korrigieren.'},
  redirect_page:{category:'crawlability',level:'warn',title:'URL leitet weiter',fix:'Interne Links und Sitemaps möglichst direkt auf die endgültige Ziel-URL zeigen lassen.'},
  title_missing:{category:'metadata',level:'error',title:'Title fehlt',fix:'Einen eindeutigen, beschreibenden Seitentitel ergänzen.'},
  title_short:{category:'metadata',level:'warn',title:'Title sehr kurz',fix:'Title präzisieren und den Hauptsuchbegriff natürlich integrieren.'},
  title_long:{category:'metadata',level:'warn',title:'Title sehr lang',fix:'Title auf eine prägnante, nicht abgeschnittene Fassung kürzen.'},
  description_missing:{category:'metadata',level:'warn',title:'Meta Description fehlt',fix:'Eine eindeutige Meta Description mit klarem Nutzen und Suchintention ergänzen.'},
  description_short:{category:'metadata',level:'info',title:'Meta Description kurz',fix:'Description bei Bedarf um relevante Informationen und Nutzen ergänzen.'},
  description_long:{category:'metadata',level:'warn',title:'Meta Description lang',fix:'Description kürzen und die wichtigste Aussage nach vorne stellen.'},
  h1_missing:{category:'content',level:'error',title:'H1 fehlt',fix:'Eine klare Hauptüberschrift ergänzen, die den Seiteninhalt eindeutig beschreibt.'},
  h1_multiple:{category:'content',level:'warn',title:'Mehrere H1',fix:'Die Dokumentstruktur prüfen und eine klare Hauptüberschrift verwenden.'},
  heading_order:{category:'content',level:'info',title:'Überschriften-Hierarchie springt',fix:'Überschriften logisch verschachteln und unnötige Sprünge in der Hierarchie vermeiden.'},
  canonical_missing:{category:'indexability',level:'info',title:'Canonical fehlt',fix:'Für indexierbare Seiten einen selbstreferenzierenden Canonical setzen, wenn das CMS dies zuverlässig unterstützt.'},
  canonical_external:{category:'indexability',level:'warn',title:'Canonical zeigt auf andere Domain',fix:'Prüfen, ob die externe Canonical-Zielseite wirklich beabsichtigt ist.'},
  canonical_mismatch:{category:'indexability',level:'warn',title:'Canonical zeigt auf andere URL',fix:'Bei eigenständigen Seiten einen selbstreferenzierenden Canonical verwenden; abweichende Canonicals nur bewusst einsetzen.'},
  canonical_multiple:{category:'indexability',level:'error',title:'Mehrere Canonical-Tags',fix:'Pro HTML-Dokument genau eine eindeutige Canonical-URL ausgeben.'},
  canonical_non200:{category:'indexability',level:'error',title:'Canonical-Ziel ist nicht erfolgreich',fix:'Canonical direkt auf eine indexierbare HTTP-200-Zielseite setzen.'},
  noindex:{category:'indexability',level:'error',title:'Seite steht auf noindex',fix:'Bei Seiten, die gefunden werden sollen, noindex aus Meta-Robots oder X-Robots-Tag entfernen.'},
  nofollow_page:{category:'indexability',level:'warn',title:'Seite steht auf nofollow',fix:'Prüfen, ob Suchmaschinen den Links auf dieser Seite wirklich nicht folgen sollen.'},
  thin_content:{category:'content',level:'warn',title:'Sehr wenig Textinhalt',fix:'Suchintention vollständig beantworten; keinen Text nur für eine Mindestwortzahl aufblasen.'},
  duplicate_title:{category:'duplicates',level:'warn',title:'Doppelter Title',fix:'Betroffene Seiten klar differenzieren oder zusammenführen, wenn sie dieselbe Suchintention bedienen.'},
  duplicate_description:{category:'duplicates',level:'warn',title:'Doppelte Meta Description',fix:'Descriptions pro relevanter Zielseite individualisieren.'},
  duplicate_h1:{category:'duplicates',level:'info',title:'Doppelte H1',fix:'Prüfen, ob unterschiedliche Seiten dieselbe Hauptüberschrift benötigen oder klarer differenziert werden sollten.'},
  duplicate_content:{category:'duplicates',level:'error',title:'Nahezu identischer Seiteninhalt',fix:'Doppelte Seiten konsolidieren, canonicalisieren oder inhaltlich klar differenzieren.'},
  orphan_page:{category:'architecture',level:'warn',title:'Verwaiste Sitemap-Seite',fix:'Wichtige Seite sinnvoll intern verlinken oder aus der Sitemap entfernen, wenn sie nicht indexiert werden soll.'},
  crawl_depth:{category:'architecture',level:'info',title:'Große Klicktiefe',fix:'Wichtige Seiten näher an zentrale Navigations- oder Hub-Seiten bringen.'},
  broken_internal_link:{category:'links',level:'error',title:'Defekter interner Link',fix:'Linkziel korrigieren, Redirect sauber setzen oder den Link entfernen.'},
  broken_external_link:{category:'links',level:'warn',title:'Defekter externer Link',fix:'Externes Ziel aktualisieren, ersetzen oder den Link entfernen.'},
  redirect_internal_link:{category:'links',level:'info',title:'Interner Link führt über Redirect',fix:'Intern direkt auf die endgültige URL verlinken.'},
  empty_anchor:{category:'links',level:'info',title:'Link ohne beschreibenden Ankertext',fix:'Sinnvollen Linktext oder einen zugänglichen Namen für Bild-/Icon-Links ergänzen.'},
  generic_anchor:{category:'links',level:'info',title:'Unspezifischer Linktext',fix:'Linktext so formulieren, dass das Ziel auch ohne Umgebung verständlich ist.'},
  internal_nofollow:{category:'links',level:'info',title:'Interner Link mit nofollow',fix:'Nofollow bei normalen internen Navigationslinks entfernen, sofern es keinen konkreten Grund gibt.'},
  image_alt:{category:'images',level:'warn',title:'Bilder ohne Alt-Text',fix:'Informative Bilder mit passendem Alt-Text versehen; rein dekorative Bilder mit leerem Alt-Attribut markieren.'},
  image_dimensions:{category:'images',level:'info',title:'Bilder ohne Breite/Höhe',fix:'Bilddimensionen angeben, um Layout-Verschiebungen zu reduzieren.'},
  image_lazy:{category:'images',level:'info',title:'Viele Bilder ohne Lazy Loading',fix:'Nicht sichtbare Bilder lazy laden; Hero/LCP-Bilder davon ausnehmen.'},
  viewport_missing:{category:'mobile',level:'error',title:'Viewport-Meta fehlt',fix:'Ein korrektes viewport-Meta-Tag für responsive Darstellung ergänzen.'},
  html_lang_missing:{category:'international',level:'warn',title:'HTML-Sprache fehlt',fix:'Das lang-Attribut am html-Element korrekt setzen.'},
  hreflang_invalid:{category:'international',level:'warn',title:'Ungültiges hreflang',fix:'Sprach-/Regionscodes und Ziel-URLs prüfen; x-default nur gezielt verwenden.'},
  hreflang_no_return:{category:'international',level:'warn',title:'hreflang ohne Rückverweis',fix:'Internationale Varianten sollten sich gegenseitig mit konsistenten hreflang-Verweisen referenzieren.'},
  hreflang_non200:{category:'international',level:'error',title:'hreflang-Ziel ist nicht erfolgreich',fix:'hreflang nur auf direkt erreichbare, indexierbare HTTP-200-Seiten setzen.'},
  social_og_missing:{category:'social',level:'info',title:'Open-Graph-Daten unvollständig',fix:'Mindestens og:title, og:description und og:image für wichtige Seiten hinterlegen.'},
  twitter_card_missing:{category:'social',level:'info',title:'Twitter/X Card fehlt',fix:'twitter:card und passende Social-Metadaten ergänzen, wenn Social Sharing relevant ist.'},
  structured_data_invalid:{category:'structured_data',level:'error',title:'Ungültiges JSON-LD',fix:'JSON-LD syntaktisch korrigieren und anschließend gegen die jeweilige Schema-Spezifikation prüfen.'},
  structured_data_missing:{category:'structured_data',level:'info',title:'Keine strukturierten Daten erkannt',fix:'Nur passende, inhaltlich belegte strukturierte Daten ergänzen; kein Markup ohne echten Seitenbezug.'},
  mixed_content:{category:'security',level:'error',title:'Mixed Content',fix:'Alle Ressourcen auf HTTPS umstellen und harte http://-Referenzen entfernen.'},
  large_html:{category:'performance',level:'warn',title:'Sehr großes HTML-Dokument',fix:'DOM und eingebettete Daten reduzieren, unnötiges Markup entfernen und Inhalte effizient laden.'},
  slow_response:{category:'performance',level:'warn',title:'Langsame Serverantwort',fix:'Caching, Backend, Datenbank und Hosting-Latenz untersuchen.'},
  sitemap_noindex:{category:'sitemaps',level:'error',title:'Noindex-URL in Sitemap',fix:'Noindex-Seite aus der XML-Sitemap entfernen oder Indexierbarkeit bewusst wiederherstellen.'},
  sitemap_non200:{category:'sitemaps',level:'error',title:'Nicht erfolgreiche URL in Sitemap',fix:'Sitemap nur mit kanonischen, indexierbaren HTTP-200-URLs befüllen.'},
  sitemap_noncanonical:{category:'sitemaps',level:'warn',title:'Nicht-kanonische URL in Sitemap',fix:'XML-Sitemaps sollten die bevorzugten Canonical-URLs enthalten.'},
  pagespeed_error:{category:'performance',level:'warn',title:'PageSpeed-Audit fehlgeschlagen',fix:'PageSpeed API-Konfiguration und öffentliche Erreichbarkeit der URL prüfen.'}
});

const categoryLabels = Object.freeze({
  crawlability:'Crawlbarkeit',indexability:'Indexierbarkeit',metadata:'Metadaten',content:'Content',
  duplicates:'Duplikate',architecture:'Seitenarchitektur',links:'Links',images:'Bilder',mobile:'Mobile',
  international:'International',social:'Social',structured_data:'Structured Data',performance:'Performance',
  sitemaps:'Sitemaps',security:'Security'
});

export function decorateIssue(raw){
  const meta=ISSUE_LIBRARY[raw.code]||{};
  return {
    level:raw.level||meta.level||'info',
    code:raw.code||'unknown',
    category:raw.category||meta.category||'other',
    title:raw.title||meta.title||raw.code||'Hinweis',
    text:raw.text||meta.title||raw.code||'Hinweis',
    fix:raw.fix||meta.fix||'Prüfen und bei Bedarf korrigieren.',
    ...raw
  };
}

export function pageAuditIssues(page){
  const issues=[];
  const add=(code,text,extra={})=>issues.push(decorateIssue({code,text,...extra}));
  if(page.statusCode!==200)add('http_status','HTTP '+page.statusCode);
  if(page.signals?.redirected)add('redirect_page','Weiterleitung auf '+(page.signals.finalUrl||page.url));
  if(!page.title)add('title_missing','Title fehlt');
  else if(page.title.length<25)add('title_short','Title sehr kurz ('+page.title.length+' Zeichen)');
  else if(page.title.length>65)add('title_long','Title lang ('+page.title.length+' Zeichen)');
  if(!page.metaDescription)add('description_missing','Meta Description fehlt');
  else if(page.metaDescription.length<70)add('description_short','Meta Description kurz ('+page.metaDescription.length+' Zeichen)');
  else if(page.metaDescription.length>170)add('description_long','Meta Description lang ('+page.metaDescription.length+' Zeichen)');
  if((page.h1||[]).length===0)add('h1_missing','H1 fehlt');
  if((page.h1||[]).length>1)add('h1_multiple',(page.h1||[]).length+' H1-Überschriften');
  if(page.signals?.headingOrderIssue)add('heading_order','Überschriften-Hierarchie enthält Sprünge');
  if((page.signals?.canonicalCount||0)>1)add('canonical_multiple',page.signals.canonicalCount+' Canonical-Tags gefunden');
  if(!page.canonical)add('canonical_missing','Canonical fehlt');
  else{
    try{
      const cu=new URL(page.canonical),pu=new URL(page.url);
      if(cu.hostname!==pu.hostname)add('canonical_external','Canonical zeigt auf '+cu.hostname);
      else if(cu.href.replace(/\/$/,'')!==pu.href.replace(/\/$/,''))add('canonical_mismatch','Canonical zeigt auf '+cu.pathname);
    }catch{}
  }
  const robots=(page.robots||'')+' '+(page.signals?.xRobotsTag||'');
  if(/\bnoindex\b/i.test(robots))add('noindex','Seite steht auf noindex');
  if(/\bnofollow\b/i.test(robots))add('nofollow_page','Seite steht auf nofollow');
  if(page.wordCount<250)add('thin_content','Wenig Text ('+page.wordCount+' Wörter)');
  if(page.imagesMissingAlt>0)add('image_alt',page.imagesMissingAlt+' Bilder ohne Alt-Text');
  if((page.signals?.imagesMissingDimensions||0)>0)add('image_dimensions',page.signals.imagesMissingDimensions+' Bilder ohne width/height');
  if((page.signals?.imagesLazyCandidates||0)>=3)add('image_lazy',page.signals.imagesLazyCandidates+' Bilder könnten lazy geladen werden');
  if(page.depth!==null&&page.depth>3)add('crawl_depth','Klicktiefe '+page.depth);
  if(!page.signals?.viewport)add('viewport_missing','Viewport-Meta fehlt');
  if(!page.signals?.htmlLang)add('html_lang_missing','lang-Attribut am HTML-Element fehlt');
  if((page.signals?.hreflangInvalid||0)>0)add('hreflang_invalid',page.signals.hreflangInvalid+' hreflang-Einträge wirken ungültig');
  if(!page.signals?.openGraphComplete)add('social_og_missing','Open-Graph-Kerndaten sind unvollständig');
  if(!page.signals?.twitterCard)add('twitter_card_missing','twitter:card fehlt');
  if((page.signals?.structuredDataInvalid||0)>0)add('structured_data_invalid',page.signals.structuredDataInvalid+' JSON-LD-Blöcke sind ungültig');
  else if((page.structuredData||[]).length===0)add('structured_data_missing','Keine strukturierten Daten erkannt');
  if((page.signals?.mixedContent||0)>0)add('mixed_content',page.signals.mixedContent+' HTTP-Ressourcen auf HTTPS-Seite');
  if(page.contentBytes>1500000)add('large_html','HTML-Größe '+Math.round(page.contentBytes/1024)+' KiB');
  if(page.responseMs>2000)add('slow_response','Serverantwort '+page.responseMs+' ms');
  if((page.signals?.emptyAnchors||0)>0)add('empty_anchor',page.signals.emptyAnchors+' Links ohne erkennbaren Ankertext');
  if((page.signals?.genericAnchors||0)>0)add('generic_anchor',page.signals.genericAnchors+' unspezifische Linktexte');
  if((page.signals?.internalNofollow||0)>0)add('internal_nofollow',page.signals.internalNofollow+' interne nofollow-Links');
  return issues;
}

function groupMapPush(map,key,value){if(!map.has(key))map.set(key,[]);map.get(key).push(value);}

export function summarizeSeoAudit(pages,links,{rootUrl,sitemapPages=[]}={}){
  const rootHost=new URL(rootUrl).hostname;
  const titleMap=new Map(),descMap=new Map(),h1Map=new Map(),contentMap=new Map(),sitemapSet=new Set(sitemapPages);
  for(const p of pages){
    if(p.title)groupMapPush(titleMap,p.title.trim().toLocaleLowerCase(),p);
    if(p.metaDescription)groupMapPush(descMap,p.metaDescription.trim().toLocaleLowerCase(),p);
    if((p.h1||[])[0])groupMapPush(h1Map,p.h1[0].trim().toLocaleLowerCase(),p);
    if(p.contentHash&&p.wordCount>=80)groupMapPush(contentMap,p.contentHash,p);
  }
  const add=(p,code,text,extra={})=>{if(!(p.issues||[]).some(x=>x.code===code&&x.text===text))p.issues.push(decorateIssue({code,text,...extra}));};
  for(const p of pages){
    if(p.depth==null&&p.url!==rootUrl&&(p.incomingLinks||0)===0)add(p,'orphan_page','In Sitemap gefunden, aber intern nicht erreicht');
    if(p.title&&(titleMap.get(p.title.trim().toLocaleLowerCase())?.length||0)>1)add(p,'duplicate_title','Title auf '+titleMap.get(p.title.trim().toLocaleLowerCase()).length+' Seiten identisch');
    if(p.metaDescription&&(descMap.get(p.metaDescription.trim().toLocaleLowerCase())?.length||0)>1)add(p,'duplicate_description','Meta Description auf '+descMap.get(p.metaDescription.trim().toLocaleLowerCase()).length+' Seiten identisch');
    if((p.h1||[])[0]&&(h1Map.get(p.h1[0].trim().toLocaleLowerCase())?.length||0)>1)add(p,'duplicate_h1','H1 auf '+h1Map.get(p.h1[0].trim().toLocaleLowerCase()).length+' Seiten identisch');
    if(p.contentHash&&(contentMap.get(p.contentHash)?.length||0)>1)add(p,'duplicate_content','Inhalt auf '+contentMap.get(p.contentHash).length+' Seiten praktisch identisch');
    const robots=(p.robots||'')+' '+(p.signals?.xRobotsTag||'');
    if(sitemapSet.has(p.url)&&/\bnoindex\b/i.test(robots))add(p,'sitemap_noindex','Noindex-URL ist in der Sitemap enthalten');
    if(sitemapSet.has(p.url)&&p.statusCode!==200)add(p,'sitemap_non200','Sitemap-URL antwortet mit HTTP '+p.statusCode);
  }
  const pageByUrl=new Map(pages.map(p=>[p.url,p]));
  for(const p of pages){
    if(p.canonical){
      const target=pageByUrl.get(p.canonical);
      if(target&&target.statusCode!==200)add(p,'canonical_non200','Canonical-Ziel '+p.canonical+' antwortet mit HTTP '+target.statusCode);
    }
    if(sitemapSet.has(p.url)&&p.canonical&&p.canonical.replace(/\/$/,'')!==p.url.replace(/\/$/,''))add(p,'sitemap_noncanonical','Sitemap-URL canonicalisiert auf '+p.canonical);
    for(const alt of p.signals?.hreflang||[]){
      if(!alt.href)continue;
      const target=pageByUrl.get(alt.href);
      if(target&&target.statusCode!==200)add(p,'hreflang_non200','hreflang '+alt.lang+' zeigt auf HTTP '+target.statusCode);
      if(target){
        const back=(target.signals?.hreflang||[]).some(x=>x.href&&x.href.replace(/\/$/,'')===p.url.replace(/\/$/,''));
        if(!back)add(p,'hreflang_no_return','Kein hreflang-Rückverweis von '+alt.href);
      }
    }
  }
  for(const link of links){
    const source=pageByUrl.get(link.source);if(!source)continue;
    const status=Number(link.targetStatus||0);
    if(status>=400||link.targetError){
      add(source,link.internal?'broken_internal_link':'broken_external_link',(link.internal?'Interner':'Externer')+' Link '+link.target+' liefert '+(status?'HTTP '+status:link.targetError));
    }else if(link.internal&&status>=300&&status<400)add(source,'redirect_internal_link','Interner Link '+link.target+' liefert HTTP '+status);
  }
  const allIssues=pages.flatMap(p=>(p.issues||[]).map(x=>decorateIssue({...x,url:p.url,pageId:p.id||null})));
  const errorPages=pages.filter(p=>(p.issues||[]).some(i=>decorateIssue(i).level==='error')).length;
  const healthScore=pages.length?Math.round((pages.length-errorPages)/pages.length*100):100;
  const levelWeight={error:8,warn:3,info:1},cats={};
  for(const issue of allIssues){
    const c=issue.category||'other';if(!cats[c])cats[c]={label:categoryLabels[c]||c,issues:0,weight:0};
    cats[c].issues++;cats[c].weight+=levelWeight[issue.level]||1;
  }
  const categoryScores={};
  for(const [key,value] of Object.entries(cats))categoryScores[key]={label:value.label,issues:value.issues,score:Math.max(0,Math.round(100-Math.min(100,value.weight*100/Math.max(8,pages.length*4))))};
  const groups=new Map();
  for(const issue of allIssues){
    if(!groups.has(issue.code))groups.set(issue.code,{code:issue.code,category:issue.category,level:issue.level,title:issue.title,fix:issue.fix,count:0,urls:[]});
    const g=groups.get(issue.code);g.count++;if(g.urls.length<12)g.urls.push(issue.url);
  }
  const severity={error:3,warn:2,info:1};
  const recommendations=[...groups.values()].sort((a,b)=>(severity[b.level]-severity[a.level])||(b.count-a.count)).slice(0,20);
  const indexable=pages.filter(p=>p.statusCode===200&&!/\bnoindex\b/i.test((p.robots||'')+' '+(p.signals?.xRobotsTag||''))).length;
  return{
    healthScore,
    indexability:{indexable,noindex:pages.filter(p=>/\bnoindex\b/i.test((p.robots||'')+' '+(p.signals?.xRobotsTag||''))).length,non200:pages.filter(p=>p.statusCode!==200).length},
    issues:{error:allIssues.filter(i=>i.level==='error').length,warn:allIssues.filter(i=>i.level==='warn').length,info:allIssues.filter(i=>i.level==='info').length},
    categoryScores,recommendations,
    duplicates:{
      titles:[...titleMap.values()].filter(x=>x.length>1).length,
      descriptions:[...descMap.values()].filter(x=>x.length>1).length,
      content:[...contentMap.values()].filter(x=>x.length>1).length
    },
    host:rootHost
  };
}

async function checkOneUrl(url,userAgent){
  const started=Date.now();
  try{
    let res=await fetch(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':userAgent,accept:'text/html,*/*'}});
    if([400,403,405,501].includes(res.status))res=await fetch(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':userAgent,accept:'text/html,*/*','Range':'bytes=0-2048'}});
    return{status:res.status,responseMs:Date.now()-started,location:res.headers.get('location')||null,error:null};
  }catch(e){return{status:0,responseMs:Date.now()-started,location:null,error:String(e.message||e)};}
}

export async function linkHealthCheck(links,{knownStatuses=new Map(),limit=1000,externalLimit=300,concurrency=8,userAgent='Lorzen-SiteOps-LinkCheck/0.9'}={}){
  const unique=[],seen=new Set(),externalSeen=new Set();
  for(const l of links){
    if(seen.has(l.target))continue;
    if(!l.internal){
      if(externalSeen.size>=externalLimit)continue;
      externalSeen.add(l.target);
    }
    seen.add(l.target);unique.push(l.target);
    if(unique.length>=limit)break;
  }
  const results=new Map();
  for(const [url,status] of knownStatuses)results.set(url,{status,responseMs:null,location:null,error:null,source:'crawl'});
  const pending=unique.filter(u=>!results.has(u));
  let cursor=0;
  async function worker(){
    while(cursor<pending.length){
      const idx=cursor++;const url=pending[idx];
      results.set(url,{...(await checkOneUrl(url,userAgent)),source:'probe'});
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,pending.length||1)},()=>worker()));
  for(const l of links){
    const r=results.get(l.target);
    if(r){l.targetStatus=r.status;l.targetResponseMs=r.responseMs;l.targetError=r.error;l.targetLocation=r.location;}
  }
  return{checked:results.size,externalChecked:[...externalSeen].filter(x=>results.has(x)).length,results};
}

function robotsGroups(text){
  const groups=[];let current=null,hasRules=false;
  for(const raw of String(text||'').split(/\r?\n/)){
    const line=raw.replace(/#.*$/,'').trim();if(!line)continue;
    const m=line.match(/^([^:]+):\s*(.*)$/);if(!m)continue;
    const key=m[1].trim().toLowerCase(),value=m[2].trim();
    if(key==='user-agent'){
      if(!current||hasRules){current={agents:[],rules:[]};groups.push(current);hasRules=false;}
      current.agents.push(value.toLowerCase());
    }else if(current&&(key==='allow'||key==='disallow')){
      hasRules=true;current.rules.push({type:key,path:value});
    }
  }
  return groups;
}
function ruleRegex(pattern){
  if(!pattern)return null;
  let end=pattern.endsWith('$');if(end)pattern=pattern.slice(0,-1);
  const escaped=pattern.replace(/[.+?^$()|[\]\\{}]/g,'\\$&').replace(/\*/g,'.*');
  try{return new RegExp('^'+escaped+(end?'$':''));}catch{return null;}
}
export function robotsAllows(text,userAgent,path='/'){
  const ua=String(userAgent||'').toLowerCase(),groups=robotsGroups(text);
  const matches=groups.map(g=>({g,specificity:Math.max(...g.agents.map(a=>a==='*'?0:(ua.includes(a)?a.length:-1)),-1)})).filter(x=>x.specificity>=0);
  if(!matches.length)return true;
  const best=Math.max(...matches.map(x=>x.specificity)),rules=matches.filter(x=>x.specificity===best).flatMap(x=>x.g.rules);
  let chosen=null;
  for(const r of rules){
    const re=ruleRegex(r.path);if(!re||!re.test(path))continue;
    const len=r.path.replace(/\*/g,'').length;
    if(!chosen||len>chosen.len||(len===chosen.len&&r.type==='allow'))chosen={...r,len};
  }
  return !chosen||chosen.type==='allow';
}

async function fetchProbe(url,{userAgent,accept='text/html,*/*',timeout=15000}={}){
  const started=Date.now();
  try{
    const res=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'User-Agent':userAgent,accept}});
    const text=await res.text();
    return{ok:res.ok,status:res.status,url:res.url,responseMs:Date.now()-started,headers:res.headers,text:text.slice(0,300000),error:null};
  }catch(e){return{ok:false,status:0,url,responseMs:Date.now()-started,headers:new Headers(),text:'',error:String(e.message||e)};}
}
async function dnsSafe(fn){try{return await fn();}catch{return[];}}
function txtFlat(records){return records.map(x=>Array.isArray(x)?x.join(''):String(x));}
function securityHeaderAudit(headers,protocol){
  const get=n=>headers.get(n)||'';
  const checks=[
    {key:'https',ok:protocol==='https:',weight:20,label:'HTTPS'},
    {key:'hsts',ok:protocol==='https:'&&Boolean(get('strict-transport-security')),weight:15,label:'HSTS'},
    {key:'csp',ok:Boolean(get('content-security-policy')),weight:20,label:'Content-Security-Policy'},
    {key:'frame',ok:Boolean(get('x-frame-options'))||/\bframe-ancestors\b/i.test(get('content-security-policy')),weight:10,label:'Clickjacking-Schutz'},
    {key:'nosniff',ok:/\bnosniff\b/i.test(get('x-content-type-options')),weight:10,label:'X-Content-Type-Options'},
    {key:'referrer',ok:Boolean(get('referrer-policy')),weight:10,label:'Referrer-Policy'},
    {key:'permissions',ok:Boolean(get('permissions-policy')),weight:10,label:'Permissions-Policy'},
    {key:'cors',ok:get('access-control-allow-origin')!=='*',weight:5,label:'Kein globales CORS-*'}
  ];
  const total=checks.reduce((n,x)=>n+x.weight,0),score=Math.round(checks.reduce((n,x)=>n+(x.ok?x.weight:0),0)/total*100);
  const issues=checks.filter(x=>!x.ok).map(x=>({level:x.weight>=15?'warn':'info',code:'security_'+x.key,text:x.label+' fehlt oder ist zu offen'}));
  let cookies=[];try{cookies=headers.getSetCookie?headers.getSetCookie():[];}catch{}
  if(!cookies.length&&headers.get('set-cookie'))cookies=[headers.get('set-cookie')];
  const cookieAudit=cookies.slice(0,20).map(raw=>({name:String(raw).split('=')[0],secure:/;\s*secure\b/i.test(raw),httpOnly:/;\s*httponly\b/i.test(raw),sameSite:/;\s*samesite=/i.test(raw)}));
  return{score,checks,issues,cookies:cookieAudit};
}
function detectTechnology(headers,html){
  const found=new Set(),server=headers.get('server')||'',powered=headers.get('x-powered-by')||'';
  if(server)found.add('Server: '+server);
  if(powered)found.add('Powered by: '+powered);
  const hay=String(html||'');
  if(/wp-content|wp-includes|wordpress/i.test(hay))found.add('WordPress');
  if(/woocommerce/i.test(hay))found.add('WooCommerce');
  if(/cdn\.shopify\.com|Shopify\.theme/i.test(hay))found.add('Shopify');
  if(/__NEXT_DATA__|\/_next\//i.test(hay))found.add('Next.js');
  if(/data-reactroot|react-dom/i.test(hay))found.add('React');
  if(/googletagmanager\.com\/gtm\.js/i.test(hay))found.add('Google Tag Manager');
  if(/googletagmanager\.com\/gtag\/js|google-analytics\.com/i.test(hay))found.add('Google Analytics');
  if(/cloudflare/i.test(server)||headers.get('cf-ray'))found.add('Cloudflare');
  return [...found];
}

async function sensitiveExposureAudit(origin,userAgent){
  const probes=[
    {path:'/.env',test:t=>/(?:^|\n)\s*(?:APP_KEY|DB_PASSWORD|DATABASE_URL|AWS_SECRET_ACCESS_KEY)\s*=/im,label:'.env'},
    {path:'/.git/HEAD',test:t=>/^ref:\s+refs\/heads\//m.test(t),label:'.git repository metadata'},
    {path:'/wp-config.php.bak',test:t=>/DB_(?:NAME|USER|PASSWORD)|AUTH_KEY|SECURE_AUTH_KEY/i.test(t),label:'WordPress config backup'},
    {path:'/wp-config.php~',test:t=>/DB_(?:NAME|USER|PASSWORD)|AUTH_KEY|SECURE_AUTH_KEY/i.test(t),label:'WordPress config editor backup'},
    {path:'/wp-content/debug.log',test:t=>/(?:PHP (?:Warning|Fatal error|Notice)|WordPress database error)/i.test(t),label:'WordPress debug log'},
    {path:'/phpinfo.php',test:t=>/<title>phpinfo\(\)<\/title>|PHP Version/i.test(t),label:'phpinfo'},
    {path:'/info.php',test:t=>/<title>phpinfo\(\)<\/title>|PHP Version/i.test(t),label:'phpinfo'},
    {path:'/server-status',test:t=>/Apache Server Status|Server Version:/i.test(t),label:'server-status'}
  ];
  const rows=await Promise.all(probes.map(async p=>{const r=await fetchProbe(origin+p.path,{userAgent,accept:'text/plain,text/html,*/*',timeout:8000});return{path:p.path,status:r.status,exposed:Boolean(r.ok&&p.test(r.text)),label:p.label};}));
  return{checked:rows.length,findings:rows.filter(x=>x.exposed).map(x=>({path:x.path,status:x.status,label:x.label}))};
}

function domainForRdap(host){return host.replace(/^www\./i,'').toLowerCase();}
async function rdapDomain(host,userAgent){
  const domain=domainForRdap(host);
  try{
    const res=await fetch('https://rdap.org/domain/'+encodeURIComponent(domain),{redirect:'follow',signal:AbortSignal.timeout(12000),headers:{'User-Agent':userAgent,accept:'application/rdap+json,application/json'}});
    if(!res.ok)return{domain,status:res.status,expiresAt:null,daysRemaining:null};
    const data=await res.json(),events=Array.isArray(data.events)?data.events:[],expiry=events.find(x=>/expiration/i.test(x.eventAction||''))?.eventDate||null;
    return{domain,status:res.status,expiresAt:expiry,daysRemaining:expiry?Math.floor((new Date(expiry)-Date.now())/86400000):null,registrar:(data.entities||[]).flatMap(e=>e.vcardArray?.[1]||[]).find(x=>x?.[0]==='fn')?.[3]||null};
  }catch(e){return{domain,status:0,expiresAt:null,daysRemaining:null,error:String(e.message||e)};}
}

export async function siteIntelligenceAudit(baseUrl,{userAgent='Lorzen-SiteOps-Intelligence/0.9'}={}){
  const normalized=new URL(baseUrl),host=normalized.hostname,origin=normalized.origin;
  const [home,robots,llms,securityWellKnown,securityRoot,a,aaaa,mx,txt,dmarc,caa,ns,rdap]=await Promise.all([
    fetchProbe(origin+'/',{userAgent}),
    fetchProbe(origin+'/robots.txt',{userAgent,accept:'text/plain,*/*',timeout:12000}),
    fetchProbe(origin+'/llms.txt',{userAgent,accept:'text/plain,*/*',timeout:12000}),
    fetchProbe(origin+'/.well-known/security.txt',{userAgent,accept:'text/plain,*/*',timeout:12000}),
    fetchProbe(origin+'/security.txt',{userAgent,accept:'text/plain,*/*',timeout:12000}),
    dnsSafe(()=>dns.resolve4(host,{ttl:true})),dnsSafe(()=>dns.resolve6(host,{ttl:true})),
    dnsSafe(()=>dns.resolveMx(domainForRdap(host))),dnsSafe(()=>dns.resolveTxt(domainForRdap(host))),
    dnsSafe(()=>dns.resolveTxt('_dmarc.'+domainForRdap(host))),dnsSafe(()=>dns.resolveCaa(domainForRdap(host))),
    dnsSafe(()=>dns.resolveNs(domainForRdap(host))),rdapDomain(host,userAgent)
  ]);
  const exposure=await sensitiveExposureAudit(origin,userAgent);
  const txtRecords=txtFlat(txt),dmarcRecords=txtFlat(dmarc),spf=txtRecords.find(x=>/^v=spf1/i.test(x))||null,dmarcPolicy=dmarcRecords.find(x=>/^v=dmarc1/i.test(x))||null;
  const security=securityHeaderAudit(home.headers,normalized.protocol),securityScore=Math.max(0,security.score-exposure.findings.length*20);
  const robotsText=robots.ok?robots.text:'';
  const botDefs=[
    {agent:'OAI-SearchBot',purpose:'search',vendor:'OpenAI'},
    {agent:'Claude-SearchBot',purpose:'search',vendor:'Anthropic'},
    {agent:'PerplexityBot',purpose:'search',vendor:'Perplexity'},
    {agent:'GPTBot',purpose:'training',vendor:'OpenAI'},
    {agent:'ClaudeBot',purpose:'training',vendor:'Anthropic'},
    {agent:'Google-Extended',purpose:'training-grounding',vendor:'Google'}
  ];
  const bots=botDefs.map(b=>({...b,allowed:robots.ok?robotsAllows(robotsText,b.agent,'/'):true,explicit:robotsText.toLowerCase().includes(b.agent.toLowerCase())}));
  const searchBots=bots.filter(x=>x.purpose==='search'),aiScore=Math.round(searchBots.filter(x=>x.allowed).length/Math.max(1,searchBots.length)*100);
  const dnsChecks=[
    {key:'a',ok:a.length>0,weight:25,label:'A Record'},
    {key:'aaaa',ok:aaaa.length>0,weight:10,label:'IPv6 / AAAA'},
    {key:'mx',ok:mx.length>0,weight:10,label:'MX'},
    {key:'spf',ok:Boolean(spf),weight:15,label:'SPF'},
    {key:'dmarc',ok:Boolean(dmarcPolicy),weight:20,label:'DMARC'},
    {key:'caa',ok:caa.length>0,weight:10,label:'CAA'},
    {key:'ns',ok:ns.length>=2,weight:10,label:'Redundante Nameserver'}
  ];
  const dnsTotal=dnsChecks.reduce((n,x)=>n+x.weight,0),domainScore=Math.round(dnsChecks.reduce((n,x)=>n+(x.ok?x.weight:0),0)/dnsTotal*100);
  const securityTxt=securityWellKnown.ok?{url:securityWellKnown.url,status:securityWellKnown.status}:securityRoot.ok?{url:securityRoot.url,status:securityRoot.status}:null;
  const issues=[
    ...security.issues,
    ...exposure.findings.map(x=>({level:'error',code:'sensitive_exposure',text:x.label+' ist öffentlich erreichbar unter '+x.path})),
    ...searchBots.filter(x=>!x.allowed).map(x=>({level:'warn',code:'ai_crawler_blocked',text:x.agent+' ist in robots.txt blockiert',vendor:x.vendor})),
    ...dnsChecks.filter(x=>!x.ok&&['a','dmarc','spf'].includes(x.key)).map(x=>({level:x.key==='a'?'error':'warn',code:'domain_'+x.key,text:x.label+' nicht erkannt'}))
  ];
  if(rdap.daysRemaining!==null&&rdap.daysRemaining<30)issues.push({level:'error',code:'domain_expiry',text:'Domain läuft in '+rdap.daysRemaining+' Tagen ab'});
  else if(rdap.daysRemaining!==null&&rdap.daysRemaining<60)issues.push({level:'warn',code:'domain_expiry',text:'Domain läuft in '+rdap.daysRemaining+' Tagen ab'});
  if(!securityTxt)issues.push({level:'info',code:'security_txt_missing',text:'security.txt wurde nicht gefunden'});
  const overallScore=Math.round((securityScore+aiScore+domainScore)/3);
  return{
    checkedAt:new Date().toISOString(),baseUrl:origin,home:{status:home.status,finalUrl:home.url,responseMs:home.responseMs,error:home.error},
    scores:{overall:overallScore,security:securityScore,aiSearch:aiScore,domain:domainScore},
    security:{...security,headerScore:security.score,score:securityScore,securityTxt,exposure},
    ai:{robotsStatus:robots.status,robotsUrl:robots.url,bots,llmsTxt:{status:llms.status,present:llms.ok,url:llms.url}},
    domain:{host,rdap,a,aaaa,mx,ns,caa,spf,dmarc:dmarcPolicy,score:domainScore,checks:dnsChecks},
    technology:detectTechnology(home.headers,home.text),
    issues
  };
}

export function compareSeoRuns(current,previous){
  if(!current||!previous)return{current:current?.run||null,previous:previous?.run||null,available:false};
  const csum=current.run?.summary||{},psum=previous.run?.summary||{},cmap=new Map((current.pages||[]).map(p=>[p.url,p])),pmap=new Map((previous.pages||[]).map(p=>[p.url,p]));
  const added=[...cmap.keys()].filter(u=>!pmap.has(u)),removed=[...pmap.keys()].filter(u=>!cmap.has(u)),changed=[];
  for(const [url,c] of cmap){
    const p=pmap.get(url);if(!p)continue;
    const fields={};
    for(const [key,cv,pv] of [['status',c.status_code,p.status_code],['title',c.title,p.title],['description',c.meta_description,p.meta_description],['canonical',c.canonical,p.canonical],['contentHash',c.content_hash,p.content_hash]]){
      if((cv??null)!==(pv??null))fields[key]={before:pv??null,after:cv??null};
    }
    if(Object.keys(fields).length)changed.push({url,changes:fields});
  }
  return{
    available:true,
    current:{id:current.run.id,startedAt:current.run.started_at,healthScore:csum.healthScore??null,issues:csum.issues||{}},
    previous:{id:previous.run.id,startedAt:previous.run.started_at,healthScore:psum.healthScore??null,issues:psum.issues||{}},
    delta:{
      healthScore:(csum.healthScore??0)-(psum.healthScore??0),
      errors:(csum.issues?.error??0)-(psum.issues?.error??0),
      warnings:(csum.issues?.warn??0)-(psum.issues?.warn??0),
      pages:(csum.pages??current.pages.length)-(psum.pages??previous.pages.length)
    },
    added:added.slice(0,100),removed:removed.slice(0,100),changed:changed.slice(0,200)
  };
}
