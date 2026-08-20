import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRequiredModeler } from '@modeler/app/useModeler';
import {
  applyStatuses,
  assignLanes,
  collectProvenance,
  displayOrder,
  recordDetails,
  type ProvenanceRecord,
} from '@modeler/provenance/records';
import { shortWhen } from '@modeler/provenance/Provenance';
import {
  computeSegLengths,
  samplePolyline,
  smootherstep,
  type Point,
} from '@modeler/simulation/TokenSimulator';
import { inspector as insp } from '@modeler/inspector/styles';
import { ICONS } from '@modeler/icons';

const SPEEDS = [
  { label: '½×', ms: 1600 },
  { label: '1×', ms: 800 },
  { label: '2×', ms: 400 },
];

// One color per branch lane, the hex twins of the Provenance dialog's `LANES` dot classes.
const LANE_COLORS = ['#a8a29e', '#8b5cf6', '#0ea5e9', '#f59e0b', '#10b981'];

// Icons standing in for the `recordDetails` labels, matching the Provenance dialog.
const DETAIL_ICONS: Record<string, string> = {
  who: ICONS.person,
  with: ICONS.cog,
  run: ICONS.play,
  seed: ICONS.asterisk,
  what: ICONS.script,
};

/** An element the registry knows for this record: its own scope, or the flow its `what` mentions. */
function elementsOf(record: ProvenanceRecord, registry: any): any[] {
  const found: any[] = [];
  if (!record.isDocument && registry.get(record.scopeId)) found.push(registry.get(record.scopeId));
  // `what` is a flow id on gateway decisions, a timestamp elsewhere — only the former resolves.
  if (record.what && registry.get(record.what)) found.push(registry.get(record.what));
  return found;
}

function resetSvgStyles(canvas: any): void {
  const svg = canvas?.getContainer?.()?.querySelector('svg');
  if (!svg) return;
  svg.style.transition = '';
  svg.style.transform = '';
  svg.style.opacity = '';
}

