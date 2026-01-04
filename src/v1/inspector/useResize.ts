import { useState, useRef, useCallback, useEffect } from 'react';

interface UseResizeOptions {
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  storageKey?: string;
}

export function useResize({
  defaultWidth = 400,
  minWidth = 200,
  maxWidth = 800,
  storageKey = 'inspectorWidth'
}: UseResizeOptions = {}) {
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) return parseInt(saved, 10);
    }
    return defaultWidth;
  });

  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startWidth: width
    };
    e.preventDefault();
  }, [width]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeRef.current) return;

    const delta = resizeRef.current.startX - e.clientX;
    const newWidth = Math.max(minWidth, Math.min(maxWidth, resizeRef.current.startWidth + delta));
    setWidth(newWidth);

    if (storageKey) {
      localStorage.setItem(storageKey, newWidth.toString());
    }
  }, [isResizing, minWidth, maxWidth, storageKey]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    resizeRef.current = null;
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return {
    width,
    isResizing,
    handleResizeMouseDown
  };
}
