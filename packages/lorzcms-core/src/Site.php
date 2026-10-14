<?php
declare(strict_types=1);
namespace SiteCms;

/** Project-neutral, versioned website configuration. The project supplies defaults and extensions. */
final class Site {
    private array $cache=[];
    public function __construct(private Store $store,private Access $access,public readonly array $project) {}
    public function sections():array {
        return [
            'settings'=>['label'=>'Einstellungen','permission'=>'settings','description'=>'Identität, Sprache und Kontakt deiner Website.','fields'=>[
                'name'=>['label'=>'Name der Website','required'=>true,'max'=>190,'default'=>$this->project['name']],
                'tagline'=>['label'=>'Kurzbeschreibung','max'=>255],
                'contact_email'=>['label'=>'Kontakt-E-Mail','kind'=>'email','max'=>190],
                'language'=>['label'=>'Sprache','kind'=>'select','options'=>['de','en'],'default'=>'de'],
            ]],
            'seo'=>['label'=>'SEO','permission'=>'settings','description'=>'Globale Vorgaben werden verwendet, wenn ein Inhalt keine eigenen Angaben enthält.','fields'=>[
                'title_suffix'=>['label'=>'Zusatz im Seitentitel','max'=>100,'default'=>' · '.$this->project['name']],
                'description'=>['label'=>'Standardbeschreibung','kind'=>'textarea','max'=>1000],
                'image'=>['label'=>'Standard-Vorschaubild','kind'=>'image','max'=>1000],
                'indexing'=>['label'=>'Suchmaschinenindexierung','kind'=>'select','options'=>['enabled','disabled'],'default'=>'enabled','option_labels'=>['enabled'=>'Erlauben','disabled'=>'Website ausschließen']],
            ]],
            'appearance'=>['label'=>'Layout','permission'=>'settings','description'=>'Gestaltung, Inhaltsbreite und Fußzeile. Seiten können zusätzlich eigene Vorlagen und Inhaltsbausteine verwenden.','fields'=>[
                'engine'=>['label'=>'Seitenaufbau','kind'=>'select','options'=>['auto','project','shared'],'default'=>'auto','option_labels'=>['auto'=>'Automatisch (Basis-CMS: gemeinsame Templates)','project'=>'Individueller Projektaufbau','shared'=>'Gemeinsame Header-, Footer- und Seitentemplates'],'help'=>'Bestehende individuelle Projekte behalten bei Automatisch ihren Aufbau. Projektmodule und Spezialrouten bleiben erhalten.'],
                'page_template'=>['label'=>'Basislayout','kind'=>'select','options'=>array_keys(PageTemplates::PRESETS),'option_labels'=>PageTemplates::PRESETS,'default'=>'studio'],
                'header_style'=>['label'=>'Header-Layout','kind'=>'select','options'=>['inline','stacked'],'option_labels'=>['inline'=>'Logo und Navigation nebeneinander','stacked'=>'Logo über Navigation'],'default'=>'inline'],
                'footer_style'=>['label'=>'Footer-Layout','kind'=>'select','options'=>['columns','minimal'],'option_labels'=>['columns'=>'Zwei Spalten','minimal'=>'Kompakt untereinander'],'default'=>'columns'],
                'logo'=>['label'=>'Logo','kind'=>'image','max'=>1000],
                'accent'=>['label'=>'Akzentfarbe','kind'=>'color','default'=>'#b4da32'],
                'background'=>['label'=>'Hintergrundfarbe','kind'=>'color','default'=>'#f7f8f2'],
                'text'=>['label'=>'Textfarbe','kind'=>'color','default'=>'#18271c'],
                'width'=>['label'=>'Inhaltsbreite','kind'=>'select','options'=>['1100','1280','1440'],'default'=>'1280'],
                'header'=>['label'=>'Kopfbereich','kind'=>'select','options'=>['normal','compact'],'default'=>'normal','option_labels'=>['normal'=>'Normal','compact'=>'Kompakt']],
                'footer'=>['label'=>'Text in der Fußzeile','kind'=>'textarea','max'=>2000],
                'header_template'=>['label'=>'Header-Template (HTML)','kind'=>'code','max'=>20000,'default'=>PageTemplates::HEADER,'help'=>'Slots: {{brand}}, {{navigation}}, {{tagline}}. Eigene HTML-Struktur und CSS-Klassen möglich. Marke und Navigation jeweils einmal einsetzen.'],
                'footer_template'=>['label'=>'Footer-Template (HTML)','kind'=>'code','max'=>20000,'default'=>PageTemplates::FOOTER,'help'=>'Slots: {{brand}}, {{tagline}}, {{footer_text}}, {{footer_navigation}}, {{contact}}. Platzhalter zwischen Tags einsetzen.'],
                'custom_css'=>['label'=>'Eigenes CSS','kind'=>'code','max'=>100000,'help'=>'Zum Beispiel: .cms-page { --page-radius: 0; } oder .cms-page .site-header { border-bottom: 2px solid var(--site-accent); }. Wird als separate CSS-Datei ausgeliefert.'],
            ]],
        ];
    }
    public function defaults(string $section):array {
        if(isset($this->sections()[$section])) {
            $values=[];foreach($this->sections()[$section]['fields'] as $key=>$field){$values[$key]=$field['default'] ?? '';}
            return array_replace($values,$this->project['site_defaults'][$section] ?? []);
        }
        if(in_array($section,['categories','menus','redirects','templates'],true)){return $this->project['site_defaults'][$section] ?? [];}
        if(str_starts_with($section,'module:')) {
            $module=$this->project['customizations'][substr($section,7)] ?? throw new HttpError(404,'Individualisierung nicht gefunden.');
            $values=[];foreach($module['fields'] as $key=>$field){$values[$key]=$field['default'] ?? ''; }return $values;
        }
        throw new HttpError(404,'Bereich nicht gefunden.');
    }
    public function get(string $section):array {
        if(isset($this->cache[$section])){return $this->cache[$section];}
        $defaults=$this->defaults($section);
        $row=$this->store->query('SELECT * FROM site_state WHERE id=?',[$section])->fetch();
        $value=$row?Store::decode($row['payload']):$defaults;
        if(isset($this->sections()[$section]) || str_starts_with($section,'module:')){$value=array_replace($defaults,$value);}
        return $this->cache[$section]=['section'=>$section,'version'=>$row?(int)$row['version']:0,'value'=>$value,'updated_at'=>$row['updated_at'] ?? null];
    }
    public function value(string $section):array {return $this->get($section)['value'];}
    public function permission(string $section):string {return in_array($section,['categories','menus'],true)?$section:'settings';}
    public function save(string $section,int $version,array $value,array $actor):array {
        $this->access->require($actor,$this->permission($section));$value=$this->validate($section,$value);
        return $this->store->transaction(function()use($section,$version,$value,$actor):array {
            $time=gmdate('c');
            if($version===0){
                try{$this->store->query('INSERT INTO site_state VALUES (?,?,?,?)',[$section,Store::json($value),1,$time]);}
                catch(\PDOException $error){if((string)$error->getCode()==='23000' || str_contains($error->getMessage(),'UNIQUE')){throw new HttpError(409,'Dieser Bereich wurde inzwischen geändert. Bitte neu laden.');}throw $error;}
                $this->store->query('INSERT INTO site_history VALUES (?,?,?,?,?,?)',[Store::id(),$section,0,Store::json($this->defaults($section)),$actor['id'],$time]);
            } else {
                if($this->store->query('UPDATE site_state SET payload=?,version=?,updated_at=? WHERE id=? AND version=?',[Store::json($value),$version+1,$time,$section,$version])->rowCount()!==1){throw new HttpError(409,'Dieser Bereich wurde inzwischen geändert. Bitte neu laden.');}
            }
            $this->store->query('INSERT INTO site_history VALUES (?,?,?,?,?,?)',[Store::id(),$section,$version+1,Store::json($value),$actor['id'],$time]);
            unset($this->cache[$section]);return $this->get($section);
        });
    }
    public function history(string $section):array {return $this->store->query('SELECT id,version,created_at FROM site_history WHERE section=? ORDER BY version DESC',[$section])->fetchAll();}
    public function preview(string $section,int $version,array $value,array $actor):array {
        $this->access->require($actor,$this->permission($section));$before=$this->get($section);
        if($before['version']!==$version){throw new HttpError(409,'Dieser Bereich wurde inzwischen geändert.');}
        $after=$this->validate($section,$value);$id=Store::id();
        $this->store->query('INSERT INTO site_proposals VALUES (?,?,?,?,?,?,?,?)',[$id,$section,$actor['id'],$version,Store::json($after),'pending',gmdate('c',time()+3600),null]);
        return ['preview_id'=>$id,'before'=>$before,'after'=>['section'=>$section,'value'=>$after,'version'=>$version+1],'expires_in'=>3600];
    }
    public function apply(string $id,array $actor):array {
        return $this->store->transaction(function()use($id,$actor):array {
            $row=$this->store->query('SELECT * FROM site_proposals WHERE id=? AND actor=?',[$id,$actor['id']])->fetch() ?: throw new HttpError(404,'Vorschau nicht gefunden.');
            $this->access->require($actor,$this->permission($row['section']));
            if($row['status']==='applied'){return Store::decode($row['result']);}
            if($row['expires_at']<gmdate('c')){throw new HttpError(410,'Vorschau abgelaufen.');}
            if($this->store->query("UPDATE site_proposals SET status='applying' WHERE id=? AND status='pending'",[$id])->rowCount()!==1){throw new HttpError(409,'Vorschau wird bereits angewendet.');}
            $result=$this->save($row['section'],(int)$row['base_version'],Store::decode($row['payload']),$actor);
            $this->store->query("UPDATE site_proposals SET status='applied',result=? WHERE id=?",[Store::json($result),$id]);return $result;
        });
    }
    public function restore(string $section,string $revision,int $version,array $actor):array {
        $row=$this->store->query('SELECT payload FROM site_history WHERE id=? AND section=?',[$revision,$section])->fetch() ?: throw new HttpError(404,'Version nicht gefunden.');
        return $this->save($section,$version,Store::decode($row['payload']),$actor);
    }
    public function validate(string $section,array $value):array {
        $this->defaults($section);
        if($section==='templates'){$templates=Templates::validate($value,$this->project);$map=array_column($templates,null,'id');foreach($this->store->query('SELECT c.type,o.payload FROM contents c JOIN content_options o ON o.content_id=c.id')->fetchAll() as $item){$id=Store::decode($item['payload'])['template'] ?? 'inherit';if(!in_array($id,['inherit','none'],true) && (!isset($map[$id]) || !in_array($item['type'],$map[$id]['types'],true))){throw new HttpError(422,'Die Vorlage ist noch einem Inhalt zugeordnet. Zuerst die Zuordnung ändern.');}}return $templates;}
        if(isset($this->sections()[$section])){
            $result=(new Schema(['configuration'=>['fields'=>$this->sections()[$section]['fields']]]))->fields('configuration',$value);
            if($section==='appearance'){foreach(['header','footer'] as $region){$result[$region.'_template']=PageTemplates::validatePartial($result[$region.'_template'],$region);}}
            return $result;
        }
        if(str_starts_with($section,'module:')){return (new Schema(['configuration'=>['fields'=>$this->project['customizations'][substr($section,7)]['fields']]]))->fields('configuration',$value);}
        if(count($value)>100 || !array_is_list($value)){throw new HttpError(422,'Höchstens 100 Einträge sind erlaubt.');}
        $ids=[];$result=[];
        foreach($value as $row){
            if(!is_array($row)){throw new HttpError(422,'Ungültiger Eintrag.');}
            if($section==='categories'){
                $row=$this->record($row,['id','name','slug','description','parent','types']);
                if(!preg_match('/^[a-z0-9][a-z0-9-]{0,79}$/D',$row['slug']) || trim($row['name'])==='' || mb_strlen($row['description'])>1000){throw new HttpError(422,'Kategorien benötigen Name, gültigen URL-Namen und höchstens 1000 Zeichen Beschreibung.');}
                $types=$row['types']===''?[]:array_map('trim',explode(',',$row['types']));foreach($types as $type){if(!isset($this->project['types'][$type])){throw new HttpError(422,'Unbekannter Inhaltstyp in Kategorie.');}}
                foreach($result as $previous){if($previous['slug']===$row['slug']){throw new HttpError(422,'Der URL-Name einer Kategorie muss eindeutig sein.');}}
            } elseif($section==='menus') {
                $row=$this->record($row,['id','label','url','parent','location']);
                if(trim($row['label'])==='' || !Html::url($row['url']) || !in_array($row['location'],['header','footer'],true)){throw new HttpError(422,'Menüeinträge benötigen Beschriftung, gültigen Link und Position.');}
            } else {
                $row=$this->record($row,['id','from','to']);$row['from']=Schema::path($row['from']);
                if(!$row['from'] || !Html::url($row['to']) || !preg_match('~^(https?://|/(?!/))~i',$row['to']) || $row['from']===$row['to']){throw new HttpError(422,'Weiterleitung benötigt einen Quellpfad und ein anderes Ziel.');}
                foreach($result as $previous){if($previous['from']===$row['from']){throw new HttpError(422,'Quellpfad bereits vorhanden.');}}
            }
            if(!preg_match('/^[a-zA-Z0-9_-]{1,64}$/D',$row['id']) || isset($ids[$row['id']])){throw new HttpError(422,'Einträge benötigen eindeutige IDs.');}
            $ids[$row['id']]=true;$result[]=$row;
        }
        if(in_array($section,['menus','categories'],true)){
            $map=array_column($result,null,'id');
            foreach($result as $row){$seen=[$row['id']=>true];$parent=$row['parent'];$depth=0;while($parent!==''){
                if(!isset($map[$parent]) || isset($seen[$parent]) || ++$depth>4){throw new HttpError(422,'Ungültige Hierarchie: fehlender übergeordneter Eintrag, Kreis oder mehr als vier Ebenen.');}
                if($section==='menus' && $map[$parent]['location']!==$row['location']){throw new HttpError(422,'Übergeordnete Menüeinträge müssen dieselbe Position haben.');}
                $seen[$parent]=true;$parent=$map[$parent]['parent'];
            }}
        }
        if($section==='redirects'){
            $map=array_column($result,'to','from');foreach($map as $from=>$to){$seen=[$from=>true];while(isset($map[$to])){if(isset($seen[$to])){throw new HttpError(422,'Weiterleitungen dürfen keine Kreise bilden.');}$seen[$to]=true;$to=$map[$to];}}
            foreach($result as $row){if($this->store->query("SELECT id FROM contents WHERE path=? AND status='published'",[$row['from']])->fetch()){throw new HttpError(422,'Eine veröffentlichte Seite belegt den Quellpfad.');}}
        }
        if($section==='categories'){
            $map=array_column($result,null,'id');
            foreach($this->store->query('SELECT c.type,c.fields,o.payload FROM contents c LEFT JOIN content_options o ON o.content_id=c.id')->fetchAll() as $item){
                $options=$item['payload']?Store::decode($item['payload']):$this->initialOptions(['type'=>$item['type'],'fields'=>Store::decode($item['fields'])]);
                foreach($options['categories'] as $id){if(!isset($map[$id]) || ($map[$id]['types']!=='' && !in_array($item['type'],array_map('trim',explode(',',$map[$id]['types'])),true))){throw new HttpError(422,'Diese Kategorie ist noch Inhalten zugeordnet. Zuerst die Zuordnung im Inhaltseditor ändern.');}}
            }
        }
        return $result;
    }
    private function record(array $row,array $keys):array {
        if(array_diff(array_keys($row),$keys)){throw new HttpError(422,'Unbekanntes Feld.');}$result=[];
        foreach($keys as $key){$v=$row[$key] ?? '';if(!is_string($v) || mb_strlen($v)>2000){throw new HttpError(422,'Ungültiges Feld: '.$key);}$result[$key]=trim($v);}return $result;
    }
    public function category(string $id):?array {foreach($this->value('categories') as $row){if($row['id']===$id){return $row;}}return null;}
    public function categoryPath(array $category):string {
        $resolver=$this->project['category_path'] ?? null;return $resolver?$resolver($category):'/category/'.$category['slug'].'/';
    }
    public function categoryIds(string $id):array {
        $ids=[$id];for($depth=0;$depth<4;$depth++){foreach($this->value('categories') as $row){if(in_array($row['parent'],$ids,true) && !in_array($row['id'],$ids,true)){$ids[]=$row['id'];}}}return $ids;
    }
    public function categoriesFor(string $type):array {return array_values(array_filter($this->value('categories'),static fn($row)=>$row['types']==='' || in_array($type,array_map('trim',explode(',',$row['types'])),true)));}
    public function layouts():array {return $this->project['layouts'] ?? ['default'=>['label'=>'Standard'],'wide'=>['label'=>'Breit'],'compact'=>['label'=>'Kompakt']];}
    public function initialOptions(array $item):array {
        $resolve=$this->project['legacy_options'] ?? null;return $resolve?$resolve($item):['categories'=>[],'layout'=>'default','blocks'=>[]];
    }
    public function options(string $type,array $value):array {
        if(array_diff(array_keys($value),['categories','layout','blocks','template','page_template'])){throw new HttpError(422,'Unbekannte Inhaltseinstellung.');}
        $result=array_replace(['categories'=>[],'layout'=>'default','blocks'=>[],'template'=>'inherit','page_template'=>'inherit'],$value);
        if(!is_string($result['page_template']) || ($result['page_template']!=='inherit' && !isset(PageTemplates::PRESETS[$result['page_template']]))){throw new HttpError(422,'Unbekanntes Basislayout.');}
        if(!is_string($result['template'])){throw new HttpError(422,'Ungültige Vorlage.');}if(!in_array($result['template'],['inherit','none'],true)){$valid=false;foreach($this->value('templates') as $template){if($template['id']===$result['template'] && in_array($type,$template['types'],true)){$valid=true;}}if(!$valid){throw new HttpError(422,'Vorlage ist für diesen Inhalt nicht verfügbar.');}}
        if(!is_array($result['categories']) || !array_is_list($result['categories']) || count($result['categories'])>30){throw new HttpError(422,'Ungültige Kategorien.');}
        foreach($result['categories'] as $id){if(!is_string($id) || !$this->category($id) || !in_array($id,array_column($this->categoriesFor($type),'id'),true)){throw new HttpError(422,'Kategorie ist für diesen Inhalt nicht verfügbar.');}}
        $result['categories']=array_values(array_unique($result['categories']));
        if(!is_string($result['layout']) || !isset($this->layouts()[$result['layout']])){throw new HttpError(422,'Unbekannte Layoutvorlage.');}
        $result['blocks']=Blocks::validate($result['blocks']);
        // Do not add new option keys to ordinary pages: older cores can still edit them after rollback.
        if($result['page_template']==='inherit'){unset($result['page_template']);}
        return $result;
    }
    public function menu(string $location,string $current=''):string {
        $rows=array_filter($this->value('menus'),static fn($row)=>$row['location']===$location);
        $render=function(string $parent,int $depth=0)use(&$render,$rows,$current):string {
            if($depth>4){return '';}$html='';foreach($rows as $row){if($row['parent']!==$parent){continue;}
                $html.='<li><a href="'.Html::escape($row['url']).'"'.($row['url']===$current?' aria-current="page"':'').'>'.Html::escape($row['label']).'</a>'.$render($row['id'],$depth+1).'</li>';
            }return $html!==''?'<ul>'.$html.'</ul>':'';
        };return $render('');
    }
    public function redirect(string $path):?string {foreach($this->value('redirects') as $row){if($row['from']===$path){return $row['to'];}}return null;}
    public function themeCss():string {
        $v=$this->value('appearance');return ':root{--site-background:'.$v['background'].';--site-text:'.$v['text'].';--site-accent:'.$v['accent'].';--green:'.$v['accent'].';--ink:'.$v['text'].';--site-width:'.$v['width'].'px;background:'.$v['background'].';color:'.$v['text'].'}.section{max-width:var(--site-width)}.layout-wide .rich{max-width:none}.layout-compact .content-section{max-width:900px}.header-compact .site-header{padding-top:14px;padding-bottom:14px}' ."\n".$v['custom_css'];
    }
}
