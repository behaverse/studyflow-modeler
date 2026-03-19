export function getCanvasZoom(): number {
  const viewport = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport) return 1;
  const match = viewport.style.transform.match(/scale\(([^)]+)\)/);
  return match ? parseFloat(match[1]) : 1;
}

export function createShapeDragImage(bpmnType: string): HTMLElement {
  const z = getCanvasZoom();
  const px = (n: number) => `${Math.round(n * z)}px`;

  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.top = '-9999px';
  el.style.left = '-9999px';
  el.style.pointerEvents = 'none';

  if (bpmnType.includes('Event')) {
    const size = px(36);
    el.style.width = size;
    el.style.height = size;
    el.style.borderRadius = '50%';
    el.style.border = '2px solid #292524';
    el.style.backgroundColor = 'rgba(255,255,255,0.85)';
    return el;
  }

  if (bpmnType.includes('Gateway')) {
    const side = Math.round(50 * z);
    const margin = Math.round(10 * z);
    el.style.width = `${side + margin * 2}px`;
    el.style.height = `${side + margin * 2}px`;
    el.style.position = 'relative';
    const diamond = document.createElement('div');
    diamond.style.position = 'absolute';
    diamond.style.width = `${side}px`;
    diamond.style.height = `${side}px`;
    diamond.style.top = `${margin}px`;
    diamond.style.left = `${margin}px`;
    diamond.style.border = '2px solid #292524';
    diamond.style.backgroundColor = 'white';
    diamond.style.transform = 'rotate(45deg)';
    el.appendChild(diamond);
    return el;
  }

  // Default: Task, Group, and all others — rounded rectangle 100×80
  el.style.width = px(100);
  el.style.height = px(80);
  el.style.borderRadius = '8px';
  el.style.border = bpmnType.includes('Group') ? '2px dashed #a8a29e' : '2px solid #292524';
  el.style.backgroundColor = bpmnType.includes('Group') ? 'transparent' : 'rgba(255,255,255,0.85)';
  return el;
}
