<?php
declare(strict_types=1);
namespace SiteCms;

/** Admin workflows for reusable website functions and registered project extensions. */
final class SiteAdmin {
    public function __construct(private Site $site,private Content $content,private Access $access,private array $configuration) {}
    private function token():string {return '<input type="hidden" name="csrf" value="'.Html::escape($_SESSION['csrf']).'">';}
    public function page(string $path,string $method,array $actor):array {
        $sections=['/admin/settings/'=>'settings','/admin/layout/'=>'appearance','/admin/categories/'=>'categories','/admin/menus/'=>'menus','/admin/seo/'=>'seo','/admin/redirects/'=>'redirects'];
        if($path==='/admin/customizations/') {return ['Individualisierungen',$this->modules($actor)];}
        if(preg_match('~^/admin/customizations/([a-z0-9_-]+)/$~D',$path,$m)){$section='module:'.$m[1];}
        else{$section=$sections[$path] ?? throw new HttpError(404,'Bereich nicht gefunden.');}
        $this->access->require($actor,$this->site->permission($section));$record=$this->site->get($section);$error='';
        $titles=['categories'=>'Kategorien','menus'=>'Menüs','redirects'=>'Weiterleitungen'];
        $definition=$this->site->sections()[$section] ?? (str_starts_with($section,'module:')?($this->site->project['customizations'][substr($section,7)] ?? []):[]);
        $title=$titles[$section] ?? ($definition['label'] ?? 'Website');
        if($method==='POST') {
            try {
                if(isset($_POST['restore'])){$this->site->restore($section,(string)$_POST['restore'],(int)($_POST['version'] ?? -1),$actor);}
                else {
                    $value=(array)($_POST['values'] ?? []);
                    if($section==='categories'){foreach($value as &$row){if(is_array($row) && is_array($row['types'] ?? null)){foreach($row['types'] as $type){if(!is_string($type)){throw new HttpError(422,'Ungültige Inhaltstypen.');}}$row['types']=implode(',',$row['types']);}}unset($row);}
                    if(isset($titles[$section])){$value=array_values(array_filter($value,static fn($row)=>is_array($row) && array_filter(array_diff_key($row,['id'=>true,'parent'=>true,'location'=>true]),static fn($v)=>!is_string($v) || trim($v)!=='')));}
                    if($section==='redirects'){foreach($value as $row){if($this->content->at((string)($row['from'] ?? ''))){throw new HttpError(422,'Eine veröffentlichte Seite belegt den Quellpfad. Zuerst die Seite verschieben oder als Entwurf speichern.');}}}
                    $this->site->save($section,(int)($_POST['version'] ?? -1),$value,$actor);
                }
                header('Location: '.$path.'?saved=1',true,303);return [$title,''];
            } catch(HttpError $e) {http_response_code($e->status);$error='<p class="error" role="alert">'.Html::escape($e->getMessage()).'</p>';if(!isset($_POST['restore'])){$record['value']=(array)($_POST['values'] ?? []);}if($e->status===409){$record['version']=(int)($_POST['version'] ?? -1);$error.='<p><a href="'.Html::escape($path).'" target="_blank" rel="noopener">Aktuellen Stand zum Vergleich öffnen</a>. Vor einem erneuten Speichern neu laden.</p>';}}
        }
        $body=$error.(isset($_GET['saved'])?'<p class="success" role="status">Änderungen gespeichert.</p>':'');
        $description=$definition['description'] ?? match($section){'categories'=>'Ordne Inhalte nach Themen. Kategorien können hierarchisch aufgebaut und auf bestimmte Inhaltstypen eingeschränkt werden.','menus'=>'Beschriftung, Ziel, Reihenfolge und Hierarchie für Hauptnavigation und Fußzeile.','redirects'=>'Alte Adressen auf ein neues Ziel umleiten (HTTP 301). Bestehende Seitenpfade werden nicht automatisch geändert.',default=>''};
        $body.='<p class="intro">'.Html::escape($description).'</p><form method="post" class="settings-form">'.$this->token().'<input type="hidden" name="version" value="'.$record['version'].'">';
        if($section==='appearance'){$body.=self::presetCards();}
        if(isset($titles[$section])){$body.=$this->collection($section,$record['value']);}
        else {foreach($definition['fields'] as $key=>$field){$body.=($field['admin_hidden'] ?? false)?'<input type="hidden" name="values['.Html::escape($key).']" value="'.Html::escape((string)($record['value'][$key] ?? '')).'">':self::field('values['.$key.']',$field,$record['value'][$key] ?? '');}}
        $body.='<div class="save-bar"><span>Version '.$record['version'].'</span><button>Änderungen speichern</button></div></form>';
        $history=$this->site->history($section);if($history){$body.='<details class="panel"><summary>Änderungsverlauf</summary><ul class="revision-list">';foreach($history as $row){$body.='<li>Version '.$row['version'].' · '.Html::escape($row['created_at']);if((int)$row['version']!==$record['version']){$body.='<form method="post">'.$this->token().'<input type="hidden" name="version" value="'.$record['version'].'"><button class="secondary" name="restore" value="'.Html::escape($row['id']).'">Wiederherstellen</button></form>';}$body.='</li>';}$body.='</ul></details>';}
        if($section==='seo'){$body.=$this->seoAudit($actor);}
        if($section==='settings'){$body.='<section class="panel"><h2>Betrieb</h2><dl class="facts"><dt>Website-Adresse</dt><dd>'.Html::escape($this->configuration['base_url']).'</dd><dt>Umgebung</dt><dd>'.($this->configuration['environment']==='production'?'Produktion':'Vorschau – Suchmaschinen gesperrt').'</dd><dt>PHP</dt><dd>'.Html::escape(PHP_VERSION).'</dd></dl></section>';}
        if(isset($definition['admin_status']) && is_callable($definition['admin_status'])){
            $body.='<section class="panel"><h2>Datenanbindung</h2><dl class="facts">';
            foreach(($definition['admin_status'])($this->configuration,$this->content) as $label=>$value){$body.='<dt>'.Html::escape((string)$label).'</dt><dd>'.Html::escape((string)$value).'</dd>';}
            $body.='</dl></section>';
        }
        return [$title,$body];
    }
    public static function field(string $name,array $field,mixed $value):string {
        $e=Html::escape(...);$value=is_string($value)?$value:'';$kind=$field['kind'] ?? 'text';$required=($field['required'] ?? false)?' required':'';
        if($kind==='image'){
            return '<div class="image-control" data-image-control><label class="field">'.$e($field['label']).'<input name="'.$e($name).'" value="'.$e($value).'" data-image-url'.$required.'></label><img class="image-field-preview" src="'.$e($value).'" alt="Aktuelle Bildauswahl"'.($value===''?' hidden':'').'><div class="image-field-actions"><button type="button" class="secondary" data-open-image-picker>Foto auswählen oder hochladen</button><button type="button" class="secondary" data-clear-image>Foto entfernen</button></div><small>'.$e($field['help'] ?? 'Bild aus der Mediathek auswählen oder neu hochladen.').'</small><noscript><a href="/admin/media/" target="_blank">Mediathek öffnen und Datei-URL kopieren</a></noscript></div>';
        }
        if($kind==='code'){return '<label class="field">'.$e($field['label']).'<textarea class="template-code" spellcheck="false" name="'.$e($name).'" rows="8" maxlength="'.($field['max'] ?? 100000).'">'.$e($value).'</textarea><small>'.$e($field['help'] ?? '').'</small></label>';}
        if($kind==='multi'){$selected=$value===''?[]:array_map('trim',explode(',',$value));$html='<fieldset class="types-field"><legend>'.$e($field['label']).'</legend>';foreach($field['options'] as $option){$html.='<label class="check"><input type="checkbox" name="'.$e($name).'[]" value="'.$e($option).'"'.(in_array($option,$selected,true)?' checked':'').'>'.$e($field['option_labels'][$option] ?? $option).'</label>';}return $html.'<small>Keine Auswahl erlaubt alle Inhaltstypen.</small></fieldset>';}
        $html='<label class="field">'.$e($field['label']);
        if($kind==='select'){$html.='<select name="'.$e($name).'"'.$required.'>';if(!($field['required'] ?? false) && !isset($field['default'])){$html.='<option value="">Bitte wählen</option>';}
            foreach($field['options'] as $option){$html.='<option value="'.$e($option).'"'.($option===$value?' selected':'').'>'.$e($field['option_labels'][$option] ?? $option).'</option>';}$html.='</select>';
        } elseif(in_array($kind,['html','textarea'],true)){$html.='<textarea name="'.$e($name).'" rows="'.($kind==='html'?12:4).'"'.($kind==='html'?' data-rich-editor aria-label="'.$e($field['label']).'"':'').$required.'>'.$e($kind==='html'?Html::sanitize($value):$value).'</textarea>';}
        else{$html.='<input type="'.(in_array($kind,['email','time','color'],true)?$kind:'text').'" name="'.$e($name).'" value="'.$e($value).'" maxlength="'.($field['max'] ?? 100000).'"'.$required.'>';}
        return $html.(isset($field['help'])?'<small>'.$e($field['help']).'</small>':'').'</label>';
    }
    public static function presetCards():string {
        $descriptions=['studio'=>'Klarer Titel, flexible Inhaltsfläche. Für Unternehmen, Vereine und Praxen.','editorial'=>'Ruhige Typografie und schmale Lesespalte. Für Texte, Artikel und Wissenswertes.','split'=>'Titel und Inhalt nebeneinander. Für Leistungen, Profile und übersichtliche Details.','landing'=>'Großer, zentrierter Auftakt. Für Startseiten, Kampagnen und Angebote.'];
        $html='<section class="page-preset-library" aria-label="Vier Basislayouts">';
        foreach(PageTemplates::PRESETS as $id=>$label){$html.='<article class="page-preset"><div class="preset-sketch preset-'.$id.'" aria-hidden="true"><span></span><strong></strong><i></i><i></i></div><h2>'.Html::escape($label).'</h2><p>'.Html::escape($descriptions[$id]).'</p><a href="/admin/page-preview/?layout='.$id.'" target="_blank" rel="noopener">Mit vorhandenem Inhalt ansehen ↗</a></article>';}
        return $html.'</section><p class="muted">Die Vorschau zeigt gespeicherte Farben, Header, Footer und CSS. Das Basislayout unten auswählen; einzelne Seiten können davon abweichen. <a href="/admin/layout/">Header, Footer und CSS bearbeiten →</a></p>';
    }
    private function collection(string $section,array $values):string {
        $keys=match($section){'categories'=>['name'=>'Name','slug'=>'URL-Name','description'=>'Beschreibung','parent'=>'Übergeordnete Kategorie','types'=>'Inhaltstypen'],'menus'=>['label'=>'Beschriftung','url'=>'Link-Ziel','parent'=>'Übergeordneter Eintrag','location'=>'Position'],default=>['from'=>'Alter Pfad','to'=>'Neues Ziel']};
        $html='<div data-collection="values" class="collection">';
        foreach($values as $index=>$row){if(is_array($row)){$html.=$this->collectionRow($section,(string)$index,$row,$keys,$values);}}
        $html.='</div><template data-collection-template="values">'.$this->collectionRow($section,'__INDEX__',['id'=>'__ID__'],$keys,$values).'</template><button class="secondary" type="button" data-add-row="values">Eintrag hinzufügen</button>';
        if($section==='categories'){$html.='<p class="muted">Zugeordnete Kategorien zuerst aus den Inhalten entfernen, bevor die Kategorie entfernt wird.</p>';}
        return $html;
    }
    private function collectionRow(string $section,string $index,array $row,array $keys,array $values):string {
        $e=Html::escape(...);$id=is_string($row['id'] ?? null)?$row['id']:'';$name='values['.$index.']';
        $summary=$row['name'] ?? $row['label'] ?? $row['from'] ?? 'Neuer Eintrag';$detail=$row['slug'] ?? $row['url'] ?? $row['to'] ?? '';
        $html='<details class="collection-item" data-row'.($index==='__INDEX__'?' open':'').'><summary><span data-row-summary>'.$e($summary).'</span><small data-row-detail>'.$e($detail).'</small></summary><fieldset class="collection-row"><legend>'.($section==='menus'?'Menüeintrag':($section==='categories'?'Kategorie':'Weiterleitung')).'</legend><input type="hidden" name="'.$name.'[id]" value="'.$e($id).'">';
        foreach($keys as $key=>$label){$field=['label'=>$label];
            if($key==='description'){$field['kind']='textarea';}
            if($key==='parent'){$field+=['kind'=>'select','options'=>array_column(array_filter($values,static fn($v)=>is_array($v) && ($v['id'] ?? '')!==$id),'id'),'option_labels'=>array_column($values,$section==='categories'?'name':'label','id')];}
            if($key==='location'){$field+=['kind'=>'select','options'=>['header','footer'],'default'=>'header','option_labels'=>['header'=>'Hauptnavigation','footer'=>'Fußzeile']];}
            if($key==='types'){$types=$this->content->schema->types;$field+=['kind'=>'multi','options'=>array_keys($types),'option_labels'=>array_map(static fn($type)=>$type['label'],$types)];}
            $html.=self::field($name.'['.$key.']',$field,$row[$key] ?? ($field['default'] ?? ''));
        }
        if($section==='categories' && ($row['slug'] ?? '')!==''){$html.='<a href="'.$e($this->site->categoryPath($row)).'" target="_blank" rel="noopener">Kategorie ansehen →</a>';}
        return $html.'<div class="row-actions"><button type="button" class="secondary" data-row-up aria-label="Eintrag nach oben">Nach oben</button><button type="button" class="secondary" data-row-down aria-label="Eintrag nach unten">Nach unten</button><button type="button" class="danger" data-row-remove>Entfernen</button></div></fieldset></details>';
    }
    private function modules(array $actor):string {
        $this->access->require($actor,'settings');$html='<p class="intro">Individualisierungen ergänzen den CMS-Standard. Diese Funktionen und Einstellungen gehören ausschließlich zum aktuellen Projekt.</p><div class="module-list">';
        foreach($this->site->project['customizations'] ?? [] as $key=>$module){$html.='<a class="module" href="/admin/customizations/'.rawurlencode($key).'/"><span class="badge">Projektmodul</span><h2>'.Html::escape($module['label']).'</h2><p>'.Html::escape($module['description']).'</p><span>Einstellungen öffnen →</span></a>';}
        return $html.'</div>'.(empty($this->site->project['customizations'])?'<p class="empty">Dieses Projekt hat noch keine Individualisierungen registriert.</p>':'');
    }
    private function seoAudit(array $actor):string {
        $html='<section class="panel"><h2>Inhalte prüfen</h2><p>Hinweise zur Redaktion, keine automatische Bewertung des Google-Rankings.</p><div class="table-scroll"><table><thead><tr><th>Inhalt</th><th>Hinweise</th></tr></thead><tbody>';
        foreach($this->content->list($actor) as $item){if($item['status']!=='published'){continue;}$issues=Seo::audit($item,$this->site,$this->configuration);if(!$issues){continue;}$html.='<tr><td><a href="/admin/content/'.$item['id'].'/?tab=seo">'.Html::escape($item['title']).'</a></td><td>'.Html::escape(implode(' · ',$issues)).'</td></tr>';}
        return $html.'</tbody></table></div><p><a href="/sitemap.xml">Sitemap öffnen</a> · <a href="/robots.txt">robots.txt öffnen</a> · <a href="/admin/redirects/">Weiterleitungen verwalten</a></p></section>';
    }
}
