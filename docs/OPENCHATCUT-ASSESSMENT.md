# OpenChatCut: Quellen- und Eignungsprüfung

Stand 22.10.2026. **Keine Installation angefordert:** Der Auftraggeber hat die
OpenChatCut-Installation im Verlauf ausdrücklich abgewählt. `occ.lorzen.de`, das
Projekt Tools und produktive Coolify-/DNS-Ressourcen wurden nicht verändert.
Es wurden weder Medien-Upload noch Videoexport als End-to-End-Test ausgeführt;
dieses Dokument meldet keine erfolgreiche Bereitstellung.

Die [offizielle Website](https://openchatcut.com/) verlinkt als Quellcode
[0xsline/OpenChatCut](https://github.com/0xsline/OpenChatCut). Geprüfte Revision:
`7fa4b7903e7ebecf832a36249f0c0c755200cc17`, Paketversion 0.2.17.

| Aspekt | Beleg / Ergebnis |
| --- | --- |
| Runtime | [package.json](https://github.com/0xsline/OpenChatCut/blob/7fa4b7903e7ebecf832a36249f0c0c755200cc17/package.json): Node `>=24 <25`, Electron-Desktop-Einstieg, Vite-Entwicklungsscripts; kein belegtes Produktions-`start`-Script. |
| Lizenz | AGPL-3.0-or-later laut Paketdefinition und Repository. Netzwerkbetrieb erfordert Prüfung der Lizenzpflichten. |
| Browser | [README](https://github.com/0xsline/OpenChatCut/blob/7fa4b7903e7ebecf832a36249f0c0c755200cc17/README.md): lokale Browsernutzung auf Port 5199; Secure Context für Web Crypto, WebCodecs und Zwischenablage erforderlich. HTTPS allein macht lokale Backend-Funktionen nicht serverfähig. |
| Docker | Kein Dockerfile für einen belegten vollständigen Produktions-Webserver. `server/e2b.Dockerfile` ist eine Sandbox-Vorlage mit FFmpeg für Skill-Scripts, kein Image für den gesamten Editor. |
| FFmpeg / Export | [media-binaries.ts](https://github.com/0xsline/OpenChatCut/blob/7fa4b7903e7ebecf832a36249f0c0c755200cc17/server/media-binaries.ts) verwendet FFmpeg/FFprobe. Serverexport-Komponenten existieren; ein statischer Vite-Build stellt diese nicht bereit. |
| Persistenz | [runtime-profile.ts](https://github.com/0xsline/OpenChatCut/blob/7fa4b7903e7ebecf832a36249f0c0c755200cc17/server/runtime-profile.ts): lokale Profile unter `~/.openchatcut`, teilweise getrennte Entwicklungsprofile und Upload-Medienpfade. Projekte, Medien, Modell-/Jobdaten müssen gemeinsam berücksichtigt werden. |
| Zugriffsschutz | [project-store-http-auth.ts](https://github.com/0xsline/OpenChatCut/blob/7fa4b7903e7ebecf832a36249f0c0c755200cc17/server/project-store-http-auth.ts) und `request-shape-gate.ts` bauen auf Loopback, Host, Origin und Browser-Request-Metadaten. Ein öffentlicher Proxy ist nicht ohne Code-/Sicherheitsprüfung gleichwertig zu diesem lokalen Modell. |
| Lokale Dateien / Agenten | README dokumentiert lokale Medien-/Agentfunktionen und `AGENT_IMPORT_ROOTS`. Ein ungeschützter öffentlicher Betrieb ist ungeeignet. |
| Große Videos / Ressourcen | Kein gemessener Produktionsbedarf. RAM, Datenträger, temporäre Exportdateien, Modell-Caches, Upload-Limits und Abbruch-/Cleanup-Verhalten müssen an einer explizit freigegebenen Testinstallation geprüft werden. |
| Proxy / E2E | Upload-Größe, Streaming, Timeouts, WebSockets, asynchrone Exportjobs und Download müssten mit einem kurzen realen Video geprüft werden. Dafür liegen hier keine Testergebnisse vor. |

Die generische Analyse ordnet diese Revision konservativ als Desktop-Anwendung mit
lokalen Serverkomponenten ohne belegten unterstützten Produktionsstart ein. Sie
installiert keinen Vite-Entwicklungsserver und meldet kein funktionsfähiges Webdeployment.
Ein späterer Server-Port würde ein eigenständiges, experimentelles Vorhaben mit
angepasstem Sicherheitsmodell, Produktions-Einstieg und reproduzierbarem Medien-E2E
darstellen. Es wurde keine OpenChatCut-Sonderbehandlung in den Deployer eingebaut.
