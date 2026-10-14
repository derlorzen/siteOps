<?php
declare(strict_types=1);
namespace SiteCms;

/** Safe portable page sections, with order controlled by the editor. */
final class Blocks {
    public static function validate(mixed $rows):array {
        if(!is_array($rows) || !array_is_list($rows) || count($rows)>30){throw new HttpError(422,'Höchstens 30 Inhaltsbausteine sind erlaubt.');}
        $schema=new Schema(['block'=>['fields'=>[
            'kind'=>['label'=>'Baustein','kind'=>'select','options'=>['text','image','cta'],'required'=>true],
            'title'=>['label'=>'Überschrift','max'=>255], 'body'=>['label'=>'Text','kind'=>'html'],
            'image'=>['label'=>'Bild','kind'=>'url'],'alt'=>['label'=>'Alternativtext','max'=>255],
            'label'=>['label'=>'Linktext','max'=>100], 'url'=>['label'=>'Link','kind'=>'url'],
        ]]]);$result=[];
        foreach($rows as $row){if(!is_array($row)){throw new HttpError(422,'Ungültiger Baustein.');}$block=$schema->fields('block',$row);
            if($block['kind']==='image' && ($block['image']==='' || !Html::url($block['image'],true) || trim($block['alt'])==='')){throw new HttpError(422,'Bildbausteine brauchen ein Bild und einen Alternativtext.');}
            if($block['kind']==='cta' && ($block['url']==='' || $block['label']==='')){throw new HttpError(422,'Linkbausteine brauchen Linktext und URL.');}
            $result[]=$block;
        }return $result;
    }
    public static function render(array $rows,?callable $rich=null):string {
        $rich ??= Html::sanitize(...);
        $html='';foreach(self::validate($rows) as $block){$html.='<section class="section cms-block cms-block-'.$block['kind'].'">';
            if($block['title']!==''){$html.='<h2>'.Html::escape($block['title']).'</h2>';}
            if($block['kind']==='image'){$html.='<figure><img src="'.Html::escape($block['image']).'" alt="'.Html::escape($block['alt']).'" loading="lazy">'.($block['body']?'<figcaption>'.$rich($block['body']).'</figcaption>':'').'</figure>';}
            else{$html.='<div class="rich">'.$rich($block['body']).'</div>';if($block['kind']==='cta'){$html.='<a class="join" href="'.Html::escape($block['url']).'">'.Html::escape($block['label']).'</a>';}}
            $html.='</section>';
        }return $html;
    }
}
