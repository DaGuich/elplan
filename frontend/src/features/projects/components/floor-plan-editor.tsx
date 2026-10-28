import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, PDFDocumentProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import {
  ElectricalComponent,
  ElectricalCircuit,
  CustomComponent,
  FloorPlanData,
  MountingPoint,
  PlanPlacement,
  PlanLayer,
  ResidualCurrentDevice,
  RoomPlanItem,
  TerminalStrip,
  emptyFloorPlan,
} from "../api";
import { useFloorPlan, useSaveFloorPlan } from "../queries";
import { CabinetEditor } from "./cabinet-editor";
import { DocumentationPanel } from "./documentation-panel";
import { SmartSystemsEditor } from "./smart-systems-editor";

type Props = {
  projectId: number;
  floorId: number;
  floorName: string;
  projectName: string;
};

type ViewTab = "layout" | "circuits" | "cabinet" | "smart" | "documentation";
type Tool = "select" | "room" | "scale" | "dimension" | PlanPlacement["kind"];
type DragState = {
  kind: "room" | "placement";
  ids: string[];
  dx: number;
  dy: number;
  originX: number;
  originY: number;
  positions: Map<string, { x: number; y: number }>;
};

const symbolKinds: { kind: PlanPlacement["kind"]; label: string; glyph: string }[] = [
  { kind: "socket", label: "Socket", glyph: "S" },
  { kind: "light", label: "Light", glyph: "L" },
  { kind: "switch", label: "Switch", glyph: "T" },
  { kind: "smoke_detector", label: "Smoke detector", glyph: "R" },
  { kind: "network", label: "Network", glyph: "N" },
  { kind: "distribution", label: "Distribution board", glyph: "DB" },
  { kind: "pv", label: "Photovoltaics", glyph: "PV" },
  { kind: "knx", label: "KNX", glyph: "KNX" },
  { kind: "custom", label: "Custom symbol", glyph: "+" },
  { kind: "doorbell", label: "Doorbell", glyph: "DB" },
  { kind: "data_outlet", label: "Data outlet", glyph: "RJ" },
  { kind: "thermostat", label: "Thermostat", glyph: "TH" },
  { kind: "motion_sensor", label: "Motion sensor", glyph: "PIR" },
  { kind: "camera", label: "Camera", glyph: "CAM" },
  { kind: "alarm", label: "Alarm", glyph: "A" },
  { kind: "speaker", label: "Speaker", glyph: "SP" },
  { kind: "door_contact", label: "Window / door contact", glyph: "C" },
  { kind: "blind", label: "Blind / shutter", glyph: "B" },
  { kind: "dali", label: "DALI", glyph: "DALI" },
  { kind: "loxone", label: "Loxone", glyph: "LOX" },
  { kind: "free_at_home", label: "Busch-free@home", glyph: "BH" },
  { kind: "homematic", label: "Homematic IP Wired", glyph: "HM" },
  { kind: "ekey", label: "ekey access", glyph: "EK" },
  { kind: "gira_door", label: "Gira door station", glyph: "G" },
  { kind: "led_driver", label: "LED driver", glyph: "LED" },
  { kind: "actuator", label: "Actuator", glyph: "ACT" },
  { kind: "binary_input", label: "Binary input", glyph: "BI" },
  { kind: "presence_detector", label: "Presence detector", glyph: "PD" },
  { kind: "bus_coupler", label: "Bus coupler", glyph: "BC" },
  { kind: "power_supply", label: "Power supply", glyph: "PS" },
  { kind: "surge_protection", label: "Surge protection", glyph: "SPD" },
  { kind: "main_switch", label: "Main switch", glyph: "MS" },
  { kind: "contactor", label: "Contactor", glyph: "K" },
  { kind: "relay", label: "Relay", glyph: "R" },
  { kind: "terminal", label: "Terminal", glyph: "X" },
];

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

function svgPoint(svg: SVGSVGElement, event: { clientX: number; clientY: number }) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function circuitNumber(circuit: ElectricalCircuit, rcds: ResidualCurrentDevice[], circuits: ElectricalCircuit[]) {
  const group = rcds.findIndex((rcd) => rcd.id === circuit.rcd_id);
  const numberInGroup = circuits.filter((item) => item.rcd_id === circuit.rcd_id).findIndex((item) => item.id === circuit.id);
  return `F${group + 1}.${numberInGroup + 1}`;
}

function dxfSafe(value: string) {
  return value.replace(/[^\x20-\x7E]/g, "?").replace(/\r?\n/g, " ");
}

