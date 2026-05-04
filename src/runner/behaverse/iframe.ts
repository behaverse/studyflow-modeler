// Behaverse runtime is shipped as a Unity WebGL build mounted at /unity by the
// Vite dev server (see vite.config.ts:unityBuildPlugin). The studyflow runner
// embeds it in an iframe and forwards a few query params (skip-debug-menu,
// optional bot config). All other communication runs through bridge.ts.

export const BEHAVERSE_RUNTIME_URL = '/unity';

// Tells Unity to skip its Loading→Debug-menu scene transition.
const SKIP_DEBUG_MENU = true;

export function buildBehaverseIframeSrc(bot: string | null): string {
  const params = new URLSearchParams();
  if (SKIP_DEBUG_MENU) params.set('skipDebugMenu', '1');
  if (bot) params.set('bot', bot);
  const qs = params.toString();
  return `${BEHAVERSE_RUNTIME_URL}/index.html${qs ? `?${qs}` : ''}`;
}
