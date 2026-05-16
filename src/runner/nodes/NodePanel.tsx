import type { ReactNode } from 'react';
import { nodeStyles } from './styles';

/** Shared card wrapper for non-fullscreen runner nodes (Behaverse uses its own iframe layout). */
export function NodePanel({ children }: { children: ReactNode }) {
  return (
    <div className={nodeStyles.card}>
      <div className={nodeStyles.panel}>{children}</div>
    </div>
  );
}