export function FloorPlanEditor({ projectId, floorId, floorName, projectName }: Props) {
  const query = useFloorPlan(projectId, floorId);
  const save = useSaveFloorPlan(projectId, floorId);
  const [data, setData] = useState<FloorPlanData>(emptyFloorPlan);
  const [tool, setTool] = useState<Tool>("select");
  const [tab, setTab] = useState<ViewTab>("layout");
  const [selection, setSelection] = useState<{ kind: "room" | "placement"; id: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeLayerId, setActiveLayerId] = useState("installation");
  const [customLabel, setCustomLabel] = useState("");
  const [selectedCustomComponentId, setSelectedCustomComponentId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [calibrationStart, setCalibrationStart] = useState<{ x: number; y: number } | null>(null);
  const [calibrationEnd, setCalibrationEnd] = useState<{ x: number; y: number } | null>(null);
  const [calibrationMeters, setCalibrationMeters] = useState("");
  const [measurementStart, setMeasurementStart] = useState<{ x: number; y: number } | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 1000, height: 700 });
  const [clipboard, setClipboard] = useState<{ rooms: RoomPlanItem[]; placements: PlanPlacement[] }>({ rooms: [], placements: [] });
  const [showElementIds, setShowElementIds] = useState(true);
  const [showBusAddresses, setShowBusAddresses] = useState(true);
  const [showCircuitNames, setShowCircuitNames] = useState(true);
  const [showFuseAssignments, setShowFuseAssignments] = useState(true);
  const [showGroupLabels, setShowGroupLabels] = useState(true);
  const [showRoomOverlays, setShowRoomOverlays] = useState(true);
  const [detectedRooms, setDetectedRooms] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (query.data) setData(query.data);
  }, [floorId, query.data]);

  const circuitCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const circuit of data.circuits) counts.set(circuit.rcd_id, (counts.get(circuit.rcd_id) ?? 0) + 1);
    return counts;
  }, [data.circuits]);
  const selectedRoom = selection?.kind === "room" ? data.rooms.find((room) => room.id === selection.id) : undefined;
  const selectedPlacement = selection?.kind === "placement" ? data.placements.find((item) => item.id === selection.id) : undefined;
  const layerIsVisible = (layerId: string) => {
    const layer = data.layers.find((item) => item.id === layerId);
    if (!layer || !layer.visible) return false;
    return !isClientPresentation || layer.purpose === "client" || layer.purpose === "architecture";
  };
  const selectedPlacements = data.placements.filter((item) => selectedIds.includes(item.id));
  const selectedRooms = data.rooms.filter((item) => selectedIds.includes(item.id));
  const isClientPresentation = data.annotation.presentation_mode === "client";

  function update(patch: Partial<FloorPlanData>) {
    setData((current) => ({ ...current, ...patch }));
    setFeedback("Unsaved changes");
  }

  function addRoom(
    name = "Room",
    templatePoints: { kind: PlanPlacement["kind"]; label: string; dx: number; dy: number }[] = []
  ) {
    const room: RoomPlanItem = {
      id: newId(),
      name,
      x: 100 + (data.rooms.length % 4) * 205,
      y: 80 + Math.floor(data.rooms.length / 4) * 145,
      width: 180,
      height: 115,
      color: "#eaf3f1",
      layer_id: activeLayerId,
    };
    const placements: PlanPlacement[] = templatePoints.map(({ kind, label, dx, dy }) => ({
      id: newId(),
      kind,
      label,
      x: room.x + dx,
      y: room.y + dy,
      rotation: 0,
      room_id: room.id,
      mounting_point_id: null,
      circuit_id: null,
      device_id: null,
      channel_id: null,
      layer_id: activeLayerId,
      color: "#2b8270",
      element_id: null,
      bus_address: null,
      cable_type: null,
      target_location: null,
      metadata: {},
    }));
    update({ rooms: [...data.rooms, room], placements: [...data.placements, ...placements] });
    setSelection({ kind: "room", id: room.id });
    setSelectedIds([room.id]);
  }

  function addPlacement(kind: PlanPlacement["kind"], label?: string, metadata: Record<string, string> = {}) {
    const point: PlanPlacement = {
      id: newId(),
      kind,
      label: label?.trim() || symbolKinds.find((item) => item.kind === kind)?.label || "Device",
      x: 500,
      y: 350,
      rotation: 0,
      room_id: null,
      mounting_point_id: null,
      circuit_id: null,
      device_id: null,
      channel_id: null,
      layer_id: activeLayerId,
      color: "#2b8270",
      element_id: `${kind.toUpperCase()}-${data.placements.filter((item) => item.kind === kind).length + 1}`,
      bus_address: null,
      cable_type: null,
      target_location: null,
      metadata,
    };
    update({ placements: [...data.placements, point] });
    setSelection({ kind: "placement", id: point.id });
    setSelectedIds([point.id]);
    setTool("select");
    return point;
  }

  function beginDrag(event: PointerEvent<SVGElement>, kind: DragState["kind"], id: string, x: number, y: number) {
    event.stopPropagation();
    const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const point = svgPoint(svg, event);
    const multiSelect = event.ctrlKey || event.metaKey;
    const ids = multiSelect
      ? selectedIds.includes(id) ? selectedIds : [...selectedIds, id]
      : selectedIds.includes(id) ? selectedIds : [id];
    const positions = new Map([...data.rooms, ...data.placements]
      .filter((item) => ids.includes(item.id))
      .map((item) => [item.id, { x: item.x, y: item.y }]));
    dragRef.current = {
      kind,
      ids,
      dx: point.x - x,
      dy: point.y - y,
      originX: x,
      originY: y,
      positions,
    };
    setSelectedIds(ids);
    setSelection({ kind, id });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasDown(event: PointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return;
    const point = svgPoint(svgRef.current, event);
    if (event.shiftKey && tool === "select") {
      panRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        x: viewBox.x,
        y: viewBox.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "room") {
      const room: RoomPlanItem = {
        id: newId(),
        name: "Room",
        x: clamp(point.x - 90, 0, 820),
        y: clamp(point.y - 57, 0, 585),
        width: 180,
        height: 115,
        color: "#eaf3f1",
        layer_id: activeLayerId,
      };
      update({ rooms: [...data.rooms, room] });
      setSelection({ kind: "room", id: room.id });
      setSelectedIds([room.id]);
      setTool("select");
      return;
    }
    if (tool === "scale") {
      if (!calibrationStart) {
        setCalibrationStart(point);
        setFeedback("Click the end of a known distance on the plan.");
      } else {
        setCalibrationEnd(point);
        setTool("select");
        setFeedback("Enter the real-world distance, then apply the calibration.");
      }
      return;
    }
    if (tool === "dimension") {
      if (!measurementStart) {
        setMeasurementStart(point);
        setFeedback("Click the end point of the dimension.");
      } else {
        const distanceUnits = Math.hypot(point.x - measurementStart.x, point.y - measurementStart.y);
        const realLength = data.scale_m_per_100_units
          ? (distanceUnits / 100) * data.scale_m_per_100_units
          : distanceUnits;
        const dimension = {
          id: newId(),
          x1: measurementStart.x,
          y1: measurementStart.y,
          x2: point.x,
          y2: point.y,
          label: `${realLength.toFixed(2)} ${data.scale_m_per_100_units ? "m" : "units"}`,
        };
        update({ dimensions: [...data.dimensions, dimension] });
        setMeasurementStart(null);
        setTool("select");
      }
      return;
    }
    if (tool !== "select") {
      const placement = addPlacement(
        tool,
        tool === "custom" ? customLabel : undefined,
        tool === "custom" && selectedCustomComponentId ? { custom_component_id: selectedCustomComponentId } : {}
      );
      const room = data.rooms.find((item) =>
        point.x >= item.x && point.x <= item.x + item.width &&
        point.y >= item.y && point.y <= item.y + item.height
      );
      setData((current) => {
        return {
          ...current,
          placements: current.placements.map((item) =>
            item.id === placement.id
              ? { ...item, x: clamp(point.x, 16, 984), y: clamp(point.y, 16, 684), room_id: room?.id ?? null }
              : item
          ),
        };
      });
      return;
    }
    setSelection(null);
    setSelectedIds([]);
  }

  function handleCanvasMove(event: PointerEvent<SVGSVGElement>) {
    if (panRef.current && svgRef.current) {
      const bounds = svgRef.current.getBoundingClientRect();
      const scaleX = viewBox.width / bounds.width;
      const scaleY = viewBox.height / bounds.height;
      setViewBox((current) => ({
        ...current,
        x: clamp(panRef.current!.x - (event.clientX - panRef.current!.clientX) * scaleX, 0, 1000 - current.width),
        y: clamp(panRef.current!.y - (event.clientY - panRef.current!.clientY) * scaleY, 0, 700 - current.height),
      }));
      return;
    }
    const drag = dragRef.current;
    if (!drag || !svgRef.current) return;
    const point = svgPoint(svgRef.current, event);
    const deltaX = point.x - drag.dx - drag.originX;
    const deltaY = point.y - drag.dy - drag.originY;
    const rooms = data.rooms.map((room) => {
      if (!drag.ids.includes(room.id)) return room;
      const original = drag.positions.get(room.id);
      if (!original) return room;
      return {
        ...room,
        x: clamp(original.x + deltaX, 0, 1000 - room.width),
        y: clamp(original.y + deltaY, 0, 700 - room.height),
      };
    });
    const placements = data.placements.map((item) => {
      if (!drag.ids.includes(item.id)) return item;
      const original = drag.positions.get(item.id);
      if (!original) return item;
      let x = clamp(original.x + deltaX, 16, 984);
      let y = clamp(original.y + deltaY, 16, 684);
      for (const room of rooms) {
        const edges = [
          { dx: Math.abs(x - room.x), value: room.x, axis: "x" },
          { dx: Math.abs(x - room.x - room.width), value: room.x + room.width, axis: "x" },
          { dx: Math.abs(y - room.y), value: room.y, axis: "y" },
          { dx: Math.abs(y - room.y - room.height), value: room.y + room.height, axis: "y" },
        ];
        for (const edge of edges) {
          if (edge.dx < 10) {
            if (edge.axis === "x") x = clamp(edge.value, 16, 984);
            else y = clamp(edge.value, 16, 684);
          }
        }
      }
      const containingRoom = rooms.find((room) =>
        x >= room.x && x <= room.x + room.width && y >= room.y && y <= room.y + room.height
      );
      return { ...item, x, y, room_id: containingRoom?.id ?? null };
    });
    update({ rooms, placements });
  }

  function zoomCanvas(factor: number) {
    setViewBox((current) => {
      const width = clamp(current.width * factor, 250, 1000);
      const height = width * 0.7;
      return {
        x: clamp(current.x + (current.width - width) / 2, 0, 1000 - width),
        y: clamp(current.y + (current.height - height) / 2, 0, 700 - height),
        width,
        height,
      };
    });
  }

  function groupSelectedPlacements() {
    if (selectedPlacements.length < 2) {
      setFeedback("Select at least two installation points to create a mounting group.");
      return;
    }
    const mountingPoint: MountingPoint = {
      id: newId(),
      name: `Mounting group ${data.mounting_points.length + 1}`,
      x: selectedPlacements.reduce((sum, item) => sum + item.x, 0) / selectedPlacements.length,
      y: selectedPlacements.reduce((sum, item) => sum + item.y, 0) / selectedPlacements.length,
      rotation: 0,
      placement_ids: selectedPlacements.map((item) => item.id),
    };
    const selected = new Set(mountingPoint.placement_ids);
    update({
      mounting_points: [
        ...data.mounting_points
          .map((point) => ({ ...point, placement_ids: point.placement_ids.filter((id) => !selected.has(id)) }))
          .filter((point) => point.placement_ids.length > 0),
        mountingPoint,
      ],
      placements: data.placements.map((item) => mountingPoint.placement_ids.includes(item.id)
        ? { ...item, mounting_point_id: mountingPoint.id }
        : item),
    });
    setFeedback("Mounting group created.");
  }

  function saveCustomComponent() {
    const name = customLabel.trim();
    if (!name) {
      setFeedback("Enter a name for the custom symbol.");
      return;
    }
    const component: CustomComponent = {
      id: newId(),
      name,
      kind: "custom",
      te_width: 1,
      channel_kinds: [],
      color: "#2b8270",
      favorite: false,
    };
    update({ custom_components: [...data.custom_components, component] });
    setSelectedCustomComponentId(component.id);
    setFeedback("Custom symbol saved to the library.");
  }

  function rotateSelection(degrees: number) {
    if (selectedPlacements.length === 0) return;
    const grouped = new Set(
      selectedPlacements
        .map((item) => item.mounting_point_id)
        .filter((id): id is string => Boolean(id))
    );
    if (grouped.size === 1 && selectedPlacements.every((item) => item.mounting_point_id === [...grouped][0])) {
      const mountingPointId = [...grouped][0];
      const mountingPoint = data.mounting_points.find((item) => item.id === mountingPointId);
      if (mountingPoint) {
        const angle = degrees * Math.PI / 180;
        update({
          mounting_points: data.mounting_points.map((item) => item.id === mountingPointId
            ? { ...item, rotation: ((item.rotation + degrees) % 360 + 360) % 360 }
            : item),
          placements: data.placements.map((item) => {
            if (item.mounting_point_id !== mountingPointId) return item;
            const dx = item.x - mountingPoint.x;
            const dy = item.y - mountingPoint.y;
            return {
              ...item,
              x: mountingPoint.x + dx * Math.cos(angle) - dy * Math.sin(angle),
              y: mountingPoint.y + dx * Math.sin(angle) + dy * Math.cos(angle),
              rotation: (item.rotation + degrees + 360) % 360,
            };
          }),
        });
        return;
      }
    }
    const selected = new Set(selectedIds);
    update({
      placements: data.placements.map((item) => selected.has(item.id)
        ? { ...item, rotation: (item.rotation + degrees + 360) % 360 }
        : item),
    });
  }

  function addFreeNote() {
    const label = window.prompt("Plan note", "Note");
    if (label === null || !label.trim()) return;
    const note = {
      id: newId(),
      kind: "note" as const,
      label: label.trim(),
      points: [[500, 350] as [number, number]],
      color: data.layers.find((layer) => layer.id === activeLayerId)?.color ?? "#ca834c",
      layer_id: activeLayerId,
      width: 1,
    };
    update({ free_canvas: [...data.free_canvas, note] });
  }

  async function detectRoomRegions() {
    if (!data.background_image) {
      setFeedback("Import a floor-plan image before detecting rooms.");
      return;
    }
    try {
      const image = new Image();
      image.src = data.background_image;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Could not decode floor-plan image."));
      });
      const canvas = window.document.createElement("canvas");
      const width = 100;
      const height = 70;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Could not analyze floor-plan image.");
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const visited = new Uint8Array(width * height);
      const detected: { x: number; y: number; width: number; height: number; area: number }[] = [];
      for (let index = 0; index < width * height; index += 1) {
        const pixelOffset = index * 4;
        const light = (pixels[pixelOffset] + pixels[pixelOffset + 1] + pixels[pixelOffset + 2]) / 3;
        if (visited[index] || light < 205) continue;
        const queue = [index];
        visited[index] = 1;
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        let area = 0;
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const current = queue[cursor];
          const x = current % width;
          const y = Math.floor(current / width);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          area += 1;
          for (const neighbor of [current - 1, current + 1, current - width, current + width]) {
            if (neighbor < 0 || neighbor >= width * height || visited[neighbor]) continue;
            const nx = neighbor % width;
            const offset = neighbor * 4;
            const neighborLight = (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) / 3;
            if (Math.abs(nx - x) + Math.abs(Math.floor(neighbor / width) - y) !== 1 || neighborLight < 205) continue;
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
        const boxWidth = maxX - minX + 1;
        const boxHeight = maxY - minY + 1;
        if (area >= 12 && area <= 1000 && boxWidth >= 8 && boxHeight >= 8) {
          detected.push({
            x: minX * 10,
            y: minY * 10,
            width: boxWidth * 10,
            height: boxHeight * 10,
            area,
          });
        }
      }
      const regions = detected
        .sort((a, b) => b.area - a.area)
        .filter((region, index, list) => !list.slice(0, index).some((other) =>
          region.x >= other.x && region.y >= other.y &&
          region.x + region.width <= other.x + other.width &&
          region.y + region.height <= other.y + other.height
        ))
        .slice(0, 30);
      if (regions.length === 0) {
        setFeedback("No enclosed room areas found. Add rooms manually or try a clearer plan.");
        return;
      }
      const rooms: RoomPlanItem[] = regions.map((region, index) => ({
        id: newId(),
        name: `Detected room ${index + 1}`,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        color: "#eaf3f1",
        layer_id: activeLayerId,
      }));
      update({ rooms: [...data.rooms, ...rooms] });
      setDetectedRooms(true);
      setFeedback(`${rooms.length} room region${rooms.length === 1 ? "" : "s"} detected. Review and rename them.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not detect room regions.");
    }
  }

  async function renderPdfPage(pdfDocument: PDFDocumentProxy, pageNumber: number) {
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = window.document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create a PDF rendering context.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const image = canvas.toDataURL("image/jpeg", 0.88);
    if (image.length > 4_000_000) throw new Error("Rendered plan page is too large to save.");
    update({ background_image: image });
    setFeedback(`PDF page ${pageNumber} imported. Save to store it with this floor.`);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.type === "application/pdf") {
      if (file.size > 10_000_000) {
        setFeedback("Floor-plan PDFs must be 10 MB or smaller.");
        return;
      }
      try {
        const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        setPdfDocument(pdf);
        setPdfPageCount(pdf.numPages);
        setPdfPage(1);
        await renderPdfPage(pdf, 1);
      } catch (error) {
        setFeedback(error instanceof Error ? `Could not import PDF: ${error.message}` : "Could not import PDF.");
      }
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setFeedback("Choose a PDF, PNG, JPEG, or WebP floor-plan file.");
      return;
    }
    if (file.size > 2_500_000) {
      setFeedback("Floor-plan images must be 2.5 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        update({ background_image: reader.result });
        setPdfDocument(null);
        setPdfPageCount(0);
        setFeedback("Floor-plan image added. Save to store it with this floor.");
      }
    };
    reader.onerror = () => setFeedback("Could not read the selected image.");
    reader.readAsDataURL(file);
  }

  function addRcd() {
    const rcd: ResidualCurrentDevice = {
      id: newId(),
      name: `RCD ${data.rcds.length + 1}`,
      rated_current_ma: 30,
      poles: 4,
      type: "A",
      upstream_id: null,
      price: 0,
    };
    update({ rcds: [...data.rcds, rcd] });
  }

  function addCircuit(rcdId: string) {
    const circuit: ElectricalCircuit = {
      id: newId(),
      name: "Final circuit",
      rcd_id: rcdId,
      breaker_type: "B",
      rated_current_a: 16,
      poles: 1,
      cable: "3×1.5 mm²",
      loads: [],
      supply: "1n",
      price: 0,
    };
    update({ circuits: [...data.circuits, circuit] });
  }

  function addElectricalComponent(kind: ElectricalComponent["kind"]) {
    const labels: Record<ElectricalComponent["kind"], string> = {
      main_switch: "Main switch",
      surge_protection: "Surge protection",
      contactor: "Contactor",
      relay: "Relay",
      terminal: "Terminal block",
      power_supply: "Power supply",
      transfer_switch: "Transfer switch",
      phase_selector: "Phase selector",
      potential_free_contact: "Potential-free contact",
      distribution_link: "Distribution link",
    };
    const component: ElectricalComponent = {
      id: newId(),
      kind,
      name: `${labels[kind]} ${data.electrical_components.filter((item) => item.kind === kind).length + 1}`,
      reference: null,
      rated_current_a: kind === "main_switch" ? 63 : null,
      poles: kind === "relay" || kind === "terminal" ? 2 : 4,
      te_width: kind === "surge_protection" ? 4 : 2,
      terminal_count: kind === "terminal" ? 4 : 0,
      contact_count: kind === "contactor" || kind === "relay" ? 2 : 0,
      controlled_component_id: null,
      circuit_ids: [],
      color: "#536c98",
      price: 0,
    };
    update({ electrical_components: [...data.electrical_components, component] });
  }

  function generateTerminalStrip(rcdId: string) {
    const circuits = data.circuits.filter((item) => item.rcd_id === rcdId);
    if (circuits.length === 0) {
      setFeedback("Add outgoing circuits before generating their terminal strip.");
      return;
    }
    const rcdIndex = data.rcds.findIndex((item) => item.id === rcdId) + 1;
    const strip: TerminalStrip = {
      id: newId(),
      name: `Terminal strip X${rcdIndex}`,
      kind: "internal",
      circuit_ids: circuits.map((item) => item.id),
      terminals_per_circuit: 3,
      terminal_width_mm: 5,
      end_brackets: 2,
      separators: Math.max(circuits.length - 1, 0),
    };
    update({ terminal_strips: [...data.terminal_strips, strip] });
  }

  function applyScaleCalibration() {
    if (!calibrationStart || !calibrationEnd) return;
    const distance = Math.hypot(calibrationEnd.x - calibrationStart.x, calibrationEnd.y - calibrationStart.y);
    const meters = Number(calibrationMeters);
    const scale = meters / (distance / 100);
    if (!Number.isFinite(meters) || meters <= 0 || distance === 0 || !Number.isFinite(scale) || scale > 1000) {
      setFeedback("Enter a positive distance greater than zero.");
      return;
    }
    update({ scale_m_per_100_units: scale });
    setCalibrationStart(null);
    setCalibrationEnd(null);
    setCalibrationMeters("");
    setFeedback("Scale calibrated. Save to store this measurement.");
  }

  function updateCircuit(id: string, patch: Partial<ElectricalCircuit>) {
    const updatedCircuits = data.circuits.map((item) => (item.id === id ? { ...item, ...patch } : item));
    if (!patch.loads) {
      update({ circuits: updatedCircuits });
      return;
    }
    const assignedLoads = new Set(patch.loads);
    const placements = data.placements.map((item) => ({
      ...item,
      circuit_id: assignedLoads.has(item.id)
        ? id
        : item.circuit_id === id
          ? null
          : item.circuit_id,
    }));
    update({
      circuits: updatedCircuits.map((item) => item.id === id
        ? item
        : { ...item, loads: item.loads.filter((loadId) => !assignedLoads.has(loadId)) }),
      placements,
      smart_devices: data.smart_devices.map((device) => ({
        ...device,
        channels: device.channels.map((channel) => ({
          ...channel,
          circuit_id: channel.load_ids.some((loadId) => assignedLoads.has(loadId))
            ? channel.load_ids.every((loadId) => updatedCircuits.find((item) => item.id === id)?.loads.includes(loadId))
              ? id
              : null
            : channel.circuit_id === id
              ? null
              : channel.circuit_id,
        })),
      })),
    });
  }

  function removeCircuit(id: string) {
    update({
      circuits: data.circuits.filter((item) => item.id !== id),
      placements: data.placements.map((item) => item.circuit_id === id ? { ...item, circuit_id: null } : item),
      smart_devices: data.smart_devices.map((device) => ({
        ...device,
        circuit_id: device.circuit_id === id ? null : device.circuit_id,
        channels: device.channels.map((channel) => channel.circuit_id === id ? { ...channel, circuit_id: null } : channel),
      })),
      measurements: data.measurements.filter((item) => item.circuit_id !== id),
      electrical_components: data.electrical_components.map((item) => ({
        ...item,
        circuit_ids: item.circuit_ids.filter((circuitId) => circuitId !== id),
      })),
      terminal_strips: data.terminal_strips.map((strip) => ({
        ...strip,
        circuit_ids: strip.circuit_ids.filter((circuitId) => circuitId !== id),
      })),
      cabinet: {
        ...data.cabinet,
        modules: data.cabinet.modules.filter((module) => module.component_id !== id),
      },
    });
  }

  function removeRcd(id: string) {
    const removedCircuitIds = new Set(data.circuits.filter((circuit) => circuit.rcd_id === id).map((circuit) => circuit.id));
    update({
      rcds: data.rcds.filter((item) => item.id !== id).map((item) => item.upstream_id === id ? { ...item, upstream_id: null } : item),
      circuits: data.circuits.filter((item) => item.rcd_id !== id),
      placements: data.placements.map((item) => removedCircuitIds.has(item.circuit_id ?? "") ? { ...item, circuit_id: null } : item),
      smart_devices: data.smart_devices.map((device) => ({
        ...device,
        circuit_id: removedCircuitIds.has(device.circuit_id ?? "") ? null : device.circuit_id,
        channels: device.channels.map((channel) => removedCircuitIds.has(channel.circuit_id ?? "") ? { ...channel, circuit_id: null } : channel),
      })),
      measurements: data.measurements.filter((item) => !removedCircuitIds.has(item.circuit_id ?? "")),
      electrical_components: data.electrical_components.map((item) => ({
        ...item,
        circuit_ids: item.circuit_ids.filter((circuitId) => !removedCircuitIds.has(circuitId)),
      })),
      terminal_strips: data.terminal_strips.map((strip) => ({
        ...strip,
        circuit_ids: strip.circuit_ids.filter((circuitId) => !removedCircuitIds.has(circuitId)),
      })),
      cabinet: {
        ...data.cabinet,
        modules: data.cabinet.modules.filter((module) => !removedCircuitIds.has(module.component_id)),
      },
    });
  }

  function copySelection() {
    if (selectedIds.length === 0) return;
    setClipboard({
      rooms: data.rooms.filter((item) => selectedIds.includes(item.id)),
      placements: data.placements.filter((item) => selectedIds.includes(item.id)),
    });
    setFeedback("Selection copied.");
  }

  function pasteSelection() {
    if (!clipboard.rooms.length && !clipboard.placements.length) return;
    const ids = new Map<string, string>();
    for (const item of [...clipboard.rooms, ...clipboard.placements]) ids.set(item.id, newId());
    const rooms = clipboard.rooms.map((item) => ({
      ...item,
      id: ids.get(item.id)!,
      x: clamp(item.x + 20, 0, 1000 - item.width),
      y: clamp(item.y + 20, 0, 700 - item.height),
    }));
    const placements = clipboard.placements.map((item) => ({
      ...item,
      id: ids.get(item.id)!,
      x: clamp(item.x + 20, 16, 984),
      y: clamp(item.y + 20, 16, 684),
      room_id: item.room_id && ids.has(item.room_id) ? ids.get(item.room_id)! : item.room_id,
      mounting_point_id: null,
      device_id: null,
      channel_id: null,
      bus_address: null,
    }));
    const placementIds = new Set(placements.map((item) => item.id));
    update({
      rooms: [...data.rooms, ...rooms],
      placements: [...data.placements, ...placements],
      circuits: data.circuits.map((circuit) => ({
        ...circuit,
        loads: [...circuit.loads, ...placements.filter((item) => item.circuit_id === circuit.id).map((item) => item.id)],
      })),
    });
    setSelectedIds([...rooms.map((item) => item.id), ...placements.map((item) => item.id)]);
    if (placements.length) setSelection({ kind: "placement", id: placements[0].id });
    else if (rooms.length) setSelection({ kind: "room", id: rooms[0].id });
    if (placementIds.size > 0) setFeedback("Selection duplicated.");
  }

  function removeSelection() {
    if (selectedIds.length === 0) return;
    const removed = new Set(selectedIds);
    update({
      rooms: data.rooms.filter((item) => !removed.has(item.id)),
      placements: data.placements
        .filter((item) => !removed.has(item.id))
        .map((item) => removed.has(item.room_id ?? "") ? { ...item, room_id: null } : item),
      mounting_points: data.mounting_points
        .map((point) => ({ ...point, placement_ids: point.placement_ids.filter((id) => !removed.has(id)) }))
        .filter((point) => point.placement_ids.length > 0),
      circuits: data.circuits.map((circuit) => ({
        ...circuit,
        loads: circuit.loads.filter((loadId) => !removed.has(loadId)),
      })),
      smart_devices: data.smart_devices.map((device) => ({
        ...device,
        channels: device.channels.map((channel) => ({
          ...channel,
          load_ids: channel.load_ids.filter((loadId) => !removed.has(loadId)),
        })),
      })),
    });
    setSelection(null);
    setSelectedIds([]);
  }

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelection();
      } else if (command && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteSelection();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0) {
        event.preventDefault();
        removeSelection();
      } else if (event.key === "Escape") {
        setSelectedIds([]);
        setSelection(null);
        setTool("select");
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [clipboard, data, selectedIds, selection]);

  function exportMaterials() {
    const rows = [
      ["Type", "Description", "Quantity"],
      ...symbolKinds
        .map(({ kind, label }) => [label, label, String(data.placements.filter((item) => item.kind === kind).length)])
        .filter((row) => row[2] !== "0"),
      ...data.rcds.map((rcd, index) => ["RCD", `${rcd.name} (${rcd.rated_current_ma} mA, ${rcd.poles}-pole)`, "1"]),
      ...data.circuits.map((circuit) => ["Circuit protection", `${circuitNumber(circuit, data.rcds, data.circuits)} ${circuit.breaker_type}${circuit.rated_current_a} - ${circuit.cable}`, "1"]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${floorName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-materials.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportDxf() {
    const pairs: string[] = [
      "0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "0", "ENDSEC",
      "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(data.layers.length + 1),
      "0", "LAYER", "2", "0", "70", "0", "62", "7", "6", "CONTINUOUS",
    ];
    for (const [index, layer] of data.layers.entries()) {
      pairs.push(
        "0", "LAYER", "2", `L${index + 1}_${dxfSafe(layer.id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 20)}`,
        "70", "0", "62", String((index % 7) + 1), "6", "CONTINUOUS"
      );
    }
    pairs.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
    const layerName = (id: string) => {
      const index = data.layers.findIndex((layer) => layer.id === id);
      return index < 0 ? "0" : `L${index + 1}_${dxfSafe(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 20)}`;
    };
    const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
      pairs.push("0", "LINE", "8", layer, "10", String(x1), "20", String(700 - y1), "30", "0", "11", String(x2), "21", String(700 - y2), "31", "0");
    };
    const text = (layer: string, value: string, x: number, y: number, height = 8) => {
      pairs.push("0", "TEXT", "8", layer, "10", String(x), "20", String(700 - y), "30", "0", "40", String(height), "1", dxfSafe(value));
    };
    for (const room of data.rooms) {
      const layer = layerName(room.layer_id);
      const x2 = room.x + room.width;
      const y2 = room.y + room.height;
      line(layer, room.x, room.y, x2, room.y);
      line(layer, x2, room.y, x2, y2);
      line(layer, x2, y2, room.x, y2);
      line(layer, room.x, y2, room.x, room.y);
      text(layer, room.name, room.x + 8, room.y + 18);
    }
    for (const item of data.placements) {
      const layer = layerName(item.layer_id);
      pairs.push("0", "CIRCLE", "8", layer, "10", String(item.x), "20", String(700 - item.y), "30", "0", "40", "6");
      text(layer, item.element_id ? `${item.element_id} ${item.label}` : item.label, item.x + 8, item.y + 4, 6);
    }
    for (const dimension of data.dimensions) {
      line("0", dimension.x1, dimension.y1, dimension.x2, dimension.y2);
      text("0", dimension.label, (dimension.x1 + dimension.x2) / 2, (dimension.y1 + dimension.y2) / 2, 6);
    }
    for (const item of data.free_canvas) {
      const layer = layerName(item.layer_id);
      if (item.kind === "note" && item.points[0]) text(layer, item.label, item.points[0][0], item.points[0][1]);
      if (item.kind === "line" && item.points.length >= 2) line(layer, item.points[0][0], item.points[0][1], item.points[1][0], item.points[1][1]);
      if (item.kind === "rectangle" && item.points.length >= 2) {
        const [start, end] = item.points;
        line(layer, start[0], start[1], end[0], start[1]);
        line(layer, end[0], start[1], end[0], end[1]);
        line(layer, end[0], end[1], start[0], end[1]);
        line(layer, start[0], end[1], start[0], start[1]);
      }
    }
    pairs.push("0", "ENDSEC", "0", "EOF");
    const url = URL.createObjectURL(new Blob([pairs.join("\r\n")], { type: "application/dxf" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${floorName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.dxf`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (query.isLoading) return <p className="editor-status">Loading floor workspace…</p>;
  if (query.isError) return <p className="editor-error">Could not load this floor workspace.</p>;

  return (
    <section className="workspace">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">FLOOR WORKSPACE</p>
          <h3>{floorName}</h3>
        </div>
        <div className="workspace-actions">
          <button type="button" className="button-secondary" onClick={exportDxf}>Export CAD (DXF)</button>
          <button type="button" className="button-secondary" onClick={exportMaterials}>Export materials CSV</button>
          <button type="button" className="button-secondary" onClick={() => window.print()}>Print / PDF</button>
          <button
            type="button"
            className="button-primary"
            onClick={() => save.mutate(data, { onSuccess: () => setFeedback("All changes saved."), onError: () => setFeedback("Save failed. Your unsaved changes are still here.") })}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving…" : "Save workspace"}
          </button>
        </div>
      </header>
      <div className="workspace-tabs" role="tablist" aria-label="Floor workspace">
        <button type="button" role="tab" aria-selected={tab === "layout"} className={tab === "layout" ? "active" : ""} onClick={() => setTab("layout")}>Floor plan</button>
        <button type="button" role="tab" aria-selected={tab === "circuits"} className={tab === "circuits" ? "active" : ""} onClick={() => setTab("circuits")}>Circuits &amp; board</button>
        <button type="button" role="tab" aria-selected={tab === "cabinet"} className={tab === "cabinet" ? "active" : ""} onClick={() => setTab("cabinet")}>Cabinet layout</button>
        <button type="button" role="tab" aria-selected={tab === "smart"} className={tab === "smart" ? "active" : ""} onClick={() => setTab("smart")}>Smart systems</button>
        <button type="button" role="tab" aria-selected={tab === "documentation"} className={tab === "documentation" ? "active" : ""} onClick={() => setTab("documentation")}>Documentation</button>
      </div>
      {tab === "layout" ? (
        <div className="plan-layout">
          <aside className="plan-sidebar">
            <label className="upload-button">
              <span>Upload floor-plan image or PDF</span>
              <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={handleFile} />
            </label>
            <p className="field-hint">PDF up to 10 MB or PNG, JPEG, WebP up to 2.5 MB</p>
            {pdfDocument && pdfPageCount > 1 && (
              <label className="field-label">PDF page
                <select value={pdfPage} onChange={(event) => {
                  const page = Number(event.target.value);
                  setPdfPage(page);
                  void renderPdfPage(pdfDocument, page);
                }}>
                  {Array.from({ length: pdfPageCount }, (_, index) => <option key={index + 1} value={index + 1}>Page {index + 1}</option>)}
                </select>
              </label>
            )}
            {data.background_image && <button className="text-button" type="button" onClick={() => update({ background_image: null })}>Remove image</button>}
            {data.background_image && (
              <>
                <label className="field-label">Plan opacity
                  <input type="range" min="0.1" max="1" step="0.05" value={data.background_opacity} onChange={(event) => update({ background_opacity: Number(event.target.value) })} />
                </label>
                <label className="field-label">Plan rotation
                  <select value={data.background_rotation} onChange={(event) => update({ background_rotation: Number(event.target.value) })}>
                    {[0, 90, 180, 270].map((degrees) => <option key={degrees} value={degrees}>{degrees}°</option>)}
                  </select>
                </label>
                <button type="button" className="tool" onClick={() => update({ image_crop: data.image_crop ? null : [0.05, 0.05, 0.9, 0.9] })}>
                  {data.image_crop ? "Reset plan crop" : "Crop plan edges"}
                </button>
                {data.image_crop && <div className="crop-controls">
                  {data.image_crop.map((value, index) => (
                    <label className="field-label" key={index}>{["Left", "Top", "Width", "Height"][index]}
                      <input type="range" min={index < 2 ? 0 : 0.2} max={index === 0 ? 1 - data.image_crop![2] : index === 1 ? 1 - data.image_crop![3] : index === 2 ? 1 - data.image_crop![0] : 1 - data.image_crop![1]} step="0.01" value={value} onChange={(event) => {
                        const crop = [...data.image_crop!] as [number, number, number, number];
                        crop[index] = clamp(Number(event.target.value), index < 2 ? 0 : 0.2, index === 0 ? 1 - crop[2] : index === 1 ? 1 - crop[3] : index === 2 ? 1 - crop[0] : 1 - crop[1]);
                        update({ image_crop: crop });
                      }} />
                    </label>
                  ))}
                </div>}
              </>
            )}
            {pdfDocument && <button type="button" className="text-button" onClick={() => { setPdfDocument(null); setPdfPageCount(0); }}>Close PDF page selector</button>}
            <label className="field-label" htmlFor="plan-scale">Scale (metres per 100 canvas units)</label>
            <input id="plan-scale" type="number" min="0.01" max="1000" step="0.01" placeholder="Not calibrated" value={data.scale_m_per_100_units ?? ""} onChange={(event) => update({ scale_m_per_100_units: event.target.value ? Number(event.target.value) : null })} />
            <button type="button" className={tool === "scale" ? "tool active" : "tool"} onClick={() => { setCalibrationStart(null); setCalibrationEnd(null); setTool(tool === "scale" ? "select" : "scale"); setFeedback("Click two points that mark a known distance."); }}>Calibrate from two points</button>
            {!isClientPresentation && data.dimensions.map((dimension) => (
              <div className="mounting-point-row" key={dimension.id}>
                <input aria-label="Dimension label" value={dimension.label} onChange={(event) => update({ dimensions: data.dimensions.map((item) => item.id === dimension.id ? { ...item, label: event.target.value } : item) })} />
                <button type="button" className="icon-button" aria-label="Delete dimension" onClick={() => update({ dimensions: data.dimensions.filter((item) => item.id !== dimension.id) })}>×</button>
              </div>
            ))}
            {calibrationEnd && calibrationStart && (
              <div className="calibration-form">
                <label className="field-label" htmlFor="calibration-distance">Distance between points (m)</label>
                <input id="calibration-distance" type="number" min="0.01" step="0.01" value={calibrationMeters} onChange={(event) => setCalibrationMeters(event.target.value)} />
                <button type="button" className="button-secondary" onClick={applyScaleCalibration}>Apply calibration</button>
              </div>
            )}
            <p className="field-hint">Calibrate against a known wall or dimension on the plan.</p>
            <div className="sidebar-divider" />
            <p className="field-label">Layers</p>
            <label className="field-label">Active layer
              <select value={activeLayerId} onChange={(event) => setActiveLayerId(event.target.value)}>
                {data.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
              </select>
            </label>
            <div className="layer-list">
              {data.layers.map((layer) => (
                <label key={layer.id} className="layer-option">
                  <input type="checkbox" checked={layer.visible} onChange={(event) => update({ layers: data.layers.map((item) => item.id === layer.id ? { ...item, visible: event.target.checked } : item) })} />
                  <input aria-label={`${layer.name} layer name`} value={layer.name} onChange={(event) => update({ layers: data.layers.map((item) => item.id === layer.id ? { ...item, name: event.target.value } : item) })} />
                </label>
              ))}
            </div>
            <button type="button" className="text-button" onClick={() => {
              const layer: PlanLayer = {
                id: newId(),
                name: `Layer ${data.layers.length + 1}`,
                visible: true,
                color: "#7c5cbd",
                purpose: "custom",
              };
              update({ layers: [...data.layers, layer] });
              setActiveLayerId(layer.id);
            }}>＋ Add layer</button>
            <label className="layer-option">
              <input type="checkbox" checked={isClientPresentation} onChange={(event) => update({ annotation: { ...data.annotation, presentation_mode: event.target.checked ? "client" : "planning" } })} />
              Client presentation mode
            </label>
            <label className="layer-option"><input type="checkbox" checked={showElementIds} onChange={(event) => setShowElementIds(event.target.checked)} />Element IDs</label>
            <label className="layer-option"><input type="checkbox" checked={showBusAddresses} onChange={(event) => setShowBusAddresses(event.target.checked)} />Bus addresses</label>
            <label className="layer-option"><input type="checkbox" checked={showCircuitNames} onChange={(event) => setShowCircuitNames(event.target.checked)} />Circuit labels</label>
            <label className="layer-option"><input type="checkbox" checked={showFuseAssignments} onChange={(event) => setShowFuseAssignments(event.target.checked)} />Fuse references</label>
            <label className="layer-option"><input type="checkbox" checked={showGroupLabels} onChange={(event) => setShowGroupLabels(event.target.checked)} />Mounting-group labels</label>
            <label className="layer-option"><input type="checkbox" checked={showRoomOverlays} onChange={(event) => setShowRoomOverlays(event.target.checked)} />Room overlays</label>
            <div className="sidebar-divider" />
            <p className="field-label">Rooms</p>
            <div className="tool-list">
              <button type="button" className={tool === "room" ? "tool active" : "tool"} onClick={() => setTool(tool === "room" ? "select" : "room")}>＋ Draw room</button>
              <button type="button" className={tool === "dimension" ? "tool active" : "tool"} onClick={() => { setMeasurementStart(null); setTool(tool === "dimension" ? "select" : "dimension"); }}>＋ Add dimension</button>
              <button type="button" className="tool" onClick={addFreeNote}>＋ Add note</button>
              <button type="button" className="tool" onClick={() => void detectRoomRegions()}>{detectedRooms ? "Detect more rooms" : "Detect rooms (beta)"}</button>
              <button type="button" className="tool" onClick={() => addRoom("Living room", [
                { kind: "light", label: "Ceiling light", dx: 90, dy: 45 },
                { kind: "switch", label: "Switch", dx: 20, dy: 20 },
                { kind: "socket", label: "Socket", dx: 30, dy: 90 },
                { kind: "socket", label: "Socket", dx: 150, dy: 90 },
              ])}>Living room template</button>
              <button type="button" className="tool" onClick={() => addRoom("Kitchen", [
                { kind: "light", label: "Ceiling light", dx: 90, dy: 45 },
                { kind: "switch", label: "Switch", dx: 20, dy: 20 },
                { kind: "socket", label: "Worktop socket", dx: 35, dy: 85 },
                { kind: "socket", label: "Worktop socket", dx: 90, dy: 85 },
                { kind: "socket", label: "Appliance socket", dx: 150, dy: 85 },
              ])}>Kitchen template</button>
              <button type="button" className="tool" onClick={() => addRoom("Bedroom", [
                { kind: "light", label: "Ceiling light", dx: 90, dy: 45 },
                { kind: "switch", label: "Switch", dx: 20, dy: 20 },
                { kind: "socket", label: "Socket", dx: 35, dy: 90 },
                { kind: "socket", label: "Socket", dx: 145, dy: 90 },
              ])}>Bedroom template</button>
            </div>
            <div className="sidebar-divider" />
            <p className="field-label">Symbol library</p>
            <div className="tool-list symbol-tools">
              {symbolKinds.map(({ kind, glyph, label }) => (
                <button type="button" key={kind} className={tool === kind ? "tool active" : "tool"} onClick={() => setTool(tool === kind ? "select" : kind)}>
                  <span className="symbol-glyph">{glyph}</span>{label}
                </button>
              ))}
            </div>
            {data.custom_components.length > 0 && (
              <div className="tool-list symbol-tools">
                {[...data.custom_components].sort((a, b) => Number(b.favorite) - Number(a.favorite)).map((component) => (
                  <div className="custom-symbol-row" key={component.id}>
                    <button type="button" className="tool" onClick={() => {
                      setCustomLabel(component.name);
                      setSelectedCustomComponentId(component.id);
                      setTool("custom");
                    }}>
                      <span className="symbol-glyph" style={{ color: component.color }}>+</span>{component.name}
                    </button>
                    <button type="button" className="icon-button" aria-label={`${component.favorite ? "Unfavorite" : "Favorite"} ${component.name}`} onClick={() => update({ custom_components: data.custom_components.map((item) => item.id === component.id ? { ...item, favorite: !item.favorite } : item) })}>{component.favorite ? "★" : "☆"}</button>
                  </div>
                ))}
              </div>
            )}
            {tool === "custom" && (
              <>
                <input aria-label="Custom symbol label" placeholder="Custom symbol name" value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} />
                <button type="button" className="text-button" onClick={saveCustomComponent}>Save to custom library</button>
              </>
            )}
            {selectedRoom && (
              <>
                <label className="field-label" htmlFor="selected-room-name">Selected room</label>
                <input id="selected-room-name" value={selectedRoom.name} onChange={(event) => update({ rooms: data.rooms.map((room) => room.id === selectedRoom.id ? { ...room, name: event.target.value } : room) })} />
              </>
            )}
            {selectedPlacement && (
              <>
                <label className="field-label" htmlFor="selected-symbol-name">Selected symbol</label>
                <input id="selected-symbol-name" value={selectedPlacement.label} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, label: event.target.value } : item) })} />
                <label className="field-label">Circuit assignment
                  <select value={selectedPlacement.circuit_id ?? ""} onChange={(event) => {
                    const targetCircuit = data.circuits.find((item) => item.id === event.target.value);
                    if (!targetCircuit) {
                      update({
                        placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, circuit_id: null } : item),
                        circuits: data.circuits.map((item) => ({ ...item, loads: item.loads.filter((id) => id !== selectedPlacement.id) })),
                        smart_devices: data.smart_devices.map((device) => ({
                          ...device,
                          channels: device.channels.map((channel) => channel.load_ids.includes(selectedPlacement.id)
                            ? { ...channel, circuit_id: null }
                            : channel),
                        })),
                      });
                      return;
                    }
                    updateCircuit(targetCircuit.id, { loads: [...targetCircuit.loads.filter((id) => id !== selectedPlacement.id), selectedPlacement.id] });
                  }}>
                    <option value="">Unassigned</option>
                    {data.circuits.map((circuit) => <option key={circuit.id} value={circuit.id}>{circuitNumber(circuit, data.rcds, data.circuits)} · {circuit.name}</option>)}
                  </select>
                </label>
                <label className="field-label">Room
                  <select value={selectedPlacement.room_id ?? ""} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, room_id: event.target.value || null } : item) })}>
                    <option value="">No room</option>
                    {data.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                  </select>
                </label>
                <label className="field-label">Layer
                  <select value={selectedPlacement.layer_id} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, layer_id: event.target.value } : item) })}>
                    {data.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                  </select>
                </label>
                <label className="field-label">Element ID
                  <input value={selectedPlacement.element_id ?? ""} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, element_id: event.target.value || null } : item) })} />
                </label>
                <label className="field-label">Bus address
                  <input value={selectedPlacement.bus_address ?? ""} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, bus_address: event.target.value || null } : item) })} />
                </label>
                <div className="button-row">
                  <button type="button" className="tool" onClick={() => rotateSelection(-45)}>Rotate −45°</button>
                  <button type="button" className="tool" onClick={() => rotateSelection(45)}>Rotate +45°</button>
                </div>
              </>
            )}
            {selectedPlacements.length > 1 && <button type="button" className="tool" onClick={groupSelectedPlacements}>Group mounting points</button>}
            {!isClientPresentation && data.mounting_points.map((point) => (
              <div className="mounting-point-row" key={point.id}>
                <input aria-label="Mounting group name" value={point.name} onChange={(event) => update({ mounting_points: data.mounting_points.map((item) => item.id === point.id ? { ...item, name: event.target.value } : item) })} />
                <button type="button" className="text-button" onClick={() => update({
                  mounting_points: data.mounting_points.filter((item) => item.id !== point.id),
                  placements: data.placements.map((item) => item.mounting_point_id === point.id ? { ...item, mounting_point_id: null } : item),
                })}>Ungroup</button>
              </div>
            ))}
            {!isClientPresentation && data.free_canvas.filter((item) => item.kind === "note").map((note) => (
              <div className="mounting-point-row" key={note.id}>
                <input aria-label="Plan note text" value={note.label} onChange={(event) => update({ free_canvas: data.free_canvas.map((item) => item.id === note.id ? { ...item, label: event.target.value } : item) })} />
                <button type="button" className="icon-button" aria-label="Delete plan note" onClick={() => update({ free_canvas: data.free_canvas.filter((item) => item.id !== note.id) })}>×</button>
              </div>
            ))}
            {selectedIds.length > 0 && <button type="button" className="button-danger" onClick={removeSelection}>Delete selection</button>}
          </aside>
          <div className="canvas-column">
            <div className="canvas-instructions">
              <span>Choose a room or symbol, then click to place. Drag to move; hold Shift and drag to pan.</span>
              <div className="button-row">
                <button type="button" className="tool" aria-label="Zoom out" onClick={() => zoomCanvas(1.2)}>−</button>
                <button type="button" className="tool" aria-label="Zoom in" onClick={() => zoomCanvas(0.8)}>＋</button>
                <button type="button" className="tool" onClick={() => setViewBox({ x: 0, y: 0, width: 1000, height: 700 })}>Reset view</button>
                <button type="button" className="tool" onClick={copySelection} disabled={!selectedIds.length}>Copy</button>
                <button type="button" className="tool" onClick={pasteSelection} disabled={!clipboard.rooms.length && !clipboard.placements.length}>Paste</button>
              </div>
            </div>
            <svg
              ref={svgRef}
              className="floor-canvas"
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              role="img"
              aria-label={`${floorName} floor-plan canvas`}
              onPointerDown={handleCanvasDown}
              onPointerMove={handleCanvasMove}
              onWheel={(event) => {
                event.preventDefault();
                zoomCanvas(event.deltaY < 0 ? 0.9 : 1.1);
              }}
              onPointerUp={() => { dragRef.current = null; panRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; panRef.current = null; }}
            >
              <defs>
                <pattern id="canvas-grid" width="25" height="25" patternUnits="userSpaceOnUse">
                  <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e9edf3" strokeWidth="1" />
                </pattern>
                <clipPath id="plan-image-clip"><rect width="1000" height="700" /></clipPath>
              </defs>
              <rect width="1000" height="700" fill="#fff" />
              <rect width="1000" height="700" fill="url(#canvas-grid)" />
              {data.background_image && (() => {
                const crop = data.image_crop ?? [0, 0, 1, 1];
                const imageWidth = 1000 / crop[2];
                const imageHeight = 700 / crop[3];
                return (
                  <g clipPath="url(#plan-image-clip)" opacity={data.background_opacity}>
                    <image
                      href={data.background_image}
                      x={-crop[0] * imageWidth}
                      y={-crop[1] * imageHeight}
                      width={imageWidth}
                      height={imageHeight}
                      preserveAspectRatio="none"
                      transform={`rotate(${data.background_rotation},500,350)`}
                    />
                  </g>
                );
              })()}
              {calibrationStart && calibrationEnd && <line x1={calibrationStart.x} y1={calibrationStart.y} x2={calibrationEnd.x} y2={calibrationEnd.y} className="calibration-line" />}
              {calibrationStart && !calibrationEnd && <circle cx={calibrationStart.x} cy={calibrationStart.y} r="7" className="calibration-point" />}
              {!isClientPresentation && data.dimensions.map((dimension) => (
                <g key={dimension.id} className="plan-dimension">
                  <line x1={dimension.x1} y1={dimension.y1} x2={dimension.x2} y2={dimension.y2} />
                  <text x={(dimension.x1 + dimension.x2) / 2} y={(dimension.y1 + dimension.y2) / 2 - 5}>{dimension.label}</text>
                </g>
              ))}
              {data.free_canvas.filter((item) => layerIsVisible(item.layer_id)).map((item) => (
                <g key={item.id} className="free-canvas-item" fill={item.color} stroke={item.color}>
                  {item.kind === "note" && item.points[0] && <text x={item.points[0][0]} y={item.points[0][1]}>{item.label}</text>}
                  {item.kind === "line" && item.points.length > 1 && <line x1={item.points[0][0]} y1={item.points[0][1]} x2={item.points[1][0]} y2={item.points[1][1]} />}
                  {item.kind === "rectangle" && item.points[0] && item.points[1] && <rect x={item.points[0][0]} y={item.points[0][1]} width={item.points[1][0] - item.points[0][0]} height={item.points[1][1] - item.points[0][1]} fill="none" />}
                </g>
              ))}
              {showRoomOverlays && data.rooms.filter((room) => layerIsVisible(room.layer_id)).map((room) => (
                <g key={room.id} onPointerDown={(event) => beginDrag(event, "room", room.id, room.x, room.y)} className="canvas-draggable">
                  <rect x={room.x} y={room.y} width={room.width} height={room.height} rx="5" style={{ fill: room.color }} className={selectedIds.includes(room.id) ? "room-shape selected" : "room-shape"} />
                  <text x={room.x + 12} y={room.y + 24} className="room-label">{room.name}</text>
                  {selectedIds.includes(room.id) && <rect x={room.x + room.width - 6} y={room.y + room.height - 6} width="12" height="12" className="selection-handle" />}
                </g>
              ))}
              {!isClientPresentation && data.mounting_points.map((point) => (
                <g key={point.id} transform={`translate(${point.x},${point.y}) rotate(${point.rotation})`} className="mounting-point">
                  <circle r="8" />
                  {showGroupLabels && <text x="12" y="4">{point.name}</text>}
                </g>
              ))}
              {data.placements.filter((item) => layerIsVisible(item.layer_id)).map((item) => {
                const glyph = symbolKinds.find((symbol) => symbol.kind === item.kind)?.glyph ?? "+";
                return (
                  <g key={item.id} transform={`translate(${item.x},${item.y}) rotate(${item.rotation})`} onPointerDown={(event) => beginDrag(event, "placement", item.id, item.x, item.y)} className="canvas-draggable">
                    <circle r="18" style={{ fill: item.color }} className={selectedIds.includes(item.id) ? "placement-circle selected" : "placement-circle"} />
                    <text textAnchor="middle" dominantBaseline="central" className="placement-glyph">{glyph}</text>
                    <text y="31" textAnchor="middle" className="placement-label">{item.label}</text>
                    {showElementIds && item.element_id && <text y="44" textAnchor="middle" className="placement-label">{item.element_id}</text>}
                    {!isClientPresentation && showBusAddresses && item.bus_address && <text y="57" textAnchor="middle" className="placement-label">{item.bus_address}</text>}
                    {!isClientPresentation && showCircuitNames && item.circuit_id && <text y="70" textAnchor="middle" className="placement-label">{data.circuits.find((circuit) => circuit.id === item.circuit_id)?.name ?? "Circuit"}</text>}
                    {!isClientPresentation && showFuseAssignments && item.circuit_id && <text y="83" textAnchor="middle" className="placement-label">{(() => {
                      const circuit = data.circuits.find((entry) => entry.id === item.circuit_id);
                      return circuit ? circuitNumber(circuit, data.rcds, data.circuits) : "";
                    })()}</text>}
                  </g>
                );
              })}
            </svg>
            <div className="canvas-footer">
              <span>{data.rooms.length} rooms · {data.placements.length} installation points</span>
              <span>{data.scale_m_per_100_units ? `Scale set: ${data.scale_m_per_100_units} m / 100 units` : "Scale not set"}</span>
            </div>
          </div>
        </div>
      ) : tab === "circuits" ? (
        <div className="circuits-panel">
          <div className="circuits-intro">
            <div><p className="eyebrow">DISTRIBUTION DOCUMENTATION</p><h4>Protective devices and outgoing circuits</h4><p>Circuits are numbered automatically below each RCD. Terminal references follow the same grouping.</p></div>
            <button type="button" className="button-primary" onClick={addRcd}>＋ Add RCD</button>
          </div>
          <section className="electrical-component-panel">
            <header><strong>Main devices, contacts and terminals</strong></header>
            <div className="button-row">
              {(["main_switch", "surge_protection", "contactor", "relay", "terminal", "power_supply", "potential_free_contact"] as ElectricalComponent["kind"][]).map((kind) => (
                <button key={kind} type="button" className="tool" onClick={() => addElectricalComponent(kind)}>＋ {kind.replace(/_/g, " ")}</button>
              ))}
            </div>
            {data.electrical_components.map((component) => (
              <div className="electrical-component-row" key={component.id}>
                <input aria-label="Electrical component name" value={component.name} onChange={(event) => update({ electrical_components: data.electrical_components.map((item) => item.id === component.id ? { ...item, name: event.target.value } : item) })} />
                <input aria-label="Electrical component reference" placeholder="Reference" value={component.reference ?? ""} onChange={(event) => update({ electrical_components: data.electrical_components.map((item) => item.id === component.id ? { ...item, reference: event.target.value || null } : item) })} />
                <select
                  aria-label="Controlled circuits"
                  multiple
                  size={Math.min(Math.max(data.circuits.length, 2), 4)}
                  value={component.circuit_ids}
                  onChange={(event) => update({ electrical_components: data.electrical_components.map((item) => item.id === component.id ? { ...item, circuit_ids: Array.from(event.currentTarget.selectedOptions, (option) => option.value) } : item) })}
                >
                  {data.circuits.map((circuit) => <option key={circuit.id} value={circuit.id}>{circuitNumber(circuit, data.rcds, data.circuits)} · {circuit.name}</option>)}
                </select>
                <button type="button" className="icon-button" aria-label={`Remove ${component.name}`} onClick={() => update({ electrical_components: data.electrical_components.filter((item) => item.id !== component.id), cabinet: { ...data.cabinet, modules: data.cabinet.modules.filter((module) => module.component_id !== component.id) } })}>×</button>
              </div>
            ))}
          </section>
          {data.rcds.length === 0 && <div className="empty-panel">Add an RCD to start documenting its outgoing circuits.</div>}
          <div className="rcd-list">
            {data.rcds.map((rcd) => {
              const rcdIndex = data.rcds.findIndex((item) => item.id === rcd.id) + 1;
              const circuits = data.circuits.filter((item) => item.rcd_id === rcd.id);
              return (
                <section key={rcd.id} className="rcd-card">
                  <header className="rcd-heading">
                    <div className="number-badge">F{rcdIndex}</div>
                    <input aria-label="RCD name" value={rcd.name} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, name: event.target.value } : item) })} />
                    <label>Rated current (mA)<input type="number" min="10" max="1000" value={rcd.rated_current_ma} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, rated_current_ma: Number(event.target.value) } : item) })} /></label>
                    <label>Poles<select value={rcd.poles} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, poles: Number(event.target.value) as 2 | 4 } : item) })}><option value={2}>2-pole</option><option value={4}>4-pole</option></select></label>
                    <label>Type<select value={rcd.type} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, type: event.target.value as ResidualCurrentDevice["type"] } : item) })}><option>A</option><option>F</option><option>B</option></select></label>
                    <label>Upstream RCD<select value={rcd.upstream_id ?? ""} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, upstream_id: event.target.value || null } : item) })}><option value="">None</option>{data.rcds.filter((item) => item.id !== rcd.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <button type="button" className="text-button" onClick={() => removeRcd(rcd.id)}>Remove</button>
                  </header>
                  <div className="circuit-schematic" aria-label={`Schematic for ${rcd.name}`}>
                    <div className="schematic-rcd">
                      <strong>F{rcdIndex}</strong>
                      <span>RCD · Type {rcd.type} · {rcd.rated_current_ma} mA</span>
                    </div>
                    {circuits.length > 0 ? (
                      <div className="schematic-output">
                        <div className="schematic-bus" />
                        <div className="schematic-branches">
                          {circuits.map((circuit) => (
                            <div key={circuit.id} className="schematic-branch">
                              <span className="branch-wire" />
                              <strong>{circuitNumber(circuit, data.rcds, data.circuits)}</strong>
                              <span>{circuit.breaker_type}{circuit.rated_current_a}</span>
                              <small>{circuit.name}</small>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : <p className="schematic-empty">Outgoing circuits appear here.</p>}
                  </div>
                  <div className="circuit-table-wrap">
                    <table className="circuit-table">
                      <thead><tr><th>Ref.</th><th>Circuit</th><th>Breaker</th><th>Rated current</th><th>Poles / supply</th><th>Cable</th><th>Connected plan points</th><th>Terminal</th><th /></tr></thead>
                      <tbody>
                        {circuits.map((circuit) => (
                          <tr key={circuit.id}>
                            <td><span className="circuit-ref">{circuitNumber(circuit, data.rcds, data.circuits)}</span></td>
                            <td><input aria-label="Circuit name" value={circuit.name} onChange={(event) => updateCircuit(circuit.id, { name: event.target.value })} /></td>
                            <td><select value={circuit.breaker_type} onChange={(event) => updateCircuit(circuit.id, { breaker_type: event.target.value as ElectricalCircuit["breaker_type"] })}><option>B</option><option>C</option><option>D</option></select></td>
                            <td><label className="unit-input"><input aria-label="Rated current in amps" type="number" min="1" max="125" value={circuit.rated_current_a} onChange={(event) => updateCircuit(circuit.id, { rated_current_a: Number(event.target.value) })} /> A</label></td>
                            <td>
                              <select aria-label="Circuit poles" value={circuit.poles} onChange={(event) => updateCircuit(circuit.id, { poles: Number(event.target.value) as ElectricalCircuit["poles"] })}>
                                {[1, 2, 3, 4].map((poles) => <option key={poles} value={poles}>{poles}-pole</option>)}
                              </select>
                              <select aria-label="Circuit supply type" value={circuit.supply} onChange={(event) => updateCircuit(circuit.id, { supply: event.target.value as ElectricalCircuit["supply"] })}>
                                <option value="1n">1N~</option><option value="3n">3N~</option><option value="emergency">Emergency</option><option value="phase_selector">Phase selector</option><option value="transfer">Transfer</option>
                              </select>
                            </td>
                            <td><input aria-label="Cable cross section" value={circuit.cable} onChange={(event) => updateCircuit(circuit.id, { cable: event.target.value })} /></td>
                            <td>
                              <select
                                aria-label="Connected floor-plan points"
                                multiple
                                size={Math.min(Math.max(data.placements.length, 2), 4)}
                                value={circuit.loads}
                                onChange={(event) => updateCircuit(circuit.id, { loads: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}
                              >
                                {data.placements.map((placement) => <option key={placement.id} value={placement.id}>{placement.label}</option>)}
                              </select>
                            </td>
                            <td><span className="terminal-ref">X{rcdIndex}.{circuits.findIndex((item) => item.id === circuit.id) + 1}</span></td>
                            <td><button className="icon-button" aria-label={`Remove ${circuit.name}`} type="button" onClick={() => removeCircuit(circuit.id)}>×</button></td>
                          </tr>
                        ))}
                        {circuits.length === 0 && <tr><td colSpan={9} className="empty-row">No outgoing circuits yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <footer className="rcd-footer"><span>{circuitCounts.get(rcd.id) ?? 0} circuits · X{rcdIndex} terminal group</span><div className="button-row"><button type="button" className="text-button" onClick={() => generateTerminalStrip(rcd.id)}>Generate terminal strip</button><button type="button" className="text-button" onClick={() => addCircuit(rcd.id)}>＋ Add circuit</button></div></footer>
                </section>
              );
            })}
          </div>
          <div className="board-summary"><strong>Board summary</strong><span>{data.rcds.length} RCDs</span><span>{data.circuits.length} outgoing circuits</span><span>{data.placements.filter((item) => item.kind === "knx").length} KNX points on floor plan</span></div>
          {data.terminal_strips.length > 0 && (
            <section className="terminal-strip-list">
              <h4>Terminal plan</h4>
              {data.terminal_strips.map((strip) => (
                <article className="terminal-strip-card" key={strip.id}>
                  <input aria-label="Terminal strip name" value={strip.name} onChange={(event) => update({ terminal_strips: data.terminal_strips.map((item) => item.id === strip.id ? { ...item, name: event.target.value } : item) })} />
                  <span>{strip.kind}</span>
                  <span>{strip.circuit_ids.length} circuits · {strip.terminals_per_circuit} terminals each · {strip.terminal_width_mm} mm</span>
                  <button type="button" className="icon-button" aria-label={`Remove ${strip.name}`} onClick={() => update({ terminal_strips: data.terminal_strips.filter((item) => item.id !== strip.id) })}>×</button>
                </article>
              ))}
            </section>
          )}
        </div>
      ) : tab === "cabinet" ? (
        <CabinetEditor data={data} onChange={update} />
      ) : tab === "smart" ? (
        <SmartSystemsEditor data={data} onChange={update} />
      ) : null}
      <DocumentationPanel
        data={data}
        projectName={projectName}
        floorName={floorName}
        active={tab === "documentation"}
        onChange={update}
      />
      {feedback && <p className={feedback.includes("failed") || feedback.includes("Choose") || feedback.includes("smaller") ? "editor-error" : "editor-status"} role="status">{feedback}</p>}
      {save.isError && !feedback && <p className="editor-error" role="alert">Could not save this workspace.</p>}
    </section>
  );
}
