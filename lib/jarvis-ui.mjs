import { icon } from './workspace-shell.mjs';

export function renderJarvis() {
  return `<div class="jarvis" id="jarvis">
  <header class="jarvis-header">
    <div><h1>Jarvis</h1><p>Dein Hermes-Chat in SiteOps</p></div>
    <div class="jarvis-status" id="jarvis-status" data-state="checking" role="status"><span></span>Hermes wird geprüft</div>
  </header>

  <div class="jarvis-body">
    <div class="jarvis-chat">
      <div class="jarvis-chat-head"><h2>KI-Chat</h2><button type="button" id="jarvis-new" disabled>Neuer Chat</button></div>
      <div class="jarvis-conversation" id="jarvis-conversation" tabindex="0" aria-label="Chatverlauf">
        <div class="jarvis-empty" id="jarvis-empty">
          <div class="jarvis-empty-icon">${icon('jarvis')}</div>
          <h3>Woran arbeiten wir heute?</h3>
          <div class="jarvis-prompts" aria-label="Fragevorschläge">
            <button type="button" data-prompt="Gib mir einen Überblick über die offenen Website-Störungen in SiteOps.">Offene Störungen</button>
            <button type="button" data-prompt="Welche Aufgaben sind heute fällig oder bereits überfällig?">Fällige Aufgaben</button>
          </div>
        </div>
        <div id="jarvis-messages"></div>
      </div>
      <div class="jarvis-feedback" id="jarvis-feedback" role="status"></div>
      <form id="jarvis-form" class="jarvis-form">
        <textarea id="jarvis-input" maxlength="12000" rows="2" aria-label="Nachricht an Hermes" placeholder="Frag deinen Assistenten …" required></textarea>
        <button type="submit" id="jarvis-send" disabled>Senden <span aria-hidden="true">↑</span></button>
        <button type="button" id="jarvis-stop" hidden title="Unterbricht die Anzeige der Antwort">Stream stoppen</button>
      </form>
    </div>

    <div class="jarvis-core">
      <canvas id="jarvis-orb" aria-hidden="true"></canvas>
      <div class="jarvis-core-head"><h2>Arbeitsbereiche</h2></div>
      <nav aria-label="Schnellzugriff auf SiteOps">
        <a href="/websites">${icon('globe')} Websites</a>
        <a href="/billing">${icon('project')} Projekte</a>
        <a href="/coolify">${icon('cms')} Coolify</a>
        <a href="/video-suite">${icon('video')} Video Suite</a>
      </nav>
    </div>
  </div>
</div><script defer src="/assets/jarvis.js"></script>`;
}
