import { gsap } from 'gsap';

const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
let userReduced = false;
try { userReduced = localStorage.getItem('trameli-reduced-motion') === 'true'; } catch { /* Storage is optional. */ }
let activeRoot = null;
let entrance = null;
let enabled = false;
let suspendedForPrint = false;
const shouldMove = () => !reducedQuery.matches && !userReduced && !suspendedForPrint;

function clearEntrance() {
  entrance?.kill();
  entrance = null;
  if (activeRoot) gsap.set(activeRoot, { clearProps: 'opacity,visibility,transform' });
}

function reset(root) {
  clearEntrance();
  activeRoot = root;
}

function enter(root) {
  clearEntrance();
  activeRoot = root;
  if (!enabled || !root || !shouldMove()) return;
  // Animate one layer, not every card: rows and scroll position stay still.
  entrance = gsap.fromTo(root, { opacity: 0.82 }, {
    opacity: 1, duration: 0.18, ease: 'power1.out', overwrite: true,
    onComplete: () => { gsap.set(root, { clearProps: 'opacity' }); entrance = null; },
  });
}

function scrollTo(target, smooth = true, offset = 0) {
  const element = typeof target === 'string' ? document.querySelector(target) : target;
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

function leave(_root, onComplete) {
  clearEntrance();
  onComplete();
}

function setReduced(value) {
  userReduced = Boolean(value);
  if (!shouldMove()) clearEntrance();
}

function init() {
  if (enabled) return;
  enabled = true;
  const root = location.hash === '#loja' ? document.getElementById('portal-content')
    : document.querySelector('.view:not([hidden])');
  enter(root);
  reducedQuery.addEventListener('change', () => { if (!shouldMove()) clearEntrance(); });
  window.addEventListener('beforeprint', () => { suspendedForPrint = true; clearEntrance(); });
  window.addEventListener('afterprint', () => { suspendedForPrint = false; });
}

window.TrameliMotion = {
  init, enter, reset, refresh: () => {}, scrollTo, scrollTop: () => window.scrollY,
  pulse, leave, setReduced, menu: () => {}, active: () => false,
};

export { init, enter, scrollTo, setReduced };
