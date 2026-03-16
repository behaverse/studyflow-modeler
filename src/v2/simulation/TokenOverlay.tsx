/**
 * React overlay that renders animated tokens on the React Flow canvas.
 * Uses the useViewport hook to transform token positions from flow
 * coordinates to screen coordinates.
 */
import { memo } from 'react';
import { useViewport } from '@xyflow/react';
import type { SimToken } from './useTokenSimulation';

const TOKEN_RADIUS = 8;

function TokenOverlayInner({ tokens }: { tokens: SimToken[] }) {
  const { x: vpX, y: vpY, zoom } = useViewport();

  if (tokens.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
      style={{ width: '100%', height: '100%' }}
    >
      <defs>
        <style>{`
          @keyframes token-bounce {
            0%   { transform: translateY(0); }
            100% { transform: translateY(-8px); }
          }
        `}</style>
      </defs>
      {tokens.map((token) => {
        const screenX = token.cx * zoom + vpX;
        const screenY = token.cy * zoom + vpY;
        const r = TOKEN_RADIUS * zoom;

        return (
          <circle
            key={token.id}
            cx={screenX}
            cy={screenY}
            r={r}
            fill={token.color}
            opacity={token.opacity}
            style={{
              transition: token.opacity < 1 ? 'opacity 0.4s, transform 0.35s' : undefined,
              transform: token.scale !== 1 ? `scale(${token.scale})` : undefined,
              transformOrigin: `${screenX}px ${screenY}px`,
              animation: token.bouncing
                ? 'token-bounce 0.5s ease-in-out infinite alternate'
                : undefined,
              filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))',
            }}
          />
        );
      })}
    </svg>
  );
}

export const TokenOverlay = memo(TokenOverlayInner);
