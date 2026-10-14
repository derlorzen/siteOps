<?php
declare(strict_types=1);
namespace SiteCms;

/** One write interface for administration, migration and MCP proposals. */
final class Content {
    public function __construct(private Store $store, public readonly Schema $schema, private Access $access,public readonly ?Site $site=null) {}
    private function hydrate(array|false $row,?array $loadedOptions=null): ?array {
        if (!$row) { return null; } $row['fields']=Store::decode($row['fields']); $row['seo']=$this->schema->seo(Store::decode($row['seo'])); $row['version']=(int)$row['version'];
        $options=$loadedOptions===null?$this->store->query('SELECT payload FROM content_options WHERE content_id=?',[$row['id']])->fetch():($loadedOptions[$row['id']] ?? false);$row['options']=$options?Store::decode($options['payload']):($this->site?$this->site->initialOptions($row):['categories'=>[],'layout'=>'default','blocks'=>[]]);return $row;
    }
    public function get(string $id): ?array { return $this->hydrate($this->store->query('SELECT * FROM contents WHERE id=?',[$id])->fetch()); }
    public function at(string $path): ?array { return $this->hydrate($this->store->query("SELECT * FROM contents WHERE path=? AND status='published'",[$path])->fetch()); }
    public function list(?array $actor = null, ?string $type = null): array {
        $rows=$this->store->query('SELECT * FROM contents ORDER BY title')->fetchAll(); $result=[];
        $options=array_column($this->store->query('SELECT * FROM content_options')->fetchAll(),null,'content_id');
        foreach($rows as $row) { $item=$this->hydrate($row,$options); if ((!$type || $item['type']===$type) && (!$actor || $this->access->can($actor,'read',$item))) { $result[]=$item; } }
        return $result;
    }
    public function validate(array $previous, array $changes, array $actor): array {
        $this->access->require($actor,'edit',$previous);
        if (array_diff(array_keys($changes),['title','fields','seo','path','status','options'])) { throw new HttpError(422,'Unbekannte Änderung.'); }
        $next=array_replace($previous,$changes);
        if (!is_string($next['title']) || trim($next['title'])==='' || mb_strlen($next['title'])>255) { throw new HttpError(422,'Ein Titel mit höchstens 255 Zeichen ist erforderlich.'); }
        if (!is_array($next['fields']) || !is_array($next['seo'])) { throw new HttpError(422,'Ungültige Felder.'); }
        if($next['path']!==null && !is_string($next['path'])) {throw new HttpError(422,'Ungültiger Seitenpfad.');}
        if ($next['path']!==$previous['path']) { $this->access->require($actor,$previous['version']===0?'create':'routes'); }
        $next['path']=Schema::path($next['path']);
        if (!in_array($next['status'],['draft','published','trash'],true)) { throw new HttpError(422,'Ungültiger Veröffentlichungsstatus.'); }
        if ($next['status']!==$previous['status']) { $this->access->require($actor,'publish',$previous); }
        $next['fields']=$this->schema->fields($previous['type'],array_replace($previous['fields'],$changes['fields'] ?? []));
        $next['seo']=$this->schema->seo(array_replace($previous['seo'],$changes['seo'] ?? []));
        $options=$changes['options'] ?? ($previous['options'] ?? ['categories'=>[],'layout'=>'default','blocks'=>[]]);if(!is_array($options)){throw new HttpError(422,'Ungültige Inhaltseinstellungen.');}
        if(isset($changes['options'])){$options=array_replace($previous['options'] ?? [],$options);}
        $next['options']=$this->site?$this->site->options($previous['type'],$options):$options;
        return $next;
    }
    public function create(string $type, string $title, ?string $path, array $fields, array $seo, string $status, array $actor, ?string $id = null,array $options=[]): array {
        $this->access->require($actor,'create'); $this->schema->type($type);
        $seed=['id'=>$id ?? Store::id(),'type'=>$type,'title'=>$title,'path'=>null,'fields'=>[],'seo'=>[],'status'=>'draft','version'=>0,'updated_at'=>gmdate('c')];
        $initial=$this->site?$this->site->initialOptions(['type'=>$type,'fields'=>$fields]):['categories'=>[],'layout'=>'default','blocks'=>[]];
        $next=$this->validate($seed,['path'=>$path,'fields'=>$fields,'seo'=>$seo,'status'=>$status,'options'=>$options ?: $initial],$actor); $next['version']=1;
        return $this->store->transaction(function() use($next,$actor):array {
            try { $this->store->query('INSERT INTO contents VALUES (?,?,?,?,?,?,?,?,?)',[$next['id'],$next['type'],$next['title'],$next['path'],$next['status'],Store::json($next['fields']),Store::json($next['seo']),1,$next['updated_at']]); }
            catch(\PDOException $error) { if ((string)$error->getCode()==='23000' || str_contains($error->getMessage(),'UNIQUE')) { throw new HttpError(409,'Dieser Inhalt oder Pfad existiert bereits.'); } throw $error; }
            $this->writeOptions($next);$this->revision($next,$actor); return $next;
        });
    }
    public function save(string $id, int $baseVersion, array $changes, array $actor): array {
        $previous=$this->get($id) ?? throw new HttpError(404,'Inhalt nicht gefunden.');
        $next=$this->validate($previous,$changes,$actor); $next['version']=$baseVersion+1; $next['updated_at']=gmdate('c');
        return $this->store->transaction(function()use($next,$baseVersion,$actor):array {
            try { $statement=$this->store->query('UPDATE contents SET title=?,path=?,status=?,fields=?,seo=?,version=?,updated_at=? WHERE id=? AND version=?',[$next['title'],$next['path'],$next['status'],Store::json($next['fields']),Store::json($next['seo']),$next['version'],$next['updated_at'],$next['id'],$baseVersion]); }
            catch(\PDOException $error) { if ((string)$error->getCode()==='23000' || str_contains($error->getMessage(),'UNIQUE')) { throw new HttpError(409,'Dieser Pfad ist bereits belegt.'); } throw $error; }
            if ($statement->rowCount()!==1) { throw new HttpError(409,'Dieser Inhalt wurde inzwischen geändert. Bitte neu laden und Änderungen vergleichen.'); }
            $this->writeOptions($next);$this->revision($next,$actor); return $next;
        });
    }
    private function writeOptions(array $item):void {
        $this->store->query('DELETE FROM content_options WHERE content_id=?',[$item['id']]);
        $this->store->query('INSERT INTO content_options VALUES (?,?)',[$item['id'],Store::json($item['options'])]);
    }
    private function revision(array $content,array $actor):void { $this->store->query('INSERT INTO revisions VALUES (?,?,?,?,?,?)',[Store::id(),$content['id'],$content['version'],Store::json($content),$actor['id'],gmdate('c')]); }
    public function preview(string $id,int $baseVersion,array $changes,array $actor):array {
        $before=$this->get($id) ?? throw new HttpError(404,'Inhalt nicht gefunden.');
        if($before['version']!==$baseVersion) { throw new HttpError(409,'Inhaltsstand hat sich geändert.'); }
        $after=$this->validate($before,$changes,$actor); $proposal=Store::id();
        $this->store->query('INSERT INTO changes VALUES (?,?,?,?,?,?,?,?)',[$proposal,$id,$actor['id'],$baseVersion,Store::json($changes),'pending',gmdate('c',time()+3600),null]);
        return ['preview_id'=>$proposal,'before'=>$before,'after'=>$after,'expires_in'=>3600];
    }
    public function apply(string $proposal,array $actor):array {
        return $this->store->transaction(function()use($proposal,$actor):array {
            $row=$this->store->query('SELECT * FROM changes WHERE id=? AND actor=?',[$proposal,$actor['id']])->fetch() ?: throw new HttpError(404,'Vorschau nicht gefunden.');
            if ($row['status']==='applied') { $current=$this->get($row['content_id']); $this->access->require($actor,'edit',$current); return Store::decode($row['result']); }
            if($row['expires_at']<gmdate('c')) { throw new HttpError(410,'Vorschau abgelaufen.'); }
            if($this->store->query("UPDATE changes SET status='applying' WHERE id=? AND status='pending'",[$proposal])->rowCount()!==1) { throw new HttpError(409,'Vorschau wird bereits angewendet.'); }
            $result=$this->save($row['content_id'],(int)$row['base_version'],Store::decode($row['payload']),$actor);
            $this->store->query("UPDATE changes SET status='applied',result=? WHERE id=?",[Store::json($result),$proposal]); return $result;
        });
    }
}
