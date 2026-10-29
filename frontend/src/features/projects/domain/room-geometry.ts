/**
 * Pure, reusable geometry operations on rooms for spec room detection: merging two rooms
 * that share an exact boundary edge, and manual hole editing. Every operation returns a
 * `GeometryResult`; invalid input never throws and never yields invalid geometry.
 *
 * Coordinates are compared exactly (no tolerance), so only edges that coincide exactly
 * (same endpoints, or one edge exactly collinear and containing the other's vertices) merge.
 */
import type { RoomPlanItem } from "../api";
import { Point, pointInPolygon, signedArea } from "./room-detection";
import {
  MAX_ROOM_HOLES,
  MAX_ROOM_VERTICES,
  isValidRoomGeometry,
  roomHoles,
  roomOutline,
  toPolygonRoom,
  withOutline,
} from "./plan-rooms";

export type GeometryErrorCode =
  | "same-room"
  | "layer-mismatch"
  | "invalid-geometry"
  | "not-adjacent"
  | "overlap"
  | "vertex-limit"
  | "hole-limit"
  | "hole-out-of-range"
  | "hole-overlap";

export type GeometryResult<T> = { ok: true; value: T } | { ok: false; code: GeometryErrorCode; message: string };

export type RoomGeometry = { outline: Point[]; holes: Point[][] };

const fail = (code: GeometryErrorCode, message: string): { ok: false; code: GeometryErrorCode; message: string } => ({ ok: false, code, message });

const key = (p: Point) => `${p.x},${p.y}`;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/** Drops repeated consecutive points and exactly collinear vertices. Null if degenerate. */
export function normalizeRing(ring: Point[]): Point[] | null {
  let result = ring.filter((p, i) => !same(p, ring[(i + ring.length - 1) % ring.length]));
  let changed = true;
  while (changed && result.length >= 3) {
    changed = false;
    for (let i = 0; i < result.length; i += 1) {
      const prev = result[(i + result.length - 1) % result.length];
      const next = result[(i + 1) % result.length];
      if (cross(prev, result[i], next) === 0) {
        result = result.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return result.length >= 3 ? result : null;
}

/**
 * Area of an outline minus its holes, in plan units². Each ring is measured relative to
 * its first vertex, which keeps floating-point error small for far-from-origin plans.
 */
export function geometryArea(outline: Point[], holes: Point[][] = []): number {
  const ringArea = (ring: Point[]) => Math.abs(signedArea(ring.map((p) => ({ x: p.x - ring[0].x, y: p.y - ring[0].y }))));
  return Math.max(0, ringArea(outline) - holes.reduce((sum, hole) => sum + ringArea(hole), 0));
}

const oriented = (ring: Point[], counterClockwise: boolean) => (signedArea(ring) > 0 === counterClockwise ? ring : [...ring].reverse());

/** Outline CCW, holes CW, so a region's interior is always left of its directed edges. */
function canonical(geometry: RoomGeometry): RoomGeometry | null {
  const outline = normalizeRing(geometry.outline);
  const holes = geometry.holes.map(normalizeRing);
  if (!outline || holes.some((hole) => hole === null)) return null;
  return { outline: oriented(outline, true), holes: (holes as Point[][]).map((hole) => oriented(hole, false)) };
}

/** Inserts every vertex of `others` lying exactly inside an edge of `ring`. */
function splitAt(ring: Point[], others: Point[]): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    result.push(a);
    const inside = others
      .filter((p) => !same(p, a) && !same(p, b) && cross(a, b, p) === 0 &&
        p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y))
      .sort((p, q) => Math.abs(p.x - a.x) + Math.abs(p.y - a.y) - Math.abs(q.x - a.x) - Math.abs(q.y - a.y));
    result.push(...inside.filter((p, k) => k === 0 || !same(p, inside[k - 1])));
  }
  return result;
}

type Edge = { a: Point; b: Point };

