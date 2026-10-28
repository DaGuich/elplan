/**
 * Pure helpers connecting room-detection geometry to the floor-plan `RoomPlanItem` model.
 * Rooms keep x/y/width/height as their bounding box so rectangle-based interactions
 * (drag, snapping, DXF, sharing) keep working; `polygon` adds an optional editable outline.
 */
import type { RoomPlanItem } from "../api";
import {
  Point,
  PLAN_HEIGHT,
  PLAN_WIDTH,
  deleteVertex,
  insertVertex,
  isSimplePolygon,
  metersPerUnitFromScale,
  moveVertex,
  pointInPolygon,
  polygonArea,
  polygonAreaM2,
  simplifyRing,
  splitPolygon,
} from "./room-detection";

export const MAX_ROOM_VERTICES = 200;
export const MAX_ROOMS = 100;
export const DETECTED_ROOM_COLOR = "#eaf3f1";

const EPS = 1e-7;

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function side(value: number): number {
  return Math.abs(value) <= EPS ? 0 : Math.sign(value);
}

function withinSegment(a: Point, b: Point, p: Point): boolean {
  return p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
}

/** True if the closed segments share any point (crossing, touching, collinear overlap). */
export function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = side(cross(a, b, c));
  const o2 = side(cross(a, b, d));
  const o3 = side(cross(c, d, a));
  const o4 = side(cross(c, d, b));
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (o1 === 0 && withinSegment(a, b, c)) || (o2 === 0 && withinSegment(a, b, d)) ||
    (o3 === 0 && withinSegment(c, d, a)) || (o4 === 0 && withinSegment(c, d, b));
}

function bounds(ring: Point[]) {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** True if any edge of `first` touches or crosses any edge of `second`. */
export function ringsTouch(first: Point[], second: Point[]): boolean {
  const a = bounds(first);
  const b = bounds(second);
  if (a.x0 > b.x1 + EPS || b.x0 > a.x1 + EPS || a.y0 > b.y1 + EPS || b.y0 > a.y1 + EPS) return false;
  for (let i = 0; i < first.length; i += 1) {
    const p = first[i];
    const q = first[(i + 1) % first.length];
    for (let j = 0; j < second.length; j += 1) {
      if (segmentsTouch(p, q, second[j], second[(j + 1) % second.length])) return true;
    }
  }
  return false;
}

/**
 * Mirrors the backend rules: simple outline, every hole simple and strictly inside the
 * outline, and holes neither touching nor nesting each other.
 */
export function isValidRoomGeometry(outline: Point[], holes: Point[][]): boolean {
  if (outline.length < 3 || outline.length > MAX_ROOM_VERTICES || !isSimplePolygon(outline)) return false;
  for (let i = 0; i < holes.length; i += 1) {
    const hole = holes[i];
    if (hole.length < 3 || hole.length > MAX_ROOM_VERTICES || !isSimplePolygon(hole)) return false;
    if (ringsTouch(outline, hole) || !pointInPolygon(hole[0], outline)) return false;
    for (let j = i + 1; j < holes.length; j += 1) {
      if (ringsTouch(hole, holes[j]) || pointInPolygon(hole[0], holes[j]) || pointInPolygon(holes[j][0], hole)) return false;
    }
  }
  return true;
}

const toPoints = (ring: [number, number][]): Point[] => ring.map(([x, y]) => ({ x, y }));
const toTuples = (ring: Point[]): [number, number][] => ring.map((p) => [p.x, p.y]);
const clampPoint = (p: Point): Point => ({ x: Math.min(PLAN_WIDTH, Math.max(0, p.x)), y: Math.min(PLAN_HEIGHT, Math.max(0, p.y)) });

export function hasPolygon(room: RoomPlanItem): boolean {
  return !!room.polygon && room.polygon.length >= 3;
}

/** Outline in plan coordinates; rectangle rooms yield their four corners. */
export function roomOutline(room: RoomPlanItem): Point[] {
  if (hasPolygon(room)) return toPoints(room.polygon!);
  return [
    { x: room.x, y: room.y },
    { x: room.x + room.width, y: room.y },
    { x: room.x + room.width, y: room.y + room.height },
    { x: room.x, y: room.y + room.height },
  ];
}

export function roomHoles(room: RoomPlanItem): Point[][] {
  return hasPolygon(room) ? (room.holes ?? []).map(toPoints) : [];
}

/** Returns the room with x/y/width/height recomputed from the given outline. */
export function withOutline(room: RoomPlanItem, outline: Point[], holes: Point[][] = roomHoles(room)): RoomPlanItem {
  const points = outline.map(clampPoint);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    ...room,
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
    polygon: toTuples(points),
    holes: holes.map((ring) => toTuples(ring.map(clampPoint))),
  };
}

