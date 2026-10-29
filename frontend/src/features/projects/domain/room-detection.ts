/**
 * Room-detection geometry (spec 02 §2). Pure functions, no DOM, no imports.
 *
 * Limitations:
 * - Raster only (RGBA/grayscale pixels); vector CAD/PDF parsing is out of scope.
 * - Walls = dark pixels. Gaps (doors, drawing breaks) are only bridged up to
 *   `gapClosePx`; larger openings merge rooms or make them leak to the exterior,
 *   in which case they are dropped.
 * - Only the outer contour is editable. Holes (pillars, shafts) are reported in
 *   `holes` and subtracted from `areaM2`, but are not part of `polygon`.
 * - Noisy scans: speckle removal and Otsu help; heavy noise, hatching, dimension
 *   lines or furniture drawn in wall colour can still split or distort regions.
 * - Contours are 4-connected pixel boundaries simplified with Douglas-Peucker, so
 *   accuracy is about one raster pixel (plus `simplifyEpsilonPx`). Diagonal walls become
 *   approximate straight edges. `areaM2` is the exact room pixel count (holes excluded)
 *   converted to plan units, so it can differ slightly from the simplified polygon's area.
 * - Exterior/open regions: anything touching the raster (or crop window) border is
 *   exterior and never returned. Regions whose holes cover a large part of their outline
 *   (page margin around a drawing/frame) are also rejected. A room cut by the crop window
 *   is therefore dropped, not reported as partial.
 * - Contours that cannot be made simple (e.g. rooms pinched to themselves at a single
 *   corner) are dropped rather than returned self-intersecting.
 * - Rotation: with a non-zero background rotation, rooms that leave the 1000x700 plan
 *   after rotating are dropped; rotated-in blank corners are not treated as exterior.
 * - The raster is assumed to be stretched over the registration window (default: the crop) exactly like the editor's
 *   <image preserveAspectRatio="none"> (non-uniform scale is handled in the area).
 */

export const PLAN_WIDTH = 1000;
export const PLAN_HEIGHT = 700;

export type Point = { x: number; y: number };

export type PixelImage = {
  data: ArrayLike<number>;
  width: number;
  height: number;
  /** 4 = RGBA (ImageData), 1 = grayscale. Default 4. */
  channels?: 1 | 4;
};

/** Mirrors the editor: image_crop = [x, y, width, height] as fractions of the source image. */
export type PlanMapping = {
  planWidth?: number;
  planHeight?: number;
  crop?: [number, number, number, number] | null;
  /**
   * Source window stretched over the plan (resolveRegistration in plan-crop.ts). Defaults to `crop`,
   * i.e. the legacy stretched mapping. `crop` then only selects the visible analysis window.
   */
  registration?: [number, number, number, number] | null;
  /** SVG-style rotation in degrees around the plan centre (background_rotation). */
  rotationDeg?: number;
};

export type DetectionOptions = {
  /** Luma below this is wall. "otsu" picks it automatically. Default 128. */
  threshold?: number | "otsu";
  /** Bridge wall gaps up to about 2*gapClosePx pixels wide. Default 0. */
  gapClosePx?: number;
  /** Dark blobs smaller than this many pixels are treated as noise. Default 8. */
  speckleMinPx?: number;
  /** Regions with fewer pixels are dropped. Default 100. */
  minAreaPx?: number;
  /** Douglas-Peucker tolerance in pixels. Default 1. */
  simplifyEpsilonPx?: number;
  /** Calibration: metres per plan unit (scale_m_per_100_units / 100). Omit when uncalibrated. */
  metersPerPlanUnit?: number;
  /** Maps raster pixels into the plan space. Default: whole image over 1000x700, no rotation. */
  plan?: PlanMapping;
  /** Reject a region when its holes cover more than this share of its outline. Default 0.25. */
  maxHoleShare?: number;
};

export type DetectedRoom = {
  /** Closed ring (last point not repeated), clockwise on screen, plan units. */
  polygon: Point[];
  holes: Point[][];
  /** Pixels belonging to the room (holes excluded). */
  areaPx: number;
  /** Calibrated floor area, null when metersPerPlanUnit is missing. */
  areaM2: number | null;
  bounds: { x: number; y: number; width: number; height: number };
};

