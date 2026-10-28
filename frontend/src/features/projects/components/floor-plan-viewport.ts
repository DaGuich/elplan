export type ViewBox = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function zoomViewBox(view: ViewBox, factor: number, anchor: Point): ViewBox {
  const width = clamp(view.width * factor, 250, 1000);
  const height = width * 0.7;
  return {
    x: clamp(view.x + (view.width - width) * anchor.x, 0, 1000 - width),
    y: clamp(view.y + (view.height - height) * anchor.y, 0, 700 - height),
    width,
    height,
  };
}

export function panViewBox(view: ViewBox, dx: number, dy: number): ViewBox {
  return {
    ...view,
    x: clamp(view.x + dx, 0, 1000 - view.width),
    y: clamp(view.y + dy, 0, 700 - view.height),
  };
}

// Wheel events do not identify their device: small pixel deltas or horizontal
// movement are treated as trackpad scrolling; Ctrl+wheel is a pinch gesture.
export function isTrackpadPan(event: Pick<WheelEvent, "ctrlKey" | "deltaMode" | "deltaX" | "deltaY">) {
  return !event.ctrlKey && event.deltaMode === 0 &&
    (event.deltaX !== 0 || (Math.abs(event.deltaY) > 0 && Math.abs(event.deltaY) < 50));
}

export function wheelPixels(delta: number, mode: number, pageSize: number) {
  return delta * (mode === 1 ? 16 : mode === 2 ? pageSize : 1);
}

export function attachWheelNavigation(svg: SVGSVGElement, update: (fn: (view: ViewBox) => ViewBox) => void) {
  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const inverse = matrix.inverse();
    const dx = wheelPixels(event.deltaX, event.deltaMode, svg.clientWidth);
    const dy = wheelPixels(event.deltaY, event.deltaMode, svg.clientHeight);
    if (isTrackpadPan(event)) {
      update((current) => panViewBox(current, inverse.a * dx + inverse.c * dy, inverse.b * dx + inverse.d * dy));
    } else if (dy !== 0) {
      const rendered = svg.viewBox.baseVal;
      const x = inverse.a * event.clientX + inverse.c * event.clientY + inverse.e;
      const y = inverse.b * event.clientX + inverse.d * event.clientY + inverse.f;
      const anchor = { x: (x - rendered.x) / rendered.width, y: (y - rendered.y) / rendered.height };
      const factor = Math.exp(clamp(dy, -500, 500) * 0.002);
      update((current) => zoomViewBox(current, factor, anchor));
    }
  };
  svg.addEventListener("wheel", handleWheel, { passive: false });
  return () => svg.removeEventListener("wheel", handleWheel);
}
