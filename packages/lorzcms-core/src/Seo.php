<?php
declare(strict_types=1);
namespace SiteCms;

final class Seo {
    public static function metadata(array $item,Site $site,array $configuration):array {
        $defaults=$site->value('seo');$seo=$item['seo'];$title=$seo['title'] ?: $item['title'].$defaults['title_suffix'];
        $description=$seo['description'] ?: ($defaults['description'] ?: $item['title']);
        $canonical=$seo['canonical'] ?? '';if($canonical===''){$canonical=$configuration['base_url'].$item['path'];}
        $image=$seo['image'] ?: $defaults['image'];if(str_starts_with($image,'/')){$image=$configuration['base_url'].$image;}
        return ['title'=>$title,'description'=>$description,'canonical'=>$canonical,'image'=>$image,'share_title'=>($seo['share_title'] ?? '') ?: $title,'share_description'=>($seo['share_description'] ?? '') ?: $description,
            'robots'=>(($configuration['environment']!=='production' || $defaults['indexing']==='disabled' || $seo['noindex'])?'noindex':'index').','.(($seo['nofollow'] ?? false)?'nofollow':'follow')];
    }
    public static function head(array $item,Site $site,array $configuration):string {
        $m=self::metadata($item,$site,$configuration);$e=Html::escape(...);
        $html='<title>'.$e($m['title']).'</title><meta name="description" content="'.$e($m['description']).'"><meta name="robots" content="'.$e($m['robots']).'"><link rel="canonical" href="'.$e($m['canonical']).'">';
        foreach(['title'=>$m['share_title'],'description'=>$m['share_description'],'url'=>$m['canonical'],'type'=>$item['type']==='post'?'article':'website','image'=>$m['image']] as $key=>$value){if($value!==''){$html.='<meta property="og:'.$key.'" content="'.$e($value).'">';}}
        return $html.'<meta name="twitter:card" content="'.($m['image']?'summary_large_image':'summary').'">';
    }
    public static function audit(array $item):array {
        $issues=[];if(!$item['path']){$issues[]='Kein öffentlicher Pfad';}
        if(($item['seo']['description'] ?? '')===''){$issues[]='Eigene Beschreibung fehlt';}
        $title=$item['seo']['title'] ?: $item['title'];if(mb_strlen($title)>65){$issues[]='Titel ist länger als 65 Zeichen';}
        if(mb_strlen($item['seo']['description'])>170){$issues[]='Beschreibung ist länger als 170 Zeichen';}
        if($item['seo']['noindex']){$issues[]='Von Suchmaschinen ausgeschlossen';}
        return $issues;
    }
}
