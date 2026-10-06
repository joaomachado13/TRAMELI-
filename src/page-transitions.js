import { gsap } from './gsap.js';
import './page-transitions.css';

let overlay;
let front;
let timeline = null;
let pendingSwap = null;

const edge = value => ({ top: value, bottom: value, c1: value, c2: value });
// Mesmos segmentos e sentido em todas as formas: evita inversões durante o morph.
const shape = (left, right) => `M${left.top},-2 C${left.top},-2 ${right.top},-2 ${right.top},-2 C${right.c1},33 ${right.c2},67 ${right.bottom},102 C${right.bottom},102 ${left.bottom},102 ${left.bottom},102 C${left.c2},67 ${left.c1},33 ${left.top},-2 Z`;
const emptyLeft = shape(edge(-4), edge(-4));
const covered = shape(edge(-4), edge(104));
const coverDuration = .6;
const revealDuration = .6;
const coveredPause = .06;
const variations = {
  swipe: [edge(52)],
  curve: [{ top: 45, bottom: 45, c1: 66, c2: 66 }],
  diagonal: [{ top: 62, bottom: 42, c1: 55, c2: 49 }],
  wave: [{ top: 52, bottom: 52, c1: 62, c2: 42 }],
};

function prepare(style) {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'route-transition';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false"><g><path class="route-transition__front"/></g></svg>';
    document.body.append(overlay);
    front = overlay.querySelector('.route-transition__front');
  }
  // Fora do smooth-content: a transição não rola com a página.
  const shell = document.querySelector('.app-shell');
  overlay.style.left = `${shell && !shell.hidden ? Math.max(0, shell.getBoundingClientRect().left) : 0}px`;
  overlay.dataset.style = style;
  overlay.querySelector('g').setAttribute('transform', ['curve', 'wave'].includes(style) ? 'rotate(-90 50 50)' : '');
  overlay.hidden = false;
}

function cancel(commit = false) {
  const swap = pendingSwap;
  pendingSwap = null;
  timeline?.kill(); timeline = null;
  if (overlay) overlay.hidden = true;
  if (commit) swap?.();
}

function morph(path, duration, ease) {
  return { morphSVG: { shape: path, shapeIndex: 0 }, duration, ease };
}

function uncover(style, start) {
  const middle = shape(edge(-4), variations[style][0]);
  // Volta pela mesma borda: curva vertical sobe e desce, sem uma segunda varredura.
  timeline.to(front, morph(middle, revealDuration / 2, 'sine.in'), start)
    .to(front, morph(emptyLeft, revealDuration / 2, 'sine.out'), start + revealDuration / 2);
}

function leave(onSwap, style = 'curve') {
  // Cliques rápidos atualizam o destino sem reiniciar uma curva já em movimento.
  if (timeline && pendingSwap) { pendingSwap = onSwap; return; }
  const continuing = Boolean(timeline);
  if (continuing) { timeline.kill(); timeline = null; style = overlay.dataset.style; }
  else cancel();
  style = variations[style] ? style : 'curve';
  prepare(style);
  const leading = shape(edge(-4), variations[style][0]);
  if (!continuing) gsap.set(front, { attr: { d: emptyLeft } });
  pendingSwap = onSwap;
  timeline = gsap.timeline({ onComplete: () => cancel() });
  const swapAt = continuing ? coverDuration / 2 : coverDuration;
  if (continuing) timeline.to(front, morph(covered, swapAt, 'sine.inOut'), 0);
  else timeline.to(front, morph(leading, coverDuration / 2, 'sine.in'), 0)
    .to(front, morph(covered, coverDuration / 2, 'sine.out'), coverDuration / 2);
  timeline.call(() => { const swap = pendingSwap; pendingSwap = null; swap?.(); }, [], swapAt);
  uncover(style, swapAt + coveredPause);
}

function reveal(style = 'curve') {
  if (timeline) return;
  style = variations[style] ? style : 'curve';
  prepare(style);
  gsap.set(front, { attr: { d: covered } });
  timeline = gsap.timeline({ onComplete: () => cancel() });
  uncover(style, 0);
}

export { leave, reveal, cancel };
