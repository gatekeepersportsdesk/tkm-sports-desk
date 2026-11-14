/**
 * Why did the page just load? A full reload (not a React state reset) is the only thing that can send the app
 * back to a fresh state, so this records the cause instead of guessing:
 *  - 'vite-full-reload'   the dev server pushed a reload because a file changed (HMR on)
 *  - 'server-restarted'   /api/health startedAt changed since the last load (the server crashed or was redeployed)
 *  - 'browser-reload'     you (or the browser) reloaded
 *  - 'back-forward' / 'first-load'
 * Pure classification lives here so it is unit tested; the browser wiring is in installSessionDiagnostics().
 */
export type LoadKind = 'first-load' | 'vite-full-reload' | 'server-restarted' | 'browser-reload' | 'back-forward' | 'navigate';

export interface LoadEvidence {
  navType?: string;                 // PerformanceNavigationTiming.type
  viteReloadFlag?: string | null;   // set by vite:beforeFullReload just before the page went away
  prevServerStart?: number | null;  // last seen /api/health startedAt
  serverStart?: number | null;      // current /api/health startedAt (null = health unreachable)
  hadPriorSession: boolean;         // we have loaded before in this browser tab
}

export interface LoadDiagnosis { kind: LoadKind; message: string; benign: boolean }

export function classifyLoad(e: LoadEvidence): LoadDiagnosis {
  if (!e.hadPriorSession) return { kind: 'first-load', message: 'First load in this tab.', benign: true };
  if (e.viteReloadFlag) {
    return { kind: 'vite-full-reload', benign: false, message: 'The dev server reloaded the page because a project file changed (HMR). Set DISABLE_HMR=true to stop this.' };
  }
  if (e.prevServerStart && e.serverStart && e.prevServerStart !== e.serverStart) {
    return { kind: 'server-restarted', benign: false, message: 'The server restarted since your last visit (crash or redeploy), which reloads the page. Your sport, tab, odds and ledger were restored from this browser.' };
  }
  if (e.navType === 'reload') return { kind: 'browser-reload', benign: true, message: 'The browser reloaded the page.' };
  if (e.navType === 'back_forward') return { kind: 'back-forward', benign: true, message: 'Back/forward navigation.' };
  return { kind: 'navigate', benign: true, message: 'Page opened again.' };
}

export interface DiagEntry { at: number; kind: LoadKind; message: string }

/** keeps the last `max` entries, newest last */
export function pushDiagLog(log: DiagEntry[], entry: DiagEntry, max = 10): DiagEntry[] {
  return [...log, entry].slice(-max);
}

const K_FLAG = 'gk_vite_reload';
const K_SERVER = 'gk_server_start';
const K_SEEN = 'gk_seen';
const K_LOG = 'gk_diag_log';

/** call once at startup; returns the diagnosis for THIS load. Never throws. */
export async function installSessionDiagnostics(): Promise<LoadDiagnosis> {
  let hadPrior = false, flag: string | null = null, prevStart: number | null = null, log: DiagEntry[] = [];
  try {
    hadPrior = sessionStorage.getItem(K_SEEN) === '1';
    flag = sessionStorage.getItem(K_FLAG);
    sessionStorage.removeItem(K_FLAG);
    sessionStorage.setItem(K_SEEN, '1');
    prevStart = Number(localStorage.getItem(K_SERVER)) || null;
    log = JSON.parse(localStorage.getItem(K_LOG) || '[]');
  } catch { /* storage blocked: diagnostics degrade to first-load */ }
  try {
    const hot = (import.meta as any).hot;
    hot?.on?.('vite:beforeFullReload', () => { try { sessionStorage.setItem(K_FLAG, String(Date.now())); } catch { /* ignore */ } });
  } catch { /* not under vite */ }
  window.addEventListener('unhandledrejection', ev => console.warn('[gatekeep] unhandled promise rejection (page stays on current tab):', ev.reason));
  window.addEventListener('error', ev => console.warn('[gatekeep] window error (page stays on current tab):', ev.message));

  let serverStart: number | null = null;
  try {
    const r = await fetch('/api/health');
    if (r.ok) serverStart = (await r.json()).startedAt ?? null;
  } catch { /* server unreachable */ }
  let navType: string | undefined;
  try { navType = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type; } catch { /* ignore */ }
  const d = classifyLoad({ navType, viteReloadFlag: flag, prevServerStart: prevStart, serverStart, hadPriorSession: hadPrior });
  try {
    if (serverStart) localStorage.setItem(K_SERVER, String(serverStart));
    localStorage.setItem(K_LOG, JSON.stringify(pushDiagLog(log, { at: Date.now(), kind: d.kind, message: d.message })));
  } catch { /* ignore */ }
  console.info(`[gatekeep] page load: ${d.kind} — ${d.message}`);
  return d;
}

/**
 * If a reload ever does happen, put the page back where you were. Saves the scroll position per sport/tab (throttled) and
 * restores it once the content is tall enough (it waits up to 4 seconds for the data to arrive). Never throws.
 */
export function installScrollRestore(getKey: () => string): () => void {
  const K = 'gk_scroll_v1';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try { sessionStorage.setItem(K, JSON.stringify({ key: getKey(), y: Math.round(window.scrollY) })); } catch { /* ignore */ }
    }, 300);
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem(K) || 'null');
    if (saved && saved.key === getKey() && saved.y > 0) {
      const t0 = Date.now();
      const tryRestore = () => {
        if (document.documentElement.scrollHeight - window.innerHeight >= saved.y || Date.now() - t0 > 4000) { window.scrollTo(0, saved.y); return; }
        requestAnimationFrame(tryRestore);
      };
      requestAnimationFrame(tryRestore);
    }
  } catch { /* ignore */ }
  window.addEventListener('scroll', save, { passive: true });
  return () => { window.removeEventListener('scroll', save); if (timer) clearTimeout(timer); };
}