const ringEdges = (ring: Point[]): Edge[] => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] }));

function properCross(e: Edge, f: Edge): boolean {
  const o1 = Math.sign(cross(e.a, e.b, f.a));
  const o2 = Math.sign(cross(e.a, e.b, f.b));
  const o3 = Math.sign(cross(f.a, f.b, e.a));
  const o4 = Math.sign(cross(f.a, f.b, e.b));
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function insideRegion(point: Point, region: RoomGeometry): boolean {
  return pointInPolygon(point, region.outline) && !region.holes.some((hole) => pointInPolygon(point, hole));
}

/**
 * Merges two regions that touch along at least one exactly shared edge. The shared edges
 * cancel; the remaining boundary becomes the outline and holes. Holes are preserved, and
 * a hole is closed when the other region fills it along its whole boundary.
 */
export function mergeGeometries(first: RoomGeometry, second: RoomGeometry): GeometryResult<RoomGeometry> {
  const a = canonical(first);
  const b = canonical(second);
  if (!a || !b || !isValidRoomGeometry(a.outline, a.holes) || !isValidRoomGeometry(b.outline, b.holes)) {
    return fail("invalid-geometry", "Both rooms need a valid outline.");
  }
  const pointsA = [a.outline, ...a.holes].flat();
  const pointsB = [b.outline, ...b.holes].flat();
  const edgesA = [a.outline, ...a.holes].flatMap((ring) => ringEdges(splitAt(ring, pointsB)));
  const edgesB = [b.outline, ...b.holes].flatMap((ring) => ringEdges(splitAt(ring, pointsA)));
  const edgeKey = (e: Edge) => `${key(e.a)}>${key(e.b)}`;
  const reverseKey = (e: Edge) => `${key(e.b)}>${key(e.a)}`;
  const keysA = new Set(edgesA.map(edgeKey));
  const keysB = new Set(edgesB.map(edgeKey));

  // Same-direction shared edge means both interiors lie on the same side.
  const overlapping =
    edgesB.some((e) => keysA.has(edgeKey(e))) ||
    edgesA.some((e) => edgesB.some((f) => properCross(e, f))) ||
    edgesA.some((e) => !keysB.has(reverseKey(e)) && insideRegion({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, b)) ||
    edgesB.some((e) => !keysA.has(reverseKey(e)) && insideRegion({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, a));
  if (overlapping) return fail("overlap", "The rooms overlap.");

  const remaining = [
    ...edgesA.filter((e) => !keysB.has(reverseKey(e))),
    ...edgesB.filter((e) => !keysA.has(reverseKey(e))),
  ];
  if (remaining.length === edgesA.length + edgesB.length) return fail("not-adjacent", "The rooms do not share an edge.");

  const next = new Map<string, Edge>();
  for (const edge of remaining) {
    // Two outgoing edges at one vertex is a pinch point, which is not a simple polygon.
    if (next.has(key(edge.a))) return fail("invalid-geometry", "Merging would pinch the outline at a single point.");
    next.set(key(edge.a), edge);
  }
  const rings: Point[][] = [];
  const visited = new Set<string>();
  for (const start of remaining) {
    if (visited.has(key(start.a))) continue;
    const ring: Point[] = [];
    let edge: Edge | undefined = start;
    while (edge && !visited.has(key(edge.a))) {
      visited.add(key(edge.a));
      ring.push(edge.a);
      edge = next.get(key(edge.b));
    }
    if (!edge || !same(edge.a, start.a)) return fail("invalid-geometry", "Merged boundary is not closed.");
    const clean = normalizeRing(ring);
    if (!clean) return fail("invalid-geometry", "Merged boundary is degenerate.");
    rings.push(clean);
  }
  const outlines = rings.filter((ring) => signedArea(ring) > 0);
  const holes = rings.filter((ring) => signedArea(ring) < 0);
  if (outlines.length !== 1) return fail("invalid-geometry", "Merge must produce exactly one outline.");
  if (holes.length > MAX_ROOM_HOLES) return fail("hole-limit", "Merged room exceeds the hole limit.");
  if (outlines[0].length > MAX_ROOM_VERTICES || holes.some((hole) => hole.length > MAX_ROOM_VERTICES)) {
    return fail("vertex-limit", "Merged room exceeds the vertex limit.");
  }
  if (!isValidRoomGeometry(outlines[0], holes)) return fail("invalid-geometry", "Merged geometry is invalid.");
  const expected = geometryArea(a.outline, a.holes) + geometryArea(b.outline, b.holes);
  const actual = geometryArea(outlines[0], holes);
  if (Math.abs(actual - expected) > 1e-9 * Math.max(1, expected)) return fail("overlap", "Merged area does not match the rooms' areas.");
  return { ok: true, value: { outline: outlines[0], holes } };
}

const geometryOf = (room: RoomPlanItem): RoomGeometry => ({ outline: roomOutline(room), holes: roomHoles(room) });

/**
 * Merges room `second` into `first` (rectangles and polygons both work). The result keeps
 * the first room's id and properties; the caller removes `second` from the plan.
 */
export function mergeRooms(first: RoomPlanItem, second: RoomPlanItem): GeometryResult<RoomPlanItem> {
  if (first.id === second.id) return fail("same-room", "Cannot merge a room with itself.");
  if (first.layer_id !== second.layer_id) return fail("layer-mismatch", "Rooms must be on the same layer.");
  const merged = mergeGeometries(geometryOf(first), geometryOf(second));
  if (!merged.ok) return merged;
  return { ok: true, value: withOutline(first, merged.value.outline, merged.value.holes) };
}

/** Axis-aligned rectangle ring, convenient for manual holes. Null for a non-positive size. */
export function rectangleRing(x: number, y: number, width: number, height: number): Point[] | null {
  if (!(width > 0) || !(height > 0)) return null;
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
}

function withHoles(room: RoomPlanItem, holes: Point[][]): GeometryResult<RoomPlanItem> {
  const base = toPolygonRoom(room);
  const outline = roomOutline(base);
  if (!isValidRoomGeometry(outline, holes)) return fail("invalid-geometry", "Holes must be simple, inside the room and not touch each other or the outline.");
  return { ok: true, value: withOutline(base, outline, holes) };
}

/** Adds a manual hole (e.g. a shaft or column). Rectangle rooms become polygon rooms. */
export function addRoomHole(room: RoomPlanItem, hole: Point[]): GeometryResult<RoomPlanItem> {
  const ring = normalizeRing(hole);
  if (!ring) return fail("invalid-geometry", "A hole needs at least three non-collinear vertices.");
  const outline = roomOutline(room);
  if (!isValidRoomGeometry(outline, [ring])) {
    return fail("hole-out-of-range", "The hole must be a simple polygon strictly inside the room.");
  }
  const existing = roomHoles(room);
  const result = withHoles(room, [...existing, ring]);
  return result.ok ? result : fail("hole-overlap", "The hole overlaps or touches another hole.");
}

/** Replaces the hole at `index` with a new ring. */
export function replaceRoomHole(room: RoomPlanItem, index: number, hole: Point[]): GeometryResult<RoomPlanItem> {
  const existing = roomHoles(room);
  if (index < 0 || index >= existing.length) return fail("invalid-geometry", "No such hole.");
  const ring = normalizeRing(hole);
  if (!ring) return fail("invalid-geometry", "A hole needs at least three non-collinear vertices.");
  return withHoles(room, existing.map((h, i) => (i === index ? ring : h)));
}

export function removeRoomHole(room: RoomPlanItem, index: number): GeometryResult<RoomPlanItem> {
  const existing = roomHoles(room);
  if (index < 0 || index >= existing.length) return fail("invalid-geometry", "No such hole.");
  return withHoles(room, existing.filter((_, i) => i !== index));
}
