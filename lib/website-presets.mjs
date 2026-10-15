/** Evidence-based public information preset. ERGO 2025 claims, published 2026-06-10.
 * Reported claim shares are NOT sport-hour-adjusted individual injury risks.
 * Review date and sources before publishing; these are general explanatory pages.
 */
const sportSources = {
  "ergo": "https://www.ergo.com/de/newsroom-ergo/reports-dossiers/sportunfaelle",
  "dguv": "https://www.dguv.de/de/ihr_partner/arbeitnehmer/gesetzliche-uv/index.jsp",
  "dguvfaq": "https://www.dguv.de/de/versicherung/versicherte_personen/faq_leistungen/index.jsp",
  "gdv": "https://www.gdv.de/gdv/medien/medieninformationen/skiunfaelle-verursachen-die-hoechsten-kosten-so-sichern-sich-urlauber-richtig-ab-185344",
  "bmas": "https://www.bmas.de/DE/Soziales/Gesetzliche-Unfallversicherung/Fragen-und-Antworten/faq-gesetzliche-unfallversicherung.html"
};
const authoredPages = [
  {
    "title": "Unfallversicherung: sinnvoll absichern",
    "path": "/",
    "description": "Private Unfallversicherung verständlich erklärt: Freizeitunfälle, gesetzlicher Schutz, typische Leistungen und Sportarten mit vielen gemeldeten Unfällen.",
    "html": "<h2>Ein Unfall kann den Alltag verändern. Was schützt wirklich?</h2>\n<p>Ein Sturz im Haushalt, ein Zusammenprall beim Fußball oder ein Unfall auf der Skipiste: Arztbesuche und Rehabilitation sind häufig abgesichert. Bleiben jedoch dauerhafte Einschränkungen, entstehen mitunter zusätzliche Ausgaben – etwa für Umbauten, Hilfsmittel oder Hilfe im Alltag. Eine private Unfallversicherung kann dann eine vereinbarte Kapitalzahlung oder weitere Leistungen bieten.</p>\n<p><strong>Entscheidend:</strong> Sie ist kein Ersatz für eine Krankenversicherung oder für eine Berufsunfähigkeitsversicherung. Ob und wie viel gezahlt wird, richtet sich nach dem Vertrag, den Unfallfolgen und den vereinbarten Leistungsarten.</p>\n<h2>Wann leistet die gesetzliche Unfallversicherung?</h2>\n<p>Vor allem bei versicherten Arbeitsunfällen, Wegeunfällen und anerkannten Berufskrankheiten. Unter bestimmten Voraussetzungen sind auch Schulsport oder bestimmte ehrenamtliche Tätigkeiten geschützt. Der normale private Freizeitsport ist dagegen grundsätzlich nicht durch die gesetzliche Unfallversicherung abgedeckt.</p>\n<p><a href=\"/gesetzlich-privat\">Gesetzliche und private Absicherung vergleichen</a></p>\n<h2>Drei Beispiele für die finanzielle Lücke</h2>\n<ul><li><strong>Ein Beinbruch heilt vollständig aus:</strong> Die Krankenkasse übernimmt Behandlung nach ihren Regeln; eine private Invaliditätsleistung fällt ohne dauerhafte Beeinträchtigung üblicherweise nicht an.</li><li><strong>Nach einem Unfall bleibt ein Gelenk dauerhaft eingeschränkt:</strong> Je nach vereinbarter Gliedertaxe, Invaliditätsgrad und Versicherungssumme kann eine Unfallversicherung eine Kapitalleistung erbringen.</li><li><strong>Ein Unfall verhindert langfristig die Berufsausübung:</strong> Eine Berufsunfähigkeitsversicherung ist für den Einkommensschutz häufig umfassender, weil sie auch Krankheiten erfassen kann. Eine Unfallversicherung löst nicht automatisch den Verdienstausfall ab.</li></ul>\n<h2>Bei welchen Sportarten gibt es besonders viele gemeldete Unfälle?</h2>\n<p>Die ERGO-Schadenstatistik 2025 erfasst die meisten gemeldeten Sportunfälle bei Fußball (35,6 %), Skisport (15,4 %), Radfahren (8,9 %) und Handball (2,9 %). Die Daten betreffen <strong>nur gemeldete Versicherungsfälle</strong>; sie zeigen nicht das Unfallrisiko pro Sportstunde oder Person und sind nicht repräsentativ für Deutschland.</p>\n<ul><li><a href=\"/unfallversicherung-fussball\">Fußball: Schutz bei Sportunfällen</a></li><li><a href=\"/unfallversicherung-skisport\">Skisport: Unfallfolgen und Bergung</a></li><li><a href=\"/unfallversicherung-radfahren\">Radfahren: Schutz bei Stürzen</a></li><li><a href=\"/unfallversicherung-handball\">Handball: Verletzungen im Verein</a></li></ul>\n<h2>Wann lohnt sich ein genauer Blick auf den Vertrag?</h2>\n<p>Besonders dann, wenn finanzielle Reserven für dauerhafte Einschränkungen fehlen, eine konkrete Sportart ausgeübt wird oder Rettungs- und Bergungsleistungen wichtig sind. Zu prüfen sind insbesondere Invaliditätssumme, Progression, Gliedertaxe, mögliche Ausschlüsse, Fristen und der Leistungsumfang.</p>\n<p>Diese Website bietet allgemeine Informationen, keine individuelle Versicherungsberatung oder Leistungszusage. Konkrete Angebote, Kontaktdaten, Impressum und Datenschutz müssen vor der Freigabe ergänzt werden.</p>\n<p><strong>Quellen:</strong> <a href=\"https://www.ergo.com/de/newsroom-ergo/reports-dossiers/sportunfaelle\">ERGO-Sportunfallstatistik 2025 (10.06.2026)</a>, <a href=\"https://www.dguv.de/de/ihr_partner/arbeitnehmer/gesetzliche-uv/index.jsp\">DGUV – gesetzliche Unfallversicherung</a>, <a href=\"https://www.dguv.de/de/versicherung/versicherte_personen/faq_leistungen/index.jsp\">DGUV – Versicherungsschutz und Leistungen</a>.</p>"
  },
  {
    "title": "Gesetzliche oder private Unfallversicherung?",
    "path": "/gesetzlich-privat",
    "description": "Wo die gesetzliche Unfallversicherung greift, wie Kranken- und private Unfallversicherung unterscheiden und welche Lücken bestehen.",
    "html": "<h2>Gesetzliche Unfallversicherung: wichtiger Schutz mit klaren Grenzen</h2>\n<p>Die gesetzliche Unfallversicherung schützt versicherte Tätigkeiten, insbesondere Arbeits- und bestimmte Wegeunfälle sowie Berufskrankheiten. Sie kann medizinische Versorgung, Rehabilitation und – bei Vorliegen der gesetzlichen Voraussetzungen – Geldleistungen wie Verletztengeld oder Rente erbringen. Auch der Schulsport kann gesetzlich versichert sein; gewöhnlicher Freizeitsport ist es im Regelfall nicht.</p>\n<h2>Wer zahlt im konkreten Beispiel?</h2>\n<ul><li><strong>Sturz auf dem direkten Arbeitsweg:</strong> Kann ein versicherter Wegeunfall sein – gesetzliche Unfallversicherung prüft und leistet nach SGB VII.</li><li><strong>Sturz beim privaten Fußballabend:</strong> Normalerweise kein gesetzlicher Arbeits- oder Wegeunfall. Die Krankenversicherung trägt die medizinische Behandlung im Rahmen ihrer Leistungen; private Unfallleistungen hängen vom Vertrag ab.</li><li><strong>Verletzung beim Schulsport:</strong> Regelmäßig gesetzlich unfallversichert, wenn sie im Rahmen einer schulischen Veranstaltung geschieht.</li><li><strong>Langfristige Berufsunfähigkeit durch Krankheit:</strong> Keine typische Leistung der privaten Unfallversicherung – die passende Einkommensabsicherung muss gesondert geprüft werden.</li></ul>\n<h2>Gesetzliche Krankenversicherung ist etwas anderes</h2>\n<p>Sie übernimmt medizinisch notwendige Leistungen nach gesetzlichen Regeln – auch bei vielen privaten Sportverletzungen. Eine pauschale Kapitalzahlung allein wegen einer dauerhaften Unfallinvalidität gehört normalerweise nicht dazu.</p>\n<h2>Private Unfallversicherung: was kann hinzukommen?</h2>\n<p>Je nach Tarif kann sie bei bleibender gesundheitlicher Beeinträchtigung eine Invaliditätsleistung zahlen. Einige Verträge enthalten zusätzlich Unfallrenten, vereinbarte Krankenhaustagegelder, Assistance-Leistungen oder Bergungs- und Rettungskosten. Nicht jeder Unfall führt zu jeder Leistung; Ausschlüsse, Fristen und Nachweise sind wichtig.</p>\n<h2>Vor dem Abschluss prüfen</h2>\n<ul><li>Wie hoch sind Grundsumme und mögliche Progression?</li><li>Wie ist die Gliedertaxe gestaltet und wann muss Invalidität eingetreten oder ärztlich festgestellt sein?</li><li>Welche Sportarten und Aktivitäten sind ein- oder ausgeschlossen?</li><li>Welche Leistungen bietet eventuell bereits eine Vereinspolice?</li><li>Ist die Absicherung bei Berufsunfähigkeit sinnvoll geregelt?</li></ul>\n<p><a href=\"/\">Zur Übersicht</a> · <a href=\"/unfallversicherung-fussball\">Beispiel Fußball</a> · <a href=\"/unfallversicherung-skisport\">Beispiel Ski</a></p>\n<p><a href=\"https://www.dguv.de/de/ihr_partner/arbeitnehmer/gesetzliche-uv/index.jsp\">Quelle: DGUV, Aufgaben und Leistungen</a> · <a href=\"https://www.bmas.de/DE/Soziales/Gesetzliche-Unfallversicherung/Fragen-und-Antworten/faq-gesetzliche-unfallversicherung.html\">Quelle: BMAS, häufige Fragen</a></p>"
  },
  {
    "title": "Unfallversicherung Fußball",
    "path": "/unfallversicherung-fussball",
    "description": "Unfallversicherung für Fußball: typische Verletzungen, gesetzlicher Schutz, Beispiel und wichtige Fragen zum privaten Unfallschutz.",
    "html": "<h2>Unfallversicherung bei Fußball: Risiken realistisch einschätzen</h2>\n<p>Zweikämpfe, schnelle Richtungswechsel und unglückliche Landungen können Bänder, Knie und Sprunggelenke belasten.</p>\n<h2>Was zeigt die Unfallstatistik?</h2>\n<p>Die ERGO-Unfallstatistik für 2025 erfasst für Fußball <strong>2.308 gemeldete Sportunfälle</strong> (35,6 % aller dort ausgewerteten Sportunfälle). Das ist ein Anteil an Schadenmeldungen dieses Versicherers, <strong>keine individuelle Unfallwahrscheinlichkeit</strong> und keine bundesweit repräsentative Sport-Risikorangliste.</p>\n<h2>Beispiel: Was passiert nach einem Unfall?</h2>\n<p>Beim Freizeittspiel reißt nach einem Zusammenstoß ein Band im Knie. Die Krankenversicherung kümmert sich nach ihren Regeln um die medizinische Versorgung. Ob eine private Unfallversicherung zusätzlich zahlt, hängt unter anderem von einer vertraglich versicherten dauerhaften Beeinträchtigung und den Fristen ab.</p>\n<h2>Gesetzlich oder privat versichert?</h2>\n<p>Ein gewöhnlicher Unfall beim privat ausgeübten Sport ist in der Regel kein gesetzlicher Arbeits- oder Wegeunfall. Die Krankenversicherung übernimmt medizinische Leistungen im Rahmen ihres Schutzes. Ob eine private Unfallversicherung bei dauerhaften Unfallfolgen zusätzlich leistet, ist tarifabhängig. Auch ein bestehender Schutz über Sportvereine sollte geprüft werden.</p>\n<p><a href=\"/gesetzlich-privat\">Gesetzliche und private Unfallversicherung vergleichen</a></p>\n<h2>Worauf sollte man achten?</h2>\n<ul><li>Gilt meine Police auch bei Vereinsfußball, Turnieren und Amateurligen?</li><li>Welche Invaliditätssumme, Progression und Gliedertaxe gelten?</li><li>Welche Melde-, Feststellungs- und Nachweisfristen stehen in den Bedingungen?</li><li>Welche bestehenden Policen und finanziellen Reserven bestehen?</li></ul>\n<h2>Praktische Vorbeugung</h2><p>Aufwärmen, passende Schuhe, Koordinationstraining und faire Zweikämpfe reduzieren vermeidbare Risiken.</p>\n<h2>Weitere Sportarten</h2><ul><li><a href=\"/unfallversicherung-skisport\">Skisport: Sportunfall und Absicherung</a></li><li><a href=\"/unfallversicherung-radfahren\">Radfahren: Sportunfall und Absicherung</a></li></ul>\n<p>Die Seite informiert allgemein; eine Zahlung oder konkrete Deckung ist nicht garantiert. Persönliche Daten und Versicherungsbedingungen sind für eine individuelle Beurteilung maßgeblich.</p>\n<p><a href=\"https://www.ergo.com/de/newsroom-ergo/reports-dossiers/sportunfaelle\">Quelle: ERGO, Sportunfallstatistik 2025 (veröffentlicht am 10.06.2026)</a> · <a href=\"https://www.dguv.de/de/versicherung/versicherte_personen/faq_leistungen/index.jsp\">Quelle: DGUV, Versicherte und Leistungen</a></p>"
  },
  {
    "title": "Unfallversicherung Skisport",
    "path": "/unfallversicherung-skisport",
    "description": "Unfallversicherung für Skisport: typische Verletzungen, gesetzlicher Schutz, Beispiel und wichtige Fragen zum privaten Unfallschutz.",
    "html": "<h2>Unfallversicherung bei Skisport: Risiken realistisch einschätzen</h2>\n<p>Hohe Geschwindigkeiten, vereiste Pisten und Kollisionen können Stürze mit Knie-, Schulter- und anderen Verletzungen verursachen.</p>\n<h2>Was zeigt die Unfallstatistik?</h2>\n<p>Die ERGO-Unfallstatistik für 2025 erfasst für Skisport <strong>1.001 gemeldete Sportunfälle</strong> (15,4 % aller dort ausgewerteten Sportunfälle). Das ist ein Anteil an Schadenmeldungen dieses Versicherers, <strong>keine individuelle Unfallwahrscheinlichkeit</strong> und keine bundesweit repräsentative Sport-Risikorangliste.</p>\n<h2>Beispiel: Was passiert nach einem Unfall?</h2>\n<p>Nach einem Sturz auf der Piste wird eine Person geborgen und benötigt längerfristige Therapie. Medizinisch notwendige Rettung und Behandlung sowie zusätzliche Bergungskosten sind verschiedene Fragen; die Leistung hängt vom Einzelfall, vom Reiseland und den jeweiligen Versicherungsbedingungen ab.</p>\n<h2>Gesetzlich oder privat versichert?</h2>\n<p>Ein gewöhnlicher Unfall beim privat ausgeübten Sport ist in der Regel kein gesetzlicher Arbeits- oder Wegeunfall. Die Krankenversicherung übernimmt medizinische Leistungen im Rahmen ihres Schutzes. Ob eine private Unfallversicherung bei dauerhaften Unfallfolgen zusätzlich leistet, ist tarifabhängig. Auch ein bestehender Schutz über Sportvereine sollte geprüft werden.</p>\n<p><a href=\"/gesetzlich-privat\">Gesetzliche und private Unfallversicherung vergleichen</a></p>\n<h2>Worauf sollte man achten?</h2>\n<ul><li>Sind Such-, Rettungs- und Bergungskosten im gewünschten Umfang eingeschlossen? Ist eine Auslandsreisekrankenversicherung vorhanden?</li><li>Welche Invaliditätssumme, Progression und Gliedertaxe gelten?</li><li>Welche Melde-, Feststellungs- und Nachweisfristen stehen in den Bedingungen?</li><li>Welche bestehenden Policen und finanziellen Reserven bestehen?</li></ul>\n<h2>Praktische Vorbeugung</h2><p>Helm, angepasste Geschwindigkeit, Pausen und die Beachtung der Pistenregeln senken Risiken.</p>\n<h2>Weitere Sportarten</h2><ul><li><a href=\"/unfallversicherung-fussball\">Fußball: Sportunfall und Absicherung</a></li><li><a href=\"/unfallversicherung-radfahren\">Radfahren: Sportunfall und Absicherung</a></li></ul>\n<p>Die Seite informiert allgemein; eine Zahlung oder konkrete Deckung ist nicht garantiert. Persönliche Daten und Versicherungsbedingungen sind für eine individuelle Beurteilung maßgeblich.</p>\n<p><a href=\"https://www.ergo.com/de/newsroom-ergo/reports-dossiers/sportunfaelle\">Quelle: ERGO, Sportunfallstatistik 2025 (veröffentlicht am 10.06.2026)</a> · <a href=\"https://www.dguv.de/de/versicherung/versicherte_personen/faq_leistungen/index.jsp\">Quelle: DGUV, Versicherte und Leistungen</a></p>"
  },
  {
    "title": "Unfallversicherung Radfahren",
    "path": "/unfallversicherung-radfahren",
    "description": "Unfallversicherung für Radfahren: typische Verletzungen, gesetzlicher Schutz, Beispiel und wichtige Fragen zum privaten Unfallschutz.",
    "html": "<h2>Unfallversicherung bei Radfahren: Risiken realistisch einschätzen</h2>\n<p>Stürze auf glattem Untergrund, Straßenhindernisse oder Kollisionen können beim Freizeit- und sportlichen Radfahren zu Verletzungen führen.</p>\n<h2>Was zeigt die Unfallstatistik?</h2>\n<p>Die ERGO-Unfallstatistik für 2025 erfasst für Radfahren <strong>579 gemeldete Sportunfälle</strong> (8,9 % aller dort ausgewerteten Sportunfälle). Das ist ein Anteil an Schadenmeldungen dieses Versicherers, <strong>keine individuelle Unfallwahrscheinlichkeit</strong> und keine bundesweit repräsentative Sport-Risikorangliste.</p>\n<h2>Beispiel: Was passiert nach einem Unfall?</h2>\n<p>Bei einer privaten Radtour verletzt sich jemand nach einem Sturz am Handgelenk. Eine vollständig verheilte Verletzung löst meist keine Invaliditätsleistung aus. Bleibt dauerhaft eine funktionelle Einschränkung, kommt es auf die Bedingungen der privaten Unfallversicherung an.</p>\n<h2>Gesetzlich oder privat versichert?</h2>\n<p>Ein gewöhnlicher Unfall beim privat ausgeübten Sport ist in der Regel kein gesetzlicher Arbeits- oder Wegeunfall. Die Krankenversicherung übernimmt medizinische Leistungen im Rahmen ihres Schutzes. Ob eine private Unfallversicherung bei dauerhaften Unfallfolgen zusätzlich leistet, ist tarifabhängig. Auch ein bestehender Schutz über Sportvereine sollte geprüft werden.</p>\n<p><a href=\"/gesetzlich-privat\">Gesetzliche und private Unfallversicherung vergleichen</a></p>\n<h2>Worauf sollte man achten?</h2>\n<ul><li>Deckt mein Vertrag Freizeit-, Rennrad- und gegebenenfalls Mountainbike-Aktivitäten ab?</li><li>Welche Invaliditätssumme, Progression und Gliedertaxe gelten?</li><li>Welche Melde-, Feststellungs- und Nachweisfristen stehen in den Bedingungen?</li><li>Welche bestehenden Policen und finanziellen Reserven bestehen?</li></ul>\n<h2>Praktische Vorbeugung</h2><p>Helm, Beleuchtung, kontrollierte Bremsen, vorausschauende Fahrweise und der richtige Abstand sind wesentlich.</p>\n<h2>Weitere Sportarten</h2><ul><li><a href=\"/unfallversicherung-fussball\">Fußball: Sportunfall und Absicherung</a></li><li><a href=\"/unfallversicherung-skisport\">Skisport: Sportunfall und Absicherung</a></li></ul>\n<p>Die Seite informiert allgemein; eine Zahlung oder konkrete Deckung ist nicht garantiert. Persönliche Daten und Versicherungsbedingungen sind für eine individuelle Beurteilung maßgeblich.</p>\n<p><a href=\"https://www.ergo.com/de/newsroom-ergo/reports-dossiers/sportunfaelle\">Quelle: ERGO, Sportunfallstatistik 2025 (veröffentlicht am 10.06.2026)</a> · <a href=\"https://www.dguv.de/de/versicherung/versicherte_personen/faq_leistungen/index.jsp\">Quelle: DGUV, Versicherte und Leistungen</a></p>"
  },
  {
    "title": "Unfallversicherung Handball",
    "path": "/unfallversicherung-handball",
    "description": "Unfallversicherung für Handball: typische Verletzungen, gesetzlicher Schutz, Beispiel und wichtige Fragen zum privaten Unfallschutz.",
    "html": "<h2>Unfallversicherung bei Handball: Risiken realistisch einschätzen</h2>\n<p>Sprünge, Landungen, Richtungswechsel und Körperkontakt machen insbesondere Sprunggelenke, Knie, Finger und Schultern anfällig.</p>\n<h2>Was zeigt die Unfallstatistik?</h2>\n<p>Die ERGO-Unfallstatistik für 2025 erfasst für Handball <strong>189 gemeldete Sportunfälle</strong> (2,9 % aller dort ausgewerteten Sportunfälle). Das ist ein Anteil an Schadenmeldungen dieses Versicherers, <strong>keine individuelle Unfallwahrscheinlichkeit</strong> und keine bundesweit repräsentative Sport-Risikorangliste.</p>\n<h2>Beispiel: Was passiert nach einem Unfall?</h2>\n<p>Beim Vereinstraining knickt ein Spieler nach der Landung um und kann mehrere Wochen nicht spielen oder arbeiten. Das bedeutet nicht automatisch eine Leistung aus der privaten Unfallversicherung: Entscheidend sind die vereinbarten Leistungsarten und ob bleibende Unfallfolgen vorliegen.</p>\n<h2>Gesetzlich oder privat versichert?</h2>\n<p>Ein gewöhnlicher Unfall beim privat ausgeübten Sport ist in der Regel kein gesetzlicher Arbeits- oder Wegeunfall. Die Krankenversicherung übernimmt medizinische Leistungen im Rahmen ihres Schutzes. Ob eine private Unfallversicherung bei dauerhaften Unfallfolgen zusätzlich leistet, ist tarifabhängig. Auch ein bestehender Schutz über Sportvereine sollte geprüft werden.</p>\n<p><a href=\"/gesetzlich-privat\">Gesetzliche und private Unfallversicherung vergleichen</a></p>\n<h2>Worauf sollte man achten?</h2>\n<ul><li>Besteht zusätzlich eine Sportverein-Gruppenversicherung und welche Leistungen deckt sie tatsächlich ab?</li><li>Welche Invaliditätssumme, Progression und Gliedertaxe gelten?</li><li>Welche Melde-, Feststellungs- und Nachweisfristen stehen in den Bedingungen?</li><li>Welche bestehenden Policen und finanziellen Reserven bestehen?</li></ul>\n<h2>Praktische Vorbeugung</h2><p>Kraft- und Stabilisationstraining, saubere Landetechnik, Aufwärmen und passende Hallenschuhe helfen, Risiken zu senken.</p>\n<h2>Weitere Sportarten</h2><ul><li><a href=\"/unfallversicherung-fussball\">Fußball: Sportunfall und Absicherung</a></li><li><a href=\"/unfallversicherung-skisport\">Skisport: Sportunfall und Absicherung</a></li></ul>\n<p>Die Seite informiert allgemein; eine Zahlung oder konkrete Deckung ist nicht garantiert. Persönliche Daten und Versicherungsbedingungen sind für eine individuelle Beurteilung maßgeblich.</p>\n<p><a href=\"https://www.ergo.com/de/newsroom-ergo/reports-dossiers/sportunfaelle\">Quelle: ERGO, Sportunfallstatistik 2025 (veröffentlicht am 10.06.2026)</a> · <a href=\"https://www.dguv.de/de/versicherung/versicherte_personen/faq_leistungen/index.jsp\">Quelle: DGUV, Versicherte und Leistungen</a></p>"
  }
];
export const accidentInsuranceSports = [
  {
    "key": "fussball",
    "name": "Fußball",
    "count": "2.308",
    "share": "35,6"
  },
  {
    "key": "skisport",
    "name": "Skisport",
    "count": "1.001",
    "share": "15,4"
  },
  {
    "key": "radfahren",
    "name": "Radfahren",
    "count": "579",
    "share": "8,9"
  },
  {
    "key": "handball",
    "name": "Handball",
    "count": "189",
    "share": "2,9"
  }
];

