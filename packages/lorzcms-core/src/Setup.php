<?php
declare(strict_types=1);
namespace SiteCms;

/** Optional one-time setup for PHP hosting without an SSH shell. */
final class Setup {
    public function __construct(private Store $store,private Access $access,private Content $content,private string $key,private ?string $seed) {}
    public function handle(string $method):void {
        if(strlen($this->key)<32){throw new HttpError(404,'Einrichtung nicht aktiviert.');}
        header('Cache-Control: no-store');header('X-Robots-Tag: noindex, nofollow');$this->access->session();
        if($method==='POST'){
            $this->access->csrf((string)($_POST['csrf'] ?? ''));
            if(!hash_equals($this->key,(string)($_POST['setup_key'] ?? ''))){throw new HttpError(403,'Einrichtungsschlüssel stimmt nicht.');}
            $this->store->install();
            $this->store->transaction(function():void {
                if((int)$this->store->query('SELECT COUNT(*) FROM users')->fetchColumn()!==0){throw new HttpError(409,'Die Einrichtung wurde bereits abgeschlossen.');}
                $id=$this->access->create((string)($_POST['email'] ?? ''),(string)($_POST['name'] ?? ''),(string)($_POST['password'] ?? ''),'admin');$actor=$this->access->user($id);
                // Fresh installations must explicitly approve search engine indexing at launch.
                $seo=$this->content->site->value('seo');$seo['indexing']='disabled';
                $this->content->site->save('seo',0,$seo,$actor);
                if($this->seed){
                    if(!is_file($this->seed)){throw new HttpError(422,'Der vorbereitete Inhaltsexport fehlt.');}
                    $data=Store::decode(file_get_contents($this->seed));
                    if(($data['format'] ?? '')!=='sitecms-content-v1'){throw new HttpError(422,'Unbekanntes Exportformat.');}
                    foreach($data['contents'] as $item){if(!$this->content->get($item['id'])){$this->content->create($item['type'],$item['title'],$item['path'],$item['fields'],$item['seo'],$item['status'],$actor,$item['id'],$item['options'] ?? []);}}
                }
            });
            header('Location: /admin/login/',true,303);return;
        }
        if($method!=='GET'){throw new HttpError(405,'Methode nicht erlaubt.');}
        echo '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>CMS einrichten</title><link rel="stylesheet" href="/assets/cms.css"></head><body><main class="workspace"><h1>CMS einrichten</h1><p>Die Datenbankverbindung und der Einrichtungsschlüssel werden vorher in der privaten Konfiguration hinterlegt.</p><form method="post"><input type="hidden" name="csrf" value="'.Html::escape($_SESSION['csrf']).'"><label>Einrichtungsschlüssel<input type="password" name="setup_key" required autocomplete="off"></label><label>Name<input name="name" required></label><label>E-Mail<input type="email" name="email" required autocomplete="username"></label><label>Administrator-Passwort (mindestens 12 Zeichen)<input type="password" name="password" minlength="12" maxlength="72" required autocomplete="new-password"></label><button>Einrichten</button></form></main></body></html>';
    }
}
