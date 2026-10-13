<?php
 declare(strict_types=1);
 use SiteCms\{Html, Content, Store, Seo, Blocks};
 return [
 'name'=>'Meine Website',
 'types'=>['page'=>['label'=>'Seiten','fields'=>['body'=>['label'=>'Inhalt','kind'=>'html']]]],
 'roles'=>['admin'=>['label'=>'Administrator','all_content'=>true,'capabilities'=>['read','edit','create','publish','routes','users','media','categories','menus','settings']]],
 'site_defaults'=>['menus'=>[['id'=>'home','label'=>'Startseite','url'=>'/','parent'=>'','location'=>'header']]],
 'handler'=>static fn(string $path,array $config,Store $store,Content $cms):bool=>false,
 'render'=>static function(array $item,array $config,Content $cms):void {
 $e=Html::escape(...);$settings=$cms->site->value('settings');
 echo '<!doctype html><html lang="'.$e($settings['language']).'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'.Seo::head($item,$cms->site,$config).'<link rel="stylesheet" href="/assets/cms.css"><link rel="stylesheet" href="/assets/demo.css"><link rel="stylesheet" href="/assets/templates.css"><link rel="stylesheet" href="/assets/site-theme.css"></head><body><header class="topbar site-header"><a href="/">'.$e($settings['name']).'</a><nav aria-label="Hauptnavigation">'.$cms->site->menu('header',$item['path']).'</nav></header><main class="workspace content"><h1>'.$e($item['title']).'</h1><div class="rich">'.Html::sanitize($item['fields']['body'] ?? '').'</div>'.Blocks::render($item['options']['blocks'] ?? []).'</main><footer class="workspace"><nav aria-label="Fußnavigation">'.$cms->site->menu('footer',$item['path']).'</nav></footer></body></html>';
 }
 ];
