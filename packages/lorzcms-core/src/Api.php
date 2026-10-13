<?php
declare(strict_types=1);
namespace SiteCms;

/** Project-neutral HTTP adapter for an existing SiteOps MCP server. */
final class Api {
    public function __construct(private Content $content,private Access $access,private Store $store) {}
    public static function output(mixed $value,int $status=200):void {http_response_code($status);header('Content-Type: application/json; charset=utf-8');echo Store::json($value);}
    public function handle(string $path,string $method):void {
        header('Cache-Control: no-store');
        $authorization=(string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        $actor=preg_match('/^Bearer ([a-f0-9]{64})$/D',$authorization,$match) ? $this->access->bearer($match[1]) : null;
        if(!$actor) {throw new HttpError(401,'Ein gültiges Bearer-Token ist erforderlich.');}
        $body=[];
        if(in_array($method,['POST','PATCH'],true)) {
            $raw=file_get_contents('php://input',false,null,0,1024*1024+1);
            if(strlen($raw)>1024*1024) {throw new HttpError(413,'Anfrage zu groß.');}
            try {$body=json_decode($raw,true,32,JSON_THROW_ON_ERROR);}catch(\JsonException){throw new HttpError(400,'Ungültiges JSON.');}
            if(!is_array($body) || !str_starts_with(ltrim($raw),'{')) {throw new HttpError(400,'Ein JSON-Objekt ist erforderlich.');}
        }
        if($path==='/api/cms/schema' && $method==='GET') {$this->access->require($actor,'read');$widgets=[];foreach((new Placeholders($this->content))->definitions() as $name=>$definition){$widgets[$name]=array_diff_key($definition,['render'=>true]);}self::output(['types'=>$this->content->schema->types,'layouts'=>$this->content->site?->layouts(),'site_sections'=>$this->content->site?->sections(),'customizations'=>($this->content->site?->project['customizations'] ?? []),'widgets'=>$widgets,'template_layouts'=>Templates::LAYOUTS,'template_sections'=>'GET /api/cms/site/templates; update through versioned site proposals']);return;}
        if($path==='/api/cms/site/changes' && $method==='POST') {
            if(!is_string($body['section'] ?? null) || !is_int($body['base_version'] ?? null) || !is_array($body['value'] ?? null)){throw new HttpError(422,'section, base_version und value sind erforderlich.');}
            self::output($this->content->site->preview($body['section'],$body['base_version'],$body['value'],$actor),201);return;
        }
        if(preg_match('~^/api/cms/site/changes/([a-f0-9]{32})/apply$~D',$path,$m) && $method==='POST'){self::output($this->content->site->apply($m[1],$actor));return;}
        if(preg_match('~^/api/cms/site/([^/]+)$~D',$path,$m) && $method==='GET'){
            $section=rawurldecode($m[1]);if(!preg_match('/^[a-zA-Z0-9:_-]+$/D',$section)){throw new HttpError(404,'Bereich nicht gefunden.');}
            $this->access->require($actor,$this->content->site->permission($section));$record=$this->content->site->get($section);header('ETag: "'.$record['version'].'"');self::output($record);return;
        }
        if($path==='/api/cms/content' && $method==='GET') {self::output(['items'=>$this->content->list($actor)]);return;}
        if($path==='/api/cms/content' && $method==='POST') {
            if(array_diff(array_keys($body),['type','title','path','fields','seo','status','options']) || !is_string($body['type'] ?? null) || !is_string($body['title'] ?? null) || !is_array($body['fields'] ?? []) || !is_array($body['seo'] ?? []) || !is_array($body['options'] ?? []) || !is_string($body['status'] ?? 'draft') || (isset($body['path']) && !is_string($body['path']))) {throw new HttpError(422,'Ungültiger Inhalt.');}
            $created=$this->content->create($body['type'],$body['title'],$body['path'] ?? null,$body['fields'] ?? [],$body['seo'] ?? [],$body['status'] ?? 'draft',$actor,null,$body['options'] ?? []);
            header('Location: /api/cms/content/'.$created['id']);self::output($created,201);return;
        }
        if(preg_match('~^/api/cms/content/([a-zA-Z0-9_-]+)$~D',$path,$match)) {
            $item=$this->content->get($match[1]) ?? throw new HttpError(404,'Inhalt nicht gefunden.');$this->access->require($actor,'read',$item);
            if($method==='GET') {header('ETag: "'.$item['version'].'"');self::output($item);return;}
            if($method==='PATCH') {
                if(!preg_match('/^"([1-9][0-9]*)"$/D',(string)($_SERVER['HTTP_IF_MATCH'] ?? ''),$version)){throw new HttpError(428,'If-Match mit der aktuellen Versionsnummer ist erforderlich.');}
                $result=$this->content->save($item['id'],(int)$version[1],$body,$actor);header('ETag: "'.$result['version'].'"');self::output($result);return;
            }
            throw new HttpError(405,'Methode nicht erlaubt.');
        }
        if($path==='/api/cms/changes' && $method==='POST') {
            if(!isset($body['content_id'],$body['base_version'],$body['changes']) || !is_string($body['content_id']) || !is_int($body['base_version']) || !is_array($body['changes'])) {throw new HttpError(422,'content_id, base_version und changes sind erforderlich.');}
            self::output($this->content->preview($body['content_id'],$body['base_version'],$body['changes'],$actor),201);return;
        }
        if(preg_match('~^/api/cms/changes/([a-f0-9]{32})/apply$~D',$path,$match) && $method==='POST') {self::output($this->content->apply($match[1],$actor));return;}
        if(preg_match('~^/api/cms/changes/([a-f0-9]{32})$~D',$path,$match) && $method==='GET') {
            $row=$this->store->query('SELECT * FROM changes WHERE id=? AND actor=?',[$match[1],$actor['id']])->fetch() ?: throw new HttpError(404,'Vorschau nicht gefunden.');
            $before=$this->content->get($row['content_id']);$this->access->require($actor,'read',$before);$row['payload']=Store::decode($row['payload']);self::output($row);return;
        }
        throw new HttpError(404,'Schnittstelle nicht gefunden.');
    }
}
