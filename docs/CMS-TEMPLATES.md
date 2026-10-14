# LorzCMS 3.4: gemeinsame Seitentemplates

Unter **Layout** werden Seitenaufbau, Basislayout, Logo, Header, Footer, Farben,
Inhaltsbreite und eigenes CSS eingestellt. Unter **Vorlagen** bleibt der visuelle
Editor für Inhaltsabschnitte, Spalten, Felder und Projektmodule erreichbar.
Beide Bereiche zeigen die vier Basislayouts mit einer Vorschau anhand vorhandener
Inhalte. Die Vorschau verwendet gespeicherte Einstellungen und verändert keine Seite.

| Basislayout | Aufbau | Typischer Einsatz |
| --- | --- | --- |
| Studio | Großer Titel, flexible Inhaltsfläche | Unternehmen, Vereine, Praxen |
| Journal | Serifentitel, schmale Lesespalte | Artikel, längere Texte |
| Fokus | Titel links, Inhalt rechts; mobil untereinander | Leistungen, Profile |
| Landing | Zentrierter Auftakt, eigener Inhaltsbereich | Startseiten, Angebote |

Im Inhaltseditor unter **Kategorien & Layout → Basislayout der Seite** kann eine
Seite vom globalen Layout abweichen. „Globales Basislayout übernehmen“ folgt der
Website-Einstellung. Die vorhandene Inhaltsvorlage bestimmt weiterhin, welche
Felder und Module im Content erscheinen. Ihr Titel ersetzt den automatischen
Seitentitel, damit nur eine H1 ausgegeben wird. Ohne Inhaltsvorlage werden die
sichtbaren Schemafelder und anschließend die zusätzlichen Bausteine ausgegeben.

## Header und Footer gestalten

Header und Footer sind eigenständige HTML-Vorlagen. Die äußeren semantischen
`header`-/`footer`-Elemente liefert der Kern. Innerhalb dieser Bereiche lassen sich
HTML-Struktur und CSS-Klassen ändern. PHP, JavaScript, Inline-CSS, Formulare und
externe Einbettungen werden nicht ausgeführt. Platzhalter stehen zwischen Tags,
niemals in Attributen.

Header-Slots: `{{brand}}`, `{{navigation}}`, `{{tagline}}`. Marke und Navigation
müssen jeweils einmal vorkommen. `brand` nutzt das ausgewählte Logo oder den
Website-Namen; Navigation stammt aus der Menüverwaltung.

Footer-Slots: `{{brand}}`, `{{tagline}}`, `{{footer_text}}`,
`{{footer_navigation}}`, `{{contact}}`. Kontakt nutzt die Kontakt-E-Mail unter
Einstellungen; der Footertext stammt aus Layout.

Beispiel für einen Header mit zusätzlicher Kurzbeschreibung:

```html
<div class="site-container header-inner">
  <div class="brand-group">{{brand}}<p>{{tagline}}</p></div>
  {{navigation}}
</div>
```

Eigenes CSS wird am Ende von `/assets/site-theme.css` ausgeliefert. Es unterliegt
der bestehenden Content Security Policy. Die Verwaltung lädt diese Datei nicht.
Farben und Breite stehen als CSS-Variablen zur Verfügung:

```css
.cms-page {
  --page-radius: .4rem;
}
.cms-page .site-header {
  border-bottom: 3px solid var(--site-accent);
}
.cms-page .brand-group p {
  font-size: .8rem;
  margin-bottom: 0;
}
.page-landing .page-intro { max-width: 60rem; }
@media (max-width: 760px) {
  .cms-page .header-inner { gap: .75rem; }
}
```

Stabile Hooks: `.cms-page`, `.page-studio`, `.page-editorial`, `.page-split`,
`.page-landing`, `.site-container`, `.site-header`, `.site-brand`,
`.site-navigation`, `.page-intro`, `.page-content`, `.site-footer` und
`.footer-inner`. Variablen: `--site-accent`, `--site-background`, `--site-text`,
`--site-width`, `--page-radius`, `--page-rule`.

## Individuelle Projekte anbinden

„Automatisch“ aktiviert die gemeinsamen Templates für `project=base`, auch für
bereits installierte Basisprojekte. HSG, Nordiamed und andere individuelle Projekte
behalten bei dieser Einstellung ihren eigenen Renderer. Zum Umstellen auf die
gemeinsamen Templates unter Layout den entsprechenden Seitenaufbau wählen.
Spezialrouten aus `project['handler']` behalten ihren bisherigen Aufbau. Auch die
Vorschau im Inhaltseditor folgt dem ausgewählten Renderer.

Registrierte `widgets`, `template_context`, `field_resolvers` und `render_image`
funktionieren weiterhin in Inhaltsvorlagen. Ohne Inhaltsvorlage funktionieren
Feldresolver, Bildrenderer und Module im Rich Text ebenfalls. Individuelle
CSS-Dateien werden über `project['page_styles']` eingebunden. Für Module mit
besonderer Darstellung muss das Projekt dort die passenden Styles registrieren.

Der Kern enthält eigene PHP-Partials in `src/Views/` für Header, Footer und die
vier Layouts. Vertrauenswürdiger Projektcode kann einzelne Partials ersetzen:

```php
'page_styles' => ['/assets/project.css'],
'page_partials' => [
    'footer' => static fn(array $view): string =>
        '<footer class="site-footer"><div class="project-footer">'
        .$view['footer'].'</div></footer>',
],
```

Der Callback erhält `intro`, `content`, `item`, `site`, `cms`, `configuration`
und bei Header/Footer zusätzlich `header` und `footer`. Zurückgegebener HTML-Code
ist vertrauenswürdiger PHP-Projektcode; dynamische Texte dort selbst escapen.
Die Dateien verbleiben im Projekt und werden bei Core-Updates nicht überschrieben.

## Auslieferung und Wiederherstellung

Die Templates und ihre Styles sind Teil des gemeinsamen Releases **3.4.0**.
SiteOps verteilt dieses Paket wie andere Core-Releases je Website sofort oder
zeitgesteuert. Eine Veröffentlichung im Git-Repository allein aktualisiert keine
Live-Website. Farben, HTML-Vorlagen, CSS und globale Auswahl verbleiben versioniert
in der jeweiligen Website-Datenbank. Der Änderungsverlauf unter Layout kann sie
wiederherstellen. Ein Code-Rollback verändert diese Daten nicht.

Schema 1 bleibt erhalten. Ein Core vor 3.4 kennt explizite `page_template`-
Zuordnungen noch nicht. Vor einem Rollback auf 3.3 oder älter deshalb individuelle
Basislayouts auf „Globales Basislayout übernehmen“ zurücksetzen, wenn Inhalte mit
dem alten Core weiter bearbeitet werden sollen. Normale Seiten bekommen keinen
zusätzlichen Optionsschlüssel. Die neuen Layout-Einstellungen werden im alten
Core nicht verwendet; ein Speichern der alten Layoutmaske ersetzt die dort noch
unbekannten Einstellungen. Ein erneutes Update auf 3.4 stellt die Codefunktionen
wieder bereit.
