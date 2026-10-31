// Diagnostico local, voluntario e efemero: nao envia nem persiste informacoes.
const MAX_EVENTS = 30;
const ALLOWED = new Set(['script-error', 'promise-rejection', 'long-task', 'offline', 'online', 'boot-ready']);
const clamp = value => Math.max(0, Math.min(60000, Math.round(Number(value) || 0)));

export function createMobileDiagnostics({ win = globalThis.window, doc = globalThis.document, perf = globalThis.performance } = {}) {
  const events = [];
  const counters = Object.create(null);
  let started = false;
  let observer = null;
  let stopped = false;
  const record = (type, duration = 0) => {
    if (stopped || !ALLOWED.has(type)) return;
    counters[type] = (counters[type] || 0) + 1;
    if (events.length === MAX_EVENTS) events.shift();
    // Apenas categoria e duracao arredondada. Sem stack, URL, IDs ou conteudo.
    events.push(Object.freeze({ type, durationMs: clamp(duration) }));
  };
  const handlers = {
    error: () => record('script-error'),
    unhandledrejection: () => record('promise-rejection'),
    offline: () => record('offline'),
    online: () => record('online'),
  };
  const snapshot = () => ({
    enabled: started && !stopped,
    events: events.map(event => ({ ...event })),
    counters: { ...counters },
  });
  const start = () => {
    if (started || stopped) return;
    started = true;
    for (const [name, handler] of Object.entries(handlers)) win.addEventListener(name, handler);
    const Observer = win.PerformanceObserver;
    if (Observer?.supportedEntryTypes?.includes('longtask')) {
      try {
        observer = new Observer(list => {
          for (const entry of list.getEntries()) record('long-task', entry.duration);
        });
        observer.observe({ type: 'longtask', buffered: false });
      } catch { observer = null; }
    }
  };
  const bootReady = () => {
    if (!started || stopped) return;
    record('boot-ready', perf?.now?.() ?? 0);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const [name, handler] of Object.entries(handlers)) win.removeEventListener(name, handler);
    observer?.disconnect();
  };
  return Object.freeze({ start, bootReady, snapshot, stop });
}

export function installMobileDiagnostics({ win = globalThis.window, doc = globalThis.document, perf = globalThis.performance } = {}) {
  // Ativacao explicita, somente no aparelho atual. Nao usa cookies ou storage.
  const params = new URLSearchParams(win.location.search);
  if (params.get('mobile-diagnostics') !== '1') return null;
  const diagnostics = createMobileDiagnostics({ win, doc, perf });
  diagnostics.start();
  // Acesso apenas para inspecao local pelo console do navegador.
  Object.defineProperty(win, 'TrameliMobileDiagnostics', {
    configurable: true, value: Object.freeze({
      snapshot: diagnostics.snapshot,
      stop: diagnostics.stop,
    }),
  });
  return diagnostics;
}
