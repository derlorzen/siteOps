<?php
declare(strict_types=1);
namespace SiteCms;

final class Media {
    public function __construct(private Store $store,private string $directory,private ?Access $access=null) {}
    public function upload(array $file,array $actor):array {
        ($this->access ?? throw new HttpError(403,'Upload benötigt einen berechtigten Zugriff.'))->require($actor,'media');
        if(($file['error'] ?? UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name']) || filesize($file['tmp_name'])>10*1024*1024) { throw new HttpError(422,'Datei fehlt oder ist größer als 10 MB.'); }
        $mime=(new \finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
        $extension=['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp','application/pdf'=>'pdf'][$mime] ?? throw new HttpError(422,'Erlaubt sind JPG, PNG, WebP und PDF.');
        if(str_starts_with($mime,'image/') && !getimagesize($file['tmp_name'])) { throw new HttpError(422,'Ungültiges Bild.'); }
        if(!is_dir($this->directory)) { mkdir($this->directory,0700,true); }
        $id=Store::id(); $filename=$id.'.'.$extension;
        if(!move_uploaded_file($file['tmp_name'],$this->directory.'/'.$filename)) { throw new HttpError(500,'Datei konnte nicht gespeichert werden.'); }
        $bytes=filesize($this->directory.'/'.$filename); $name=mb_substr(basename($file['name']),0,190);
        try {$this->store->query('INSERT INTO media (id,name,mime,filename,bytes,actor) VALUES (?,?,?,?,?,?)',[$id,$name,$mime,$filename,$bytes,$actor['id']]);}
        catch(\Throwable $error){unlink($this->directory.'/'.$filename);throw $error;}
        return ['id'=>$id,'url'=>'/media/'.$id,'name'=>$name,'mime'=>$mime];
    }
    public function serve(string $id):void {
        $row=$this->store->query('SELECT * FROM media WHERE id=?',[$id])->fetch() ?: throw new HttpError(404,'Datei nicht gefunden.');
        $file=$this->directory.'/'.$row['filename']; if(!is_file($file)) { throw new HttpError(404,'Datei nicht gefunden.'); }
        header('Content-Type: '.$row['mime']); header('X-Content-Type-Options: nosniff');
        header('Content-Disposition: inline; filename="'.preg_replace('/[^a-zA-Z0-9._-]/','_',$row['name']).'"');
        header('Content-Length: '.filesize($file)); Stream::file($file);
    }
}
