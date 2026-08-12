import type { ReactNode } from 'react';
import { nodeStyles } from '@runner/nodes/styles';

export function NodePanel({ children }: { children: ReactNode }) {
  return (
    <div className={nodeStyles.card}>
      <div className={nodeStyles.panel}>{children}</div>
    </div>
  );
}
