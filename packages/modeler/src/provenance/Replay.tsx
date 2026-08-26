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
import { border, radius, shadow, surface } from '@modeler/ui/styles';
import { getEditorPort } from '@modeler/editor/bpmnAdapter';
import type { EditorElements, EditorPort, EditorView } from '@modeler/editor/port';
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

/** An element the editor knows for this record: its own scope, or the flow its `what` mentions. */
function elementsOf(record: ProvenanceRecord, elements: EditorElements): any[] {
  const found: any[] = [];
  if (!record.isDocument && elements.get(record.scopeId)) found.push(elements.get(record.scopeId));
  // `what` is a flow id on gateway decisions, a timestamp elsewhere; only the former resolves.
  if (record.what && elements.get(record.what)) found.push(elements.get(record.what));
  return found;
}

function resetSvgStyles(view: EditorView): void {
  const svg = view.getContainer()?.querySelector('svg');
  if (!svg) return;
  svg.style.transition = '';
  svg.style.transform = '';
  svg.style.opacity = '';
}

/** Dim the canvas, light up elements as their records land, and float a token on the active one. */
function useReplayHighlights(editor: EditorPort, shown: ProvenanceRecord[]): void {
  const marked = useRef<Array<[string, string]>>([]);
  const tokenRef = useRef<any>(null);
  const tokenPos = useRef<{ x: number; y: number; elId: string; rootId?: string } | null>(null);
  const glideFrame = useRef<number | null>(null);
  const planeShift = useRef<number | null>(null);

  useEffect(() => {
    const { view, elements } = editor;
    view.getContainer()?.classList.add('replay-active');
    return () => {
      view.getContainer()?.classList.remove('replay-active');
      for (const [id, m] of marked.current) if (elements.get(id)) view.removeMarker(id, m);
      marked.current = [];
      if (glideFrame.current) cancelAnimationFrame(glideFrame.current);
      glideFrame.current = null;
      if (planeShift.current) clearTimeout(planeShift.current);
      planeShift.current = null;
      resetSvgStyles(view);
      tokenPos.current = null;
      tokenRef.current?.remove();
      tokenRef.current = null;
    };
  }, [editor]);

  useEffect(() => {
    const { view, elements: registry } = editor;

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

    for (const [id, m] of marked.current) if (registry.get(id)) view.removeMarker(id, m);
    marked.current = [];
    const add = (id: string, m: string) => {
      if (!registry.get(id)) return;
      view.addMarker(id, m);
      marked.current.push([id, m]);
    };
    for (const id of touched) add(id, 'replay-touched');
    for (const [id, r] of newest) if (r.invalidated) add(id, 'replay-voided');

    // The token: a pulsing circle on the element the newest record activates or mentions.
    const current = shown[shown.length - 1];
    const target = current ? elementsOf(current, registry).find((el) => el.width) : undefined;
    const layer = view.getLayer('provenance-replay', 1000);
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
      resetSvgStyles(view);
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
    const rootId = registry.findRoot(target)?.id;
    const from = tokenPos.current;

    // The follow-camera: center a point at a comfortable zoom, keeping the user's own zoom when it is already readable.
    const camera = (center: Point) => {
      const vb = view.viewbox();
      const scale = Math.min(1.3, Math.max(0.6, vb.scale));
      const width = vb.outer.width / scale;
      const height = vb.outer.height / scale;
      return { x: center.x - width / 2, y: center.y - height / 2, width, height };
    };

    // A glide only makes sense within one plane: the first step lands directly, and a plane
    // change dives, the old context zooming away while the new one settles in.
    if (!from || from.rootId !== rootId) {
      const place = () => {
        setPos(to, target.id, rootId);
        try { view.scrollToElement(target, 80); } catch { /* off-root elements can decline */ }
        view.setViewbox(camera(to));
      };
      const svg = view.getContainer()?.querySelector('svg');
      if (!from || !svg) {
        place();
        return;
      }
      // The doorway: the collapsed shape being entered (on the old plane), or the shape the old
      // plane belongs to (on the new one); the camera flies through it, so the move is visible.
      const shapeOf = (root: any) => (root?.businessObject?.id ? registry.get(root.businessObject.id) : undefined);
      const oldRoot = registry.root();
      const newRoot = registry.findRoot(target);
      const doorIn = shapeOf(newRoot);
      const doorOut = shapeOf(oldRoot);
      const inward = !!doorIn && registry.findRoot(doorIn) === oldRoot;
      const outward = !inward && !!doorOut && registry.findRoot(doorOut) === newRoot;
      const doorway = (shape: any) => {
        const vb = view.viewbox();
        const scale = Math.min(3, vb.outer.width / (shape.width * 1.5), vb.outer.height / (shape.height * 1.5));
        const width = vb.outer.width / scale;
        const height = vb.outer.height / scale;
        return { x: shape.x + shape.width / 2 - width / 2, y: shape.y + shape.height / 2 - height / 2, width, height };
      };
      const fly = (dest: any, ms: number, fade: 'out' | 'in', then?: () => void) => {
        const vb0 = view.viewbox();
        const start = performance.now();
        const frame = (now: number) => {
          const t = Math.min((now - start) / ms, 1);
          const eased = smootherstep(t);
          view.setViewbox({
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
        // Fly into the collapsed shape, fading out, then surface inside its plane.
        fly(doorway(doorIn), 420, 'out', () => {
          place();
          svg.style.transition = 'none';
          svg.style.transform = 'scale(0.92)';
          svg.style.transformOrigin = '50% 50%';
          // A forced reflow commits the pose, so the settle transitions from it; no
          // `requestAnimationFrame` here: it starves in hidden tabs, freezing the dive midway.
          void svg.getBoundingClientRect();
          svg.style.transition = 'opacity 300ms ease-out, transform 300ms ease-out';
          svg.style.opacity = '1';
          svg.style.transform = 'scale(1)';
          planeShift.current = window.setTimeout(() => {
            resetSvgStyles(view);
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
          try { view.scrollToElement(target, 80); } catch { /* off-root elements can decline */ }
          const dest = camera(to);
          view.setViewbox(doorway(doorOut));
          svg.style.transition = 'none';
          fly(dest, 420, 'in', () => resetSvgStyles(view));
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
          resetSvgStyles(view);
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
    const vb0 = view.viewbox();
    const dest = camera(to);
    const frame = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = smootherstep(t);
      setPos(samplePolyline(points, segLengths, eased * totalDist), target.id, rootId);
      view.setViewbox({
        x: vb0.x + (dest.x - vb0.x) * eased,
        y: vb0.y + (dest.y - vb0.y) * eased,
        width: vb0.width + (dest.width - vb0.width) * eased,
        height: vb0.height + (dest.height - vb0.height) * eased,
      });
      glideFrame.current = t < 1 ? requestAnimationFrame(frame) : null;
    };
    glideFrame.current = requestAnimationFrame(frame);
  }, [editor, shown]);
}

type Props = { onClose: () => void };

const scopeName = (r: ProvenanceRecord) =>
  (r.isDocument ? (r.action === 'executed' ? r.scopeId : 'document') : r.scopeId);

export function ReplayPanel({ onClose }: Props) {
  const editor = getEditorPort(useRequiredModeler());
  // `importXML` fires no `commandStack.changed`, so we bump a separate version to force a new timeline when the document changes.
  const [docVersion, bumpDocVersion] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.events.on('import.done', bumpDocVersion);
    return () => editor.events.off('import.done', bumpDocVersion);
  }, [editor]);
  return <ReplayTimeline key={docVersion} onClose={onClose} />;
}

function ReplayTimeline({ onClose }: Props) {
  const editor = getEditorPort(useRequiredModeler());
  const [revision, bumpRevision] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    editor.events.on('commandStack.changed', bumpRevision);
    return () => editor.events.off('commandStack.changed', bumpRevision);
  }, [editor]);

  const records = useMemo(
    () => collectProvenance(editor.getDefinitions()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `revision` stands in for the document
    [editor, revision],
  );
  const total = records.length;

  const trail = useMemo(() => {
    const clones = applyStatuses(records.map((r) => ({ ...r })));
    const graph = assignLanes(displayOrder([...clones]));
    return clones.map((r) => ({ record: r, lane: graph.get(r)?.lane ?? 0 }));
  }, [records]);

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
  useReplayHighlights(editor, shown);

  const jump = (to: number) => {
    setPlaying(false);
    setCursor(Math.min(Math.max(to, 0), total));
  };
  const step = (delta: number) => jump(at + delta);
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (at >= total) setCursor(0);
    setPlaying(true);
  };

  // Scrubbing: a press or drag anywhere on the track lands the playhead on the nearest step.
  const trackRef = useRef<HTMLDivElement>(null);
  const scrub = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect) jump(Math.round(((clientX - rect.left) / rect.width) * total));
  };

  // The animation-tool staples: space plays, arrows step, Home/End jump to the ends.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return;
      const acts: Record<string, () => void> = {
        ' ': togglePlay,
        ArrowLeft: () => step(-1),
        ArrowRight: () => step(1),
        Home: () => jump(0),
        End: () => jump(total),
      };
      if (!acts[e.key]) return;
      e.preventDefault();
      acts[e.key]();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Each document-level `executed` stamp is one run of the study, matching the Provenance dialog.
  const runs = shown.filter((r) => r.isDocument && r.action === 'executed').length;
  const btn = 'flex items-center justify-center size-7 rounded-md text-stone-500 enabled:hover:text-stone-900 enabled:hover:bg-black/[0.05] enabled:cursor-pointer disabled:opacity-30 transition-colors';
  const frac = (n: number) => `${(n / Math.max(total, 1)) * 100}%`;

  return (
    <div className="fixed bottom-2 inset-x-2 z-[220]" data-testid="provenance-replay">
      <div className={`${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panelFlat} text-stone-900 px-3 py-2`}>
        <div className="flex items-center gap-1">
          <h1
            className="text-[15px] font-semibold text-stone-900 tracking-tight pr-2"
            title="Elements light up as their records land; the token marks the active step, colored by branch"
          >
            Replay
          </h1>
          {total === 0 ? (
            <p className="flex-1 text-sm text-stone-500 italic">No provenance yet.</p>
          ) : (
            <>
              <button type="button" onClick={() => jump(0)} disabled={at <= 0} className={btn} title="Start" aria-label="Jump to start">
                <i className={`${ICONS.skipStart} size-4 block`} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => step(-1)} disabled={at <= 0} className={btn} title="Back" aria-label="Step back">
                <i className={`${ICONS.chevronLeft} size-4 block`} aria-hidden="true" />
              </button>
              <button type="button" onClick={togglePlay} className={btn} title={playing ? 'Pause (space)' : 'Play the timeline'} aria-label={playing ? 'Pause' : 'Play'}>
                <i className={`${playing ? ICONS.pause : ICONS.playFill} size-4 block`} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => step(1)} disabled={at >= total} className={btn} title="Forward" aria-label="Step forward">
                <i className={`${ICONS.chevronRight} size-4 block`} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => jump(total)} disabled={at >= total} className={btn} title="End" aria-label="Jump to end">
                <i className={`${ICONS.skipEnd} size-4 block`} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
                className="px-1.5 py-0.5 rounded-md text-[11px] font-mono text-stone-500 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer transition-colors"
                title="Speed"
                aria-label={`Speed ${SPEEDS[speedIdx].label}`}
              >
                {SPEEDS[speedIdx].label}
              </button>
              <span className="w-px h-4 bg-black/10 mx-1.5 shrink-0" aria-hidden="true" />
              {current ? (
                <div className="flex items-center gap-2.5 flex-1 min-w-0 overflow-hidden whitespace-nowrap">
                  {current.icon && <i className={`${current.icon} size-3.5 shrink-0 text-stone-500`} aria-hidden="true" />}
                  <span className={`text-sm font-semibold shrink-0 ${current.action === 'invalidated' ? 'text-red-600' : 'text-stone-900'}`}>{current.action}</span>
                  <span className="text-[11px] font-mono text-stone-500 truncate max-w-[14rem]" title={current.isDocument ? current.scopeId : current.scopeLabel}>
                    {scopeName(current)}
                  </span>
                  {recordDetails(current).map(([label, value]) => (
                    <span key={label} className="inline-flex items-center gap-1 min-w-0 text-[11px] font-mono text-stone-500" title={`${label}: ${value}`}>
                      <i className={`${DETAIL_ICONS[label] ?? ICONS.threeDots} size-3 shrink-0 text-stone-400`} aria-hidden="true" />
                      <span className="truncate max-w-[10rem]">{value}</span>
                    </span>
                  ))}
                  <span className="text-[11px] font-mono text-stone-400 shrink-0" title={current.when}>{shortWhen(current.when) ?? '—'}</span>
                  {current.note && <span className="text-xs italic text-stone-500 truncate min-w-0" title={current.note}>{current.note}</span>}
                </div>
              ) : (
                <p className="flex-1 text-xs text-stone-500 italic">Before the first record.</p>
              )}
              {runs > 0 && (
                <span className="text-[11px] text-stone-400 whitespace-nowrap shrink-0">
                  <strong className="text-stone-500">{runs}</strong> {runs === 1 ? 'run' : 'runs'}
                </span>
              )}
              <span className="text-[11px] font-mono text-stone-400 whitespace-nowrap shrink-0 pl-1">{at}/{total}</span>
            </>
          )}
          <button type="button" onClick={onClose} className={btn} title="Stop the replay and bring the inspector back" aria-label="Close replay">
            <i className={`${ICONS.close} size-3.5 block`} aria-hidden="true" />
          </button>
        </div>
        {total > 0 && (
          <div
            ref={trackRef}
            className="relative h-9 mt-1 cursor-ew-resize touch-none select-none"
            role="slider"
            tabIndex={0}
            aria-label="Replay position"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={at}
            aria-valuetext={current ? `${at} of ${total}: ${current.action} ${scopeName(current)}` : `0 of ${total}`}
            title="Scrub through the timeline as of any moment"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX); }}
            onPointerMove={(e) => { if (e.buttons & 1) scrub(e.clientX); }}
          >
            <div className="absolute inset-x-0 top-1/2 h-px bg-black/10" aria-hidden="true" />
            <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-stone-400/40" style={{ left: 0, width: frac(at) }} aria-hidden="true" />
            {trail.map(({ record: r, lane }, i) => {
              // Run stamps read as tall section marks, invalidation markers as red, the rest by lane.
              const stamp = r.isDocument && r.action === 'executed';
              const color = r.action === 'invalidated' ? '#ef4444' : LANE_COLORS[lane % LANE_COLORS.length];
              return (
                <span
                  key={i}
                  className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity ${stamp ? 'w-[5px] h-5' : 'w-[3px] h-2.5'} ${i < at ? '' : 'opacity-25'}`}
                  style={{ left: frac(i + 1), backgroundColor: color }}
                  title={`${i + 1}/${total} · ${r.action} ${scopeName(r)} — ${shortWhen(r.when) ?? '—'}`}
                />
              );
            })}
            {/* No `left` transition */}
            <div
              className="absolute top-0 bottom-0 -translate-x-1/2 pointer-events-none"
              style={{ left: frac(at) }}
              aria-hidden="true"
            >
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] rounded-full bg-stone-900" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 size-2 rounded-[2px] rotate-45 bg-stone-900" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
