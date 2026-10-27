<?php
declare(strict_types=1);

/** Verify project bytes independently on the target before executing project PHP. */
function cmsAgentProject(string $root, mixed $reference): array {
    if (!is_array($reference) || !is_string($reference['id'] ?? null) ||
        !preg_match('/^[a-f0-9-]{36}$/D',$reference['id']) ||
        !is_string($reference['digest'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D',$reference['digest'])) {
        cmsAgentFail(422,'Ungültiger Projektverweis.');
    }
    $raw=file_get_contents($root.'/.lorzcms/projects/'.$reference['id'].'/manifest.json');
    if (!is_string($raw) || !hash_equals($reference['digest'],hash('sha256',$raw))) { cmsAgentFail(422,'Projektmanifest stimmt nicht.'); }
    $manifest=json_decode($raw,true,64,JSON_THROW_ON_ERROR);
    $project=$manifest['project'] ?? '';
    $seed=$manifest['seedPath'] ?? '';
    if (!is_string($project) || !preg_match('/^[a-z][a-z0-9-]{0,59}$/D',$project) || $project==='base' ||
        $project!==($reference['project'] ?? null) || $seed!=='migration/'.$project.'-content.json' ||
        $seed!==($reference['seedPath'] ?? null) || !is_array($manifest['files'] ?? null) ||
        count($manifest['files'])<2 || count($manifest['files'])>1000) { cmsAgentFail(422,'Projektmanifest unvollständig.'); }
    $seen=[];$total=0;
    foreach ($manifest['files'] as $file) {
        $path=$file['path'] ?? '';
        if (!is_string($path) || strlen($path)>240 || !preg_match('~^[A-Za-z0-9_./-]+$~D',$path) ||
            str_contains($path,'..') || str_contains($path,'//') || isset($seen[strtolower($path)])) { cmsAgentFail(422,'Unzulässiger Projektpfad.'); }
        $allowed=$path===$seed || $path==='audit/asset-verification.json' ||
            preg_match('~^projects/'.preg_quote($project,'~').'/[A-Za-z0-9_/-]+\.(?:php|json)$~D',$path) ||
            preg_match('~^public/(?:assets/[A-Za-z0-9_./-]+\.(?:css|js|svg|txt|woff2?|ttf|png|jpe?g|webp|gif|ico)|wp-content/uploads/[A-Za-z0-9_./-]+\.(?:svg|png|jpe?g|webp|gif|pdf))$~D',$path);
        if (!$allowed) { cmsAgentFail(422,'Projekt darf Core und Konfiguration nicht ersetzen.'); }
        $seen[strtolower($path)]=true;
        $resolved=realpath($root.'/'.$path);
        if (!$resolved || !str_starts_with(str_replace('\\','/',$resolved),str_replace('\\','/',realpath($root)).'/') ||
            !is_file($resolved) || !is_int($file['bytes'] ?? null) || $file['bytes']<1 || $file['bytes']>5*1024*1024 ||
            filesize($resolved)!==$file['bytes'] || !is_string($file['sha256'] ?? null) ||
            !hash_equals($file['sha256'],hash_file('sha256',$resolved))) { cmsAgentFail(422,'Projektdatei-Prüfsumme stimmt nicht.'); }
        $total+=$file['bytes'];if ($total>64*1024*1024) { cmsAgentFail(422,'Projekt ist zu groß.'); }
        if (str_ends_with($path,'.php')) { token_get_all((string)file_get_contents($resolved),TOKEN_PARSE); }
    }
    if (!isset($seen['projects/'.$project.'/project.php'],$seen[$seed])) { cmsAgentFail(422,'Projektdatei oder Inhaltsexport fehlt.'); }
    $data=cmsAgentJson($root.'/'.$seed);
    if (($data['format'] ?? '')!=='sitecms-content-v1' || ($data['project'] ?? '')!==$project ||
        !is_array($data['contents'] ?? null) || count($data['contents'])>10000) { cmsAgentFail(422,'Unpassender Projekt-Inhaltsexport.'); }
    return $reference;
}

function cmsAgentImportProject(string $root, array $package, SiteCms\Content $content, array $actor): void {
    $data=cmsAgentJson($root.'/'.$package['seedPath']);
    foreach ($data['site_configuration'] ?? [] as $section=>$value) {
        $current=$content->site->get($section);
        $content->site->save($section,$current['version'],$value,$actor);
    }
    foreach ($data['contents'] as $item) {
        $content->create($item['type'],$item['title'],$item['path'],$item['fields'],$item['seo'],$item['status'],
            $actor,$item['id'],$item['options'] ?? []);
    }
    // A staged copy keeps its imported content and URLs but is not indexed automatically.
    $seo=$content->site->get('seo');$value=$seo['value'];$value['indexing']='disabled';
    $content->site->save('seo',$seo['version'],$value,$actor);
}
