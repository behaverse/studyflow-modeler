// Relative path so the iframe resolves under any Pages base.
// Dev: vite.config.ts:unityBuildPlugin. Prod: dist/assessment-unity/.
export const BEHAVERSE_RUNTIME_URL = 'assessment-unity';

/** `skipDebugMenu=1` skips Unity's Loading -> Debug-menu transition. */
export function buildBehaverseIframeSrc(): string {
  return `${BEHAVERSE_RUNTIME_URL}/index.html?skipDebugMenu=1`;
}
