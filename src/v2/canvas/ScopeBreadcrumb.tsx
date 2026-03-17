import { useModelerStore } from '../store';

/**
 * Canvas overlay breadcrumb shown when drilling into a sub-process.
 * Displays "Process > SubProcessName" and lets the user navigate back up.
 */
export function ScopeBreadcrumb() {
  const scopeStack = useModelerStore((s) => s.scopeStack);
  const exitScope = useModelerStore((s) => s.exitScope);

  if (scopeStack.length === 0) return null;

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-black/60 backdrop-blur-sm text-stone-200 text-xs rounded-full px-3 py-1.5 shadow-lg border border-white/10">
      {/* Root link */}
      <button
        className="hover:text-white transition-colors"
        onClick={() => {
          // Exit all scopes back to root
          const depth = scopeStack.length;
          for (let i = 0; i < depth; i++) exitScope();
        }}
      >
        Process
      </button>

      {scopeStack.map((entry, idx) => {
        const isLast = idx === scopeStack.length - 1;
        return (
          <span key={entry.id} className="flex items-center gap-1">
            <i className="bi bi-chevron-right text-stone-500 text-[10px]" />
            {isLast ? (
              <span className="text-white font-semibold">{entry.name}</span>
            ) : (
              <button
                className="hover:text-white transition-colors"
                onClick={() => {
                  // Exit scopes until this entry is on top
                  const stepsToExit = scopeStack.length - 1 - idx;
                  for (let i = 0; i < stepsToExit; i++) exitScope();
                }}
              >
                {entry.name}
              </button>
            )}
          </span>
        );
      })}

      {/* Escape shortcut hint */}
      <span className="ml-2 text-stone-500 border border-stone-600 rounded px-1 text-[10px]">
        Esc
      </span>
    </div>
  );
}
