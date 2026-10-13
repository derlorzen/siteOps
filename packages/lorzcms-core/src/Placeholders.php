<?php
declare(strict_types=1);
namespace SiteCms;

/** Only registered widgets execute. Content is never interpreted as PHP or a template language. */
final class Placeholders {
    public function __construct(private Content $content,private array $configuration=[]) {}
    public function definitions():array {return $this->content->site?->project['widgets'] ?? [];}
    public function value(string $key,array $item):string {
        $key=preg_replace('/^(fields\.|field:)/','',$key);$resolver=$this->content->site?->project['placeholder_values'][$key] ?? null;
        $value=$resolver?$resolver($item,$this->content,$this->configuration):($key==='title'?($item['title'] ?? ''):($item['fields'][$key] ?? ''));return is_string($value)?$value:'';
    }
    public function parameters(string $name,array $values,?array $item=null):array {
        $definition=$this->definitions()[$name] ?? throw new HttpError(422,'Unbekanntes Modul: '.$name);$fields=$definition['fields'] ?? [];
        if(array_diff(array_keys($values),array_keys($fields))){throw new HttpError(422,'Unbekannter Modulparameter.');}$result=[];
        foreach($fields as $key=>$field){$value=$values[$key] ?? ($field['default'] ?? '');if(!is_string($value) || strlen($value)>1000){throw new HttpError(422,'Ungültiger Modulparameter.');}
            if(preg_match('/^\{\{([a-zA-Z0-9_.:]+)\}\}$/D',$value,$m)){
                $source=preg_replace('/^(fields\.|field:)/','',$m[1]);$known=$source==='title';foreach($this->content->schema->types as $type){$known=$known || isset($type['fields'][$source]);}if(!$known){throw new HttpError(422,'Unbekannter Inhaltsplatzhalter.');}
                if($item===null){$result[$key]=$value;continue;}$value=$this->value($m[1],$item);if($value===''){$value=$field['fallback'] ?? '';}
            }
            if(($field['kind'] ?? '')==='number' && $value!=='' && (!ctype_digit($value) || (int)$value>($field['max_value'] ?? 999999999))){throw new HttpError(422,'Ungültige Zahl: '.$key);}
            $result[$key]=(new Schema(['params'=>['fields'=>[$key=>$field]]]))->fields('params',[$key=>$value])[$key];
        }return $result;
    }
    public function module(string $name,array $params,array $item):string {
        $definition=$this->definitions()[$name] ?? null;if(!$definition){return '<p class="widget-notice">Dieses Modul ist nicht verfügbar.</p>';}
        try{$params=$this->parameters($name,$params,$item);$render=$definition['render'];return $render($params,$item,$this->content,$this->configuration);}
        catch(HttpError $error){return '<p class="widget-notice">'.Html::escape($error->getMessage()).'</p>';}
    }
    public function rich(string $html,array $item):string {
        $html=Html::sanitize($html);$document=new \DOMDocument('1.0','UTF-8');$previous=libxml_use_internal_errors(true);$document->loadHTML('<?xml encoding="UTF-8"><html><body>'.$html.'</body></html>',LIBXML_NONET);libxml_clear_errors();libxml_use_internal_errors($previous);
        $body=$document->getElementsByTagName('body')->item(0);$texts=[];$walk=function(\DOMNode $node)use(&$walk,&$texts):void {foreach(iterator_to_array($node->childNodes) as $child){if($child instanceof \DOMText){$texts[]=$child;}else{$walk($child);}}};$walk($body);
        foreach($texts as $text){$parts=preg_split('/(\{\{[a-zA-Z0-9_.:]+\}\}|\[[a-z][a-z0-9_]*(?:\s+[^\]\r\n]*)?\])/',$text->nodeValue,-1,PREG_SPLIT_DELIM_CAPTURE);if(count($parts)<2){continue;}
            foreach($parts as $part){
                if(preg_match('/^\{\{([a-zA-Z0-9_.:]+)\}\}$/D',$part,$m)){$text->parentNode->insertBefore($document->createTextNode($this->value($m[1],$item)),$text);continue;}
                if(preg_match('/^\[([a-z][a-z0-9_]*)(.*)\]$/Ds',$part,$m) && isset($this->definitions()[$m[1]])){
                    $args=[];$rest=trim($m[2]);while($rest!=='') {if(!preg_match('/^([a-z][a-z0-9_]*)\s*=\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\s]+))(?:\s+|$)/s',$rest,$attr)){break;}$args[$attr[1]]=($attr[2] ?? '')!==''?$attr[2]:(($attr[3] ?? '')!==''?$attr[3]:($attr[4] ?? ''));$rest=substr($rest,strlen($attr[0]));}
                    $rendered=$rest===''?$this->module($m[1],$args,$item):'<p class="widget-notice">Ungültiger Platzhalter.</p>';
                    // Keep generated block widgets outside paragraph/heading wrappers.
                    if($text->parentNode instanceof \DOMElement && in_array($text->parentNode->tagName,['p','h2','h3','h4'],true) && trim($text->parentNode->textContent)===$part){$wrapper=$text->parentNode;$div=$document->createElement('div');$wrapper->parentNode->replaceChild($div,$wrapper);$div->appendChild($text);}
                    $fragment=new \DOMDocument('1.0','UTF-8');$old=libxml_use_internal_errors(true);$fragment->loadHTML('<?xml encoding="UTF-8"><html><body>'.$rendered.'</body></html>',LIBXML_NONET);libxml_clear_errors();libxml_use_internal_errors($old);foreach(iterator_to_array($fragment->getElementsByTagName('body')->item(0)->childNodes) as $node){$text->parentNode->insertBefore($document->importNode($node,true),$text);}continue;
                }$text->parentNode->insertBefore($document->createTextNode($part),$text);
            }$text->parentNode->removeChild($text);
        }$result='';foreach($body->childNodes as $node){$result.=$document->saveHTML($node);}return $result;
    }
}
