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
                ($statistics && ($umami = self::umami($site)) ? '<script type="text/plain" data-lorzcms-consent="statistics" data-src="/assets/umami-loader.js?v=3.7.0" data-lorzcms-umami data-host="'.Html::escape($umami['host']).'" data-website-id="'.Html::escape($umami['website_id']).'"></script>' : '').
                '<script src="/assets/cookie-consent.js?v=3.7.0" defer></script>';
        }
        $headEnd = stripos($html, '</head>');
        if ($headEnd !== false && $headEnd < $bodyEnd) {
            $style = '<link rel="stylesheet" href="/assets/cookie-consent.css?v=3.7.0">';
            $html = substr_replace($html, $style, $headEnd, 0);
            $bodyEnd += strlen($style);
        }
        return substr_replace($html, $markup, $bodyEnd, 0);
    }

    /** Public privacy policy path; without it no consent dialog and therefore no optional service is rendered. */
    public static function privacyPath(Content $content): string {
        return self::legalPath($content, (string)($content->site->value('privacy')['privacy_path'] ?? ''), ['/datenschutz/', '/datenschutzerklaerung/', '/datenschutzerklaerung-eu/', '/privacy-policy/']);
    }

    /** Umami tracking target, only when statistics consent is offered and the configuration is complete. */
    public static function umami(Site $site): ?array {
        $value = $site->value('privacy');
        if (($value['statistics'] ?? 'off') !== 'on' || ($value['umami'] ?? 'off') !== 'on') {
            return null;
        }
        $host = (string)($value['umami_host'] ?? '');
        $id = strtolower((string)($value['umami_website_id'] ?? ''));
        if (!self::isUmamiHost($host) || !self::isUuid($id)) {
            return null;
        }
        return ['host' => rtrim($host, '/'), 'website_id' => $id];
    }

    /** Content-Security-Policy for public pages; the Umami origin is allowed only while tracking is configured. */
    public static function csp(?Site $site): string {
        $umami = $site ? self::umami($site) : null;
        $origin = $umami ? ' '.$umami['host'] : '';
        return "default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'".$origin."; connect-src 'self'".$origin."; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; object-src 'none'";
    }

    public static function validateUmami(array $value): array {
        $value['umami_host'] = rtrim(trim((string)($value['umami_host'] ?? '')), '/');
        $value['umami_website_id'] = strtolower(trim((string)($value['umami_website_id'] ?? '')));
        if ($value['umami_host'] !== '' && !self::isUmamiHost($value['umami_host'])) {
            throw new HttpError(422, 'Die Umami-Adresse muss eine HTTPS-Adresse ohne Pfad sein, zum Beispiel https://stats.lorzen.de');
        }
        if ($value['umami_website_id'] !== '' && !self::isUuid($value['umami_website_id'])) {
            throw new HttpError(422, 'Die Umami-Website-ID muss eine UUID sein.');
        }
        if (($value['umami'] ?? 'off') === 'on' && ($value['umami_host'] === '' || $value['umami_website_id'] === '')) {
            throw new HttpError(422, 'Für Umami werden Adresse und Website-ID benötigt.');
        }
        return $value;
    }

    private static function isUmamiHost(string $host): bool {
        return preg_match('~^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/?$~D', $host) === 1;
    }

    private static function isUuid(string $id): bool {
        return preg_match('~^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$~D', $id) === 1;
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
