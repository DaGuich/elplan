/**
 * Registration-preserving crop (spec 01 "Asset Metadata & Coordinates Preservation").
 *
 * Two persisted values:
 *  - `image_crop`           visible window, [x, y, w, h] as fractions of the source image (unchanged format).
 *  - `image_crop_reference` registration window: the source-image window that is stretched over the
 *                           whole plan rectangle. Optional; absent on legacy data.
 *
 * Registration window R = image_crop_reference ?? image_crop ?? full image.
 *  - Legacy data (no reference): R = saved crop, so the stretched render is exactly the old one.
 *  - The first crop edit persists R as the reference (see `editCrop`); afterwards crops only clip the
 *    image in source coordinates. Image position, scale (`scale_m_per_100_units`) and overlay
 *    coordinates stay fixed, so no coordinate migration is ever needed.
 *  - Rotation is about the plan centre and applied to the image and its clip together (source frame).
 */
export type Crop = [number, number, number, number];
export type Point = { x: number; y: number };
export type PlanSize = { planWidth?: number; planHeight?: number };
export type CropState = { image_crop: Crop | null; image_crop_reference?: Crop | null };
export type Rect = { x: number; y: number; width: number; height: number };

export const PLAN_WIDTH = 1000;
export const PLAN_HEIGHT = 700;
export const MIN_CROP_SIZE = 0.2;
const FULL: Crop = [0, 0, 1, 1];
const EPS = 1e-9;

export function isValidCrop(crop: readonly number[] | null | undefined): crop is Crop {
  return !!crop && crop.length === 4 && crop.every(Number.isFinite)
    && crop[0] >= 0 && crop[1] >= 0 && crop[2] > 0 && crop[3] > 0
    && crop[0] + crop[2] <= 1 + EPS && crop[1] + crop[3] <= 1 + EPS;
}

/** Invalid or missing crops fall back to the whole image. */
export function normalizeCrop(crop: readonly number[] | null | undefined): Crop {
  return isValidCrop(crop) ? [crop[0], crop[1], crop[2], crop[3]] : [...FULL];
}

/** Registration window R (see file header). Never depends on later crop edits once persisted. */
export function resolveRegistration(state: { image_crop?: readonly number[] | null; image_crop_reference?: readonly number[] | null }): Crop {
  if (isValidCrop(state.image_crop_reference)) return normalizeCrop(state.image_crop_reference);
  return normalizeCrop(state.image_crop);
}

/** Clamps one crop edge, keeping the window inside the image and >= MIN_CROP_SIZE. */
export function setCropValue(crop: readonly number[] | null | undefined, index: 0 | 1 | 2 | 3, value: number): Crop {
  const next = normalizeCrop(crop);
  const min = index < 2 ? 0 : MIN_CROP_SIZE;
  const max = index < 2 ? 1 - Math.max(next[index + 2], MIN_CROP_SIZE) : 1 - next[index - 2];
  next[index] = Math.min(Math.max(Number.isFinite(value) ? value : min, min), Math.max(min, max));
  return next;
}

/**
 * Applies a crop edit (`nextCrop`, null = reset). Persists the reference on the first edit
 * (old crop, or the full image for previously uncropped plans) and keeps it afterwards.
 */
export function editCrop(state: CropState, nextCrop: readonly number[] | null): Required<CropState> {
  const reference = isValidCrop(state.image_crop_reference) ? normalizeCrop(state.image_crop_reference) : normalizeCrop(state.image_crop);
  return { image_crop: nextCrop && isValidCrop(nextCrop) ? normalizeCrop(nextCrop) : null, image_crop_reference: reference };
}

function sameCrop(a: Crop, b: Crop): boolean {
  return a.every((value, index) => Math.abs(value - b[index]) < EPS);
}

/**
 * A source-frame clip is only needed when it hides part of the registered image. It is skipped
 * for legacy data, for crop == registration and for a full-image crop: those must show exactly
 * what the legacy render showed (only the fixed canvas clip applied after rotation), including
 * the corners at non-zero rotation.
 */
export function needsSourceClip(state: CropState): boolean {
  if (!isValidCrop(state.image_crop_reference)) return false;
  const crop = normalizeCrop(state.image_crop);
  return !sameCrop(crop, resolveRegistration(state)) && !sameCrop(crop, FULL);
}

export type CropLayout = {
  /** Image rectangle in plan units, before rotation. Depends only on the registration window. */
  image: Rect;
  /**
   * Visible window in plan units, same pre-rotation frame (may extend past the plan rect if crop is wider than R).
   * null when `needsSourceClip` is false: the legacy render had no source-frame clip, only the fixed canvas clip after rotation.
   */
  clip: Rect | null;
  /** Transform for the <g> holding image and clip; rotation about the plan centre. */
  transform: string | undefined;
};

