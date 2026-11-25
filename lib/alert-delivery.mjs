const SMTP_ERROR_HINTS = {
  EAUTH: 'SMTP-Anmeldung fehlgeschlagen. Benutzername und Passwort prüfen.',
  ECONNECTION: 'Verbindung zum SMTP-Server fehlgeschlagen. Host, Port und Firewall prüfen.',
  ETIMEDOUT: 'SMTP-Verbindung hat das Zeitlimit überschritten.',
  ESOCKET: 'SMTP-Socket oder TLS-Verbindung fehlgeschlagen.',
  ENOTFOUND: 'SMTP-Hostname konnte nicht aufgelöst werden.',
  EAI_AGAIN: 'DNS-Abfrage für den SMTP-Server vorübergehend fehlgeschlagen.',
  EENVELOPE: 'SMTP-Server hat Absender oder Empfänger abgelehnt.'
};

function safeDeliveryError(error) {
  const rawCode = String(error?.code || '');
  const code = /^[A-Z_]{2,40}$/.test(rawCode) ? rawCode : 'DELIVERY_FAILED';
  const responseCode = Number.isInteger(error?.responseCode) ? error.responseCode : null;
  const hint =
    responseCode === 535
      ? 'SMTP-Anmeldung abgelehnt (535). Zugangsdaten prüfen.'
      : SMTP_ERROR_HINTS[code] || 'Der Versanddienst hat die Anfrage abgelehnt.';
  return { code, responseCode, error: responseCode ? `${hint} SMTP-Status: ${responseCode}.` : hint };
}

export function summarizeAlertResults(jobs, settled) {
  return jobs.map((job, index) => {
    const result = settled[index];
    if (result?.status === 'rejected') {
      return { channel: job.channel, ok: false, ...safeDeliveryError(result.reason) };
    }
    if (result?.status !== 'fulfilled') {
      return { channel: job.channel, ok: false, error: 'Kein Ergebnis des Versanddienstes erhalten.' };
    }
    if (job.channel === 'email') {
      const info = result.value || {};
      const acceptedCount = Array.isArray(info.accepted) ? info.accepted.length : 0;
      const rejectedCount = Array.isArray(info.rejected) ? info.rejected.length : 0;
      const ok = acceptedCount > 0 && rejectedCount === 0;
      return {
        channel: 'email',
        ok,
        acceptedCount,
        rejectedCount,
        messageId: typeof info.messageId === 'string' ? info.messageId.slice(0, 256) : null,
        smtpResponse: typeof info.response === 'string' ? info.response.slice(0, 256) : null,
        error: ok ? null : 'SMTP hat nicht alle Empfänger angenommen.'
      };
    }
    if (job.channel === 'webhook') {
      const httpStatus = Number.isInteger(result.value?.status) ? result.value.status : null;
      const ok = result.value?.ok === true;
      return {
        channel: 'webhook',
        ok,
        httpStatus,
        error: ok ? null : `Webhook hat nicht erfolgreich geantwortet (HTTP ${httpStatus ?? 'unbekannt'}).`
      };
    }
    return { channel: job.channel, ok: false, error: 'Unbekannter Benachrichtigungskanal.' };
  });
}
