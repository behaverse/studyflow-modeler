/**
 * HACK Silence the `ContextPad#getPad is deprecated` warning produced by
 * diagram-js 15.x when used through bpmn-js 18.x. The warning will stop once
 * bpmn-js ships a fix; track progress at
 * https://github.com/bpmn-io/diagram-js/pull/888
 *
 * Wraps `contextPad.getPad` so that any `console.warn` invoked during the
 * original call is filtered to drop the deprecation message. Everything else
 * still logs normally.
 */
export function silenceGetPadDeprecationWarning(contextPad: { getPad?: (target: any) => any }): void {
  if (typeof contextPad.getPad !== 'function') return;

  const originalGetPad = contextPad.getPad.bind(contextPad);
  contextPad.getPad = function (target: any) {
    const originalWarn = console.warn;
    console.warn = (...args: any[]) => {
      if (args[0]?.message?.includes?.('ContextPad#getPad is deprecated')) return;
      originalWarn.apply(console, args);
    };
    try {
      return originalGetPad(target);
    } finally {
      console.warn = originalWarn;
    }
  };
}
