/**
 * Token simulation engine for v2 (React Flow).
 *
 * Ported from v1's TokenSimulator.ts — replaces bpmn-js canvas/SVG
 * manipulation with React state that drives a React overlay component.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';

const TOKEN_SPEED = 200; // pixels per sec
const ACTIVITY_PAUSE_MS = 500;
const SPAWN_INTERVAL_MS = 1000;
const MAX_ACTIVE_TOKENS = 5;

const TOKEN_COLORS = [
  '#e040fb', // pink
  '#00bcd4', // teal
  '#ff9800', // orange
  '#4caf50', // green
  '#2196f3', // blue
];

export interface SimToken {
  id: number;
  color: string;
  cx: number;
  cy: number;
  /** For path interpolation */
  pathPoints: { x: number; y: number }[];
  segLengths: number[];
  totalDist: number;
  travelled: number;
  targetNodeId: string | null;
  paused: boolean;
  pauseRemaining: number;
  done: boolean;
  bouncing: boolean;
  opacity: number;
  scale: number;
}

function smootherstep(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function samplePolyline(
  points: { x: number; y: number }[],
  segLengths: number[],
  dist: number,
) {
  let remaining = dist;
  for (let i = 0; i < segLengths.length; i++) {
    if (remaining <= segLengths[i]) {
      const t = segLengths[i] > 0 ? remaining / segLengths[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    remaining -= segLengths[i];
  }
  return points[points.length - 1];
}

/** Build a lookup from node id → center position + dimensions */
function buildNodeMap(nodes: Node[]) {
  const map = new Map<
    string,
    { cx: number; cy: number; width: number; height: number; bpmnType: string }
  >();
  for (const n of nodes) {
    const w = (n.data?.width as number) ?? (n.style?.width as number) ?? 100;
    const h = (n.data?.height as number) ?? (n.style?.height as number) ?? 80;
    map.set(n.id, {
      cx: n.position.x + w / 2,
      cy: n.position.y + h / 2,
      width: w,
      height: h,
      bpmnType: (n.data?.bpmnType as string) ?? '',
    });
  }
  return map;
}

/** Build adjacency: nodeId → outgoing edge targets with waypoint centers */
function buildAdjacency(edges: Edge[], nodeMap: ReturnType<typeof buildNodeMap>) {
  const adj = new Map<string, { targetId: string; waypoints: { x: number; y: number }[] }[]>();
  for (const e of edges) {
    const targetInfo = nodeMap.get(e.target);
    if (!targetInfo) continue;

    const existing = adj.get(e.source) ?? [];
    // Use edge waypoints from BO if available, otherwise straight line
    const bo = (e.data as any)?.businessObject;
    const rawWaypoints: { x: number; y: number }[] = [];
    if (bo?.di?.waypoint) {
      for (const wp of bo.di.waypoint) {
        rawWaypoints.push({ x: wp.x, y: wp.y });
      }
    }
    existing.push({ targetId: e.target, waypoints: rawWaypoints });
    adj.set(e.source, existing);
  }
  return adj;
}

export function useTokenSimulation(nodes: Node[], edges: Edge[]) {
  const [active, setActive] = useState(false);
  const [tokens, setTokens] = useState<SimToken[]>([]);
  const tokensRef = useRef<SimToken[]>([]);
  const nextIdRef = useRef(0);
  const colorIndexRef = useRef(0);
  const lastTsRef = useRef(0);
  const animRef = useRef<number | null>(null);
  const spawnRef = useRef<number | null>(null);
  const activeRef = useRef(false);

  // Snapshot graph structure into refs so the animation loop doesn't
  // depend on React re-renders
  const nodeMapRef = useRef(buildNodeMap(nodes));
  const adjRef = useRef(buildAdjacency(edges, nodeMapRef.current));

  useEffect(() => {
    nodeMapRef.current = buildNodeMap(nodes);
    adjRef.current = buildAdjacency(edges, nodeMapRef.current);
  }, [nodes, edges]);

  const getStartNodeIds = useCallback(() => {
    return nodes
      .filter((n) => (n.data?.bpmnType as string)?.includes('StartEvent'))
      .map((n) => n.id);
  }, [nodes]);

  const spawnToken = useCallback((nodeId: string) => {
    const info = nodeMapRef.current.get(nodeId);
    if (!info) return;

    const color = TOKEN_COLORS[colorIndexRef.current % TOKEN_COLORS.length];
    colorIndexRef.current++;

    const token: SimToken = {
      id: nextIdRef.current++,
      color,
      cx: info.cx,
      cy: info.cy,
      pathPoints: [],
      segLengths: [],
      totalDist: 0,
      travelled: 0,
      targetNodeId: null,
      paused: false,
      pauseRemaining: 0,
      done: false,
      bouncing: false,
      opacity: 1,
      scale: 1,
    };

    tokensRef.current.push(token);
    advanceFromNode(token, nodeId);
  }, []);

  function advanceFromNode(token: SimToken, nodeId: string) {
    const info = nodeMapRef.current.get(nodeId);
    if (!info) {
      fadeOut(token);
      return;
    }

    // End event → pop
    if (info.bpmnType.includes('EndEvent')) {
      popToken(token);
      return;
    }

    const outgoing = adjRef.current.get(nodeId) ?? [];
    if (outgoing.length === 0) {
      token.bouncing = true;
      return;
    }

    const isParallel =
      info.bpmnType.includes('ParallelGateway') ||
      info.bpmnType.includes('InclusiveGateway');

    if (isParallel && outgoing.length > 1) {
      // Send existing token along first path
      sendAlongEdge(token, outgoing[0]);
      // Clone for remaining paths
      for (let i = 1; i < outgoing.length; i++) {
        const clone = cloneToken(token);
        sendAlongEdge(clone, outgoing[i]);
      }
      return;
    }

    // Exclusive/random or single outgoing
    if (outgoing.length > 1) {
      const pick = outgoing[Math.floor(Math.random() * outgoing.length)];
      sendAlongEdge(token, pick);
    } else {
      sendAlongEdge(token, outgoing[0]);
    }
  }

  function sendAlongEdge(
    token: SimToken,
    edge: { targetId: string; waypoints: { x: number; y: number }[] },
  ) {
    const targetInfo = nodeMapRef.current.get(edge.targetId);
    if (!targetInfo) {
      fadeOut(token);
      return;
    }

    const points: { x: number; y: number }[] = [
      { x: token.cx, y: token.cy },
      ...edge.waypoints,
      { x: targetInfo.cx, y: targetInfo.cy },
    ];

    // Deduplicate consecutive points
    const cleaned = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = cleaned[cleaned.length - 1];
      if (Math.abs(points[i].x - prev.x) > 0.5 || Math.abs(points[i].y - prev.y) > 0.5) {
        cleaned.push(points[i]);
      }
    }

    const segLengths: number[] = [];
    let totalDist = 0;
    for (let i = 0; i < cleaned.length - 1; i++) {
      const dx = cleaned[i + 1].x - cleaned[i].x;
      const dy = cleaned[i + 1].y - cleaned[i].y;
      const len = Math.sqrt(dx * dx + dy * dy);
      segLengths.push(len);
      totalDist += len;
    }

    token.pathPoints = cleaned;
    token.segLengths = segLengths;
    token.totalDist = totalDist;
    token.travelled = 0;
    token.targetNodeId = edge.targetId;
  }

  function cloneToken(source: SimToken): SimToken {
    const clone: SimToken = {
      id: nextIdRef.current++,
      color: source.color,
      cx: source.cx,
      cy: source.cy,
      pathPoints: [],
      segLengths: [],
      totalDist: 0,
      travelled: 0,
      targetNodeId: null,
      paused: false,
      pauseRemaining: 0,
      done: false,
      bouncing: false,
      opacity: 0.9,
      scale: 1,
    };
    tokensRef.current.push(clone);
    return clone;
  }

  function fadeOut(token: SimToken) {
    token.opacity = 0;
    setTimeout(() => {
      token.done = true;
    }, 400);
  }

  function popToken(token: SimToken) {
    token.scale = 2.5;
    token.opacity = 0;
    setTimeout(() => {
      token.done = true;
    }, 350);
  }

  const tick = useCallback((timestamp: number) => {
    if (!activeRef.current) return;

    const dt = Math.min((timestamp - lastTsRef.current) / 1000, 0.1);
    lastTsRef.current = timestamp;

    let changed = false;

    for (const token of tokensRef.current) {
      if (token.done || token.bouncing) continue;

      if (token.paused) {
        token.pauseRemaining -= dt * 1000;
        if (token.pauseRemaining <= 0) {
          token.paused = false;
          changed = true;
        }
        continue;
      }

      if (token.totalDist > 0) {
        token.travelled += TOKEN_SPEED * dt;
        let t = Math.min(token.travelled / token.totalDist, 1);
        t = smootherstep(t);
        const targetDist = t * token.totalDist;
        const pos = samplePolyline(token.pathPoints, token.segLengths, targetDist);
        token.cx = pos.x;
        token.cy = pos.y;
        changed = true;

        if (t >= 1) {
          const targetId = token.targetNodeId;
          token.pathPoints = [];
          token.segLengths = [];
          token.totalDist = 0;
          token.travelled = 0;
          token.targetNodeId = null;

          if (!targetId) {
            fadeOut(token);
          } else {
            const targetInfo = nodeMapRef.current.get(targetId);
            if (targetInfo) {
              token.cx = targetInfo.cx;
              token.cy = targetInfo.cy;
            }

            if (
              targetInfo &&
              (targetInfo.bpmnType.includes('Activity') ||
                targetInfo.bpmnType.includes('Task') ||
                targetInfo.bpmnType.includes('SubProcess'))
            ) {
              token.paused = true;
              token.pauseRemaining = ACTIVITY_PAUSE_MS;
              setTimeout(() => {
                if (activeRef.current && !token.done) {
                  advanceFromNode(token, targetId);
                }
              }, ACTIVITY_PAUSE_MS);
            } else {
              advanceFromNode(token, targetId);
            }
          }
        }
      }
    }

    // Remove done tokens
    const before = tokensRef.current.length;
    tokensRef.current = tokensRef.current.filter((t) => !t.done);
    if (tokensRef.current.length !== before) changed = true;

    if (changed) {
      setTokens([...tokensRef.current]);
    }

    animRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    setActive(true);

    tokensRef.current = [];
    colorIndexRef.current = 0;
    nextIdRef.current = 0;

    const startIds = getStartNodeIds();
    for (const id of startIds) {
      spawnToken(id);
    }
    setTokens([...tokensRef.current]);

    spawnRef.current = window.setInterval(() => {
      if (!activeRef.current) return;
      const activeCount = tokensRef.current.filter((t) => !t.done).length;
      if (activeCount >= MAX_ACTIVE_TOKENS) return;
      for (const id of startIds) {
        spawnToken(id);
      }
    }, SPAWN_INTERVAL_MS);

    lastTsRef.current = performance.now();
    animRef.current = requestAnimationFrame(tick);
  }, [getStartNodeIds, spawnToken, tick]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);

    if (spawnRef.current) {
      clearInterval(spawnRef.current);
      spawnRef.current = null;
    }
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }

    tokensRef.current = [];
    setTokens([]);
  }, []);

  const toggle = useCallback(() => {
    if (activeRef.current) {
      stop();
    } else {
      start();
    }
  }, [start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (spawnRef.current) clearInterval(spawnRef.current);
      if (animRef.current) cancelAnimationFrame(animRef.current);
      activeRef.current = false;
    };
  }, []);

  return { active, tokens, toggle, start, stop };
}
