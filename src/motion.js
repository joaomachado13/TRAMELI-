import { gsap, ScrollSmoother, ScrollTrigger } from './gsap.js';
import * as pageTransitions from './page-transitions.js';

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
let userReduced = false;
try { userReduced = localStorage.getItem('trameli-reduced-motion') === 'true'; } catch { /* Storage is optional. */ }
let activeRoot = null;
let entrance = null;
let enabled = false;
let suspendedForPrint = false;
let smoother = null;
let refreshFrame = 0;
let menuOpen = false;
let dragging = false;
const desktopQuery = matchMedia('(min-width: 1100px) and (hover: hover) and (pointer: fine)');
const smoothing = 0.45;
const shouldMove = () => !reducedQuery.matches && !userReduced && !suspendedForPrint;

function pauseScroll() {
  smoother?.paused(menuOpen || Boolean(document.querySelector('dialog[open]')), true);
}

function syncScroll() {
  if (!enabled) return;
  const useSmoother = shouldMove() && desktopQuery.matches;
  if (!useSmoother && smoother) {
    const position = smoother.scrollTop();
    smoother.kill(); smoother = null;
    window.scrollTo({ top: position, behavior: 'instant' });
  } else if (useSmoother && !smoother && document.getElementById('smooth-content')) {
    const position = window.scrollY;
    smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper', content: '#smooth-content',
      smooth: smoothing, smoothTouch: false, effects: false, normalizeScroll: false,
      onFocusIn: (_self, event) => !event.target.closest('dialog[open]'),
    });
    smoother.scrollTop(position);
  }
  smoother?.smooth(dragging ? 0 : smoothing);
  pauseScroll();
}

function refresh() {
  if (!enabled || refreshFrame) return;
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = 0;
    syncScroll();
    if (smoother) ScrollTrigger.refresh();
  });
}

function menu(open) { menuOpen = Boolean(open); pauseScroll(); }

function clearEntrance() {
  entrance?.kill();
  entrance = null;
  if (activeRoot) gsap.set(activeRoot, { clearProps: 'opacity,visibility,transform' });
}

function reset(root) {
  clearEntrance();
  activeRoot = root;
}

function enter(root, { swipe } = {}) {
  clearEntrance();
  activeRoot = root;
  refresh();
  if (!enabled || !root || !shouldMove()) return;
  if (swipe) pageTransitions.reveal(swipe);
  // Animate one layer, not every card: rows and scroll position stay still.
  entrance = gsap.fromTo(root, { opacity: 0.82 }, {
    opacity: 1, duration: 0.18, ease: 'power1.out', overwrite: true,
    onComplete: () => { gsap.set(root, { clearProps: 'opacity' }); entrance = null; },
  });
}

function scrollTo(target, smooth = true, offset = 0) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  syncScroll();
  if (smoother) {
    // As telas são dinâmicas; recalcula o limite antes de navegar para um item.
    ScrollTrigger.refresh();
    const y = typeof target === 'number' ? target : element ? smoother.offset(element, 'top top') - offset : 0;
    smoother.scrollTo(Math.max(0, y), smooth && shouldMove());
    return;
  }
  const y = typeof target === 'number' ? target : element ? element.getBoundingClientRect().top + window.scrollY - offset : 0;
  window.scrollTo({ top: Math.max(0, y), behavior: smooth && shouldMove() ? 'smooth' : 'instant' });
}

function pulse(element) {
  if (!element || !shouldMove()) return;
  gsap.fromTo(element, { scale: 1 }, {
    scale: 1.025, duration: 0.1, ease: 'power1.out', yoyo: true, repeat: 1,
    overwrite: true, clearProps: 'transform',
  });
}

function leave(_root, onComplete, { style = 'curve' } = {}) {
  clearEntrance();
  if (enabled && shouldMove()) pageTransitions.leave(onComplete, style);
  else { pageTransitions.cancel(); onComplete(); }
}

function setReduced(value) {
  userReduced = Boolean(value);
  if (!shouldMove()) { clearEntrance(); pageTransitions.cancel(true); }
  syncScroll();
}

function init() {
  if (enabled) return;
  enabled = true;
  syncScroll();
  const root = location.hash === '#loja' ? document.getElementById('portal-content')
    : document.querySelector('.view:not([hidden])');
  enter(root);
  reducedQuery.addEventListener('change', () => { if (!shouldMove()) { clearEntrance(); pageTransitions.cancel(true); } syncScroll(); });
  desktopQuery.addEventListener('change', refresh);
  window.addEventListener('beforeprint', () => { suspendedForPrint = true; clearEntrance(); pageTransitions.cancel(true); syncScroll(); });
  window.addEventListener('afterprint', () => { suspendedForPrint = false; refresh(); });
  window.addEventListener('resize', refresh);
  window.addEventListener('hashchange', refresh);
  document.addEventListener('close', pauseScroll, true);
  document.addEventListener('dragstart', event => {
    if (!event.target.closest('.order-card')) return;
    dragging = true; smoother?.scrollTop(smoother.scrollTop()); smoother?.smooth(0);
  });
  const finishDrag = () => { dragging = false; smoother?.smooth(smoothing); refresh(); };
  document.addEventListener('dragend', finishDrag);
  document.addEventListener('drop', finishDrag);
  // Atualizações de pedidos, filtros, imagens e modais mudam a altura da página.
  const content = document.getElementById('smooth-content');
  if (content) {
    new ResizeObserver(refresh).observe(content);
    new MutationObserver(refresh).observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
    document.querySelector('.app-shell') && new ResizeObserver(refresh).observe(document.querySelector('.app-shell'));
  }
  new MutationObserver(pauseScroll).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  document.fonts?.ready.then(refresh);
}

window.TrameliMotion = {
  init, enter, reset, refresh, scrollTo, scrollTop: () => smoother ? smoother.scrollTop() : window.scrollY,
  pulse, leave, cancelTransition: () => pageTransitions.cancel(), setReduced, menu, active: () => Boolean(smoother),
};

export { init, enter, scrollTo, setReduced };
