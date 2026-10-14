<?php
declare(strict_types=1);
namespace SiteCms;

/** Generic schema-generated administration. No project content types live here. */
final class Admin {
    public function __construct(private Store $store,private Content $content,private Access $access,private Media $media,private string $name,private Site $site,private array $configuration,private array $project) {}
    private function csrf():string { return '<input type="hidden" name="csrf" value="'.Html::escape($_SESSION['csrf']).'">'; }
    private function redirect(string $url):never { header('Location: '.$url,true,303); exit; }
    private function layout(string $title,string $body,?array $actor=null):void {
        $e=Html::escape(...);
        $path=parse_url($_SERVER['REQUEST_URI'] ?? '/admin/',PHP_URL_PATH);
        echo '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><link rel="icon" href="/assets/sitecms-favicon.svg" type="image/svg+xml"><title>'.$e($title).' · LorzCMS</title><link rel="stylesheet" href="/assets/cms-tailwind.css?v=3.3.0"><link rel="stylesheet" href="/assets/cms.css"><link rel="stylesheet" href="/assets/cms-admin.css"><link rel="stylesheet" href="/assets/builder.css"><link rel="stylesheet" href="/assets/cms-modern.css"></head><body class="admin '.($actor?'signed-in':'signed-out').'"><a class="skip" href="#workspace">Zum Inhalt</a>';
        if($actor){echo '<aside class="admin-sidebar"><a class="admin-brand" href="/admin/">LorzCMS <small>'.$e($this->site->value('settings')['name']).'</small></a><nav aria-label="Verwaltung">';
            foreach([''=>'Übersicht','contents'=>'Inhalte','templates'=>'Vorlagen','categories'=>'Kategorien','media'=>'Medien','menus'=>'Menüs','layout'=>'Layout','seo'=>'SEO','customizations'=>'Individualisierungen','settings'=>'Einstellungen','users'=>'Benutzer'] as $key=>$label){
                $permission=match($key){'categories'=>'categories','menus'=>'menus','templates','layout','seo','customizations','settings'=>'settings','users'=>'users',default=>'read'};
                if(!$this->access->can($actor,$permission)){continue;}$url='/admin/'.($key!==''?$key.'/':'');$active=$key===''?$path==='/admin/':str_starts_with($path,$url) || ($key==='contents' && (str_starts_with($path,'/admin/content/') || str_starts_with($path,'/admin/new/')));
                echo '<a href="'.$url.'"'.($active?' aria-current="page"':'').'>'.$e($label).'</a>';
            }if(isset($this->project['types']['person'])){echo '<a href="/admin/contents/?type=person">Mein Team</a>';}echo '</nav><div class="sidebar-bottom"><a href="/" target="_blank" rel="noopener">Website ansehen ↗</a><small>'.$e($actor['name'] ?? 'Redaktion').' · '.$e($this->access->roles[$actor['role']]['label']).'</small><form method="post" action="/admin/logout/">'.$this->csrf().'<button class="link">Abmelden</button></form></div></aside>';}
        else{echo '<header class="topbar"><a href="/">LorzCMS <small>'.$e($this->name).'</small></a></header>';}
        echo '<main id="workspace" class="workspace"><div class="workspace-heading"><div><p class="eyebrow">'.$e($this->name).' / Verwaltung</p><h1>'.$e($title).'</h1></div>'.($actor?'<span class="environment">'.($this->configuration['environment']==='production'?'Produktion':'Vorschau').'</span>':'').'</div>'.$body.'</main><script src="/assets/cms.js" defer></script><script src="/assets/template-builder.js" defer></script><script src="/assets/media-picker.js" defer></script></body></html>';
    }
    public function handle(string $path,string $method):void {
        header('Cache-Control: no-store'); $this->access->session(); $actor=$this->access->current();
        if($method==='POST') { $this->access->csrf((string)($_POST['csrf'] ?? '')); }
        if($path==='/admin/login/') {
            if($actor) {$this->redirect('/admin/');}
            $error='';
            if($method==='POST') {
                $user=$this->access->attempt((string)($_POST['email'] ?? ''),(string)($_POST['password'] ?? ''),(string)($_SERVER['REMOTE_ADDR'] ?? ''));
                if($user) { $this->access->login($user); $this->redirect('/admin/'); } $error='<p class="error">E-Mail oder Passwort stimmt nicht.</p>';
            }
            $this->layout('Anmelden',$error.'<form method="post" class="login">'.$this->csrf().'<label>E-Mail<input type="email" name="email" required autocomplete="username"></label><label>Passwort<input type="password" name="password" required autocomplete="current-password"></label><button>Anmelden</button></form>'); return;
        }
        if(!$actor) { $this->redirect('/admin/login/'); }
        if($path==='/admin/media-picker/') {
            $this->access->require($actor,'media');header('Content-Type: application/json; charset=utf-8');
            if($method==='POST') {
                $file=$_FILES['file'] ?? [];$temp=$file['tmp_name'] ?? '';
                if(!is_uploaded_file($temp) || !in_array((new \finfo(FILEINFO_MIME_TYPE))->file($temp),['image/jpeg','image/png','image/webp'],true)){throw new HttpError(422,'Bitte JPG, PNG oder WebP auswählen.');}
                echo json_encode($this->media->upload($file,$actor),JSON_THROW_ON_ERROR);return;
            }
            $images=$this->store->query("SELECT id,name,mime FROM media WHERE mime LIKE 'image/%' ORDER BY name")->fetchAll();
            foreach($images as &$image){$image['url']='/media/'.$image['id'];}unset($image);
            if($catalog=$this->project['media_catalog'] ?? null){foreach($catalog($this->configuration) as $image){if(str_starts_with($image['mime'],'image/')){$images[]=$image;}}}
            echo json_encode(['images'=>$images],JSON_THROW_ON_ERROR);return;
        }
        if($path==='/admin/page-preview/' && $method==='GET'){
            $this->access->require($actor,'settings');$preset=(string)($_GET['layout'] ?? 'studio');
            if(!isset(PageTemplates::PRESETS[$preset])){throw new HttpError(422,'Unbekanntes Basislayout.');}
            $items=array_values(array_filter($this->content->list($actor),static fn($item)=>$item['status']!=='trash'));
            $item=$items[0] ?? throw new HttpError(404,'Bitte zuerst einen Inhalt anlegen, um das Layout mit echten Inhalten anzusehen.');
            $item['options']['page_template']=$preset;header('X-Robots-Tag: noindex, nofollow');
            echo (new PageTemplates($this->content,array_replace($this->configuration,['environment'=>'development'])))->render($item);return;
        }
        if($path==='/admin/template-preview/' && $method==='POST'){(new TemplateAdmin($this->content,$this->access,$this->configuration))->preview($actor);return;}
        if($path==='/admin/templates/'){[$title,$body]=(new TemplateAdmin($this->content,$this->access,$this->configuration))->page($actor,$method);if(http_response_code()!==303){$this->layout($title,$body,$actor);}return;}
        if($path==='/admin/logout/' && $method==='POST') { $_SESSION=[]; session_regenerate_id(true); $this->redirect('/admin/login/'); }
        if($path==='/admin/users/') {$this->users($actor,$method);return;}
        if(preg_match('~^/admin/preview/([a-zA-Z0-9_-]+)/$~D',$path,$match) && $method==='GET'){
            $item=$this->content->get($match[1]) ?? throw new HttpError(404,'Inhalt nicht gefunden.');$this->access->require($actor,'read',$item);
            header('X-Robots-Tag: noindex, nofollow');PageTemplates::output($item,array_replace($this->configuration,['environment'=>'development']),$this->content);return;
        }
        if(preg_match('~^/admin/(settings|layout|categories|menus|seo|redirects|customizations)(/|$)~',$path)){
            [$title,$body]=(new SiteAdmin($this->site,$this->content,$this->access,$this->configuration))->page($path,$method,$actor);
            if(http_response_code()!==303){$this->layout($title,$body,$actor);}return;
        }
        if($path==='/admin/media/') {
            $this->access->require($actor,'media');
            if($method==='POST') { $this->media->upload($_FILES['file'] ?? [],$actor); $this->redirect('/admin/media/'); }
            $body='<section class="panel"><h2>Datei hochladen</h2><form method="post" enctype="multipart/form-data">'.$this->csrf().'<label>Bild oder PDF (max. 10 MB)<input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" required></label><button>Hochladen</button></form></section>';
            $items=$this->store->query('SELECT * FROM media ORDER BY name')->fetchAll();foreach($items as &$item){$item['url']='/media/'.$item['id'];}unset($item);
            $catalog=$this->project['media_catalog'] ?? null;if($catalog){$items=array_merge($items,$catalog($this->configuration));}
            $search=trim((string)($_GET['q'] ?? ''));$body.='<form class="filters" method="get"><label>Dateien suchen<input name="q" value="'.Html::escape($search).'" placeholder="Dateiname"></label><button class="secondary">Suchen</button></form><div class="media-grid">';
            $items=array_values(array_filter($items,static fn($item)=>$search==='' || mb_stripos($item['name'],$search)!==false));[$items,$pager]=$this->paginate($items,24);
            foreach($items as $item) {if($search!=='' && mb_stripos($item['name'],$search)===false){continue;}$url=Html::escape($item['url']);$body.='<article class="media-card">'.(str_starts_with($item['mime'],'image/')?'<img src="'.$url.'" alt="'.Html::escape($item['name']).'" loading="lazy">':'<span class="badge">PDF</span>').'<h2><a href="'.$url.'" target="_blank" rel="noopener">'.Html::escape($item['name']).'</a></h2><small>'.number_format($item['bytes']/1024,0,',','.').' KB'.(!empty($item['imported'])?' · Übernommen':'').'</small><code>'.$url.'</code><button type="button" class="secondary" data-copy-url="'.$url.'">Datei-URL kopieren</button></article>'; }
            $this->layout('Medien',$body.'</div>'.$pager,$actor);return;
        }
        if($path==='/admin/new/') {$this->editor($actor,$method,null);return;}
        if(preg_match('~^/admin/content/([a-zA-Z0-9_-]+)/$~D',$path,$match)) { $this->editor($actor,$method,$match[1]);return; }
        if($path==='/admin/' && !isset($_GET['type']) && !isset($_GET['q'])) {$this->dashboard($actor);return;}
        if(!in_array($path,['/admin/','/admin/contents/'],true)) {throw new HttpError(404,'Verwaltungsseite nicht gefunden.');}
        $type=!empty($_GET['type']) ? (string)$_GET['type'] : null; $items=$this->content->list($actor,$type);
        $query=trim((string)($_GET['q'] ?? ''));$status=(string)($_GET['status'] ?? '');$category=(string)($_GET['category'] ?? '');
        $items=array_values(array_filter($items,static fn($item)=>($query==='' || mb_stripos($item['title'].' '.$item['path'],$query)!==false) && ($status===''?$item['status']!=='trash':$item['status']===$status) && ($category==='' || in_array($category,$item['options']['categories'],true))));
        $body='<div class="toolbar"><nav><a href="/admin/contents/">Alle Inhalte</a><a href="/admin/contents/?status=trash">Papierkorb</a>';
        foreach($this->content->schema->types as $key=>$definition) {$body.='<a href="/admin/?type='.rawurlencode($key).'">'.Html::escape($definition['label']).'</a>';}
        $body.='</nav>'; if($this->access->can($actor,'create')) {$body.='<a class="button" href="/admin/new/?type='.rawurlencode($type ?? array_key_first($this->content->schema->types)).'">Inhalt anlegen</a>';}
        $body.='</div><form class="filters" method="get"><label>Suche<input name="q" value="'.Html::escape($query).'" placeholder="Titel oder Pfad"></label><input type="hidden" name="type" value="'.Html::escape($type ?? '').'"><label>Status<select name="status"><option value="">Alle</option><option value="draft"'.($status==='draft'?' selected':'').'>Entwurf</option><option value="published"'.($status==='published'?' selected':'').'>Veröffentlicht</option><option value="trash"'.($status==='trash'?' selected':'').'>Papierkorb</option></select></label><label>Kategorie<select name="category"><option value="">Alle</option>';
        foreach($this->site->value('categories') as $row){$body.='<option value="'.Html::escape($row['id']).'"'.($category===$row['id']?' selected':'').'>'.Html::escape($row['name']).'</option>';}
        $body.='</select></label><button class="secondary">Filtern</button><a href="/admin/contents/">Zurücksetzen</a></form><p class="muted">'.count($items).' Inhalte · Änderungen werden versioniert. Bestehende Adressen bleiben beim Umbenennen erhalten.</p><div class="table-scroll"><table><thead><tr><th>Inhalt</th><th>Typ</th><th>Status</th><th>URL</th></tr></thead><tbody>';
        [$items,$pager]=$this->paginate($items,50);
        foreach($items as $item) {$body.='<tr><td><a href="/admin/content/'.$item['id'].'/">'.Html::escape($item['title']).'</a></td><td>'.Html::escape($this->content->schema->type($item['type'])['label']).'</td><td>'.(['published'=>'Veröffentlicht','draft'=>'Entwurf','trash'=>'Papierkorb'][$item['status']]).'</td><td><code>'.Html::escape($item['path'] ?? '—').'</code></td></tr>';}
        $this->layout('Inhalte',$body.'</tbody></table></div>'.$pager,$actor);
    }
    private function paginate(array $items,int $size):array {
        $pages=max(1,(int)ceil(count($items)/$size));$page=max(1,min($pages,(int)($_GET['p'] ?? 1)));$html='';
        if($pages>1){$html='<nav class="pagination" aria-label="Ergebnisseiten">';$query=array_intersect_key($_GET,array_flip(['q','type','status','category']));
            for($index=max(1,$page-2);$index<=min($pages,$page+2);$index++){$html.='<a href="?'.Html::escape(http_build_query(array_replace($query,['p'=>$index]))).'"'.($index===$page?' aria-current="page"':'').'>'.$index.'</a>';}$html.='<span>Seite '.$page.' von '.$pages.'</span></nav>';
        }return [array_slice($items,($page-1)*$size,$size),$html];
    }
    private function dashboard(array $actor):void {
        $items=array_values(array_filter($this->content->list($actor),static fn($i)=>$i['status']!=='trash'));$published=count(array_filter($items,static fn($i)=>$i['status']==='published'));$drafts=count($items)-$published;
        $body='<p class="intro">Inhalte pflegen, Website gestalten und projektspezifische Funktionen verwalten.</p><div class="overview-counts"><a href="/admin/contents/"><strong>'.count($items).'</strong> Inhalte</a><a href="/admin/contents/?status=published"><strong>'.$published.'</strong> Veröffentlicht</a><a href="/admin/contents/?status=draft"><strong>'.$drafts.'</strong> Entwürfe</a></div><div class="dashboard-grid"><section class="panel"><h2>Zuletzt bearbeitet</h2><ul class="activity-list">';
        usort($items,static fn($a,$b)=>strcmp($b['updated_at'],$a['updated_at']));foreach(array_slice($items,0,8) as $item){$body.='<li><a href="/admin/content/'.$item['id'].'/">'.Html::escape($item['title']).'</a><small>'.Html::escape(substr($item['updated_at'],0,10)).' · Version '.$item['version'].'</small></li>';}
        $body.='</ul></section><section class="panel"><h2>Inhalt anlegen</h2><div class="quick-links">';
        if($this->access->can($actor,'create')){foreach($this->content->schema->types as $key=>$type){if($type['legacy'] ?? false){continue;}$body.='<a href="/admin/new/?type='.rawurlencode($key).'">'.$type['label'].' <span>+</span></a>';}}else{$body.='<p>Du kannst die dir zugeordneten Inhalte bearbeiten.</p>';}
        $body.='</div></section></div>';if($this->access->can($actor,'settings')){$body.='<section class="panel"><h2>Website konfigurieren</h2><div class="quick-links"><a href="/admin/menus/">Navigation bearbeiten →</a><a href="/admin/layout/">Layout einstellen →</a><a href="/admin/seo/">SEO prüfen →</a><a href="/admin/customizations/">Individualisierungen →</a></div></section>';}
        $this->layout('Übersicht',$body,$actor);
    }
    private function editor(array $actor,string $method,?string $id):void {
        [$title,$body]=(new Editor($this->store,$this->content,$this->access,$this->site))->page($actor,$method,$id);
        if(http_response_code()===303){return;}
        $this->layout($title,$body,$actor);
    }
    private function users(array $actor,string $method):void {
        $this->access->require($actor,'users');
        if($method==='POST') {
            if(isset($_POST['disable'])) {
                $id=(string)$_POST['disable']; if($id===$actor['id']) {throw new HttpError(422,'Das eigene Konto kann hier nicht deaktiviert werden.');}
                $user=$this->store->query('SELECT * FROM users WHERE id=?',[$id])->fetch() ?: throw new HttpError(404,'Benutzer nicht gefunden.');
                $this->access->update($actor,$id,$user['name'],$user['role'],Store::decode($user['grants']),false);
            } elseif(isset($_POST['update'])) {
                $this->access->update($actor,(string)$_POST['update'],(string)$_POST['name'],(string)$_POST['role'],(array)($_POST['grants'] ?? []),isset($_POST['active']),(string)($_POST['password'] ?? ''));
            } else {
                $this->access->create((string)$_POST['email'],(string)$_POST['name'],(string)$_POST['password'],(string)$_POST['role'],(array)($_POST['grants'] ?? []));
            }
            $this->redirect('/admin/users/');
        }
        if(isset($_GET['edit'])) {
            $user=$this->store->query('SELECT * FROM users WHERE id=?',[(string)$_GET['edit']])->fetch() ?: throw new HttpError(404,'Benutzer nicht gefunden.');
            $e=Html::escape(...);$grants=Store::decode($user['grants']);
            $body='<form method="post">'.$this->csrf().'<input type="hidden" name="update" value="'.$e($user['id']).'"><p>'.$e($user['email']).'</p><label>Name<input name="name" required value="'.$e($user['name']).'"></label><label>Rolle<select name="role">';
            foreach($this->access->roles as $key=>$role){$body.='<option value="'.$e($key).'" '.($key===$user['role']?'selected':'').'>'.$e($role['label']).'</option>';}
            $body.='</select></label><label class="check"><input type="checkbox" name="active" '.($user['active']?'checked':'').'>Aktiv</label><label>Neues Passwort (leer lassen, um es beizubehalten)<input type="password" name="password" minlength="12" maxlength="72" autocomplete="new-password"></label><fieldset><legend>Zugeordnete Inhalte</legend>';
            foreach($this->content->list($actor) as $item){$body.='<label class="check"><input type="checkbox" name="grants[]" value="'.$e($item['id']).'" '.(in_array($item['id'],$grants,true)?'checked':'').'>'.$e($item['title']).'</label>';}
            $this->layout('Benutzer bearbeiten',$body.'</fieldset><p class="muted">Beim Speichern werden bestehende Sitzungen und API-Tokens dieses Kontos beendet.</p><button>Speichern</button></form>',$actor);return;
        }
        $body='<table><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Status</th><th></th></tr></thead><tbody>';
        foreach($this->store->query('SELECT id,name,email,role,active FROM users ORDER BY name')->fetchAll() as $user) {$body.='<tr><td><a href="/admin/users/?edit='.$user['id'].'">'.Html::escape($user['name']).'</a></td><td>'.Html::escape($user['email']).'</td><td>'.Html::escape($user['role']).'</td><td>'.($user['active']?'Aktiv':'Deaktiviert').'</td><td>';if($user['active'] && $user['id']!==$actor['id']) {$body.='<form method="post">'.$this->csrf().'<button name="disable" value="'.$user['id'].'">Deaktivieren</button></form>';}$body.='</td></tr>';}
        $body.='</tbody></table><h2>Benutzer anlegen</h2><form method="post">'.$this->csrf().'<label>Name<input name="name" required></label><label>E-Mail<input type="email" name="email" required></label><label>Passwort (mindestens 12 Zeichen)<input type="password" name="password" minlength="12" required autocomplete="new-password"></label><label>Rolle<select name="role">';
        foreach($this->access->roles as $key=>$role) {$body.='<option value="'.Html::escape($key).'">'.Html::escape($role['label']).'</option>';}
        $body.='</select></label><fieldset><legend>Zugeordnete Inhalte für eingeschränkte Rollen</legend>';
        foreach($this->content->list($actor) as $item) {$body.='<label class="check"><input type="checkbox" name="grants[]" value="'.$item['id'].'">'.Html::escape($item['title']).'</label>';}
        $this->layout('Benutzer',$body.'</fieldset><button>Benutzer anlegen</button></form>',$actor);
    }
}