/** Dim the canvas, light up elements as their records land, and float a token on the active one. */
function useReplayHighlights(modeler: any, shown: ProvenanceRecord[]): void {
  const marked = useRef<Array<[string, string]>>([]);
  const tokenRef = useRef<any>(null);
  const tokenPos = useRef<{ x: number; y: number; elId: string; rootId?: string } | null>(null);
  const glideFrame = useRef<number | null>(null);
  const planeShift = useRef<number | null>(null);

  useEffect(() => {
    const canvas = modeler?.get?.('canvas', false);
    if (!canvas) return undefined;
    canvas.getContainer()?.classList.add('replay-active');
    return () => {
      canvas.getContainer()?.classList.remove('replay-active');
      const registry = modeler.get('elementRegistry', false);
      for (const [id, m] of marked.current) if (registry?.get(id)) canvas.removeMarker(id, m);
      marked.current = [];
      if (glideFrame.current) cancelAnimationFrame(glideFrame.current);
      glideFrame.current = null;
      if (planeShift.current) clearTimeout(planeShift.current);
      planeShift.current = null;
      resetSvgStyles(canvas);
      tokenPos.current = null;
      tokenRef.current?.remove();
      tokenRef.current = null;
    };
  }, [modeler]);

  useEffect(() => {
    const canvas = modeler?.get?.('canvas', false);
    const registry = modeler?.get?.('elementRegistry', false);
    if (!canvas || !registry) return;

    const touched = new Set<string>();
    const newest = new Map<string, ProvenanceRecord>();
    for (const r of shown) {
      for (const el of elementsOf(r, registry)) {
        touched.add(el.id);
        if (el.label?.id) touched.add(el.label.id);
      }
      if (!r.isDocument && r.action === 'executed') newest.set(r.scopeId, r);
    }
    // A flow between two lit elements is part of the story even when no record names it.
    for (const conn of registry.filter((el: any) => el.waypoints && el.source && el.target)) {
      if (touched.has(conn.source.id) && touched.has(conn.target.id)) touched.add(conn.id);
    }

    for (const [id, m] of marked.current) if (registry.get(id)) canvas.removeMarker(id, m);
    marked.current = [];
    const add = (id: string, m: string) => {
      if (!registry.get(id)) return;
      canvas.addMarker(id, m);
      marked.current.push([id, m]);
    };
    for (const id of touched) add(id, 'replay-touched');
    for (const [id, r] of newest) if (r.invalidated) add(id, 'replay-voided');

    // The token: a pulsing circle on the element the newest record activates or mentions.
    const current = shown[shown.length - 1];
    const target = current ? elementsOf(current, registry).find((el) => el.width) : undefined;
    const layer = canvas.getLayer('provenance-replay', 1000);
    if (!tokenRef.current) {
      tokenRef.current = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      tokenRef.current.setAttribute('r', '8');
      tokenRef.current.setAttribute('class', 'studyflow-replay-token');
    }
    const token = tokenRef.current;
    if (token.parentNode !== layer) layer.appendChild(token);
    // The token wears its branch's lane color; document run stamps switch it as a new branch starts.
    const lane = current ? assignLanes(displayOrder([...shown])).get(current)?.lane ?? 0 : 0;
    token.style.fill = LANE_COLORS[lane % LANE_COLORS.length];

    const setPos = (p: Point, elId: string, rootId?: string) => {
      token.setAttribute('cx', String(p.x));
      token.setAttribute('cy', String(p.y));
      tokenPos.current = { x: p.x, y: p.y, elId, rootId };
    };
    if (glideFrame.current) cancelAnimationFrame(glideFrame.current);
    glideFrame.current = null;
    // An interrupted plane dive snaps visible; its pending placement is superseded by this step.
    if (planeShift.current) {
      clearTimeout(planeShift.current);
      planeShift.current = null;
      resetSvgStyles(canvas);
    }

    if (!target) {
      // A document record moves nothing: the token idles, dimmed, where the last step left it.
      if (tokenPos.current) token.style.opacity = '0.35';
      else token.style.display = 'none';
      return;
    }
    token.style.display = '';
    token.style.opacity = '';
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const rootId = canvas.findRoot?.(target)?.id;
    const from = tokenPos.current;

    // The follow-camera: the viewbox that centers a point at a comfortable zoom, keeping the
    // user's own zoom when it is already in a readable band.
    const camera = (center: Point) => {
      const vb = canvas.viewbox();
      const scale = Math.min(1.3, Math.max(0.6, vb.scale));
      const width = vb.outer.width / scale;
      const height = vb.outer.height / scale;
      return { x: center.x - width / 2, y: center.y - height / 2, width, height };
    };

    // A glide only makes sense within one plane: the first step lands directly, and a plane
    // change dives — the old context zooms away while the new one settles in.
    if (!from || from.rootId !== rootId) {
      const place = () => {
        setPos(to, target.id, rootId);
        try { canvas.scrollToElement(target, 80); } catch { /* off-root elements can decline */ }
        canvas.viewbox(camera(to));
      };
      const svg = canvas.getContainer()?.querySelector('svg');
      if (!from || !svg) {
        place();
        return;
      }
      // The doorway: the collapsed shape being entered (on the old plane), or the shape the old
      // plane belongs to (on the new one) — the camera flies through it, so the move is visible.
      const shapeOf = (root: any) => (root?.businessObject?.id ? registry.get(root.businessObject.id) : undefined);
      const oldRoot = canvas.getRootElement?.();
      const newRoot = canvas.findRoot?.(target);
      const doorIn = shapeOf(newRoot);
      const doorOut = shapeOf(oldRoot);
      const inward = !!doorIn && canvas.findRoot?.(doorIn) === oldRoot;
      const outward = !inward && !!doorOut && canvas.findRoot?.(doorOut) === newRoot;
      const doorway = (shape: any) => {
        const vb = canvas.viewbox();
        const scale = Math.min(3, vb.outer.width / (shape.width * 1.5), vb.outer.height / (shape.height * 1.5));
        const width = vb.outer.width / scale;
        const height = vb.outer.height / scale;
        return { x: shape.x + shape.width / 2 - width / 2, y: shape.y + shape.height / 2 - height / 2, width, height };
      };
      const fly = (dest: any, ms: number, fade: 'out' | 'in', then?: () => void) => {
        const vb0 = canvas.viewbox();
        const start = performance.now();
        const frame = (now: number) => {
          const t = Math.min((now - start) / ms, 1);
          const eased = smootherstep(t);
          canvas.viewbox({
            x: vb0.x + (dest.x - vb0.x) * eased,
            y: vb0.y + (dest.y - vb0.y) * eased,
            width: vb0.width + (dest.width - vb0.width) * eased,
            height: vb0.height + (dest.height - vb0.height) * eased,
          });
          svg.style.opacity = String(fade === 'out' ? 1 - eased : eased);
          if (t < 1) glideFrame.current = requestAnimationFrame(frame);
          else { glideFrame.current = null; then?.(); }
        };
        glideFrame.current = requestAnimationFrame(frame);
      };

      if (inward) {
        // Fly into the collapsed shape, fading out — then surface inside its plane.
        fly(doorway(doorIn), 420, 'out', () => {
          place();
          svg.style.transition = 'none';
          svg.style.transform = 'scale(0.92)';
          svg.style.transformOrigin = '50% 50%';
          // A forced reflow commits the pose, so the settle transitions from it — no
          // `requestAnimationFrame` here: it starves in hidden tabs, freezing the dive midway.
          void svg.getBoundingClientRect();
          svg.style.transition = 'opacity 300ms ease-out, transform 300ms ease-out';
          svg.style.opacity = '1';
          svg.style.transform = 'scale(1)';
          planeShift.current = window.setTimeout(() => {
            resetSvgStyles(canvas);
            planeShift.current = null;
          }, 320);
        });
        return;
      }
      if (outward) {
        // Quick fade, then pull back out of the shape the plane belonged to.
        svg.style.transition = 'opacity 160ms ease-in';
        svg.style.opacity = '0';
        planeShift.current = window.setTimeout(() => {
          planeShift.current = null;
          setPos(to, target.id, rootId);
          try { canvas.scrollToElement(target, 80); } catch { /* off-root elements can decline */ }
          const dest = camera(to);
          canvas.viewbox(doorway(doorOut));
          svg.style.transition = 'none';
          fly(dest, 420, 'in', () => resetSvgStyles(canvas));
        }, 170);
        return;
      }
      // No doorway to fly through (a sibling plane, say): a plain crossfade.
      svg.style.transition = 'opacity 200ms ease-in';
      svg.style.opacity = '0';
      planeShift.current = window.setTimeout(() => {
        place();
        svg.style.transition = 'none';
        void svg.getBoundingClientRect();
        svg.style.transition = 'opacity 280ms ease-out';
        svg.style.opacity = '1';
        planeShift.current = window.setTimeout(() => {
          resetSvgStyles(canvas);
          planeShift.current = null;
        }, 300);
      }, 210);
      return;
    }
    if (from.x === to.x && from.y === to.y) return;
    // Follow the sequence flow when one directly links the two steps, either way around.
    const fromEl = registry.get(from.elId);
    const flow = registry.filter((el: any) => el.waypoints
      && ((el.source === fromEl && el.target === target) || (el.source === target && el.target === fromEl)))[0];
    const waypoints: Point[] = (flow?.waypoints ?? []).map((wp: any) => ({ x: wp.x, y: wp.y }));
    if (flow?.source === target) waypoints.reverse();
    const points = [{ x: from.x, y: from.y }, ...waypoints, to].filter((p, i, all) =>
      i === 0 || Math.abs(p.x - all[i - 1].x) > 0.5 || Math.abs(p.y - all[i - 1].y) > 0.5);
    const { segLengths, totalDist } = computeSegLengths(points);
    const duration = Math.min(450, Math.max(200, totalDist / 0.7));
    const start = performance.now();
    const vb0 = canvas.viewbox();
    const dest = camera(to);
    const frame = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = smootherstep(t);
      setPos(samplePolyline(points, segLengths, eased * totalDist), target.id, rootId);
      canvas.viewbox({
        x: vb0.x + (dest.x - vb0.x) * eased,
        y: vb0.y + (dest.y - vb0.y) * eased,
        width: vb0.width + (dest.width - vb0.width) * eased,
        height: vb0.height + (dest.height - vb0.height) * eased,
      });
      glideFrame.current = t < 1 ? requestAnimationFrame(frame) : null;
    };
    glideFrame.current = requestAnimationFrame(frame);
  }, [modeler, shown]);
}

