<?php
declare(strict_types=1);
namespace SiteCms;

final class Consent {
    public static function append(string $html, Content $content, bool $isAdminLogin): string {
        $bodyEnd = strripos($html, '</body>');
        if ($bodyEnd === false || !preg_match('/^\s*<!doctype\s+html\b/i', $html)) {
            return $html;
        }

        $site = $content->site;
        $settings = $site->get('privacy');
        $privacy = self::legalPath($content, $settings['value']['privacy_path'], ['/datenschutz/', '/datenschutzerklaerung/', '/datenschutzerklaerung-eu/', '/privacy-policy/']);
        $imprint = self::legalPath($content, $settings['value']['imprint_path'], ['/impressum/', '/legal-notice/']);
        $statistics = !$isAdminLogin && $privacy !== '' && $settings['value']['statistics'] === 'on';
        $marketing = !$isAdminLogin && $privacy !== '' && $settings['value']['marketing'] === 'on';
        $links = '';
        if ($imprint !== '') {
            $links .= '<a href="'.Html::escape($imprint).'">Impressum</a>';
        }
        if ($privacy !== '') {
            $links .= '<a href="'.Html::escape($privacy).'">Datenschutz</a>';
        }
        if ($statistics || $marketing) {
            $links .= '<button type="button" data-consent-open hidden>Cookie-Einstellungen</button>';
        }
        if ($links === '') {
            return $html;
        }

        $markup = '<div class="lorz-privacy" role="navigation" aria-label="Rechtliche Informationen">'.$links.'</div>';
        if ($statistics || $marketing) {
            $options = ($statistics ? '<label><input type="checkbox" name="statistics"> Statistik</label>' : '').
                ($marketing ? '<label><input type="checkbox" name="marketing"> Marketing</label>' : '');
            $markup .= '<dialog class="lorz-consent" data-consent-dialog data-revision="'.(int)$settings['version'].'" aria-labelledby="lorz-consent-title">'.
                '<h2 id="lorz-consent-title">Cookie-Einstellungen</h2><p>Notwendige Funktionen bleiben verfügbar. Optionale Dienste starten nur, wenn du einwilligst.</p>'.
                '<p><a href="'.Html::escape($privacy).'">Datenschutzerklärung</a></p>'.
                '<form method="dialog">'.$options.'<div class="lorz-consent-actions">'.
                '<button value="reject" autofocus>Nur notwendige</button><button value="save">Auswahl speichern</button><button value="accept">Alle akzeptieren</button></div></form></dialog>'.
                '<script src="/assets/cookie-consent.js?v=3.6.1" defer></script>';
        }
        $headEnd = stripos($html, '</head>');
        if ($headEnd !== false && $headEnd < $bodyEnd) {
            $style = '<link rel="stylesheet" href="/assets/cookie-consent.css?v=3.6.1">';
            $html = substr_replace($html, $style, $headEnd, 0);
            $bodyEnd += strlen($style);
        }
        return substr_replace($html, $markup, $bodyEnd, 0);
    }

    private static function legalPath(Content $content, string $configured, array $fallbacks): string {
        if ($configured !== '') {
            // Explicit configuration also supports published project routes outside the content store.
            return self::isInternalLegalPath($configured) ? $configured : '';
        }
        foreach ($fallbacks as $path) {
            if ($content->at($path)) {
                return $path;
            }
        }
        return '';
    }

    private static function isInternalLegalPath(string $path): bool {
        return preg_match('~^/(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+(?:\.html?|/)?$~D', $path) === 1 &&
            !preg_match('~^/(?:admin|api|assets)(?:/|$)~i', $path);
    }
}
