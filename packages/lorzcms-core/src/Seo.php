<?php
declare(strict_types=1);
namespace SiteCms;

/** SEO defaults shared by newly created pages, previews and the editorial audit. */
final class Seo {
    private static function absolute(string $url,string $base):string {
        return str_starts_with($url,'/') ? rtrim($base,'/').$url : $url;
    }
    /** Generate a page-specific fallback. Do not repeat the global description on every URL. */
    private static function excerpt(array $item):string {
        $parts=[];
        foreach($item['fields'] ?? [] as $value){if(is_string($value)){$parts[]=$value;}}
        foreach($item['options']['blocks'] ?? [] as $block){if(is_array($block)){foreach(['title','body'] as $key){if(is_string($block[$key] ?? null)){$parts[]=$block[$key];}}}}
        $text=trim(preg_replace('/\s+/u',' ',html_entity_decode(strip_tags(implode(' ',$parts)),ENT_QUOTES | ENT_HTML5,'UTF-8')) ?? '');
        if(mb_strlen($text)>165){$text=rtrim(mb_substr($text,0,162));$last=mb_strrpos($text,' ');if($last!==false && $last>105){$text=mb_substr($text,0,$last);} $text.='…';}
        return $text;
    }
    public static function metadata(array $item,Site $site,array $configuration):array {
        $defaults=$site->value('seo');$seo=$item['seo'] ?? [];
        $title=trim((string)($seo['title'] ?? '')) ?: trim((string)($item['title'] ?? '').($defaults['title_suffix'] ?? ''));
        $description=trim((string)($seo['description'] ?? '')) ?: (self::excerpt($item) ?: (trim((string)($defaults['description'] ?? '')) ?: (string)($item['title'] ?? '')));
        $base=rtrim((string)$configuration['base_url'],'/');
        $canonical=trim((string)($seo['canonical'] ?? '')) ?: $base.($item['path'] ?? '/');
        $image=trim((string)($seo['image'] ?? '')) ?: trim((string)($defaults['image'] ?? ''));
        $image=self::absolute($image,$base);
        $noindex=($configuration['environment'] ?? '')!=='production' || ($defaults['indexing'] ?? '')!=='enabled' || !empty($seo['noindex']);
        return ['title'=>$title,'description'=>$description,'canonical'=>$canonical,'image'=>$image,
            'share_title'=>trim((string)($seo['share_title'] ?? '')) ?: $title,
            'share_description'=>trim((string)($seo['share_description'] ?? '')) ?: $description,
            'robots'=>($noindex?'noindex':'index').(!empty($seo['nofollow'])?',nofollow':',follow')];
    }
    /** Minimal, truthful schema.org graph. Business/address/review claims are never invented. */
    public static function structuredData(array $item,Site $site,array $configuration):array {
        $base=rtrim((string)$configuration['base_url'],'/');
        $settings=$site->value('settings');$m=self::metadata($item,$site,$configuration);
        $siteName=trim((string)($settings['name'] ?? ''));
        $graph=[['@type'=>'WebPage','@id'=>$m['canonical'].'#webpage','url'=>$m['canonical'],
            'name'=>$m['title'],'description'=>$m['description'],'inLanguage'=>$settings['language'] ?? 'de',
            'isPartOf'=>['@id'=>$base.'/#website']]];
        if(($item['path'] ?? '')==='/'){
            $graph[]=['@type'=>'WebSite','@id'=>$base.'/#website','url'=>$base.'/','name'=>$siteName,
                'inLanguage'=>$settings['language'] ?? 'de'];
            if($siteName!=='' && $siteName!=='Meine Website'){
                $organization=['@type'=>'Organization','@id'=>$base.'/#organization','name'=>$siteName,'url'=>$base.'/'];
                $appearance=$site->value('appearance');$logo=trim((string)($appearance['logo'] ?? ''));
                if($logo!==''){$organization['logo']=self::absolute($logo,$base);}
                if(!empty($settings['contact_email'])){$organization['email']=$settings['contact_email'];}
                $graph[]=$organization;
            }
        }
        return ['@context'=>'https://schema.org','@graph'=>$graph];
    }
    public static function head(array $item,Site $site,array $configuration):string {
        $m=self::metadata($item,$site,$configuration);$e=Html::escape(...);
        $html='<title>'.$e($m['title']).'</title><meta name="description" content="'.$e($m['description']).'"><meta name="robots" content="'.$e($m['robots']).'"><link rel="canonical" href="'.$e($m['canonical']).'">';
        foreach(['title'=>$m['share_title'],'description'=>$m['share_description'],'url'=>$m['canonical'],'type'=>($item['type'] ?? '')==='post'?'article':'website','image'=>$m['image']] as $key=>$value){
            if($value!==''){$html.='<meta property="og:'.$key.'" content="'.$e($value).'">';}
        }
        $html.='<meta name="twitter:card" content="'.($m['image']?'summary_large_image':'summary').'">';
        $html.='<meta name="twitter:title" content="'.$e($m['share_title']).'"><meta name="twitter:description" content="'.$e($m['share_description']).'">';
        $json=json_encode(self::structuredData($item,$site,$configuration),JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
        return $html.'<script type="application/ld+json">'.$json.'</script>';
    }
    /** Editorial recommendations are advisory; search engines set no fixed character limits. */
    public static function audit(array $item,?Site $site=null,?array $configuration=null):array {
        $issues=[];$seo=$item['seo'] ?? [];
        if(empty($item['path'])){$issues[]='Öffentlicher Pfad fehlt';}
        if(trim((string)($item['title'] ?? ''))===''){$issues[]='Seitentitel fehlt';}
        if(trim((string)($seo['description'] ?? ''))==='' && self::excerpt($item)===''){$issues[]='Individuelle Seitenbeschreibung ergänzen';}
        if(!empty($seo['noindex'])){$issues[]='Seite ist bewusst auf noindex gesetzt';}
        if(!empty($seo['nofollow'])){$issues[]='Links werden nicht verfolgt (nofollow)';}
        if($site && $configuration){
            $m=self::metadata($item,$site,$configuration);
            if(($configuration['environment'] ?? '')==='production' && ($site->value('seo')['indexing'] ?? '')!=='enabled'){$issues[]='Globale Indexierung ist deaktiviert';}
            if(($item['path'] ?? '') && $m['canonical']!==rtrim((string)$configuration['base_url'],'/').$item['path']){$issues[]='Canonical verweist auf eine andere URL – Absicht prüfen';}
            if($m['image']===''){$issues[]='Vorschaubild für soziale Netzwerke ergänzen';}
        }
        return $issues;
    }
}
