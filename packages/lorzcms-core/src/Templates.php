<?php
declare(strict_types=1);
namespace SiteCms;

/** Shared arrangements fill from content records; project widgets stay behind the registry. */
final class Templates {
    public const LAYOUTS=['one'=>1,'two'=>2,'sidebar'=>2,'three'=>3];
    public function __construct(private Content $content,private array $configuration=[]) {}
    public static function validate(array $templates,array $project):array {
        if(!array_is_list($templates) || count($templates)>30){throw new HttpError(422,'Höchstens 30 Vorlagen sind erlaubt.');}$ids=[];$defaults=[];$result=[];
        foreach($templates as $template){if(!is_array($template) || array_diff(array_keys($template),['id','name','types','default_for','sections'])){throw new HttpError(422,'Ungültige Vorlage.');}
            $id=$template['id'] ?? '';if(!is_string($id) || !preg_match('/^[a-z][a-z0-9_-]{0,63}$/D',$id) || isset($ids[$id])){throw new HttpError(422,'Vorlagen benötigen eindeutige IDs.');}$ids[$id]=true;
            if(!is_string($template['name'] ?? null) || trim($template['name'])==='' || mb_strlen($template['name'])>190){throw new HttpError(422,'Vorlagenname erforderlich.');}
            foreach(['types','default_for'] as $key){if(!is_array($template[$key] ?? null) || !array_is_list($template[$key])){throw new HttpError(422,'Inhaltstypen auswählen.');}foreach($template[$key] as $type){if(!is_string($type) || !isset($project['types'][$type]) || ($key==='default_for' && (!in_array($type,$template['types'],true) || isset($defaults[$type])))){throw new HttpError(422,'Unbekannter Typ oder mehrere Standardvorlagen für denselben Typ.');}if($key==='default_for'){$defaults[$type]=$id;}}}
            if(!$template['types']){throw new HttpError(422,'Mindestens einen Inhaltstyp auswählen.');}$sections=$template['sections'] ?? null;if(!is_array($sections) || !array_is_list($sections) || count($sections)>20){throw new HttpError(422,'Höchstens 20 Abschnitte sind erlaubt.');}$nodeIds=[];$titles=0;$count=0;
            foreach($sections as &$section){if(!is_array($section) || array_diff(array_keys($section),['id','layout','tone','spacing','columns']) || !isset(self::LAYOUTS[$section['layout'] ?? '']) || !in_array($section['tone'] ?? '',['plain','soft','dark'],true) || !in_array($section['spacing'] ?? '',['compact','normal','airy'],true)){throw new HttpError(422,'Ungültiger Abschnitt.');}self::nodeId($section['id'] ?? '',$nodeIds);
                if(!is_array($section['columns'] ?? null) || !array_is_list($section['columns']) || count($section['columns'])!==self::LAYOUTS[$section['layout']]){throw new HttpError(422,'Die Spalten passen nicht zum Abschnitt.');}
                foreach($section['columns'] as &$column){if(!is_array($column) || !array_is_list($column)){throw new HttpError(422,'Ungültige Spalte.');}foreach($column as &$node){if(++$count>100 || !is_array($node) || array_diff(array_keys($node),['id','kind','field','module','params','html','heading'])){throw new HttpError(422,'Ungültiges Element.');}self::nodeId($node['id'] ?? '',$nodeIds);$kind=$node['kind'] ?? '';
                    if(!is_string($node['heading'] ?? '') || mb_strlen($node['heading'] ?? '')>190){throw new HttpError(422,'Ungültige Überschrift.');}
                    if($kind==='field'){$key=$node['field'] ?? '';if(!is_string($key)){throw new HttpError(422,'Ungültiges Feld.');}$known=$key==='title';foreach($template['types'] as $type){$known=$known || isset($project['types'][$type]['fields'][$key]);}if(!$known){throw new HttpError(422,'Unbekanntes Inhaltsfeld.');}if($key==='title'){$titles++;}}
                    elseif($kind==='text'){if(!is_string($node['html'] ?? null) || strlen($node['html'])>100000){throw new HttpError(422,'Ungültiger Text.');}$node['html']=Html::sanitize($node['html']);}
                    elseif($kind==='module'){$name=$node['module'] ?? '';if(!is_string($name) || !isset($project['widgets'][$name]) || !is_array($node['params'] ?? null)){throw new HttpError(422,'Unbekanntes Modul.');}/* Only registry metadata is inspected; widgets never execute during validation. */
                        $fields=$project['widgets'][$name]['fields'] ?? [];if(array_diff(array_keys($node['params']),array_keys($fields))){throw new HttpError(422,'Unbekannter Modulparameter.');}foreach($node['params'] as $param=>$value){if(!is_string($value) || strlen($value)>1000){throw new HttpError(422,'Ungültiger Modulparameter.');}if(preg_match('/^\{\{([a-zA-Z0-9_.:]+)\}\}$/D',$value,$match)){$source=preg_replace('/^(fields\.|field:)/','',$match[1]);$known=$source==='title';foreach($template['types'] as $type){$known=$known || isset($project['types'][$type]['fields'][$source]);}if(!$known){throw new HttpError(422,'Unbekannter Parameterplatzhalter.');}}else{$field=$fields[$param];if(($field['kind'] ?? '')==='number' && $value!=='' && (!ctype_digit($value) || (int)$value>($field['max_value'] ?? 999999999))){throw new HttpError(422,'Ungültiger Modulparameter.');}(new Schema(['params'=>['fields'=>[$param=>$field]]]))->fields('params',[$param=>$value]);}}}
                    else{throw new HttpError(422,'Unbekannter Elementtyp.');}
                }unset($node);}unset($column);
            }unset($section);if($titles!==1){throw new HttpError(422,'Jede Vorlage benötigt genau ein Titel-Element.');}$template['sections']=$sections;$result[]=$template;
        }return $result;
    }
    private static function nodeId(mixed $id,array &$ids):void {if(!is_string($id) || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/D',$id) || isset($ids[$id])){throw new HttpError(422,'Element-IDs müssen eindeutig sein.');}$ids[$id]=true;}
    public function resolve(array $item):?array {
        $selected=$item['options']['template'] ?? 'inherit';if($selected==='none'){return null;}foreach($this->content->site->value('templates') as $template){if(($selected==='inherit' && in_array($item['type'],$template['default_for'],true)) || ($selected===$template['id'] && in_array($item['type'],$template['types'],true))){return $template;}}return null;
    }
    public function render(array $template,array $item):string {
        $prepare=$this->content->site->project['template_context'] ?? null;if($prepare){$item=$prepare($item,$template,$this->content,$this->configuration);}
        $placeholders=new Placeholders($this->content,$this->configuration);$html='<div class="cms-template" data-template="'.Html::escape($template['id']).'">';
        foreach($template['sections'] as $section){$html.='<section class="template-section tone-'.$section['tone'].' spacing-'.$section['spacing'].'"><div class="template-container grid-'.$section['layout'].'">';foreach($section['columns'] as $column){$html.='<div class="template-column">';foreach($column as $node){$value=$this->widget($node,$item,$placeholders);if($value!==''){$html.='<div class="template-widget widget-'.$node['kind'].'">'.(!empty($node['heading'])?'<h2>'.Html::escape($node['heading']).'</h2>':'').$value.'</div>';}}$html.='</div>';}$html.='</div></section>';}
        return $html.'</div>';
    }
    private function widget(array $node,array $item,Placeholders $placeholders):string {
        if($node['kind']==='module'){return $placeholders->module($node['module'],$node['params'],$item);}if($node['kind']==='text'){return '<div class="rich">'.$placeholders->rich($node['html'],$item).'</div>';}
        $key=$node['field'];if($key==='title'){return '<h1>'.Html::escape($item['title']).'</h1>';}$value=$item['fields'][$key] ?? '';$resolver=$this->content->site->project['field_resolvers'][$key] ?? null;if($value==='' && $resolver){$value=$resolver($item,$this->content,$this->configuration);}if($value==='' || $value===[]){return '';}$field=$this->content->schema->types[$item['type']]['fields'][$key] ?? [];$kind=$field['kind'] ?? 'text';
        if($kind==='html'){return '<div class="rich">'.$placeholders->rich($value,$item).'</div>';}
        if($kind==='image' || ($field['presentation'] ?? '')==='image'){if(Html::url($value,true) && isset($this->content->site->project['render_image'])){return ($this->content->site->project['render_image'])($value,$item,$this->content,$this->configuration);}return Html::url($value,true)?'<figure class="template-photo"><img src="'.Html::escape($value).'" alt="'.Html::escape($item['title']).'" loading="lazy"></figure>':'';}
        if($kind==='rows'){if(!is_array($value)){return '';}$html='<div class="table-scroll"><table><thead><tr>';foreach($field['columns'] as $column){$html.='<th>'.Html::escape($column['label']).'</th>';}$html.='</tr></thead><tbody>';foreach($value as $row){$html.='<tr>';foreach($field['columns'] as $column=>$definition){$html.='<td>'.Html::escape($row[$column] ?? '').'</td>';}$html.='</tr>';}return $html.'</tbody></table></div>';}
        if(!is_string($value)){return '';}return '<p class="field-value">'.nl2br(Html::escape($value)).'</p>';
    }
}
