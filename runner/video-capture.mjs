// Shared intent and structural checks. Missing recording setup must never become a slide.
export function captureMode(scene) {
  return scene.capture_mode || (scene.demoUrl ? (scene.demoSteps?.length ? 'recording' : 'screenshot') : 'text');
}
export function capturePlan(scenes) {
  return scenes.map((scene, index) => {
    const mode = captureMode(scene), issues = [];
    if (!['text', 'screenshot', 'recording'].includes(mode)) issues.push('Unbekannte Aufnahmeart.');
    if (mode === 'text' && (scene.demoUrl || scene.template_id || scene.demoSteps?.length || scene.login_profile_id)) issues.push('Texttafel enthält einen Browser-Ablauf. Aufnahmeart korrigieren.');
    if (mode !== 'text') {
      if (!scene.demoUrl) issues.push('Keine Demo-URL hinterlegt. Gespeicherte Demoszene auswählen.');
      if (scene.test_data_only !== true) issues.push('Testkonto und Testdaten bestätigen.');
      if (mode === 'recording' && !scene.demoSteps?.length) issues.push('Kein ausführbarer Aufnahme-Ablauf hinterlegt. Demoszene mit Aktionen auswählen.');
      if (mode === 'screenshot' && scene.demoSteps?.length) issues.push('Aktionen erfordern eine Bildschirmaufnahme statt Standbild.');
    }
    return { scene: index + 1, mode, headline: scene.headline || '', url: scene.demoUrl || null,
      login_required: Boolean(scene.login_profile_id), actions: scene.demoSteps?.length || 0,
      ok: issues.length === 0, issues };
  });
}
export function requireCapturePlan(scenes) {
  const plan = capturePlan(scenes), blocked = plan.filter(s => !s.ok);
  if (blocked.length) throw Object.assign(new Error(blocked.map(s => 'Szene ' + s.scene + ': ' + s.issues.join(' ')).join(' ')), {statusCode:422});
  return plan;
}
