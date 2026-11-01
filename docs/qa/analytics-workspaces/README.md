# Analytics: gerenderte Vorher-/Nachher-Ansichten

Aufnahme am 31.10.2026 mit Chromium, tatsächlichen SiteOps-Server-Renderern und simulierten Providerantworten aus `test/analytics-fixture.mjs`. Keine Mockups und keine Live-Kundendaten. Die Vorher-Aufnahmen verwenden Code und Assets aus `464bac492bfd06b0de8d6d1907cf0627e2d23256`; beide Stände erhalten dieselbe Fixture. Videobilder sind in dieser Fixture nicht hinterlegt; echte Provider-Thumbnails werden unterstützt.

| Ansicht | Vorher, 1440 px | Nachher, 1440 px | Nachher, 390 px |
| --- | --- | --- | --- |
| Search Console | [Einrichtung vor Daten](before-search-console-desktop.png) | [Suchleistung](search-console-desktop.png) | [Mobil](search-console-mobile.png) |
| YouTube Analytics | [Kennzahlen und Rohdatentabellen](before-youtube-desktop.png) | [Videoanalyse](youtube-desktop.png) | [Mobil](youtube-mobile.png) |

`test/analytics-browser.test.mjs` prüft beide verbundenen Ansichten bei 360, 390, 768, 1280 und 1440 Pixeln. Vier zusätzliche axe-Scans bei 390/1440 Pixeln meldeten keine Verstöße: [Befunde](accessibility.json). Der bestehende Produkt-Browsertest prüfte weitere 115 Ansichten und 66 Accessibility-Zustände, ebenfalls ohne Befunde.

Die ausführliche Änderung, Interaktionsprüfung und Grenzen stehen im [Umsetzungsnachweis](../../ANALYTICS-WORKSPACES.md). CI erzeugt neue Screenshots und Befunde als `siteops-product-qa`-Artefakt. Lokale Gesamtsuite: 439 bestanden, 16 übersprungen; zusätzliche aktivierte Browser-Testfälle: sieben bestanden.
