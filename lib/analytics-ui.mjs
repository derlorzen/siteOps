import { escapeHtml as esc } from './product-ui.mjs';

export const searchMetrics = [
  { key: 'clicks', label: 'Klicks', format: 'count' },
  { key: 'impressions', label: 'Impressionen', format: 'count' },
  { key: 'ctr', label: 'Klickrate', format: 'percent' },
  { key: 'position', label: 'Ø Position', format: 'decimal', inverse: true }
];
export const videoMetrics = [
  { key: 'views', label: 'Aufrufe', format: 'count' },
  { key: 'estimatedMinutesWatched', label: 'Wiedergabezeit', format: 'hours' },
  { key: 'averageViewDuration', label: 'Ø Wiedergabedauer', format: 'duration' }
];
export function analyticsMetrics(prefix, metrics) {
  return `<div class="analytics-metrics" id="${prefix}-metrics" role="group" aria-label="Kennzahl für den Zeitverlauf auswählen">${metrics.map((metric, i) => `<button type="button" class="analytics-metric" data-metric="${metric.key}" data-format="${metric.format}" data-inverse="${Boolean(metric.inverse)}" aria-pressed="${i === 0}" aria-controls="${prefix}-chart"><span>${esc(metric.label)}</span><strong data-value>–</strong><small data-comparison>Wird geladen …</small></button>`).join('')}</div>`;
}
export function analyticsTrend(prefix) {
  return `<div class="analytics-trend"><div class="analytics-section-head"><h2 id="${prefix}-chart-title">${prefix === 'gsc' ? 'Klicks' : 'Aufrufe'} im Zeitverlauf</h2><span class="analytics-meta" id="${prefix}-chart-context"></span></div><div class="analytics-chart" id="${prefix}-chart" role="figure" aria-label="Tageswerte im Zeitverlauf" aria-describedby="${prefix}-chart-help"><div class="analytics-chart-state">Zeitverlauf wird geladen …</div></div><div class="analytics-chart-foot"><span id="${prefix}-chart-insight"></span><span id="${prefix}-chart-help">Tageswerte · Pfeiltasten für einzelne Tage</span></div></div>`;
}
export function analyticsEmpty(prefix, title, description, action = '') {
  return `<div class="analytics-empty" id="${prefix}-empty" hidden><svg viewBox="0 0 48 36" fill="none" aria-hidden="true"><path d="M2 1v32h44M8 25l9-9 9 5L40 5" stroke="currentColor" stroke-width="2"/></svg><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
}
export function analyticsDataNote(text) {
  return `<p class="analytics-data-note">${esc(text)}</p>`;
}
