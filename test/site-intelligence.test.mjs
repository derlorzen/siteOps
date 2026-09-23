import test from 'node:test';
import assert from 'node:assert/strict';
import { robotsAllows, pageAuditIssues, summarizeSeoAudit, compareSeoRuns } from '../lib/site-intelligence.mjs';

test('robots rules prefer specific crawler group over wildcard',()=>{
  const robots=`User-agent: *
Disallow: /private/

User-agent: OAI-SearchBot
Allow: /
Disallow: /no-ai-search/
`;
  assert.equal(robotsAllows(robots,'OAI-SearchBot','/private/page'),true);
  assert.equal(robotsAllows(robots,'OAI-SearchBot','/no-ai-search/page'),false);
  assert.equal(robotsAllows(robots,'SomeBot','/private/page'),false);
});

test('page audit emits actionable technical SEO issues',()=>{
  const page={url:'https://example.com/a',statusCode:200,title:'Kurz',metaDescription:'',canonical:'',robots:'noindex',h1:[],wordCount:40,imagesMissingAlt:2,contentBytes:2000000,responseMs:2500,depth:4,structuredData:[],signals:{canonicalCount:0,viewport:false,htmlLang:'',openGraphComplete:false,twitterCard:'',mixedContent:1}};
  const issues=pageAuditIssues(page),codes=new Set(issues.map(x=>x.code));
  for(const code of ['title_short','description_missing','h1_missing','noindex','thin_content','image_alt','crawl_depth','viewport_missing','mixed_content','large_html','slow_response'])assert.equal(codes.has(code),true,code);
  assert.equal(issues.every(x=>x.category&&x.fix),true);
});

test('site summary catches duplicate metadata and hreflang return errors',()=>{
  const p1={url:'https://example.com/de',statusCode:200,title:'Gleich',metaDescription:'Gleiche Beschreibung',canonical:'https://example.com/de',robots:'',h1:['Gleich'],wordCount:500,depth:0,incomingLinks:2,contentHash:'aaa',signals:{hreflang:[{lang:'en',href:'https://example.com/en'}]},issues:[]};
  const p2={url:'https://example.com/en',statusCode:200,title:'Gleich',metaDescription:'Gleiche Beschreibung',canonical:'https://example.com/en',robots:'',h1:['Gleich'],wordCount:500,depth:1,incomingLinks:1,contentHash:'aaa',signals:{hreflang:[]},issues:[]};
  const summary=summarizeSeoAudit([p1,p2],[],{rootUrl:'https://example.com/de',sitemapPages:[p1.url,p2.url]});
  const codes=new Set(p1.issues.map(x=>x.code));
  assert.equal(codes.has('duplicate_title'),true);
  assert.equal(codes.has('duplicate_description'),true);
  assert.equal(codes.has('duplicate_content'),true);
  assert.equal(codes.has('hreflang_no_return'),true);
  assert.equal(summary.duplicates.content,1);
  assert.ok(summary.recommendations.length>0);
});

test('audit comparison reports score and URL changes',()=>{
  const current={run:{id:'new',started_at:'2026-09-23',summary:{healthScore:90,issues:{error:1,warn:2},pages:2}},pages:[{url:'https://example.com/',status_code:200,title:'Neu',meta_description:'x',canonical:'https://example.com/',content_hash:'2'},{url:'https://example.com/new',status_code:200,title:'Neu 2',meta_description:'y',canonical:'https://example.com/new',content_hash:'3'}]};
  const previous={run:{id:'old',started_at:'2026-09-22',summary:{healthScore:80,issues:{error:3,warn:4},pages:2}},pages:[{url:'https://example.com/',status_code:200,title:'Alt',meta_description:'x',canonical:'https://example.com/',content_hash:'1'},{url:'https://example.com/old',status_code:200,title:'Alt 2',meta_description:'y',canonical:'https://example.com/old',content_hash:'4'}]};
  const diff=compareSeoRuns(current,previous);
  assert.equal(diff.available,true);
  assert.equal(diff.delta.healthScore,10);
  assert.deepEqual(diff.added,['https://example.com/new']);
  assert.deepEqual(diff.removed,['https://example.com/old']);
  assert.equal(diff.changed.length,1);
});
