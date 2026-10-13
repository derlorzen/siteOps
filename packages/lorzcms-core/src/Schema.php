<?php
declare(strict_types=1);
namespace SiteCms;

final class Schema {
    public function __construct(public readonly array $types) {}
    public function type(string $name): array { return $this->types[$name] ?? throw new HttpError(422, 'Unbekannter Inhaltstyp.'); }
    public function fields(string $type, array $values): array {
        $definitions = $this->type($type)['fields'];
        if (array_diff(array_keys($values), array_keys($definitions))) { throw new HttpError(422, 'Unbekanntes Inhaltsfeld.'); }
        $result = [];
        foreach ($definitions as $key => $field) {
            $value = $values[$key] ?? ($field['default'] ?? '');
            if (($field['kind'] ?? '') === 'rows') {
                $value=$values[$key] ?? [];
                if(!is_array($value) || count($value)>50) {throw new HttpError(422,'Ungültige Zeilen: '.$key);}
                $rowSchema=new self(['row'=>['fields'=>$field['columns']]]); $rows=[];
                foreach($value as $row) {
                    if(!is_array($row)) {throw new HttpError(422,'Ungültige Zeile.');}
                    if(!array_filter($row,static fn($cell)=>!is_string($cell) || trim($cell)!=='')){continue;}
                    $rows[]=$rowSchema->fields('row',$row);
                }
                $result[$key]=$rows;continue;
            }
            if (!is_string($value) || mb_strlen($value) > ($field['max'] ?? 100000)) { throw new HttpError(422, 'Ungültiges Feld: ' . $key); }
            if (($field['required'] ?? false) && trim($value) === '') { throw new HttpError(422, 'Pflichtfeld: ' . $field['label']); }
            if (($field['kind'] ?? 'text') === 'html') { $value = Html::sanitize($value); }
            if (($field['kind'] ?? '') === 'url' && $value !== '' && !Html::url($value)) { throw new HttpError(422, 'Ungültige URL: ' . $key); }
            if (($field['kind'] ?? '') === 'image' && $value !== '' && !Html::url($value,true)) { throw new HttpError(422, 'Ungültige Bild-URL: ' . $key); }
            if (($field['kind'] ?? '') === 'time' && $value!=='' && !preg_match('/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/D',$value)) {throw new HttpError(422,'Ungültige Uhrzeit: '.$key);}
            if (($field['kind'] ?? '') === 'select' && $value!=='' && !in_array($value,$field['options'],true)) {throw new HttpError(422,'Ungültige Auswahl: '.$key);}
            if (($field['kind'] ?? '') === 'email' && $value!=='' && !filter_var($value,FILTER_VALIDATE_EMAIL)) {throw new HttpError(422,'Ungültige E-Mail: '.$key);}
            if (($field['kind'] ?? '') === 'color' && !preg_match('/^#[a-fA-F0-9]{6}$/D',$value)) {throw new HttpError(422,'Ungültige Farbe: '.$key);}
            if (($field['kind'] ?? '') === 'number' && $value!=='' && (!ctype_digit($value) || (int)$value<($field['min_value'] ?? 0) || (int)$value>($field['max_value'] ?? 999999999))) {throw new HttpError(422,'Ungültige Zahl: '.$key);}
            $result[$key] = $value;
        }
        return $result;
    }
    public function seo(array $values): array {
        if (array_diff(array_keys($values), ['title','description','image','noindex','nofollow','canonical','share_title','share_description'])) { throw new HttpError(422, 'Unbekanntes SEO-Feld.'); }
        $result = array_replace(['title'=>'','description'=>'','image'=>'','noindex'=>false,'nofollow'=>false,'canonical'=>'','share_title'=>'','share_description'=>''], $values);
        foreach (['title'=>255,'description'=>1000,'image'=>1000,'canonical'=>1000,'share_title'=>255,'share_description'=>1000] as $key=>$max) {
            if (!is_string($result[$key]) || mb_strlen($result[$key]) > $max) { throw new HttpError(422, 'Ungültiges SEO-Feld.'); }
        }
        if (!is_bool($result['noindex']) || ($result['image'] !== '' && !Html::url($result['image'], true))) { throw new HttpError(422, 'Ungültige SEO-Werte.'); }
        if(!is_bool($result['nofollow']) || ($result['canonical']!=='' && (!filter_var($result['canonical'],FILTER_VALIDATE_URL) || !preg_match('~^https?://~i',$result['canonical']) || !Html::url($result['canonical'])))){throw new HttpError(422,'Ungültige Canonical-Adresse oder Robots-Angabe.');}
        return $result;
    }
    public static function path(?string $path): ?string {
        if ($path === null || $path === '') { return null; }
        $decoded=rawurldecode($path);
        if (strlen($path) > 450 || !str_starts_with($path, '/') || str_starts_with($path, '//')
            || preg_match('/[?\x00-\x20\x7f#\\\\]/', $decoded) || str_contains($decoded, '..') || str_contains($decoded,'%') || str_starts_with($decoded,'//')
            || preg_match('~^/(admin|api/cms|assets|sitemap.xml|robots.txt)(/|$)~', $decoded) || preg_match('~^/media/[a-f0-9]{32}$~D',$decoded)) { throw new HttpError(422, 'Ungültiger oder reservierter Seitenpfad.'); }
        return $path;
    }
}
