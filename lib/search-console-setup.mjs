// Read-only guidance from persisted facts. Execution remains in the authorized service.
const readPermissions = new Set(['siteOwner', 'siteFullUser', 'siteRestrictedUser']);
export function searchConsoleSetup({ configured = false, accounts = [], linkage = null, site_enabled } = {}) {
  const website = site_enabled !== undefined;
  const link = linkage?.invalidated ? null : linkage;
  const account = Boolean(accounts.length && (!link?.account_id || accounts.some(a => a.id === link.account_id)));
  const linked = Boolean(link?.property);
  const readable = linked && readPermissions.has(link.permission_level);
  const active = site_enabled !== false && site_enabled !== 0;
  const live = Boolean(link?.live_approved_at);
  const domain = Boolean(link?.property?.startsWith('sc-domain:'));
  const verified = Boolean(link?.verified_at);
  const canSync = Boolean(configured && account && linked && readable && live && active);
  const steps = [];
  function add(id, title, complete, description, action, available = true, required = true, skipped = false) {
    steps.push({
      id,
      title,
      state: skipped
        ? 'not_required'
        : complete
          ? 'complete'
          : !required
            ? 'optional'
            : available
              ? 'required'
              : 'blocked',
      required: required && !skipped,
      description,
      action,
      can_start: !complete && !skipped && available,
      can_review: available
    });
  }
  add(
    'client',
    'Google-Zugang einrichten',
    configured,
    configured
      ? 'Client-ID und Client-Secret sind hinterlegt.'
      : 'Aktiviere Search Console API und Site Verification API in deinem Google-Cloud-Projekt. Hinterlege danach Client-ID, Client-Secret und die angezeigte Weiterleitungsadresse.',
    'configure'
  );
  add(
    'account',
    'Google-Konto verbinden',
    account,
    account
      ? 'Ein für dich autorisiertes Google-Konto ist verbunden.'
      : 'Melde dich bei Google an und erteile SiteOps den Zugriff auf Search Console. Eine gespeicherte Client-ID allein verbindet noch kein Konto.',
    'connect',
    configured
  );
  if (website) {
    add(
      'link',
      'Diese Website zuordnen',
      linked,
      linked
        ? link.property
        : linkage?.invalidated
          ? 'Die Domain wurde geändert. Wähle für die aktuelle Domain erneut eine passende Google-Website aus.'
          : 'Wähle dein Google-Konto und eine vorhandene Google-Website aus. Nur wenn noch keine passende vorhanden ist, bereite eine neue Domain-Property vor.',
      'link',
      configured && account
    );
    add(
      'active',
      'Website in SiteOps aktivieren',
      active,
      active
        ? 'Diese Website ist in SiteOps aktiv.'
        : 'Der Datenabruf benötigt eine aktive Website. Öffne die Websiteverwaltung und aktiviere diese Website.',
      'activate',
      true
    );
    add(
      'live',
      'Datenabruf für diese Website freigeben',
      live,
      live
        ? 'Diese Website ist in SiteOps freigegeben. Externe Änderungen benötigen weiterhin eine eigene Vorschau und Zustimmung.'
        : 'Prüfe die Website und bestätige ihre Freigabe in SiteOps. Google- und DNS-Änderungen benötigen danach weiterhin eine eigene Vorschau und Zustimmung.',
      'live',
      configured && account && linked && active
    );
    const needsDns = domain && !readable;
    add(
      'dns',
      'Google-Bestätigung im DNS hinterlegen',
      Boolean(link?.dns_applied),
      readable
        ? 'Die vorhandene Google-Berechtigung reicht zum Lesen. Eine neue DNS-Verifizierung ist nicht erforderlich.'
        : verified
          ? 'Google hat die Inhaberschaft bereits bestätigt.'
          : link?.dns_applied
            ? 'Der DNS-Schritt wurde in SiteOps ausgeführt. Die Bestätigung durch Google steht noch aus.'
            : 'In SiteOps ist noch kein ausgeführter DNS-Bestätigungsschritt erfasst. Prüfe den TXT-Eintrag in der Vorschau; bereits extern vorhandene Einträge werden dort geprüft.',
      'dns',
      Boolean(domain && linked && live && active && configured && account),
      true,
      !needsDns || verified
    );
    add(
      'verify',
      'Domaininhaberschaft bei Google bestätigen',
      verified,
      verified
        ? 'Google hat die Domaininhaberschaft bestätigt.'
        : readable
          ? 'Die vorhandene Google-Berechtigung reicht zum Lesen. Eine neue Inhaberbestätigung ist nicht erforderlich.'
          : 'Lass Google den DNS-TXT-Eintrag prüfen. Ein eingetragener TXT-Wert allein ist noch keine bestätigte Inhaberschaft.',
      'verify',
      Boolean(domain && linked && live && active && configured && account),
      true,
      !needsDns
    );
    add(
      'property',
      'Google-Zugriff auf diese Website herstellen',
      readable,
      readable
        ? 'Google hat eine Leseberechtigung für diese Website gemeldet.'
        : domain
          ? 'Nach bestätigter Inhaberschaft kannst du die Website bei Google anmelden und die Berechtigung prüfen.'
          : 'Bestätige diese URL-Property in Google Search Console oder wähle eine bereits zugängliche Website aus. SiteOps führt DNS-Verifizierung nur für Domain-Properties aus.',
      domain ? 'property' : 'google',
      Boolean(linked && configured && account && (!domain || (verified && live && active)))
    );
    add(
      'sync',
      link?.sync_error ? 'Suchdaten erneut abrufen' : 'Suchdaten erstmals abrufen',
      Boolean(link?.last_sync_at && !link?.sync_error),
      link?.sync_error
        ? 'Der letzte Abruf ist fehlgeschlagen. Prüfe die Verbindung und versuche es erneut; vorhandene Daten bleiben erhalten.'
        : link?.last_sync_at
          ? 'Die Leistungsdaten wurden zuletzt erfolgreich abgerufen.'
          : 'Rufe die Leistungsdaten ab. Ein erfolgreicher leerer Bericht bedeutet, dass Google für den Zeitraum noch keine Werte liefert.',
      'sync',
      canSync
    );
    const sitemapDone = ['submitted', 'pending', 'processed'].includes(link?.sitemap_status);
    add(
      'sitemap',
      'Sitemap einreichen',
      sitemapDone,
      sitemapDone
        ? 'Die Sitemap wurde eingereicht. Das garantiert keine Indexierung.'
        : link?.sitemap_status === 'errors'
          ? 'Google meldet Fehler zur Sitemap. Prüfe die Sitemap-Adresse. Leistungsdaten können trotzdem abgerufen werden.'
          : 'Optional: Sende die Sitemap an Google. Sie ist keine Voraussetzung für das Lesen der Suchleistung.',
      'sitemap',
      Boolean(canSync && link?.permission_level !== 'siteRestrictedUser'),
      false
    );
  }
  if (website && !linked) {
    for (const id of ['dns', 'verify']) {
      const step = steps.find(item => item.id === id);
      step.state = 'conditional';
      step.required = false;
      step.description =
        'Nur bei einer neuen Domain-Property erforderlich. Nach der Website-Zuordnung zeigt SiteOps, ob dieser Schritt nötig ist.';
    }
    steps.find(item => item.id === 'property').description =
      'Nach der Zuordnung wird geprüft, ob dein Google-Konto diese Website lesen darf. Eine vorhandene Leseberechtigung reicht aus.';
  }
  if (website && domain && !readable && !verified && link.dns_applied === undefined) {
    const dns = steps.find(step => step.id === 'dns');
    dns.state = 'unknown';
    dns.description =
      'Ob der DNS-TXT-Eintrag bereits vorhanden ist, wurde hier noch nicht geprüft. Öffne die DNS-Vorschau und prüfe den aktuellen Eintrag, bevor du eine Änderung freigibst.';
  }
  const missing = steps.filter(step => step.required && step.state !== 'complete');
  return {
    connected: Boolean(configured && account && (!website || (linked && readable))),
    can_sync: canSync,
    complete: missing.length === 0,
    next_step: missing.find(step => step.can_start)?.id || missing[0]?.id || null,
    missing_steps: missing.map(step => step.id),
    steps
  };
}
