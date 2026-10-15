# LorzCMS 3.5 — SEO-first für neue und bestehende Websites

## Zwei Ebenen statt zweier SEO-Systeme

**SiteOps** crawlt die tatsächlich öffentlich ausgelieferten Seiten unabhängig vom CMS.
Der bestehende Bereich `/sites/:slug/seo` zeigt den technischen Crawl, interne Verlinkung,
Indexierbarkeit, Canonical/Robots/Sitemap, Medien, Inhaltsähnlichkeiten,
Structured Data und, sofern konfiguriert, Google PageSpeed/Lighthouse. Er bleibt
auch für fremde CMS, WordPress und statische Websites nutzbar.
In der LorzCMS-Websiteübersicht und Installationsdetailseite führt der neue
Button **SEO-Audit** direkt in diesen Bereich.

**LorzCMS** übernimmt die SEO-Grundregeln bereits beim Aufbau und in der
Redaktion, bevor der externe Crawl beginnt:

- Automatische, absolute Canonical-URLs aus der konfigurierten HTTPS-Domain.
- Individuelle, aus dem sichtbaren Seitentext abgeleitete Beschreibungen, wenn
  keine redaktionelle Beschreibung gespeichert ist. Ein globaler Standardtext
  wird nicht grundlos auf allen Seiten wiederholt.
- Aussagekräftige Seitentitel mit optionalem Website-Suffix und explizite
  Overrides, ohne Keyword-Stuffing oder starre Zeichengrenzen zu erzwingen.
- HTML-escaped Title, Meta-Description, Robots, Open Graph und Twitter Cards.
  Als Bild-Fallback dient bei vorhandener Konfiguration das Website-Logo.
- JSON-LD für WebPage sowie auf der Startseite WebSite und, falls ein echter
  Website-Name konfiguriert ist, Organization. E-Mail und Logo werden nur
  ausgegeben, wenn echte Werte vorhanden sind. Keine erfundenen lokalen
  Adressen, Bewertungen oder Search-Rich-Result-Versprechen.
- Robots-Indexierung wird anhand Umgebung, globaler Einstellung und
  Seitenoptionen gesteuert. Sitemap nur für veröffentlichte, indexierbare,
  kanonische Inhalte. Vorhandene Weiterleitungen und Pfadvalidierung bleiben
  erhalten.
- Redaktionsprüfung im CMS zeigt u.a. fehlende Beschreibung, Alt-Text,
  Platzhalter, abweichende Canonicals, fehlende Social-Bilder oder bewusstes
  noindex. Diese Empfehlungen blockieren redaktionelle Arbeit nicht.
- Die SEO-Seite nennt HTTPS, Website-Name und Indexierungsfreigabe als
  Startprüfung. Sie ersetzt keine Live-Prüfung des ausgelieferten HTMLs.

## Sicherer Start

**Nur Neuinstallationen** über den SiteOps-Agenten oder den CMS-Ersteinrichter
bekommen bei der Einrichtung `seo.indexing = disabled`. Der vorbereitete
Willkommenstext ist damit nicht indexierbar. Zum Go-Live:

1. Unter `/admin/settings/` Name, Sprache und Kontakt prüfen.
2. Unter `/admin/seo/` Seitentitel, Beschreibungen und optional ein Bild
   hinterlegen; Inhalte redaktionell vervollständigen.
3. SiteOps SEO-Audit über die Installationsseite starten und technische
   Probleme beheben. Bei Umzug der Domain Weiterleitungen prüfen.
4. Bewusst die Indexierung unter `/admin/seo/` erlauben.
5. Einen Live-Crawl wiederholen und Sitemap, Robots, Canonical und
   indexierbare Seiten überprüfen.

Die Änderung setzt **niemals** bereits angeschlossene oder aktualisierte
CMS-Websites stillschweigend auf noindex. Bestehende SiteOps-Websites werden
durch das Release nicht geändert. Eine Freigabe des CMS-Releases und das
anschließende geplante Update sind weiterhin eigenständige Schritte.

SEO ist kein Garant für Rankings. Die Google-Suche gibt keine strikten
Zeichenlimits für Title oder Meta-Descriptions vor. Hinweise im CMS sind
deshalb Empfehlungen und keine vermeintlichen Ranking-Faktoren.
