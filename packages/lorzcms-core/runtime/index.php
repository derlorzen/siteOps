<?php
declare(strict_types=1);


use SiteCms\{Admin,Api,Html,HttpError,Media,Setup};
$path=parse_url($_SERVER['REQUEST_URI'] ?? '/',PHP_URL_PATH) ?: '/';
$method=$_SERVER['REQUEST_METHOD'] ?? 'GET';
header('X-Content-Type-Options: nosniff');header('Referrer-Policy: strict-origin-when-cross-origin');
header('X-Frame-Options: SAMEORIGIN');
header("Content-Security-Policy: default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; object-src 'none'");
ob_start();
try {
    [$configuration,$project,$store,$schema,$access,$content]=cms_boot();
    $site=$content->site;
    $project['name']=$site->value('settings')['name'];
    if($configuration['environment']!=='production') {header('X-Robots-Tag: noindex, nofollow');}
    $media=new Media($store,$configuration['storage'].'/media',$access);
    if(str_starts_with($path,'/admin') || str_starts_with($path,'/api/cms')) {
        if($configuration['environment']==='production' && ($_SERVER['HTTPS'] ?? '')!=='on') {throw new HttpError(403,'Die Verwaltung benötigt HTTPS.');}
        $sessionPath=$configuration['storage'].'/sessions';if(!is_dir($sessionPath)){mkdir($sessionPath,0700,true);}session_save_path($sessionPath);
    }
    if($path==='/admin') {header('Location: /admin/',true,308);}
    elseif($path==='/admin/setup/') {(new Setup($store,$access,$content,(string)($configuration['setup_key'] ?? ''),$project['seed'] ?? null))->handle($method);}
    elseif(str_starts_with($path,'/admin/')) {
        if(!in_array($method,['GET','POST'],true)){throw new HttpError(405,'Methode nicht erlaubt.');}
        (new Admin($store,$content,$access,$media,$project['name'],$site,$configuration,$project))->handle($path,$method);
    } elseif(str_starts_with($path,'/api/cms/')) {(new Api($content,$access,$store))->handle($path,$method);}
    elseif(!in_array($method,['GET','HEAD'],true)){throw new HttpError(405,'Methode nicht erlaubt.');}
    elseif(preg_match('~^/media/([a-f0-9]{32})$~D',$path,$match)) {$media->serve($match[1]);}
    elseif($path==='/assets/site-theme.css') {header('Content-Type: text/css; charset=utf-8');header('Cache-Control: no-cache');echo $site->themeCss();}
    elseif($path==='/robots.txt') {header('Content-Type: text/plain; charset=utf-8');echo $configuration['environment']==='production' && $site->value('seo')['indexing']==='enabled'?"User-agent: *\nDisallow: /admin/\nDisallow: /api/cms/\nSitemap: ".$configuration['base_url']."/sitemap.xml\n":"User-agent: *\nDisallow: /\n";}
    elseif($path==='/sitemap.xml') {
        header('Content-Type: application/xml; charset=utf-8');echo '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
        foreach($content->list() as $item){if($item['status']==='published' && $item['path'] && !$item['seo']['noindex'] && $site->value('seo')['indexing']==='enabled' && (($item['seo']['canonical'] ?? '')==='' || $item['seo']['canonical']===$configuration['base_url'].$item['path'])) {echo '<url><loc>'.Html::escape($configuration['base_url'].$item['path']).'</loc><lastmod>'.Html::escape($item['updated_at']).'</lastmod></url>';}}
        if($site->value('seo')['indexing']==='enabled'){foreach($site->value('categories') as $category){$route=$site->categoryPath($category);if(!$content->at($route)){echo '<url><loc>'.Html::escape($configuration['base_url'].$route).'</loc></url>';}}}echo '</urlset>';
    } else {
        $handler=$project['handler'];$handled=$handler($path,$configuration,$store,$content);
        if(!$handled) {
            $item=$content->at($path);
            if(!$item && ($target=$site->redirect($path))){header('Location: '.$target,true,301);$handled=true;}
            if(!$item && !$handled){
                foreach($site->value('categories') as $category){if($path===$site->categoryPath($category)){$item=['id'=>'category-'.$category['id'],'type'=>isset($schema->types['page'])?'page':array_key_first($schema->types),'title'=>$category['name'],'path'=>$path,'status'=>'published','fields'=>['body'=>'<p>'.Html::escape($category['description']).'</p><ul>'],'seo'=>$schema->seo(['description'=>$category['description']]),'options'=>['categories'=>[],'layout'=>'default','blocks'=>[]]];$categoryIds=$site->categoryIds($category['id']);
                    foreach($content->list() as $entry){if($entry['status']==='published' && $entry['path'] && array_intersect($categoryIds,$entry['options']['categories'])){$item['fields']['body'].='<li><a href="'.Html::escape($entry['path']).'">'.Html::escape($entry['title']).'</a></li>';}}$item['fields']['body'].='</ul>';break;}}
            }
            if($handled){}
            elseif(!$item && !str_ends_with($path,'/') && $content->at($path.'/')) {header('Location: '.$path.'/',true,301);}
            elseif($item) {\SiteCms\PageTemplates::output($item,$configuration,$content);}
            else {throw new HttpError(404,'Diese Seite wurde nicht gefunden.');}
        }
    }
}catch(HttpError $error) {
    ob_clean();http_response_code($error->status);
    if(str_starts_with($path,'/api/cms/')) {Api::output(['error'=>$error->getMessage()],$error->status);}
    else {echo '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hinweis</title><link rel="stylesheet" href="/assets/cms.css"></head><body><main class="workspace"><h1>'.Html::escape($error->getMessage()).'</h1><p><a href="/admin/">Verwaltung</a> · <a href="/">Startseite</a></p></main></body></html>';}
}catch(Throwable $error) {ob_clean();error_log((string)$error);http_response_code(500);echo 'Die Anwendung konnte die Anfrage nicht abschließen. Bitte die Einrichtung und das Serverprotokoll prüfen.';}
if($method==='HEAD'){ob_end_clean();}else{ob_end_flush();}
