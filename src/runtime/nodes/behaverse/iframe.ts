// Behaverse runtime is a Unity WebGL build (the assessment-unity project)
// mounted at `assessment-unity/` next to the host HTML page (app.html /
// run.html / index.html). In dev it's served by vite.config.ts:unityBuildPlugin;
// in production the modeler's deploy workflow unpacks the latest
// behaverse/assessment-unity release into dist/assessment-unity/.
//
// URL is intentionally RELATIVE (no leading slash) so the iframe resolves
// correctly under any Pages base path.

export const BEHAVERSE_RUNTIME_URL = 'assessment-unity';

// Tells Unity to skip its Loading→Debug-menu scene transition.
const SKIP_DEBUG_MENU = true;

export function buildBehaverseIframeSrc(): string {
  const params = new URLSearchParams();
  if (SKIP_DEBUG_MENU) params.set('skipDebugMenu', '1');
  const qs = params.toString();
  return `${BEHAVERSE_RUNTIME_URL}/index.html${qs ? `?${qs}` : ''}`;
}
