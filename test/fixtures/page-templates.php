<?php
declare(strict_types=1);
use SiteCms\{Access,Content,Html,HttpError,PageTemplates,Schema,Site,SiteAdmin,Store,Templates};
define('LORZCMS_CORE',dirname(__DIR__,2).'/packages/lorzcms-core');
define('LORZCMS_ROOT',dirname(__DIR__,2));
require LORZCMS_CORE.'/runtime/bootstrap.php';
$project=require LORZCMS_CORE.'/projects/base/project.php';
$project['name']='Morgen & Partner';
$project['site_defaults']['settings']=['name'=>'Morgen & Partner','tagline'=>'Raum für gute Ideen','contact_email'=>'hallo@example.de'];
$project['types']['page']['fields']['image']=['label'=>'Bild','kind'=>'image'];
$project['widgets']['local']=['label'=>'Projektmodul','fields'=>[],'render'=>static fn()=>'<p>Individuelles Projektmodul</p>'];
$project['page_partials']['footer']=static fn($view)=>'<footer class="site-footer"><div class="project-footer">'.$view['footer'].'</div></footer>';
$store=new Store('sqlite::memory:');$store->install();$schema=new Schema($project['types']);$access=new Access($store,$project['roles']);$site=new Site($store,$access,$project);$cms=new Content($store,$schema,$access,$site);
$actor=['id'=>'admin','role'=>'admin','grants'=>[]];$configuration=['project'=>'base','environment'=>'production','base_url'=>'https://example.de'];
function check(bool $condition,string $message):void {if(!$condition){throw new RuntimeException($message);}}
function rejected(callable $action,int $status):void {try{$action();}catch(HttpError $error){check($error->status===$status,'Expected status '.$status);return;}throw new RuntimeException('Expected rejection '.$status);}
$item=$cms->create('page','Gute Ideen brauchen Raum.','/',['body'=>'<p>Wir begleiten Menschen und Unternehmen bei ihrem nächsten Schritt. Mit klaren Gedanken, frischen Perspektiven und einem Blick für das Wesentliche.</p><h2>Gemeinsam weiterdenken</h2><p>Von der ersten Frage bis zur passenden Lösung: Wir hören zu, bringen Struktur in komplexe Themen und machen Möglichkeiten sichtbar.</p><blockquote>Veränderung beginnt mit einem guten Gespräch.</blockquote><p><a href="/kontakt/">Lernen wir uns kennen →</a></p>','image'=>''],[],'published',$actor);
$site->save('menus',0,[['id'=>'home','label'=>'Startseite','url'=>'/','parent'=>'','location'=>'header'],['id'=>'service','label'=>'Leistungen','url'=>'/leistungen/','parent'=>'','location'=>'header'],['id'=>'sub','label'=>'Beratung','url'=>'/beratung/','parent'=>'service','location'=>'header'],['id'=>'contact','label'=>'Kontakt','url'=>'/kontakt/','parent'=>'','location'=>'header'],['id'=>'legal','label'=>'Impressum','url'=>'/impressum/','parent'=>'','location'=>'footer']],$actor);
$initial=$site->get('appearance');$appearance=$initial['value'];$appearance['accent']='#a6cfbb';$appearance['background']='#faf9f6';$appearance['text']='#203a31';$appearance['footer']='Gute Gedanken. Klare Schritte.';$appearance['custom_css']='.cms-page { --page-radius: .4rem; }';
$site->save('appearance',0,$appearance,$actor);
rejected(fn()=>$site->save('appearance',0,$appearance,$actor),409);
$pages=new PageTemplates($cms,$configuration);check($pages->enabled(),'Base installations automatically use shared templates');
if(isset($argv[1])){file_put_contents($argv[1].'/site-theme.css',$site->themeCss());}
foreach(PageTemplates::PRESETS as $id=>$label){$current=$item;$current['options']['page_template']=$id;$html=$pages->render($current);check(str_contains($html,'page-'.$id),'Preset class');check(substr_count($html,'<h1>')===1,'Exactly one title');check(str_contains($html,'aria-current="page"'),'Active navigation');check(str_contains($html,'project-footer'),'Project partial hook');check(str_contains($html,'Gute Gedanken.'),'Shared footer text');check(str_contains($html,'https://example.de/'),'SEO canonical');if(isset($argv[1])){file_put_contents($argv[1].'/'.$id.'.html',$html);}}
$changed=$cms->save($item['id'],1,['options'=>['page_template'=>'split']],$actor);check($changed['options']['page_template']==='split','Page override is persisted');check(str_contains($pages->render($cms->at('/')),'page-split'),'Page override renders');
$inherited=$cms->save($item['id'],2,['options'=>['page_template'=>'inherit']],$actor);check(!isset($inherited['options']['page_template']),'Reset to inherit removes the new key for older cores');
rejected(fn()=>$site->options('page',['page_template'=>'../../config']),422);
check(str_contains($site->themeCss(),$appearance['custom_css']),'Custom CSS served by theme endpoint');
$safe=PageTemplates::validatePartial('<div class="custom-header" onclick="alert(1)">{{brand}}{{navigation}}<script>alert(1)</script></div>','header');check(str_contains($safe,'class="custom-header"') && !str_contains($safe,'script') && !str_contains($safe,'onclick'),'Safe HTML allows styling classes');
rejected(fn()=>PageTemplates::validatePartial('<p title="{{navigation}}">{{brand}}{{navigation}}</p>','header'),422);
rejected(fn()=>PageTemplates::validatePartial('{{brand}}{{navigation}}{{unknown}}','header'),422);
rejected(fn()=>PageTemplates::validatePartial('{{brand}}','header'),422);
check(!str_contains(Html::sanitize('<span class="custom">text</span>'),'class='),'Rich text allowlist stays unchanged');
$module=$item;$module['fields']['body']='[local]';check(str_contains($pages->render($module),'Individuelles Projektmodul'),'Project modules in content');
rejected(fn()=>$site->save('appearance',1,$appearance,['id'=>'guest','role'=>'guest','grants'=>[]]),403);
$template=['id'=>'test','name'=>'Title and body','types'=>['page'],'default_for'=>['page'],'sections'=>[['id'=>'s','layout'=>'one','tone'=>'plain','spacing'=>'normal','columns'=>[[['id'=>'t','kind'=>'field','field'=>'title'],['id'=>'b','kind'=>'field','field'=>'body']]]]]];
$site->save('templates',0,Templates::validate([$template],$project),$actor);check(substr_count($pages->render($item),'<h1>')===1,'Content templates do not duplicate page title');
$legacy=$project;$legacy['render']=static function(){echo 'legacy-renderer';};$legacySite=new Site($store,$access,$legacy);$legacyCms=new Content($store,$schema,$access,$legacySite);check(!(new PageTemplates($legacyCms,['project'=>'hsg']))->enabled(),'Existing project uses its own renderer');ob_start();PageTemplates::output($item,['project'=>'hsg'],$legacyCms);check(ob_get_clean()==='legacy-renderer','Legacy render callback retained');
$saved=$site->get('appearance');$appearance['engine']='shared';$site->save('appearance',$saved['version'],$appearance,$actor);check((new PageTemplates($cms,['project'=>'hsg']))->enabled(),'Project can opt into shared templates');
$site->restore('appearance',$site->history('appearance')[count($site->history('appearance'))-1]['id'],2,$actor);check($site->value('appearance')['engine']==='auto','Appearance restore includes defaults');
$_SESSION=['csrf'=>'test'];[$title,$admin]=(new SiteAdmin($site,$cms,$access,$configuration))->page('/admin/layout/','GET',$actor);check(str_contains($admin,'values[custom_css]') && str_contains($admin,'values[header_template]'),'Admin template and CSS controls');
if(isset($argv[1])){file_put_contents($argv[1].'/admin.html','<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/cms.css"><link rel="stylesheet" href="/assets/cms-admin.css"><link rel="stylesheet" href="/assets/builder.css"><link rel="stylesheet" href="/assets/cms-modern.css"></head><body class="admin"><main class="workspace"><h1>Layout & Templates</h1>'.$admin.'</main></body></html>');}
echo json_encode(['presets'=>array_keys(PageTemplates::PRESETS),'status'=>'passed']);
