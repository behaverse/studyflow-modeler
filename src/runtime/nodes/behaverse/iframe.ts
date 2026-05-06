// Behaverse runtime is shipped as a Unity WebGL build mounted at /unity by the
// Vite dev server (see vite.config.ts:unityBuildPlugin). The studyflow runner
// embeds it in an iframe and forwards a single skip-debug-menu flag. All
// per-task config (including bot overrides) rides inside the RunTask
// JSON payload — see bridge.ts.

export const BEHAVERSE_RUNTIME_URL = '/unity';

// Tells Unity to skip its Loading→Debug-menu scene transition.
const SKIP_DEBUG_MENU = true;

export function buildBehaverseIframeSrc(): string {
  const params = new URLSearchParams();
  if (SKIP_DEBUG_MENU) params.set('skipDebugMenu', '1');
  const qs = params.toString();
  return `${BEHAVERSE_RUNTIME_URL}/index.html${qs ? `?${qs}` : ''}`;
}
