import type { Plugin } from 'vite';

export function claudeProxyPlugin(options?: {
  route?: string;
  binary?: string;
  timeoutMs?: number;
}): Plugin;
