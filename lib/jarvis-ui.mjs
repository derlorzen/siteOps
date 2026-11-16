import { icon } from './workspace-shell.mjs';

export function renderJarvis() {
  return `<div class="jarvis" id="jarvis">
  <nav class="jarvis-sidebar" id="jarvis-sidebar" aria-label="Jarvis-Projekte und Chats">
    <div class="jarvis-sidebar-head">
      <strong>${icon('jarvis')} Jarvis</strong>
      <button class="jarvis-mobile" type="button" id="jarvis-close" aria-label="Projektmenü schließen">×</button>
    </div>
    <button class="jarvis-new" type="button" id="jarvis-new" disabled>＋ Neuer Chat</button>
    <div class="jarvis-nav-title"><h2>Projekte</h2><button type="button" id="jarvis-new-project" disabled aria-label="Neues Projekt">＋</button></div>
    <div id="jarvis-projects"></div>
    <h2>Chats im Projekt</h2>
    <div id="jarvis-chats"></div>
    <button type="button" id="jarvis-install" hidden>App installieren</button>
    <button type="button" id="jarvis-notify" hidden>Benachrichtigungen aktivieren</button>
  </nav>
  <div class="jarvis-chat">
    <div class="jarvis-toolbar">
      <button class="jarvis-mobile" type="button" id="jarvis-menu" aria-controls="jarvis-sidebar" aria-expanded="false" aria-label="Projekte und Chats öffnen">☰</button>
      <div class="jarvis-heading"><h1 id="jarvis-title">Jarvis</h1><span id="jarvis-model"></span></div>
      <div class="jarvis-status" id="jarvis-status" data-state="checking" role="status">Hermes wird geprüft</div>
    </div>
    <div class="jarvis-conversation" id="jarvis-conversation" tabindex="0" aria-label="Chatverlauf">
      <div class="jarvis-flow">
        <div class="jarvis-empty" id="jarvis-empty">
          <h2>Woran arbeiten wir heute?</h2>
          <div class="jarvis-starters">
            <button type="button" data-prompt="Prüfe, warum der Shop einen Fehler meldet.">Shop-Störung prüfen</button>
            <button type="button" data-prompt="Hilf mir, ein Bagisto-Release zu prüfen.">Bagisto-Release prüfen</button>
          </div>
        </div>
        <div id="jarvis-messages"></div>
        <div id="jarvis-options" hidden></div>
      </div>
    </div>
    <div class="jarvis-bottom">
      <div class="jarvis-feedback" id="jarvis-feedback" role="status"></div>
      <form id="jarvis-form" class="jarvis-form">
        <textarea id="jarvis-input" maxlength="12000" rows="2" aria-label="Nachricht an Hermes" placeholder="Frag Jarvis …" enterkeyhint="enter" required></textarea>
        <div class="jarvis-actions">
          <button type="button" id="jarvis-dictate" hidden aria-label="Nachricht diktieren" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg></button>
          <button type="submit" id="jarvis-send" disabled aria-label="Nachricht senden">↑</button>
          <button type="button" id="jarvis-stop" hidden>Stopp</button>
          <button type="button" id="jarvis-retry" hidden>Erneut versuchen</button>
        </div>
      </form>
    </div>
  </div>
  <dialog id="jarvis-project-dialog">
    <form id="jarvis-project-form">
      <h2>Neues Projekt</h2>
      <label>Projektname <input id="jarvis-project-name" maxlength="100" required></label>
      <p id="jarvis-project-error" role="status"></p>
      <div class="jarvis-dialog-actions">
        <button type="button" id="jarvis-project-cancel">Abbrechen</button>
        <button type="submit">Projekt anlegen</button>
      </div>
    </form>
  </dialog>
</div><script defer src="/assets/jarvis.js"></script>`;
}
