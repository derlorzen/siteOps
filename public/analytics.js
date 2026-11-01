/* Shared analytics presentation. Values and points come only from provider reports. */
(() => {
  'use strict';
  const numeric = value =>
    value !== null && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value))
      ? Number(value)
      : null;
  const number = (value, decimals = 0) =>
    numeric(value) == null
      ? '–'
      : new Intl.NumberFormat('de-DE', { maximumFractionDigits: decimals }).format(Number(value));
  const date = (value, year = false) => {
    const parsed = new Date(String(value).length === 10 ? value + 'T12:00:00Z' : value);
    return Number.isFinite(parsed.getTime())
      ? new Intl.DateTimeFormat('de-DE', {
          timeZone: 'UTC',
          day: '2-digit',
          month: '2-digit',
          ...(year ? { year: 'numeric' } : {})
        }).format(parsed)
      : '–';
  };
  function format(value, kind) {
    if (numeric(value) == null) return '–';
    value = Number(value);
    if (kind === 'percent') return number(value * 100, 2) + ' %';
    if (kind === 'hours') return number(value / 60, 1) + ' Std.';
    if (kind === 'duration') {
      const seconds = Math.round(value);
      return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0') + ' Min.';
    }
    return number(value, kind === 'decimal' ? 1 : 0);
  }
  function comparison(current, previous, metric) {
    current = numeric(current);
    previous = numeric(previous);
    if (current == null) return { text: 'Keine Daten verfügbar', tone: 'neutral' };
    if (previous == null) return { text: 'Im ausgewählten Zeitraum', tone: 'neutral' };
    const difference = current - previous,
      sign = difference > 0 ? '+' : difference < 0 ? '−' : '';
    const tone =
      difference === 0 ? 'neutral' : (metric.inverse ? difference < 0 : difference > 0) ? 'positive' : 'negative';
    if (metric.format === 'percent')
      return { text: sign + number(Math.abs(difference) * 100, 2) + ' Prozentpunkte', tone };
    if (metric.inverse) return { text: sign + number(Math.abs(difference), 1) + ' Positionen', tone };
    if (previous === 0)
      return { text: difference === 0 ? 'Unverändert' : 'Zuvor ' + format(previous, metric.format), tone: 'neutral' };
    return { text: sign + number(Math.abs(difference / previous) * 100, 1) + ' % zum Vergleich', tone };
  }
  function metrics(root, definitions, current = {}, previous = {}, select) {
    root.querySelectorAll('[data-metric]').forEach(button => {
      const definition = definitions.find(metric => metric.key === button.dataset.metric);
      if (!definition) return;
      button.disabled = typeof select !== 'function';
      button.querySelector('[data-value]').textContent = format(current?.[definition.key], definition.format);
      const delta = comparison(current?.[definition.key], previous?.[definition.key], definition),
        detail = button.querySelector('[data-comparison]');
      detail.textContent = delta.text;
      detail.dataset.tone = delta.tone;
      button.onclick = () => {
        root
          .querySelectorAll('[data-metric]')
          .forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        select?.(definition);
      };
    });
  }
  const models = new WeakMap(),
    svgNode = (name, attributes = {}) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      return node;
    };
  function chart(root, rows, metric, { dateKey = 'date', title, insight, context } = {}) {
    let model = models.get(root);
    if (!model) {
      model = {};
      models.set(root, model);
      model.observer = new ResizeObserver(() => draw(root, model));
      model.observer.observe(root);
    }
    model.rows = rows;
    model.metric = metric;
    model.dateKey = dateKey;
    model.title = title;
    model.insight = insight;
    model.context = context;
    draw(root, model);
  }
  function draw(root, model) {
    if (!model.metric) return;
    const { metric, dateKey } = model,
      points = (model.rows || [])
        .map(row => ({ date: row[dateKey], time: Date.parse(row[dateKey]), value: numeric(row[metric.key]) }))
        .filter(point => Number.isFinite(point.time) && point.value != null)
        .sort((a, b) => a.time - b.time);
    root.replaceChildren();
    root.removeAttribute('aria-busy');
    root.onpointermove = root.onpointerleave = root.onfocus = root.onkeydown = null;
    if (model.title) model.title.textContent = metric.label + ' im Zeitverlauf';
    if (model.context)
      model.context.textContent =
        metric.format === 'hours'
          ? 'In Stunden'
          : metric.format === 'duration'
            ? 'In Minuten'
            : metric.format === 'percent'
              ? 'In Prozent'
              : metric.inverse
                ? 'Niedriger ist besser'
                : '';
    if (!points.length) {
      root.setAttribute('aria-label', metric.label + ': keine Tageswerte gemeldet.');
      root.removeAttribute('tabindex');
      const empty = document.createElement('div');
      empty.className = 'analytics-chart-state';
      empty.textContent = 'Für diesen Zeitraum liegen noch keine Tageswerte vor.';
      root.append(empty);
      if (model.insight) model.insight.textContent = 'Fehlende Werte werden nicht als Null dargestellt.';
      return;
    }
    root.tabIndex = 0;
    root.setAttribute(
      'aria-label',
      metric.label + ', ' + points.length + ' gemeldete Tageswerte. Pfeiltasten wählen einen Tag.'
    );
    const width = Math.max(280, root.clientWidth),
      height = 246,
      left = 48,
      right = 16,
      top = 20,
      bottom = 32,
      plotWidth = width - left - right,
      plotHeight = height - top - bottom;
    const values = points.map(point =>
        metric.format === 'hours'
          ? point.value / 60
          : metric.format === 'duration'
            ? point.value / 60
            : metric.format === 'percent'
              ? point.value * 100
              : point.value
      ),
      peak = Math.max(...values, 0),
      magnitude = 10 ** Math.floor(Math.log10(peak || 1)),
      maximum = Math.max(1, Math.ceil(peak / magnitude) * magnitude);
    const minTime = points[0].time,
      maxTime = points.at(-1).time,
      span = maxTime - minTime || 86400000;
    const x = point => left + ((point.time - minTime) / span) * plotWidth,
      y = value => top + plotHeight - (value / maximum) * plotHeight;
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, 'aria-hidden': 'true' });
    for (let i = 0; i <= 4; i++) {
      const value = (maximum * i) / 4,
        yy = y(value);
      svg.append(svgNode('line', { x1: left, y1: yy, x2: width - right, y2: yy, class: 'analytics-gridline' }));
      const label = svgNode('text', { x: left - 12, y: yy + 4, 'text-anchor': 'end', class: 'analytics-axis' });
      label.textContent = new Intl.NumberFormat('de-DE', {
        notation: maximum >= 10000 ? 'compact' : 'standard',
        maximumFractionDigits: maximum < 10 ? 1 : 0
      }).format(value);
      svg.append(label);
    }
    const ticks = Math.min(width < 450 ? 3 : 5, points.length),
      indices = [
        ...new Set(
          Array.from({ length: ticks }, (_, i) => Math.round((i * (points.length - 1)) / Math.max(1, ticks - 1)))
        )
      ];
    indices.forEach(index => {
      const label = svgNode('text', {
        x: x(points[index]),
        y: height - 8,
        'text-anchor': index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle',
        class: 'analytics-axis'
      });
      label.textContent = date(points[index].date);
      svg.append(label);
    });
    let path = '';
    points.forEach((point, index) => {
      const move = index === 0 || point.time - points[index - 1].time > 36 * 3600000;
      path += (move ? 'M' : 'L') + x(point).toFixed(2) + ',' + y(values[index]).toFixed(2) + ' ';
    });
    svg.append(
      svgNode('path', {
        d: path,
        class: 'analytics-series',
        fill: 'none',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      })
    );
    if (points.length === 1)
      svg.append(svgNode('circle', { cx: x(points[0]), cy: y(values[0]), r: 4, class: 'analytics-series-dot' }));
    const marker = svgNode('g', { visibility: 'hidden' }),
      guide = svgNode('line', { y1: top, y2: height - bottom, class: 'analytics-crosshair' }),
      dot = svgNode('circle', { r: 4.5, class: 'analytics-series-dot' });
    marker.append(guide, dot);
    svg.append(marker);
    root.append(svg);
    const tooltip = document.createElement('div');
    tooltip.className = 'analytics-point';
    tooltip.hidden = true;
    root.append(tooltip);
    const readout = document.createElement('span');
    readout.className = 'ui-sr-only';
    readout.setAttribute('aria-live', 'polite');
    root.append(readout);
    let active = 0;
    const choose = (index, announce = false) => {
      active = Math.max(0, Math.min(points.length - 1, index));
      const point = points[active],
        xx = x(point);
      guide.setAttribute('x1', xx);
      guide.setAttribute('x2', xx);
      dot.setAttribute('cx', xx);
      dot.setAttribute('cy', y(values[active]));
      marker.setAttribute('visibility', 'visible');
      tooltip.hidden = false;
      tooltip.style.left = Math.max(0, Math.min(width - 190, xx - 90)) + 'px';
      const day = document.createElement('span'),
        value = document.createElement('strong');
      day.textContent = date(point.date, true);
      value.textContent = format(point.value, metric.format);
      tooltip.replaceChildren(day, value);
      if (announce) readout.textContent = day.textContent + ': ' + value.textContent;
    };
    root.onpointermove = event => {
      const cursor = event.clientX - root.getBoundingClientRect().left;
      let closest = 0;
      points.forEach((point, index) => {
        if (Math.abs(x(point) - cursor) < Math.abs(x(points[closest]) - cursor)) closest = index;
      });
      choose(closest);
    };
    root.onpointerleave = () => {
      if (document.activeElement !== root) {
        marker.setAttribute('visibility', 'hidden');
        tooltip.hidden = true;
      }
    };
    root.onfocus = () => choose(points.length - 1, true);
    root.onblur = () => {
      marker.setAttribute('visibility', 'hidden');
      tooltip.hidden = true;
    };
    root.onkeydown = event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        choose(
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? points.length - 1
              : active + (event.key === 'ArrowLeft' ? -1 : 1),
          true
        );
      }
    };
    if (model.insight) {
      const best = values.indexOf(metric.inverse ? Math.min(...values) : Math.max(...values));
      model.insight.textContent =
        (metric.inverse ? 'Beste Position' : 'Höchster Tageswert') +
        ' am ' +
        date(points[best].date) +
        ': ' +
        format(points[best].value, metric.format);
    }
  }
  function chartState(root, text) {
    const model = models.get(root);
    if (model) model.metric = null;
    root.onpointermove = root.onpointerleave = root.onfocus = root.onblur = root.onkeydown = null;
    root.replaceChildren();
    root.setAttribute('aria-label', text);
    root.removeAttribute('tabindex');
    const state = document.createElement('div');
    state.className = 'analytics-chart-state';
    state.textContent = text;
    root.append(state);
  }
  const definitions = root =>
    [...root.querySelectorAll('[data-metric]')].map(button => ({
      key: button.dataset.metric,
      format: button.dataset.format,
      inverse: button.dataset.inverse === 'true',
      label: button.querySelector('span').textContent
    }));
  window.SiteOpsAnalytics = { number, date, format, numeric, metrics, chart, chartState, comparison, definitions };
})();