export function otsuThreshold(luma: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const value of luma) hist[value] += 1;
  const total = luma.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < 256; t += 1) {
    weightB += hist[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * hist[t];
    const diff = sumB / weightB - (sum - sumB) / weightF;
    const variance = weightB * weightF * diff * diff;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best + 1;
}

function toLuma(image: PixelImage): Uint8Array {
  const { width, height } = image;
  const channels = image.channels ?? 4;
  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i += 1) {
    if (channels === 1) {
      luma[i] = image.data[i];
    } else {
      const o = i * 4;
      const alpha = image.data[o + 3] / 255;
      const value = (0.299 * image.data[o] + 0.587 * image.data[o + 1] + 0.114 * image.data[o + 2]) * alpha + 255 * (1 - alpha);
      luma[i] = Math.round(value);
    }
  }
  return luma;
}

function removeSpeckles(wall: Uint8Array, width: number, height: number, minPx: number) {
  if (minPx <= 1) return;
  const seen = new Uint8Array(wall.length);
  for (let start = 0; start < wall.length; start += 1) {
    if (!wall[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    for (let c = 0; c < queue.length; c += 1) {
      const x = queue[c] % width;
      const y = (queue[c] - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const n = ny * width + nx;
          if (wall[n] && !seen[n]) {
            seen[n] = 1;
            queue.push(n);
          }
        }
      }
    }
    if (queue.length < minPx) for (const index of queue) wall[index] = 0;
  }
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k += 1) horizontal[y * width + k] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!horizontal[y * width + x]) continue;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k += 1) out[k * width + x] = 1;
    }
  }
  return out;
}

/** Labels free regions (4-connected). Returns labels (0 = wall) and the exterior label set. */
function labelRegions(blocked: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(blocked.length);
  const exterior = new Set<number>();
  let count = 0;
  for (let start = 0; start < blocked.length; start += 1) {
    if (blocked[start] || labels[start]) continue;
    count += 1;
    labels[start] = count;
    const queue = [start];
    for (let c = 0; c < queue.length; c += 1) {
      const cur = queue[c];
      const x = cur % width;
      const y = (cur - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) exterior.add(count);
      if (x > 0 && !blocked[cur - 1] && !labels[cur - 1]) { labels[cur - 1] = count; queue.push(cur - 1); }
      if (x < width - 1 && !blocked[cur + 1] && !labels[cur + 1]) { labels[cur + 1] = count; queue.push(cur + 1); }
      if (y > 0 && !blocked[cur - width] && !labels[cur - width]) { labels[cur - width] = count; queue.push(cur - width); }
      if (y < height - 1 && !blocked[cur + width] && !labels[cur + width]) { labels[cur + width] = count; queue.push(cur + width); }
    }
  }
  return { labels, exterior, count };
}

/** Gives pixels removed by gap-closing back to the nearest region, so areas are not shrunk. */
function reclaimDilated(labels: Int32Array, wall: Uint8Array, width: number, height: number, steps: number) {
  let frontier: number[] = [];
  for (let i = 0; i < labels.length; i += 1) if (labels[i]) frontier.push(i);
  for (let step = 0; step < steps * 2 && frontier.length > 0; step += 1) {
    const next: number[] = [];
    for (const cur of frontier) {
      const x = cur % width;
      const y = (cur - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (labels[n] || wall[n]) continue;
        labels[n] = labels[cur];
        next.push(n);
      }
    }
    frontier = next;
  }
}

