/** Suppresses the diagram-js 15 / bpmn-js 18 `ContextPad#getPad is deprecated` warning; remove once bpmn-io/diagram-js#888 ships. */
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