type Props = { onClose: () => void };

export function ReplayPanel({ onClose }: Props) {
  const modeler = useRequiredModeler();
  const [revision, bumpRevision] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const eventBus = modeler?.get?.('eventBus', false);
    if (!eventBus) return undefined;
    eventBus.on('commandStack.changed', bumpRevision);
    return () => eventBus.off('commandStack.changed', bumpRevision);
  }, [modeler]);

  const records = useMemo(
    () => collectProvenance(modeler?.getDefinitions?.()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision` stands in for the document
    [modeler, revision],
  );
  const total = records.length;

  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(1);
  const at = Math.min(cursor, total);
  useEffect(() => {
    if (!playing) return undefined;
    const id = setTimeout(() => {
      if (at >= total) setPlaying(false);
      else setCursor(at + 1);
    }, SPEEDS[speedIdx].ms);
    return () => clearTimeout(id);
  }, [playing, at, total, speedIdx]);

  // Clones per step: `applyStatuses` re-derives the as-of-this-moment flags without touching the originals.
  const shown = applyStatuses(records.slice(0, at).map((r) => ({ ...r })));
  const current = shown[shown.length - 1];
  useReplayHighlights(modeler, shown);

  const step = (delta: number) => {
    setPlaying(false);
    setCursor(Math.min(Math.max(at + delta, 0), total));
  };
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (at >= total) setCursor(0);
    setPlaying(true);
  };

  // Each document-level `executed` stamp is one run of the study, matching the Provenance dialog.
  const runs = shown.filter((r) => r.isDocument && r.action === 'executed').length;
  const btn = 'flex items-center justify-center size-7 rounded-md text-stone-500 enabled:hover:text-stone-900 enabled:hover:bg-black/[0.05] enabled:cursor-pointer disabled:opacity-30 transition-colors';

  return (
    <div className="fixed top-2 right-2 z-[220]" data-testid="provenance-replay">
      <div className={insp.panel} style={{ width: 300 }}>
        <div className="flex items-center gap-1 p-2 pb-1">
          <h1 className="text-[15px] font-semibold text-stone-900 tracking-tight">Replay</h1>
          <span className="flex-1" aria-hidden="true" />
          <button type="button" onClick={onClose} className={btn} title="Stop the replay and bring the inspector back" aria-label="Close replay">
            <i className={`${ICONS.close} size-3.5 block`} aria-hidden="true" />
          </button>
        </div>
        {total === 0 ? (
          <p className="px-2 pb-3 text-sm text-stone-500 italic">No provenance yet — nothing to replay.</p>
        ) : (
          <div className="px-2 pb-2 space-y-2">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => step(-1)} disabled={at <= 0} className={btn} title="One record back" aria-label="Step back">
                <i className={`${ICONS.chevronLeft} size-4 block`} aria-hidden="true" />
              </button>
              <button type="button" onClick={togglePlay} className={btn} title={playing ? 'Pause' : 'Play the trail in order'} aria-label={playing ? 'Pause replay' : 'Play replay'}>
                <i className={`${playing ? ICONS.pause : ICONS.playFill} size-4 block`} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => step(1)} disabled={at >= total} className={btn} title="One record forward" aria-label="Step forward">
                <i className={`${ICONS.chevronRight} size-4 block`} aria-hidden="true" />
              </button>
              <span className="flex-1" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
                className="px-1.5 py-0.5 rounded-md text-[11px] font-mono text-stone-500 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer transition-colors"
                title="Playback speed"
                aria-label={`Playback speed ${SPEEDS[speedIdx].label}`}
              >
                {SPEEDS[speedIdx].label}
              </button>
              <span className="text-[11px] font-mono text-stone-400 whitespace-nowrap">{at}/{total}</span>
            </div>
            <input
              type="range"
              min={0}
              max={total}
              step={1}
              value={at}
              onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
              className="w-full accent-stone-500 cursor-pointer"
              aria-label="Replay position"
              title="Scrub through the trail as of any moment"
            />
            {current ? (
              <div className="rounded-lg bg-cream-200/70 border border-black/[0.06] p-2 space-y-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  {current.icon && <i className={`${current.icon} size-3.5 shrink-0 text-stone-500`} aria-hidden="true" />}
                  <span className={`text-sm font-semibold ${current.action === 'invalidated' ? 'text-red-600' : 'text-stone-900'}`}>{current.action}</span>
                  <span className="text-[11px] font-mono text-stone-500 truncate" title={current.isDocument ? current.scopeId : current.scopeLabel}>
                    {current.isDocument ? (current.action === 'executed' ? current.scopeId : 'document') : current.scopeId}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  {recordDetails(current).map(([label, value]) => (
                    <span key={label} className="inline-flex items-center gap-1 min-w-0 text-[11px] font-mono text-stone-500" title={`${label}: ${value}`}>
                      <i className={`${DETAIL_ICONS[label] ?? ICONS.threeDots} size-3 shrink-0 text-stone-400`} aria-hidden="true" />
                      <span className="truncate max-w-[10rem]">{value}</span>
                    </span>
                  ))}
                </div>
                <div className="text-[11px] font-mono text-stone-400" title={current.when}>{shortWhen(current.when) ?? '—'}</div>
                {current.note && <p className="text-xs italic text-stone-500">{current.note}</p>}
              </div>
            ) : (
              <p className="text-xs text-stone-500 italic">Before the first record.</p>
            )}
            <p className="text-[11px] text-stone-400">
              {runs > 0 && <><strong className="text-stone-500">{runs}</strong> {runs === 1 ? 'run' : 'runs'} so far · </>}
              elements light up as their records land; the token marks the active step, colored by branch.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