function traceLoops(inRegion: (x: number, y: number) => boolean, pixels: number[], width: number): Point[][] {
  // Directed boundary edges with the region on the right (clockwise on screen).
  const outgoing = new Map<number, { to: number; used: boolean }[]>();
  const stride = width + 1;
  const key = (x: number, y: number) => y * stride + x;
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const from = key(x1, y1);
    const list = outgoing.get(from) ?? [];
    list.push({ to: key(x2, y2), used: false });
    outgoing.set(from, list);
  };
  for (const index of pixels) {
    const x = index % width;
    const y = (index - x) / width;
    if (!inRegion(x, y - 1)) add(x, y, x + 1, y);
    if (!inRegion(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!inRegion(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!inRegion(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops: Point[][] = [];
  for (const [startKey, edges] of outgoing) {
    for (const first of edges) {
      if (first.used) continue;
      const loop: Point[] = [];
      let from = startKey;
      let edge: { to: number; used: boolean } | undefined = first;
      while (edge && !edge.used) {
        edge.used = true;
        loop.push({ x: from % stride, y: (from - (from % stride)) / stride });
        const prev = from;
        from = edge.to;
        const candidates: { to: number; used: boolean }[] = (outgoing.get(from) ?? []).filter((e) => !e.used);
        if (candidates.length > 1) {
          // Pinch point: turn right so diagonally touching pixels stay in one loop.
          const dxIn = (from % stride) - (prev % stride);
          const dyIn = Math.floor(from / stride) - Math.floor(prev / stride);
          const turn = (e: { to: number }) => {
            const dx = (e.to % stride) - (from % stride);
            const dy = Math.floor(e.to / stride) - Math.floor(from / stride);
            return dxIn * dy - dyIn * dx; // >0 right turn on screen
          };
          candidates.sort((a, b) => turn(b) - turn(a));
        }
        edge = candidates[0];
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

export function signedArea(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function polygonArea(polygon: Point[]): number {
  return Math.abs(signedArea(polygon));
}

function removeCollinear(ring: Point[]): Point[] {
  let result = ring;
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    const next: Point[] = [];
    for (let i = 0; i < result.length; i += 1) {
      const prev = result[(i + result.length - 1) % result.length];
      const cur = result[i];
      const following = result[(i + 1) % result.length];
      const cross = (cur.x - prev.x) * (following.y - cur.y) - (cur.y - prev.y) * (following.x - cur.x);
      if (cross === 0) changed = true;
      else next.push(cur);
    }
    result = next;
  }
  return result;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function simplifyOpen(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  let maxDistance = -1;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (d > maxDistance) {
      maxDistance = d;
      index = i;
    }
  }
  if (maxDistance <= epsilon) return [points[0], points[points.length - 1]];
  return [...simplifyOpen(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplifyOpen(points.slice(index), epsilon)];
}

export function simplifyRing(ring: Point[], epsilon: number): Point[] {
  const base = removeCollinear(ring);
  if (epsilon <= 0 || base.length <= 4) return base;
  let a = 0;
  let b = 0;
  let best = -1;
  for (let i = 1; i < base.length; i += 1) {
    const d = Math.hypot(base[i].x - base[0].x, base[i].y - base[0].y);
    if (d > best) {
      best = d;
      b = i;
    }
  }
  const first = simplifyOpen(base.slice(a, b + 1), epsilon);
  const second = simplifyOpen([...base.slice(b), base[a]], epsilon);
  const merged = [...first.slice(0, -1), ...second.slice(0, -1)];
  return merged.length >= 3 ? merged : base;
}

type Mapping = { map: (p: Point) => Point; unitArea: number };

function buildMapping(width: number, height: number, plan: PlanMapping, offsetX: number, offsetY: number, sourceWidth: number, sourceHeight: number): Mapping {
  const planWidth = plan.planWidth ?? PLAN_WIDTH;
  const planHeight = plan.planHeight ?? PLAN_HEIGHT;
  const [cx, cy, cw, ch] = validCrop(plan.registration) ? plan.registration : plan.crop ?? [0, 0, 1, 1];
  const angle = ((plan.rotationDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const centreX = planWidth / 2;
  const centreY = planHeight / 2;
  const map = (p: Point): Point => {
    const x = (((offsetX + p.x) / sourceWidth - cx) / cw) * planWidth;
    const y = (((offsetY + p.y) / sourceHeight - cy) / ch) * planHeight;
    if (angle === 0) return { x, y };
    const dx = x - centreX;
    const dy = y - centreY;
    return { x: centreX + dx * cos - dy * sin, y: centreY + dx * sin + dy * cos };
  };
  const unitArea = (planWidth / (cw * sourceWidth)) * (planHeight / (ch * sourceHeight));
  return { map, unitArea };
}

function validCrop(crop: PlanMapping["crop"]): crop is [number, number, number, number] {
  return !!crop && crop.every(Number.isFinite) && crop[0] >= 0 && crop[1] >= 0 && crop[2] > 0 && crop[3] > 0 && crop[0] + crop[2] <= 1 + 1e-9 && crop[1] + crop[3] <= 1 + 1e-9;
}

/** Simplifies while guaranteeing a simple polygon close to the exact pixel outline; null if impossible. */
function safeContour(raw: Point[], epsilon: number): Point[] | null {
  const exact = removeCollinear(raw);
  const exactArea = polygonArea(exact);
  let eps = epsilon;
  for (let attempt = 0; attempt < 4 && eps > 0; attempt += 1, eps /= 2) {
    const candidate = simplifyRing(raw, eps);
    if (candidate.length < 3) continue;
    if (Math.abs(polygonArea(candidate) - exactArea) > 0.05 * exactArea) continue;
    if (isSimplePolygon(candidate)) return candidate;
  }
  return exact.length >= 3 && isSimplePolygon(exact) ? exact : null;
}

export function detectRooms(image: PixelImage, options: DetectionOptions = {}): DetectedRoom[] {
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return [];
  const channels = image.channels ?? 4;
  if (image.data.length < sourceWidth * sourceHeight * channels) return [];
  const plan = options.plan ?? {};
  if (plan.crop && !validCrop(plan.crop)) return [];
  if (plan.registration && !validCrop(plan.registration)) return [];

  const fullLuma = toLuma(image);
  // Restrict to the visible crop window so its border counts as exterior.
  const [cx, cy, cw, ch] = plan.crop ?? [0, 0, 1, 1];
  const offsetX = Math.round(cx * sourceWidth);
  const offsetY = Math.round(cy * sourceHeight);
  const width = Math.min(sourceWidth - offsetX, Math.round((cx + cw) * sourceWidth) - offsetX);
  const height = Math.min(sourceHeight - offsetY, Math.round((cy + ch) * sourceHeight) - offsetY);
  if (width <= 0 || height <= 0) return [];
  const luma = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) luma.set(fullLuma.subarray((offsetY + y) * sourceWidth + offsetX, (offsetY + y) * sourceWidth + offsetX + width), y * width);

  const threshold = options.threshold === "otsu" ? otsuThreshold(luma) : options.threshold ?? 128;
  const wall = new Uint8Array(luma.length);
  for (let i = 0; i < luma.length; i += 1) wall[i] = luma[i] < threshold ? 1 : 0;
  removeSpeckles(wall, width, height, options.speckleMinPx ?? 8);

  const gap = Math.max(0, Math.floor(options.gapClosePx ?? 0));
  const blocked = dilate(wall, width, height, gap);
  const { labels, exterior, count } = labelRegions(blocked, width, height);
  if (gap > 0) reclaimDilated(labels, wall, width, height, gap);

  const members: number[][] = Array.from({ length: count + 1 }, () => []);
  for (let i = 0; i < labels.length; i += 1) if (labels[i]) members[labels[i]].push(i);

  const mapping = buildMapping(width, height, plan, offsetX, offsetY, sourceWidth, sourceHeight);
  const planWidth = plan.planWidth ?? PLAN_WIDTH;
  const planHeight = plan.planHeight ?? PLAN_HEIGHT;
  const minArea = options.minAreaPx ?? 100;
  const epsilon = options.simplifyEpsilonPx ?? 1;
  const maxHoleShare = options.maxHoleShare ?? 0.25;
  const tolerance = 1e-6;
  const rooms: DetectedRoom[] = [];
  for (let label = 1; label <= count; label += 1) {
    const pixels = members[label];
    if (exterior.has(label) || pixels.length < minArea) continue;
    const inRegion = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && labels[y * width + x] === label;
    const loops = traceLoops(inRegion, pixels, width)
      .map((loop) => ({ loop, area: signedArea(loop) }))
      .sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    if (loops.length === 0) continue;
    const outerArea = Math.abs(loops[0].area);
    const holeArea = loops.slice(1).reduce((sum, entry) => sum + Math.abs(entry.area), 0);
    if (outerArea === 0 || holeArea / outerArea > maxHoleShare) continue;
    const outline = safeContour(loops[0].loop, epsilon);
    if (!outline) continue;
    const polygon = outline.map(mapping.map);
    if (polygon.some((p) => p.x < -tolerance || p.y < -tolerance || p.x > planWidth + tolerance || p.y > planHeight + tolerance)) continue;
    const holes = loops.slice(1)
      .map((entry) => safeContour(entry.loop, epsilon))
      .filter((ring): ring is Point[] => ring !== null)
      .map((ring) => ring.map(mapping.map));
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    const areaUnits = pixels.length * mapping.unitArea;
    rooms.push({
      polygon,
      holes,
      areaPx: pixels.length,
      areaM2: options.metersPerPlanUnit ? areaUnits * options.metersPerPlanUnit ** 2 : null,
      bounds: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) },
    });
  }
  return rooms.sort((a, b) => b.areaPx - a.areaPx);
}

/** Editor stores scale_m_per_100_units; returns metres per plan unit (null if not calibrated). */
export function metersPerUnitFromScale(scaleMPer100Units: number | null | undefined): number | null {
  return scaleMPer100Units && scaleMPer100Units > 0 && Number.isFinite(scaleMPer100Units) ? scaleMPer100Units / 100 : null;
}

/** Metres per plan unit from two picked points and their known real distance. */
export function calibrateMetersPerUnit(a: Point, b: Point, meters: number): number | null {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  return distance > 0 && meters > 0 && Number.isFinite(meters) ? meters / distance : null;
}

/** Calibrated area of a (possibly edited) polygon, minus optional holes. */
export function polygonAreaM2(polygon: Point[], metersPerUnit: number, holes: Point[][] = []): number {
  const units = polygonArea(polygon) - holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
  return Math.max(0, units) * metersPerUnit ** 2;
}

// ---- pure edit helpers (return new arrays, never mutate) ----

export function moveVertex(polygon: Point[], index: number, to: Point): Point[] {
  if (index < 0 || index >= polygon.length) return polygon;
  return polygon.map((p, i) => (i === index ? { x: to.x, y: to.y } : p));
}

/** Inserts a vertex on edge `edgeIndex` (edge i runs from vertex i to i+1); defaults to the midpoint. */
export function insertVertex(polygon: Point[], edgeIndex: number, at?: Point): Point[] {
  if (edgeIndex < 0 || edgeIndex >= polygon.length) return polygon;
  const a = polygon[edgeIndex];
  const b = polygon[(edgeIndex + 1) % polygon.length];
  const point = at ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return [...polygon.slice(0, edgeIndex + 1), point, ...polygon.slice(edgeIndex + 1)];
}

/** Removes a vertex; a polygon keeps at least 3 vertices. */
export function deleteVertex(polygon: Point[], index: number): Point[] {
  if (polygon.length <= 3 || index < 0 || index >= polygon.length) return polygon;
  return polygon.filter((_, i) => i !== index);
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/** True if no two non-adjacent edges intersect (touching counts as intersecting). */
export function isSimplePolygon(polygon: Point[]): boolean {
  const n = polygon.length;
  if (n < 3 || polygonArea(polygon) === 0) return false;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = polygon[i];
      const b = polygon[(i + 1) % n];
      const c = polygon[j];
      const d = polygon[(j + 1) % n];
      if (segmentsCross(a, b, c, d)) return false;
      const touching = [orient(a, b, c) === 0 && onSegment(a, b, c), orient(a, b, d) === 0 && onSegment(a, b, d),
        orient(c, d, a) === 0 && onSegment(c, d, a), orient(c, d, b) === 0 && onSegment(c, d, b)];
      if (touching.some(Boolean)) return false;
    }
  }
  return true;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

/**
 * Splits a simple polygon along the chord between two vertices. Returns null when the
 * chord is invalid (same/adjacent vertices, crosses the boundary, or runs outside).
 */
export function splitPolygon(polygon: Point[], i: number, j: number): [Point[], Point[]] | null {
  const n = polygon.length;
  if (n < 4 || i === j || i < 0 || j < 0 || i >= n || j >= n) return null;
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  if (hi - lo === 1 || (lo === 0 && hi === n - 1)) return null;
  const a = polygon[lo];
  const b = polygon[hi];
  for (let k = 0; k < n; k += 1) {
    const c = polygon[k];
    const d = polygon[(k + 1) % n];
    if (k === lo || k === hi || (k + 1) % n === lo || (k + 1) % n === hi) continue;
    if (segmentsCross(a, b, c, d)) return null;
  }
  for (let k = 0; k < n; k += 1) {
    if (k !== lo && k !== hi && orient(a, b, polygon[k]) === 0 && onSegment(a, b, polygon[k])) return null;
  }
  if (!pointInPolygon({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, polygon)) return null;
  const first = polygon.slice(lo, hi + 1);
  const second = [...polygon.slice(hi), ...polygon.slice(0, lo + 1)];
  return [first, second];
}
