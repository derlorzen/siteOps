<?php
declare(strict_types=1);
namespace SiteCms\Migration;
use SiteCms\{Content,Html};

/** WP-specific transport ends here; no WordPress runtime is retained. */
final class WordPressImport {
    public function __construct(private Content $content,private array $actor) {}
    public function run(array $records,callable $map):array {
        $result=['created'=>0,'skipped'=>0];
        foreach($records as $record){
            $mapped=$map($record); $id=$mapped['id'];
            if($this->content->get($id)){$result['skipped']++;continue;}
            $this->content->create($mapped['type'],html_entity_decode($mapped['title'],ENT_QUOTES|ENT_HTML5,'UTF-8'),$mapped['path'],$mapped['fields'],$mapped['seo'] ?? [],$mapped['status'] ?? 'draft',$this->actor,$id);$result['created']++;
        }
        return $result;
    }
    public static function clean(string $html,array $removeClassPrefixes=[],string $sourceOrigin=''):string {
        $document=new \DOMDocument();$previous=libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="UTF-8"><html><body>'.$html.'</body></html>',LIBXML_NONET|LIBXML_NOERROR|LIBXML_NOWARNING);libxml_clear_errors();libxml_use_internal_errors($previous);
        $xpath=new \DOMXPath($document);
        foreach(iterator_to_array($xpath->query('//*[@class or @data-widget_type]')) as $element){
            $classes=explode(' ',$element->getAttribute('class'));$classes[]=$element->getAttribute('data-widget_type');$remove=false;
            foreach($classes as $class){foreach($removeClassPrefixes as $prefix){if(str_starts_with($class,$prefix)){$remove=true;}}}
            if($remove && $element->parentNode){$element->parentNode->removeChild($element);}
        }
        foreach($xpath->query('//img[@data-src]') as $image){$image->setAttribute('src',$image->getAttribute('data-src'));}
        if($sourceOrigin!==''){foreach($xpath->query('//*[@href or @src]') as $link){foreach(['href','src'] as $attribute){$url=$link->getAttribute($attribute);if(str_starts_with($url,rtrim($sourceOrigin,'/').'/')){$link->setAttribute($attribute,substr($url,strlen(rtrim($sourceOrigin,'/'))));}}}}
        $body=$document->getElementsByTagName('body')->item(0);$result='';foreach($body->childNodes as $child){$result.=$document->saveHTML($child);}return Html::sanitize($result);
    }
    public static function main(string $html):string {
        $document=new \DOMDocument();$previous=libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="UTF-8">'.$html,LIBXML_NONET|LIBXML_NOERROR|LIBXML_NOWARNING);libxml_clear_errors();libxml_use_internal_errors($previous);
        $xpath=new \DOMXPath($document);$main=$xpath->query('//main')->item(0) ?? $xpath->query('//article')->item(0);
        return $main?$document->saveHTML($main):'';
    }
}
