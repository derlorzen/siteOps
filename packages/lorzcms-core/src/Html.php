<?php
declare(strict_types=1);
namespace SiteCms;

final class Html {
    public static function escape(mixed $value): string { return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
    public static function url(string $value, bool $image = false): bool {
        if (preg_match('/[\x00-\x20\x7f\\\\]/', $value) || str_starts_with($value, '//')) { return false; }
        return str_starts_with($value, '/') || str_starts_with($value, '#') || preg_match($image ? '~^https?://~i' : '~^(https?://|mailto:|tel:)~i', $value) === 1;
    }
    /** Allowlisted rich text, used for import, saving and final rendering. */
    public static function sanitize(string $html): string {
        $document = new \DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);
        $document->loadHTML('<?xml encoding="UTF-8"><html><body>' . $html . '</body></html>', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors(); libxml_use_internal_errors($previous);
        $allowed = ['p','h2','h3','h4','strong','em','b','i','a','img','ul','ol','li','br','blockquote','table','thead','tbody','tr','th','td','figure','figcaption','hr','span'];
        $walk = function (\DOMNode $parent) use (&$walk, $allowed): void {
            foreach (iterator_to_array($parent->childNodes) as $node) {
                if (!$node instanceof \DOMElement) { if ($node instanceof \DOMComment) { $parent->removeChild($node); } continue; }
                $tag = strtolower($node->tagName);
                if (in_array($tag, ['script','style','iframe','object','embed','svg','math','form','input','button','textarea','select','template','link','meta'], true)) { $parent->removeChild($node); continue; }
                $walk($node);
                if (!in_array($tag, $allowed, true)) {
                    while ($node->firstChild) { $parent->insertBefore($node->firstChild, $node); }
                    $parent->removeChild($node); continue;
                }
                foreach (iterator_to_array($node->attributes) as $attribute) {
                    $name = strtolower($attribute->name); $value = $attribute->value;
                    $keep = in_array($name, ['alt','title'], true)
                        || ($tag === 'a' && $name === 'href' && self::url($value))
                        || ($tag === 'img' && $name === 'src' && self::url($value, true))
                        || (in_array($tag, ['th','td'], true) && in_array($name, ['colspan','rowspan'], true) && preg_match('/^[1-9][0-9]?$/D', $value));
                    if (!$keep) { $node->removeAttribute($attribute->name); }
                }
                if ($tag === 'img') { $node->setAttribute('loading', 'lazy'); $node->setAttribute('decoding', 'async'); }
            }
        };
        $body = $document->getElementsByTagName('body')->item(0); $walk($body);
        $result = ''; foreach ($body->childNodes as $node) { $result .= $document->saveHTML($node); }
        return $result;
    }
}
