import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';

gsap.registerPlugin(ScrollTrigger, ScrollSmoother);

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const desktopQuery = matchMedia('(min-width: 761px)');
const touchQuery = matchMedia('(pointer: coarse)');
let userReduced = false;
try { userReduced = localStorage.getItem('trameli-reduced-motion') === 'true'; } catch { /* Storage is optional. */ }
let smoother = null;
let entrance = null;
let enabled = false;
let suspendedForPrint = false;
let activeRoot = null;
let refreshFrame = 0;
let leaveTween = null;
const shouldMove = () => !reducedQuery.matches && !userReduced;
const shouldSmooth = () => enabled && !suspendedForPrint && shouldMove() && desktopQuery.matches && !touchQuery.matches;

function clearEntrance() {
  if (!entrance) return;
  entrance.revert();
  entrance = null;
}

function refresh() {
  if (!enabled || suspendedForPrint || refreshFrame) return;
  refreshFrame = requestAnimationFrame(() => {
    refreshFrame = 0;
    if (smoother) ScrollTrigger.refresh();
  });
}

function reset(root) {
  clearEntrance();
  activeRoot = root;
}

function syncSmoother() {
  if (!enabled) return;
  const keepY = window.scrollY;
  if (shouldSmooth() && !smoother) {
    smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper', content: '#smooth-content',
      smooth: 0.62, smoothTouch: false, effects: false,
    });
    window.scrollTo(0, keepY);
    refresh();
  } else if (!shouldSmooth() && smoother) {
    smoother.kill();
    smoother = null;
    window.scrollTo(0, keepY);
  }
}

function enter(root) {
  activeRoot = root;
  clearEntrance();
  if (!enabled || !root || !shouldMove() || suspendedForPrint) return;
  const selectors = root.id === 'operation-view'
    ? '.intro, .day-tools, .summary-card, .ledger-note, .day-finance, .orders-section, .supplier-list, .print-info'
    : root.id === 'home-view'
      ? '.hero, .kpi-card, .attention-strip, .content-grid > .panel, .bottom-grid > .panel'
      : root.id === 'portal-content'
        ? '.portal-hero, .portal-section__head, .portal-search, .portal-categories, .portal-product, .portal-page > .portal-eyebrow, .portal-page > h1, .portal-page > p, .portal-cart-line, .portal-order-summary, .portal-history > article, .portal-success__receipt'
        : '.screen-hero, .screen-metric, .screen-panel';
  const elements = [...root.querySelectorAll(selectors)].filter(element => !element.closest('[hidden]'));
  if (!elements.length) return;
  entrance = gsap.context(() => {
    const immediate = [];
    elements.forEach(element => {
      const { top, bottom } = element.getBoundingClientRect();
      if (bottom <= 0) return;
      if (top < innerHeight * 0.88) immediate.push(element);
      else {
        gsap.set(element, { opacity: 0, y: 16 });
        ScrollTrigger.create({
          trigger: element, start: 'top 94%', once: true,
          onEnter: () => gsap.to(element, { opacity: 1, y: 0, duration: 0.48, ease: 'power2.out', clearProps: 'opacity,transform' }),
        });
      }
    });
    if (immediate.length) gsap.fromTo(immediate,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.46, stagger: { each: 0.035, from: 'start' }, ease: 'power2.out', clearProps: 'opacity,transform' });
  }, root);
  refresh();
}

function scrollTo(target, smooth = true, offset = 0) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
  const y = typeof target === 'number' ? target : element ? element.getBoundingClientRect().top + window.scrollY - offset : 0;
  const top = Math.max(0, y);
  if (smoother && smooth && shouldMove()) smoother.scrollTo(top, true);
  else window.scrollTo({ top, behavior: smooth && shouldMove() ? 'smooth' : 'instant' });
}

function pulse(element) {
  if (!element || !shouldMove()) return;
  gsap.fromTo(element, { scale: 1 }, { scale: 1.045, duration: 0.13, ease: 'power1.out', yoyo: true, repeat: 1, overwrite: true, clearProps: 'transform' });
}

function leave(root, onComplete) {
  if (!enabled || !shouldMove() || !root) { onComplete(); return; }
  clearEntrance();
  leaveTween?.kill();
  gsap.set(root, { clearProps: 'opacity,visibility,transform' });
  leaveTween = gsap.to(root, { autoAlpha: 0, y: -7, duration: 0.16, ease: 'power1.in',
    onComplete: () => {
      gsap.set(root, { clearProps: 'opacity,visibility,transform' });
      leaveTween = null;
      onComplete();
    },
  });
}

function setReduced(value) {
  userReduced = Boolean(value);
  if (userReduced || reducedQuery.matches) {
    clearEntrance();
    leaveTween?.progress(1);
    gsap.killTweensOf('.button--primary, .portal-primary, .portal-hero a');
    gsap.set('.button--primary, .portal-primary, .portal-hero a', { clearProps: 'transform' });
  }
  syncSmoother();
  if (shouldMove() && activeRoot) enter(activeRoot);
}

function beforePrint() {
  suspendedForPrint = true;
  clearEntrance();
  syncSmoother();
}

function afterPrint() {
  suspendedForPrint = false;
  syncSmoother();
  if (activeRoot && shouldMove()) enter(activeRoot);
}

function init() {
  if (enabled) return;
  enabled = true;
  syncSmoother();
  const root = location.hash === '#loja' ? document.getElementById('portal-content')
    : document.querySelector('.view:not([hidden])');
  enter(root);
  reducedQuery.addEventListener('change', () => setReduced(userReduced));
  desktopQuery.addEventListener('change', syncSmoother);
  touchQuery.addEventListener('change', syncSmoother);
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);
  document.addEventListener('pointerover', event => {
    if (!shouldMove() || event.pointerType === 'touch') return;
    const button = event.target.closest('.button--primary, .portal-primary, .portal-hero a');
    if (!button || button.contains(event.relatedTarget)) return;
    gsap.to(button, { scale: 1.025, duration: 0.19, ease: 'power2.out', overwrite: true });
  });
  document.addEventListener('pointerout', event => {
    const button = event.target.closest('.button--primary, .portal-primary, .portal-hero a');
    if (!button || button.contains(event.relatedTarget)) return;
    if (!shouldMove()) { gsap.set(button, { clearProps: 'transform' }); return; }
    gsap.to(button, { scale: 1, duration: 0.16, ease: 'power2.out', overwrite: true, clearProps: 'transform' });
  });
}

window.TrameliMotion = { init, enter, reset, refresh, scrollTo, scrollTop: () => window.scrollY,
  pulse, leave, setReduced, menu: open => smoother?.paused(open), active: () => Boolean(smoother) };

export { init, enter, refresh, scrollTo, setReduced };