export function accidentInsuranceBlueprint({ origin, contactEmail = '' }) {
  const cleanOrigin = String(origin).replace(/\/$/,'');
  const siteName = 'Unfallversicherung verständlich erklärt';
  const menu = authoredPages.map((item, i) => ({
    id: 'siteops-' + i,
    label: item.path === '/' ? 'Start' : item.path === '/gesetzlich-privat' ? 'Gesetzlich vs. privat' : item.title.replace('Unfallversicherung ', ''),
    url: item.path,
    parent: '',
    location: 'header'
  }));
  return {
    companyName: siteName,
    tagline: 'Unfallversicherung, Leistungen und Sportverletzungen verständlich erklärt',
    location: 'Deutschland',
    contactEmail,
    accent: '#1c658f',
    pages: authoredPages.map(item => ({
      title: item.title, path: item.path, body: item.html,
      seo: {
        title: item.title,
        description: item.description,
        canonical: cleanOrigin + (item.path === '/' ? '/' : item.path)
      }
    })),
    menu,
    themeCss: [
      '.cms-page{--site-accent:#1c658f}',
      '.cms-page .page-intro{background:linear-gradient(115deg,#ecf5f8,#f5f9fa);border-radius:24px;padding:clamp(24px,5vw,54px)}',
      '.cms-page .page-intro h1{color:#133852;letter-spacing:-.035em;line-height:1.12}',
      '.cms-page main{max-width:1160px;margin-inline:auto;overflow-wrap:anywhere}',
      '.cms-page main h2{color:#143e56;letter-spacing:-.025em;margin-top:1.9em}',
      '.cms-page main p,.cms-page main li{line-height:1.75}',
      '.cms-page main a{color:#17658c;text-decoration-thickness:2px;text-underline-offset:3px}',
      '.cms-page .site-navigation{display:flex;flex-wrap:wrap;gap:12px}',
      '@media(max-width:720px){.cms-page .header-inner{flex-wrap:wrap}.cms-page .page-intro{padding:22px;border-radius:16px}.cms-page main{padding-inline:clamp(12px,3vw,24px)}}'
    ].join(''),
    reviewRequired: true,
    seoIndexing: 'disabled',
    legalNotice: 'Information ohne individuelle Beratung; Impressum, Datenschutz, Betreiberangaben und etwaige Angebote vor Freigabe prüfen.',
    sourceLinks: [sportSources.ergo, sportSources.dguv, sportSources.bmas]
  };
}