/** Moves the room's bounding box to (x, y), carrying polygon and holes along. */
export function translateRoom(room: RoomPlanItem, x: number, y: number): RoomPlanItem {
  const dx = x - room.x;
  const dy = y - room.y;
  if (!hasPolygon(room)) return { ...room, x, y };
  const shift = (ring: [number, number][]): [number, number][] => ring.map(([px, py]) => [px + dx, py + dy]);
  return { ...room, x, y, polygon: shift(room.polygon!), holes: (room.holes ?? []).map(shift) };
}

export function roomContains(room: RoomPlanItem, x: number, y: number): boolean {
  if (x < room.x || x > room.x + room.width || y < room.y || y > room.y + room.height) return false;
  if (!hasPolygon(room)) return true;
  const point = { x, y };
  return pointInPolygon(point, toPoints(room.polygon!)) && !roomHoles(room).some((hole) => pointInPolygon(point, hole));
}

/** Floor area in m², or null when the plan is not calibrated. Holes are subtracted. */
export function roomAreaM2(room: RoomPlanItem, scaleMPer100Units: number | null | undefined): number | null {
  const perUnit = metersPerUnitFromScale(scaleMPer100Units);
  if (perUnit === null) return null;
  return polygonAreaM2(roomOutline(room), perUnit, roomHoles(room));
}

const fmt = (value: number) => String(Math.round(value * 100) / 100);

/** SVG path for outline plus holes (use with fillRule="evenodd"); rectangles give a plain box. */
export function roomPath(room: RoomPlanItem): string {
  const ring = (points: Point[]) => `M${points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join("L")}Z`;
  return [roomOutline(room), ...roomHoles(room)].map(ring).join("");
}

/** Converts a rectangle room into an editable four-vertex polygon (no-op if already a polygon). */
export function toPolygonRoom(room: RoomPlanItem): RoomPlanItem {
  return hasPolygon(room) ? room : withOutline(room, roomOutline(room), []);
}

function editOutline(room: RoomPlanItem, edit: (outline: Point[]) => Point[]): RoomPlanItem | null {
  if (!hasPolygon(room)) return null;
  const next = edit(roomOutline(room)).map(clampPoint);
  if (!isValidRoomGeometry(next, roomHoles(room))) return null;
  return withOutline(room, next);
}

/** Each edit returns the updated room, or null if it would produce an invalid outline. */
export function moveRoomVertex(room: RoomPlanItem, index: number, to: Point): RoomPlanItem | null {
  return editOutline(room, (outline) => moveVertex(outline, index, clampPoint(to)));
}

export function insertRoomVertex(room: RoomPlanItem, edgeIndex: number): RoomPlanItem | null {
  return editOutline(room, (outline) => insertVertex(outline, edgeIndex));
}

export function deleteRoomVertex(room: RoomPlanItem, index: number): RoomPlanItem | null {
  if (!hasPolygon(room) || room.polygon!.length <= 3) return null;
  return editOutline(room, (outline) => deleteVertex(outline, index));
}

/**
 * Splits a polygon room along the chord between two vertices. The first part keeps the
 * id; the second gets `newId`. Holes follow the part that contains them.
 */
