<?php
declare(strict_types=1);
namespace SiteCms;

/** Shared page shell. Project callbacks only replace named, trusted rendering seams. */
final class PageTemplates {
    public const PRESETS=['studio'=>'Studio · klar & vielseitig','editorial'=>'Journal · lesefreundlich','split'=>'Fokus · Titel neben Inhalt','landing'=>'Landing · großzügiger Auftakt'];
    public const HEADER='<div class="site-container header-inner">{{brand}}{{navigation}}</div>';
    public const FOOTER='<div class="site-container footer-inner"><div>{{brand}}<p>{{tagline}}</p><p>{{footer_text}}</p></div><div>{{footer_navigation}}{{contact}}</div></div>';
    public function __construct(private Content $content,private array $configuration) {}
    public function enabled():bool {
        $mode=$this->content->site->value('appearance')['engine'];
        return $mode==='shared' || ($mode==='auto' && ($this->configuration['project'] ?? '')==='base');
    }
    public static function output(array $item,array $configuration,Content $content):void {
        $engine=new self($content,$configuration);
        if($engine->enabled()) {echo $engine->render($item);}
        else {($content->site->project['render'])($item,$configuration,$content);}
    }
    public static function validatePartial(string $html,string $region):string {
        $html=Html::sanitize($html,true);
        $document=new \DOMDocument();@$document->loadHTML('<?xml encoding="UTF-8"><html><body>'.$html.'</body></html>',LIBXML_NONET);
        foreach($document->getElementsByTagName('*') as $node){foreach($node->attributes as $attribute){if(str_contains($attribute->value,'{{')){throw new HttpError(422,'Platzhalter nur zwischen HTML-Tags einsetzen.');}}}
        $allowed=$region==='header'?['brand','navigation','tagline']:['brand','tagline','footer_text','footer_navigation','contact'];
        preg_match_all('/\{\{(.*?)\}\}/s',$html,$matches);
        foreach($matches[1] as $token){if(!in_array($token,$allowed,true)){throw new HttpError(422,'Unbekannter Platzhalter im '.$region.': '.$token);}}
        if($region==='header' && (substr_count($html,'{{brand}}')!==1 || substr_count($html,'{{navigation}}')!==1)){throw new HttpError(422,'Der Header benötigt {{brand}} und {{navigation}} jeweils einmal.');}
        return $html;
    }
    public function render(array $item,?array $contentTemplate=null):string {
        $site=$this->content->site;$appearance=$site->value('appearance');$settings=$site->value('settings');$e=Html::escape(...);
        $preset=$item['options']['page_template'] ?? 'inherit';if($preset==='inherit'){$preset=$appearance['page_template'];}
        if(!isset(self::PRESETS[$preset])){$preset='studio';}
        $templates=new Templates($this->content,$this->configuration);$template=$contentTemplate ?? $templates->resolve($item);
        if($template){$body=$templates->render($template,$item);$intro='';}
        else {
            $intro='<div class="page-intro"><p class="page-eyebrow">'.$e($settings['tagline']).'</p><h1>'.$e($item['title']).'</h1></div>';
            $body=$templates->renderFields($item);
        }
        $body.=Blocks::render($item['options']['blocks'] ?? []);
        $view=['intro'=>$intro,'content'=>$body,'item'=>$item,'site'=>$site,'cms'=>$this->content,'configuration'=>$this->configuration];
        $main=$this->partial($preset,$view);
        $brand='<a class="site-brand" href="/">'.($appearance['logo']!==''?'<img src="'.$e($appearance['logo']).'" alt="'.$e($settings['name']).'" width="180" height="60">':$e($settings['name'])).'</a>';
        $slots=['{{brand}}'=>$brand,'{{navigation}}'=>'<nav class="site-navigation" aria-label="Hauptnavigation">'.$site->menu('header',$item['path'] ?? '').'</nav>','{{tagline}}'=>$e($settings['tagline']),'{{footer_text}}'=>nl2br($e($appearance['footer'])),'{{footer_navigation}}'=>'<nav aria-label="Fußnavigation">'.$site->menu('footer',$item['path'] ?? '').'</nav>','{{contact}}'=>$settings['contact_email']!==''?'<a href="mailto:'.$e($settings['contact_email']).'">'.$e($settings['contact_email']).'</a>':''];
        $header=strtr(self::validatePartial($appearance['header_template'],'header'),$slots);$footer=strtr(self::validatePartial($appearance['footer_template'],'footer'),$slots);
        $view+=['header'=>$header,'footer'=>$footer];
        $styles='<link rel="stylesheet" href="/assets/templates.css"><link rel="stylesheet" href="/assets/page-templates.css">';
        foreach($site->project['page_styles'] ?? [] as $style){if(is_string($style) && Html::url($style)){$styles.='<link rel="stylesheet" href="'.$e($style).'">';}}
        return '<!doctype html><html lang="'.$e($settings['language']).'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'.Seo::head($item,$site,$this->configuration).$styles.'<link rel="stylesheet" href="/assets/site-theme.css"></head><body class="cms-page page-'.$preset.' header-'.$e($appearance['header_style']).' header-'.$e($appearance['header']).' footer-'.$e($appearance['footer_style']).' layout-'.$e($item['options']['layout'] ?? 'default').'"><a class="skip-link" href="#main-content">Zum Inhalt</a>'.$this->partial('header',$view).'<main id="main-content" tabindex="-1">'.$main.'</main>'.$this->partial('footer',$view).'</body></html>';
    }
    private function partial(string $name,array $view):string {
        $override=$this->content->site->project['page_partials'][$name] ?? null;
        if($override){return (string)$override($view);}
        // Only names from PRESETS or the fixed header/footer slots reach this include.
        return require __DIR__.'/Views/'.$name.'.php';
    }
}
