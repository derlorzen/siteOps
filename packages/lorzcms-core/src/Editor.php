<?php
declare(strict_types=1);
namespace SiteCms;

final class Editor {
    public function __construct(private Store $store,private Content $content,private Access $access,private Site $site) {}
    private function token():string {return '<input type="hidden" name="csrf" value="'.Html::escape($_SESSION['csrf']).'">';}
    public function page(array $actor,string $method,?string $id):array {
        $type=$id?($this->content->get($id)['type'] ?? throw new HttpError(404,'Inhalt nicht gefunden.')):(string)($_GET['type'] ?? array_key_first($this->content->schema->types));
        $definition=$this->content->schema->type($type);
        $item=$id?$this->content->get($id):['title'=>'','fields'=>[],'seo'=>$this->content->schema->seo([]),'path'=>'','status'=>'draft','version'=>0,'options'=>['categories'=>[],'layout'=>'default','blocks'=>[]]];
        $id?$this->access->require($actor,'edit',$item):$this->access->require($actor,'create');$error='';
        if($method==='POST'){
            try{
                if(isset($_POST['duplicate']) && $id){$saved=$this->content->create($type,$item['title'].' (Kopie)',null,$item['fields'],$item['seo'],'draft',$actor,null,$item['options']);}
                elseif(isset($_POST['trash']) && $id){$saved=$this->content->save($id,(int)($_POST['version'] ?? 0),['status'=>'trash'],$actor);}
                elseif(isset($_POST['restore']) && $id){
                    $row=$this->store->query('SELECT snapshot FROM revisions WHERE id=? AND content_id=?',[(string)$_POST['restore'],$id])->fetch() ?: throw new HttpError(404,'Version nicht gefunden.');
                    $old=Store::decode($row['snapshot']);$old['options'] ??= $this->site->initialOptions($old);$old['options']['template'] ??='inherit';$old['options']['page_template'] ??='inherit';$saved=$this->content->save($id,(int)($_POST['version'] ?? 0),array_intersect_key($old,array_flip(['title','fields','seo','status','options'])),$actor);
                } else {
                    $seo=[];foreach(['title','description','image','canonical','share_title','share_description'] as $key){$seo[$key]=(string)($_POST['seo_'.$key] ?? '');}$seo['noindex']=isset($_POST['seo_noindex']);$seo['nofollow']=isset($_POST['seo_nofollow']);
                    $changes=['title'=>(string)($_POST['title'] ?? ''),'fields'=>(array)($_POST['fields'] ?? []),'seo'=>$seo];
                    if(isset($_POST['options_present'])){$changes['options']=['categories'=>array_values((array)($_POST['categories'] ?? [])),'layout'=>(string)($_POST['layout'] ?? 'default'),'page_template'=>(string)($_POST['page_template'] ?? ($item['options']['page_template'] ?? 'inherit')),'template'=>(string)($_POST['template'] ?? ($item['options']['template'] ?? 'inherit')),'blocks'=>array_values((array)($_POST['blocks'] ?? []))];}
                    if(!$id || $this->access->can($actor,'routes')){$changes['path']=(string)($_POST['path'] ?? '');}
                    if($this->access->can($actor,'publish',$id?$item:null)){$changes['status']=(string)($_POST['status'] ?? 'draft');}
                    $saved=$id?$this->content->save($id,(int)($_POST['version'] ?? 0),$changes,$actor):$this->content->create($type,$changes['title'],$changes['path'] ?? null,$changes['fields'],$seo,$changes['status'] ?? 'draft',$actor,null,$changes['options'] ?? []);
                }
                header('Location: /admin/content/'.$saved['id'].'/?saved=1',true,303);return ['',''];
            }catch(HttpError $e){http_response_code($e->status);$error='<p class="error" role="alert">'.Html::escape($e->getMessage()).' Deine Eingaben bleiben unten erhalten.</p>';if(isset($changes)){$item=array_replace($item,$changes);}if($e->status===409){$item['version']=(int)($_POST['version'] ?? 0);$error.='<p><a href="/admin/content/'.Html::escape($id).'/" target="_blank" rel="noopener">Aktuellen Stand zum Vergleich öffnen</a>. Vor einem erneuten Speichern neu laden.</p>';}}
        }
        $e=Html::escape(...);$body=$error.(isset($_GET['saved'])?'<p class="success" role="status">Änderungen gespeichert.</p>':'');
        $body.='<div class="editor-actions"><a href="/admin/contents/">← Zur Inhaltsübersicht</a>';
        if($id){$body.='<a class="button secondary" href="/admin/preview/'.$e($id).'/" target="_blank" rel="noopener">Vorschau öffnen</a>';}
        if($item['path'] && $item['status']==='published'){$body.='<a href="'.$e($item['path']).'" target="_blank" rel="noopener">Öffentliche Seite →</a>';}$body.='</div>';
        $body.='<form method="post" class="editor" data-editor-form>'.$this->token().'<input type="hidden" name="version" value="'.$item['version'].'"><input type="hidden" name="options_present" value="1"><div class="editor-grid"><div class="editor-main"><div class="panel">'.SiteAdmin::field('title',['label'=>'Titel','required'=>true,'max'=>255],$item['title']).'</div><nav class="editor-tabs" aria-label="Editor-Bereiche"><a href="#tab-content">Inhalt</a><a href="#tab-structure">Kategorien & Layout</a><a href="#tab-seo">SEO & Teilen</a><a href="#tab-history">Versionen</a></nav>';
        $body.='<section id="tab-content" class="editor-panel panel"><h2>Inhalt</h2>';
        $catalog=[];foreach((new Placeholders($this->content))->definitions() as $name=>$widget){$catalog[$name]=array_diff_key($widget,['render'=>true]);}$data=['modules'=>$catalog,'fields'=>array_merge(['title'=>'Titel'],array_map(static fn($field)=>$field['label'],$definition['fields']))];$body.='<script type="application/json" data-placeholder-catalog>'.json_encode($data,JSON_THROW_ON_ERROR|JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT|JSON_UNESCAPED_UNICODE).'</script><p class="editor-help">Module und Inhaltsplatzhalter kannst du direkt über die Werkzeugleiste des Texteditors einsetzen.</p>';
        foreach($definition['fields'] as $key=>$field){if($field['admin_hidden'] ?? false){continue;}if(($field['kind'] ?? '')==='rows'){$body.=$this->rows($key,$field,$item['fields'][$key] ?? []);}else{$body.=SiteAdmin::field('fields['.$key.']',$field,$item['fields'][$key] ?? ($field['default'] ?? ''));}}
        $body.='</section><section id="tab-structure" class="editor-panel panel"><h2>Kategorien & Layout</h2><fieldset><legend>Kategorien</legend>';
        foreach($this->site->categoriesFor($type) as $category){$body.='<label class="check"><input type="checkbox" name="categories[]" value="'.$e($category['id']).'"'.(in_array($category['id'],$item['options']['categories'],true)?' checked':'').'>'.$e($category['name']).'</label>';}
        if(!$this->site->categoriesFor($type)){$body.='<p class="muted">Für diesen Inhaltstyp gibt es noch keine Kategorien.</p>';}
        $body.='</fieldset>'.SiteAdmin::field('layout',['label'=>'Layoutvorlage','kind'=>'select','default'=>'default','options'=>array_keys($this->site->layouts()),'option_labels'=>array_map(static fn($v)=>$v['label'],$this->site->layouts())],$item['options']['layout']);
        $pageLabels=['inherit'=>'Globales Basislayout übernehmen']+PageTemplates::PRESETS;
        $body.=SiteAdmin::field('page_template',['label'=>'Basislayout der Seite','kind'=>'select','default'=>'inherit','options'=>array_keys($pageLabels),'option_labels'=>$pageLabels,'help'=>'Gilt für gemeinsame Seitentemplates. Inhalt, Inhaltsvorlage und Projektmodule bleiben unabhängig davon.'],$item['options']['page_template'] ?? 'inherit');
        $templateLabels=['inherit'=>'Standardvorlage des Inhaltstyps','none'=>'Ohne Inhaltsvorlage'];foreach($this->site->value('templates') as $template){if(in_array($type,$template['types'],true)){$templateLabels[$template['id']]=$template['name'];}}$body.=SiteAdmin::field('template',['label'=>'Inhaltsvorlage','kind'=>'select','default'=>'inherit','options'=>array_keys($templateLabels),'option_labels'=>$templateLabels],$item['options']['template'] ?? 'inherit');if($this->access->can($actor,'settings')){$body.='<a class="text-link" href="/admin/templates/" target="_blank" rel="noopener">Gemeinsame Vorlagen gestalten →</a>';}
        $body.='<h3>Zusätzliche Inhaltsbausteine</h3><p class="muted">Diese Abschnitte erscheinen unterhalb des Hauptinhalts. Reihenfolge und Inhalt sind frei editierbar.</p><div class="collection" data-collection="blocks">';
        foreach($item['options']['blocks'] as $index=>$block){$body.=$this->block((string)$index,$block);}
        $body.='</div><template data-collection-template="blocks">'.$this->block('__INDEX__',[]).'</template><button type="button" class="secondary" data-add-row="blocks">Baustein hinzufügen</button></section>';
        $body.='<section id="tab-seo" class="editor-panel panel"><h2>SEO & Teilen</h2><div class="search-preview" aria-label="Suchergebnis-Vorschau"><small data-seo-url>'.$e($item['path']?:'/deine-seite/').'</small><h3 data-seo-preview-title>'.$e($item['seo']['title']?:$item['title']).'</h3><p data-seo-preview-description>'.$e($item['seo']['description']).'</p></div>';
        foreach(['title'=>['label'=>'SEO-Titel','max'=>255,'help'=>'Richtwert: etwa 50–65 Zeichen. Leer übernimmt den Inhaltstitel und den globalen Zusatz.'],'description'=>['label'=>'Beschreibung','kind'=>'textarea','max'=>1000,'help'=>'Richtwert: etwa 140–170 Zeichen.'],'canonical'=>['label'=>'Canonical-Adresse','max'=>1000,'help'=>'Leer verwendet automatisch die bestehende Seitenadresse.'],'image'=>['label'=>'Vorschaubild-URL','max'=>1000],'share_title'=>['label'=>'Titel beim Teilen','max'=>255],'share_description'=>['label'=>'Beschreibung beim Teilen','kind'=>'textarea','max'=>1000]] as $key=>$field){$body.=SiteAdmin::field('seo_'.$key,$field,$item['seo'][$key] ?? '');}
        $body.='<label class="check"><input type="checkbox" name="seo_noindex"'.($item['seo']['noindex']?' checked':'').'>Von Suchmaschinen ausschließen (noindex)</label><label class="check"><input type="checkbox" name="seo_nofollow"'.(($item['seo']['nofollow'] ?? false)?' checked':'').'>Links nicht verfolgen (nofollow)</label></section>';
        $body.='<section id="tab-history" class="editor-panel panel"><h2>Bisherige Versionen</h2><ul class="revision-list">';
        if($id){foreach($this->store->query('SELECT id,version,created_at FROM revisions WHERE content_id=? ORDER BY version DESC',[$id])->fetchAll() as $revision){$body.='<li><span>Version '.$revision['version'].' · '.$e($revision['created_at']).'</span>';if((int)$revision['version']!==$item['version']){$body.='<button class="secondary" name="restore" value="'.$e($revision['id']).'" formnovalidate>Wiederherstellen</button>';}$body.='</li>';}}
        else{$body.='<li>Nach dem ersten Speichern erscheinen hier die Versionen.</li>';}
        $body.='</ul></section></div><aside class="editor-aside"><section class="panel"><h2>Veröffentlichung</h2><p><span class="badge">'.$e($definition['label']).'</span> · Version '.$item['version'].'</p>';
        if($this->access->can($actor,'publish',$id?$item:null)){$body.=SiteAdmin::field('status',['label'=>'Status','kind'=>'select','default'=>'draft','options'=>$item['status']==='trash'?['draft','published','trash']:['draft','published'],'option_labels'=>['draft'=>'Entwurf','published'=>'Veröffentlicht','trash'=>'Papierkorb']],$item['status']);}
        else{$body.='<p>'.($item['status']==='published'?'Veröffentlicht':'Entwurf').'</p>';}
        $body.='<label>Öffentlicher Pfad<input name="path" value="'.$e($item['path']).'"'.(!$id || $this->access->can($actor,'routes')?'':' readonly').'><small>Bleibt beim Ändern des Titels erhalten. Bei einer Änderung unter SEO eine Weiterleitung anlegen.</small></label><button class="full-width">Speichern</button><p class="muted" data-dirty-status role="status">Alle Änderungen gespeichert.</p>';
        if($id && $this->access->can($actor,'create')){$body.='<button class="secondary full-width" name="duplicate" value="1" formnovalidate>Als Entwurf duplizieren</button>';}
        if($id && $item['status']!=='trash' && $this->access->can($actor,'publish',$item)){$body.='<button class="danger full-width" name="trash" value="1" formnovalidate>In den Papierkorb</button>';}
        if($item['status']==='trash'){$body.='<p>Zum Wiederherstellen den Status auf Entwurf oder Veröffentlicht setzen und speichern. Frühere Inhalte findest du unter Versionen.</p>';}
        $body.='</section><section class="panel"><h2>Medien verwenden</h2><p>Bild oder PDF in der Mediathek hochladen, dann die Datei-URL in das passende Feld einfügen.</p><a href="/admin/media/" target="_blank" rel="noopener">Mediathek öffnen →</a></section></aside></div></form>';
        return [$id?$item['title']:'Neuer Inhalt · '.$definition['label'],$body];
    }
    private function rows(string $key,array $definition,mixed $rows):string {
        $rows=is_array($rows)?$rows:[];$e=Html::escape(...);$name='fields['.$key.']';$html='<fieldset><legend>'.$e($definition['label']).'</legend><div data-collection="'.$e($name).'" class="collection">';
        foreach($rows as $index=>$row){$html.=$this->row($name,(string)$index,$definition['columns'],is_array($row)?$row:[]);}
        return $html.'</div><template data-collection-template="'.$e($name).'">'.$this->row($name,'__INDEX__',$definition['columns'],[]).'</template><button type="button" class="secondary" data-add-row="'.$e($name).'">Zeile hinzufügen</button></fieldset>';
    }
    private function row(string $name,string $index,array $fields,array $row):string {
        $html='<div class="collection-row" data-row>';foreach($fields as $key=>$field){$html.=SiteAdmin::field($name.'['.$index.']['.$key.']',$field,$row[$key] ?? '');}return $html.$this->actions().'</div>';
    }
    private function block(string $index,array $block):string {
        $fields=['kind'=>['label'=>'Baustein','kind'=>'select','default'=>'text','options'=>['text','image','cta'],'option_labels'=>['text'=>'Textabschnitt','image'=>'Bild mit Bildunterschrift','cta'=>'Text mit Link / Button']], 'title'=>['label'=>'Überschrift','max'=>255], 'body'=>['label'=>'Text / Bildunterschrift','kind'=>'html'], 'image'=>['label'=>'Bild-URL'], 'alt'=>['label'=>'Bild-Alternativtext'], 'label'=>['label'=>'Linktext'], 'url'=>['label'=>'Link-Ziel']];
        return $this->row('blocks',$index,$fields,$block);
    }
    private function actions():string {return '<div class="row-actions"><button type="button" class="secondary" data-row-up>Nach oben</button><button type="button" class="secondary" data-row-down>Nach unten</button><button type="button" class="danger" data-row-remove>Entfernen</button></div>';}
}