export function splitRoom(room: RoomPlanItem, i: number, j: number, newId: string): [RoomPlanItem, RoomPlanItem] | null {
  if (!hasPolygon(room)) return null;
  const parts = splitPolygon(roomOutline(room), i, j);
  if (!parts) return null;
  const [first, second] = parts;
  if (first.length > MAX_ROOM_VERTICES || second.length > MAX_ROOM_VERTICES) return null;
  const holes = roomHoles(room);
  // A cut through a hole would leave a hole straddling both parts.
  if (holes.some((hole) => ringsTouch(first, hole) && ringsTouch(second, hole))) return null;
  const inFirst = holes.filter((hole) => pointInPolygon(hole[0], first));
  const inSecond = holes.filter((hole) => !inFirst.includes(hole));
  if (!isValidRoomGeometry(first, inFirst) || !isValidRoomGeometry(second, inSecond)) return null;
  return [
    { ...withOutline(room, first, inFirst), name: `${room.name} 1` },
    { ...withOutline(room, second, inSecond), id: newId, name: `${room.name} 2` },
  ];
}

/** A point inside the room (midpoint of the widest span on the vertical centre line) for labels. */
export function labelAnchor(room: RoomPlanItem): Point {
  if (!hasPolygon(room)) return { x: room.x + room.width / 2, y: room.y + room.height / 2 };
  const outline = roomOutline(room);
  const y = room.y + room.height / 2 + 0.01;
  const crossings: number[] = [];
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a.y > y !== b.y > y) crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  crossings.sort((p, q) => p - q);
  let best = { start: room.x, end: room.x + room.width, length: -1 };
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const length = crossings[i + 1] - crossings[i];
    if (length > best.length) best = { start: crossings[i], end: crossings[i + 1], length };
  }
  return { x: (best.start + best.end) / 2, y };
}

/** Shrinks vertex count (Douglas-Peucker with growing tolerance) until it fits the schema limit. */
function fitVertexLimit(ring: Point[]): Point[] | null {
  let candidate = ring;
  for (let epsilon = 1; candidate.length > MAX_ROOM_VERTICES && epsilon <= 16; epsilon *= 2) {
    candidate = simplifyRing(ring, epsilon);
  }
  return candidate.length <= MAX_ROOM_VERTICES && isSimplePolygon(candidate) ? candidate : null;
}

function bboxOverlapShare(a: RoomPlanItem, b: RoomPlanItem): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return (width * height) / Math.min(a.width * a.height, b.width * b.height);
}

export type DetectedGeometry = { polygon: Point[]; holes: Point[][] };

/**
 * Turns detector output into new rooms flagged for review. Skips candidates that mostly
 * overlap an already detected room (so repeated detection does not duplicate) and respects
 * the per-plan room limit. Returns the rooms and how many candidates were skipped.
 */
export function buildDetectedRooms(
  candidates: DetectedGeometry[],
  existing: RoomPlanItem[],
  layerId: string,
  makeId: () => string,
  label: (index: number) => string,
): { rooms: RoomPlanItem[]; skipped: number } {
  const rooms: RoomPlanItem[] = [];
  const known = existing.filter((room) => room.source === "detected");
  const detectedCount = known.length;
  let skipped = 0;
  for (const candidate of candidates) {
    if (existing.length + rooms.length >= MAX_ROOMS) { skipped += 1; continue; }
    const outline = fitVertexLimit(candidate.polygon);
    if (!outline || polygonArea(outline) === 0) { skipped += 1; continue; }
    const holeRings = candidate.holes.map(fitVertexLimit);
    const holes = holeRings.filter((ring): ring is Point[] => ring !== null);
    // Dropping a hole would overstate the area, so unusable geometry skips the whole room.
    if (holes.length !== holeRings.length || !isValidRoomGeometry(outline, holes)) { skipped += 1; continue; }
    const room = withOutline({
      id: makeId(),
      name: label(detectedCount + rooms.length + 1),
      x: 0, y: 0, width: 1, height: 1,
      color: DETECTED_ROOM_COLOR,
      layer_id: layerId,
      source: "detected",
      needs_review: true,
    }, outline, holes);
    if ([...known, ...rooms].some((other) => bboxOverlapShare(room, other) > 0.5)) { skipped += 1; continue; }
    rooms.push(room);
  }
  return { rooms, skipped };
}