/**
 * SVG usage:
 *   {clip && <clipPath id="c"><rect {...clip}/></clipPath>}
 *   <g clipPath="url(#plan-image-clip)">             // existing plan-rect clip (optional)
 *     <g transform={transform}>
 *       <image href=… {...image} preserveAspectRatio="none" clipPath={clip ? "url(#c)" : undefined}/>
 *     </g>
 *   </g>
 * Legacy (reference absent) gives clip == null (omit the inner clip) and an image identical to the old render.
 */
export function cropLayout(state: CropState, rotationDeg = 0, size: PlanSize = {}): CropLayout {
  const pw = size.planWidth ?? PLAN_WIDTH;
  const ph = size.planHeight ?? PLAN_HEIGHT;
  const [rx, ry, rw, rh] = resolveRegistration(state);
  const [cx, cy, cw, ch] = normalizeCrop(state.image_crop);
  const iw = pw / rw;
  const ih = ph / rh;
  return {
    image: { x: -rx * iw, y: -ry * ih, width: iw, height: ih },
    clip: needsSourceClip(state) ? { x: (cx - rx) * iw, y: (cy - ry) * ih, width: cw * iw, height: ch * ih } : null,
    transform: rotationDeg ? `rotate(${rotationDeg},${pw / 2},${ph / 2})` : undefined,
  };
}

function rotate(p: Point, deg: number, size: PlanSize, inverse: boolean): Point {
  if (!deg) return p;
  const a = ((inverse ? -deg : deg) * Math.PI) / 180;
  const cx = (size.planWidth ?? PLAN_WIDTH) / 2;
  const cy = (size.planHeight ?? PLAN_HEIGHT) / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** Normalized source-image point (0..1) -> plan coordinates, for registration window `reg`. */
export function imageToPlan(p: Point, reg: readonly number[], rotationDeg = 0, size: PlanSize = {}): Point {
  const [rx, ry, rw, rh] = normalizeCrop(reg);
  return rotate({ x: ((p.x - rx) / rw) * (size.planWidth ?? PLAN_WIDTH), y: ((p.y - ry) / rh) * (size.planHeight ?? PLAN_HEIGHT) }, rotationDeg, size, false);
}

/** Inverse of `imageToPlan`. */
export function planToImage(p: Point, reg: readonly number[], rotationDeg = 0, size: PlanSize = {}): Point {
  const [rx, ry, rw, rh] = normalizeCrop(reg);
  const q = rotate(p, rotationDeg, size, true);
  return { x: rx + (q.x / (size.planWidth ?? PLAN_WIDTH)) * rw, y: ry + (q.y / (size.planHeight ?? PLAN_HEIGHT)) * rh };
}

/** Raster pixel (full source raster of sourceWidth x sourceHeight) -> plan coordinates. */
export function rasterToPlan(p: Point, sourceWidth: number, sourceHeight: number, reg: readonly number[], rotationDeg = 0, size: PlanSize = {}): Point {
  return imageToPlan({ x: p.x / sourceWidth, y: p.y / sourceHeight }, reg, rotationDeg, size);
}

/** Plan area per source pixel squared; constant for a given registration (crop-independent). */
export function planAreaPerRasterPixel(sourceWidth: number, sourceHeight: number, reg: readonly number[], size: PlanSize = {}): number {
  const [, , rw, rh] = normalizeCrop(reg);
  return ((size.planWidth ?? PLAN_WIDTH) / (rw * sourceWidth)) * ((size.planHeight ?? PLAN_HEIGHT) / (rh * sourceHeight));
}

/** Visible crop window in source pixels (pre-rotation) to restrict raster analysis to. */
export function visibleRasterWindow(crop: readonly number[] | null | undefined, sourceWidth: number, sourceHeight: number): Rect {
  const [cx, cy, cw, ch] = normalizeCrop(crop);
  return { x: cx * sourceWidth, y: cy * sourceHeight, width: cw * sourceWidth, height: ch * sourceHeight };
}

/** True if the plan point lies in the visible (clipped) part of the blueprint. */
export function isInsideCrop(p: Point, state: CropState, rotationDeg = 0, size: PlanSize = {}): boolean {
  const [cx, cy, cw, ch] = normalizeCrop(state.image_crop);
  const q = planToImage(p, resolveRegistration(state), rotationDeg, size);
  return q.x >= cx - EPS && q.x <= cx + cw + EPS && q.y >= cy - EPS && q.y <= cy + ch + EPS;
}

/** Visible window corners in plan coordinates (rotated). */
export function cropPolygon(state: CropState, rotationDeg = 0, size: PlanSize = {}): Point[] {
  const [cx, cy, cw, ch] = normalizeCrop(state.image_crop);
  const reg = resolveRegistration(state);
  return ([[cx, cy], [cx + cw, cy], [cx + cw, cy + ch], [cx, cy + ch]] as const).map(([x, y]) => imageToPlan({ x, y }, reg, rotationDeg, size));
}

/** Physical area (m²) of a plan-unit area; scale is metres per 100 plan units. */
export function planAreaToSquareMeters(planArea: number, metersPer100Units: number): number {
  const perUnit = metersPer100Units / 100;
  return planArea * perUnit * perUnit;
}
