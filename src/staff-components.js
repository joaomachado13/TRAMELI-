const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function pageHeader({ title, actions = '', description = '' }) {
  return `<header class="screen-hero staff-page-header"><div><h1 class="h1">${escape(title)}</h1>${description ? `<p class="screen-description">${escape(description)}</p>` : ''}</div>${actions ? `<div class="staff-page-actions">${actions}</div>` : ''}</header>`;
}

export function metricCard(label, value, note) {
  return `<article class="screen-metric staff-metric"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></article>`;
}

export function card(title, content) {
  return `<section class="screen-panel staff-card">${title ? `<div class="screen-panel__heading"><h2>${escape(title)}</h2></div>` : ''}${content}</section>`;
}

export function feedback({ title, description = '', kind = 'empty', action = '' }) {
  const state = ['empty', 'loading', 'error'].includes(kind) ? kind : 'empty';
  return `<div class="staff-feedback staff-feedback--${state} friendly-empty" role="${state === 'error' ? 'alert' : 'status'}"${state === 'loading' ? ' aria-busy="true"' : ''}><span class="staff-feedback__icon" aria-hidden="true">${state === 'error' ? '!' : state === 'loading' ? '…' : '—'}</span><strong>${escape(title)}</strong>${description ? `<span>${escape(description)}</span>` : ''}${state === 'loading' ? '<span class="staff-skeleton" aria-hidden="true"></span><span class="staff-skeleton staff-skeleton--short" aria-hidden="true"></span>' : ''}${action}</div>`;
}

export function statusBadge(label, tone = 'neutral', className = '') {
  const state = ['success', 'warning', 'danger', 'info', 'neutral'].includes(tone) ? tone : 'neutral';
  return `<span class="staff-badge staff-badge--${state} ${escape(className)}">${escape(label)}</span>`;
}

// Values are escaped here; attributes are fixed markup supplied by internal callers.
export function listRow({ title, subtitle = '', avatar = '↗', badge = '', value = '', href = '', attributes = '', className = '' }) {
  const tag = href ? 'a' : 'button';
  const icon = ({ '▣':'orders', '▦':'calendar', '$':'currency', '□':'box', '↗':'arrow' })[avatar];
  const avatarMarkup = icon ? `<span class="ico ico--${icon}" aria-hidden="true"></span>` : escape(avatar);
  return `<${tag} ${href ? `href="${escape(href)}"` : 'type="button"'} class="record-row staff-list-row ${escape(className)}" ${attributes}><span class="record-avatar" aria-hidden="true">${avatarMarkup}</span><span class="record-main"><strong>${escape(title)}</strong>${subtitle ? `<small title="${escape(subtitle)}">${escape(subtitle)}</small>` : ''}</span><span class="staff-list-tail">${value ? `<strong>${escape(value)}</strong>` : ''}${badge}</span><span class="record-chevron" aria-hidden="true">›</span></${tag}>`;
}

export function revenueChart(entries, formatMoney) {
  if (!entries.length) return feedback({ title: 'Sem vendas no período.' });
  const visible = entries.slice().sort(([a], [b]) => a.localeCompare(b)).slice(-10);
  const maximum = Math.max(1, ...visible.map(([, value]) => value));
  const step = 10 ** Math.floor(Math.log10(maximum));
  const ceiling = Math.ceil(maximum / step) * step;
  const ticks = Array.from({ length: 5 }, (_, i) => formatMoney(Math.round(ceiling * (4 - i) / 4)));
  return `<figure class="staff-revenue-chart"><figcaption>Vendas por data de entrega · até 10 dias com pedidos</figcaption><div class="staff-revenue-chart__layout" style="--columns:${visible.length}"><div class="staff-revenue-chart__axis" aria-hidden="true">${ticks.map(tick => `<span>${escape(tick)}</span>`).join('')}</div><div class="staff-revenue-chart__plot">${visible.map(([date, value]) => { const label = new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); const tooltip = `${label} · ${formatMoney(value)}`; return `<div class="staff-revenue-chart__column"><button type="button" class="staff-revenue-chart__bar" style="--bar:${value * 100 / ceiling}%" aria-label="${escape(tooltip)}" data-tooltip="${escape(tooltip)}"><span class="sr-only">${escape(tooltip)}</span></button><small>${escape(label)}</small></div>`; }).join('')}</div></div></figure>`;
}

export function balanceProgress(received, due, formatMoney) {
  const total = received + due;
  return `<div class="staff-balance"><div class="staff-balance__track" role="img" aria-label="${escape(`Recebido ${formatMoney(received)}; em aberto ${formatMoney(due)}`)}"><span class="staff-balance__received" style="width:${total ? received * 100 / total : 0}%"></span><span class="staff-balance__due" style="width:${total ? due * 100 / total : 0}%"></span></div><dl><div><dt>Recebido</dt><dd>${escape(formatMoney(received))}</dd></div><div><dt>Em aberto</dt><dd>${escape(formatMoney(due))}</dd></div></dl></div>`;
}
