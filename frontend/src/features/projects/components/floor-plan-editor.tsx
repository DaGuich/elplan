import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  projectsApi,
} from "../api";
import { useFloorPlan, useSaveFloorPlan, useTopologyPlacements } from "../queries";
import { RoomMetadataEditor } from "./room-metadata-editor";
import { SchematicView } from "./schematic-view";
import { boardManagementApi } from "./board-management-api";
import { CabinetEditor } from "./cabinet-editor";
import { DocumentationPanel } from "./documentation-panel";
import { SmartSystemsEditor } from "./smart-systems-editor";
import { attachWheelNavigation, panViewBox, zoomViewBox } from "./floor-plan-viewport";
import { renderPdfPageToUrl } from "./blueprint-render";
import { cropLayout, editCrop, resolveRegistration, setCropValue } from "../domain/plan-crop";
import { detectRooms } from "../domain/room-detection";
import {
  MAX_ROOMS,
  buildDetectedRooms,
  deleteRoomVertex,
  hasPolygon,
  insertRoomVertex,
  labelAnchor,
  moveRoomVertex,
  roomAreaM2,
  roomContains,
  roomHoles,
  roomOutline,
  roomPath,
  splitRoom,
  toPolygonRoom,
  translateRoom,
} from "../domain/plan-rooms";
import { addRectangularRoomHole, mergeRooms, removeRoomHole } from "../domain/room-geometry";
import { LoadedWorkspace, reconcileWorkspaceRefresh } from "../domain/workspace-refresh";
import { resolveRcdBoard } from "../domain/rcd-board";
import { useI18n } from "../../../i18n";
import { ApiError } from "../../../lib/api-client";

type Props = {
  projectId: number;
  floorId: number;
  floorName: string;
  projectName: string;
};

type ViewTab = "layout" | "circuits" | "schematic" | "cabinet" | "smart" | "documentation";
type Tool = "select" | "room" | "scale" | "dimension" | "hole" | PlanPlacement["kind"];
type DragState = {
  kind: "room" | "placement";
  ids: string[];
  dx: number;
  dy: number;
  originX: number;
  originY: number;
  positions: Map<string, { x: number; y: number }>;
};
type HoleDraft = { roomId: string; start: { x: number; y: number }; end: { x: number; y: number } };

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
  const { t } = useI18n();
  const query = useFloorPlan(projectId, floorId);
  const topologyPlacements = useTopologyPlacements(projectId);
  const boards = useQuery({
    queryKey: ["projects", projectId, "topology", "boards"],
    queryFn: () => boardManagementApi.list(projectId),
  });
  const save = useSaveFloorPlan(projectId, floorId);
  const [data, setData] = useState<FloorPlanData>(emptyFloorPlan);
  const [blueprintUrl, setBlueprintUrl] = useState<string | null>(null);
  const [hasBlueprint, setHasBlueprint] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [tab, setTab] = useState<ViewTab>("layout");
  const [newRcdBoardId, setNewRcdBoardId] = useState("");
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
  const acknowledgedSaveRef = useRef<FloorPlanData | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const vertexDragRef = useRef<{ roomId: string; index: number } | null>(null);
  const [splitState, setSplitState] = useState<{ roomId: string; first: number | null } | null>(null);
  const [holeDraft, setHoleDraft] = useState<HoleDraft | null>(null);
  const panRef = useRef<{ pointerId: number; clientX: number; clientY: number } | null>(null);
  const touchesRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; midpoint: { x: number; y: number } } | null>(null);
  const loadedPlanRef = useRef<LoadedWorkspace | null>(null);

  useEffect(() => {
    if (!query.data) return;
    const previous = loadedPlanRef.current;
    const next = query.data;
    const acknowledgedSave = acknowledgedSaveRef.current === next;
    acknowledgedSaveRef.current = null;
    setData((current) => reconcileWorkspaceRefresh(current, previous, floorId, next, acknowledgedSave));
    loadedPlanRef.current = { floorId, data: next };
  }, [floorId, query.data]);

  const blueprintUrlRef = useRef<string | null>(null);
  const blueprintGenerationRef = useRef(0);

  function showBlueprintUrl(url: string | null) {
    if (blueprintUrlRef.current) URL.revokeObjectURL(blueprintUrlRef.current);
    blueprintUrlRef.current = url;
    setBlueprintUrl(url);
  }

  // Stored PDFs keep the original file; only the selected page is rasterized for display.
  async function showStoredFile(blob: Blob, contentType: string, page: number, generation: number) {
    if (generation !== blueprintGenerationRef.current) return;
    if (contentType !== "application/pdf") {
      setPdfDocument(null);
      setPdfPageCount(0);
      showBlueprintUrl(URL.createObjectURL(blob));
      return;
    }
    const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
    const pdf = await task.promise;
    const current = clamp(page, 1, pdf.numPages);
    let url: string;
    try {
      url = await renderPdfPageToUrl(pdf, current);
    } catch (error) {
      await task.destroy();
      throw error;
    }
    if (generation !== blueprintGenerationRef.current) {
      URL.revokeObjectURL(url);
      await task.destroy();
      return;
    }
    setPdfDocument(pdf);
    setPdfPageCount(pdf.numPages);
    setPdfPage(current);
    showBlueprintUrl(url);
  }

  useEffect(() => {
    const generation = ++blueprintGenerationRef.current;
    showBlueprintUrl(null);
    setHasBlueprint(false);
    setPdfDocument(null);
    setPdfPageCount(0);
    (async () => {
      let meta;
      try {
        meta = await projectsApi.blueprint(projectId, floorId);
      } catch (error) {
        if (generation === blueprintGenerationRef.current && !(error instanceof ApiError && error.status === 404)) {
          setFeedback(t("Could not load the stored floor-plan file."));
        }
        return;
      }
      if (generation !== blueprintGenerationRef.current) return;
      setHasBlueprint(true);
      try {
        const blob = await projectsApi.blueprintContent(projectId, floorId);
        await showStoredFile(blob, meta.content_type, meta.pdf_page, generation);
      } catch {
        if (generation === blueprintGenerationRef.current) setFeedback(t("Could not load the stored floor-plan file."));
      }
    })();
    return () => {
      blueprintGenerationRef.current += 1;
      if (blueprintUrlRef.current) URL.revokeObjectURL(blueprintUrlRef.current);
      blueprintUrlRef.current = null;
    };
  }, [projectId, floorId]);

  // A stored blueprint wins over the legacy inline data URL.
  const backgroundSrc = blueprintUrl ?? data.background_image;

  async function storeBlueprint(file: Blob, filename: string) {
    const generation = ++blueprintGenerationRef.current;
    let stored;
    try {
      stored = await projectsApi.uploadBlueprint(projectId, floorId, file, filename, hasBlueprint);
      if (generation !== blueprintGenerationRef.current) return false;
      setHasBlueprint(true);
      if (stored.content_type === "application/pdf" && stored.pdf_page !== 1) {
        stored = await projectsApi.setBlueprintPage(projectId, floorId, 1);
      }
      await showStoredFile(file, stored.content_type, stored.pdf_page, generation);
    } catch (error) {
      if (generation === blueprintGenerationRef.current) setFeedback(error instanceof Error ? `${t("Could not store the floor-plan file")}: ${error.message}` : t("Could not store the floor-plan file."));
      return false;
    }
    if (generation !== blueprintGenerationRef.current) return false;
    if (data.background_image) update({ background_image: null });
    setFeedback(t("Floor-plan file stored."));
    return true;
  }

  async function removeBackground() {
    const generation = ++blueprintGenerationRef.current;
    if (hasBlueprint) {
      try {
        await projectsApi.deleteBlueprint(projectId, floorId);
      } catch (error) {
        if (generation === blueprintGenerationRef.current) setFeedback(error instanceof Error ? error.message : t("Could not remove the floor-plan file."));
        return;
      }
      if (generation !== blueprintGenerationRef.current) return;
      setHasBlueprint(false);
      showBlueprintUrl(null);
      setPdfDocument(null);
      setPdfPageCount(0);
    }
    update({ background_image: null });
  }

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    return attachWheelNavigation(svg, setViewBox);
  }, [tab, query.isLoading, query.isError]);

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
    setFeedback(t("Unsaved changes"));
  }

  function addRoom(
    name = t("Room"),
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
      label: label?.trim() || symbolKinds.find((item) => item.kind === kind)?.label || t("Device"),
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
    if (event.button === 1 || (event.shiftKey && tool === "select") || pinchRef.current) return;
    if (event.button !== 0) return;
    if (tool === "hole") {
      if (!selectedRoom || (kind === "room" && selectedRoom.id !== id)) {
        setFeedback(t("Select the room before drawing a hole."));
        return;
      }
      event.stopPropagation();
      const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement;
      if (!svg) return;
      const point = svgPoint(svg, event);
      if (!roomContains(selectedRoom, point.x, point.y)) {
        setFeedback(t("Draw the hole inside the selected room."));
        return;
      }
      setHoleDraft({ roomId: selectedRoom.id, start: point, end: point });
      svg.setPointerCapture(event.pointerId);
      return;
    }
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
    if (pinchRef.current) return;
    if (event.button === 1 || (event.button === 0 && event.shiftKey && tool === "select")) {
      event.preventDefault();
      panRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const point = svgPoint(svgRef.current, event);
    if (tool === "hole") {
      if (!selectedRoom || !roomContains(selectedRoom, point.x, point.y)) {
        setFeedback(t("Draw the hole inside the selected room."));
        return;
      }
      setHoleDraft({ roomId: selectedRoom.id, start: point, end: point });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "room") {
      const room: RoomPlanItem = {
        id: newId(),
        name: t("Room"),
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
        setFeedback(t("Click the end of a known distance on the plan."));
      } else {
        setCalibrationEnd(point);
        setTool("select");
        setFeedback(t("Enter the real-world distance, then apply the calibration."));
      }
      return;
    }
    if (tool === "dimension") {
      if (!measurementStart) {
        setMeasurementStart(point);
        setFeedback(t("Click the end point of the dimension."));
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
      const room = data.rooms.find((item) => roomContains(item, point.x, point.y));
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
    if (pinchRef.current) return;
    if (holeDraft && svgRef.current) {
      setHoleDraft({ ...holeDraft, end: svgPoint(svgRef.current, event) });
      return;
    }
    if (panRef.current?.pointerId === event.pointerId && svgRef.current) {
      const matrix = svgRef.current.getScreenCTM();
      if (!matrix) return;
      const inverse = matrix.inverse();
      const dx = event.clientX - panRef.current.clientX;
      const dy = event.clientY - panRef.current.clientY;
      panRef.current.clientX = event.clientX;
      panRef.current.clientY = event.clientY;
      setViewBox((current) => panViewBox(current, -inverse.a * dx - inverse.c * dy, -inverse.b * dx - inverse.d * dy));
      return;
    }
    const vertexDrag = vertexDragRef.current;
    if (vertexDrag && svgRef.current) {
      const room = data.rooms.find((item) => item.id === vertexDrag.roomId);
      const moved = room ? moveRoomVertex(room, vertexDrag.index, svgPoint(svgRef.current, event)) : null;
      if (moved) applyRoomEdit([moved]);
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
      return translateRoom(
        room,
        clamp(original.x + deltaX, 0, 1000 - room.width),
        clamp(original.y + deltaY, 0, 700 - room.height),
      );
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
      const containingRoom = rooms.find((room) => roomContains(room, x, y));
      return { ...item, x, y, room_id: containingRoom?.id ?? null };
    });
    update({ rooms, placements });
  }

  // Replaces edited rooms and re-links symbols that were in (or are now inside) an edited room.
  function applyRoomEdit(edited: RoomPlanItem[], added: RoomPlanItem[] = []) {
    const editedIds = new Set(edited.map((room) => room.id));
    const rooms = [...data.rooms.map((room) => edited.find((item) => item.id === room.id) ?? room), ...added];
    const placements = data.placements.map((item) => {
      if (item.room_id && !editedIds.has(item.room_id)) return item;
      const containing = rooms.find((room) => roomContains(room, item.x, item.y));
      return containing ? { ...item, room_id: containing.id } : item.room_id ? { ...item, room_id: null } : item;
    });
    update({ rooms, placements });
  }

  function beginVertex(event: PointerEvent<SVGElement>, room: RoomPlanItem, index: number) {
    if (event.button !== 0 || pinchRef.current) return;
    event.stopPropagation();
    if (splitState?.roomId === room.id) {
      if (splitState.first === null) {
        setSplitState({ roomId: room.id, first: index });
        setFeedback(t("Click the second vertex to finish the split."));
        return;
      }
      if (splitState.first === index) return;
      const parts = data.rooms.length < MAX_ROOMS ? splitRoom(room, splitState.first, index, newId()) : null;
      if (!parts) {
        setSplitState({ roomId: room.id, first: null });
        setFeedback(t("These vertices cannot be joined: the cut must be a straight line inside the room between two non-adjacent vertices."));
        return;
      }
      const [kept, created] = parts;
      const placements = data.placements.map((item) => {
        if (item.room_id !== room.id) return item;
        return { ...item, room_id: roomContains(created, item.x, item.y) && !roomContains(kept, item.x, item.y) ? created.id : kept.id };
      });
      setData((current) => ({
        ...current,
        rooms: [...current.rooms.map((item) => (item.id === kept.id ? kept : item)), created],
        placements,
      }));
      setFeedback(t("Room split. Review both parts."));
      setSplitState(null);
      setSelection({ kind: "room", id: kept.id });
      setSelectedIds([kept.id]);
      return;
    }
    vertexDragRef.current = { roomId: room.id, index };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function beginEdgeInsert(event: PointerEvent<SVGElement>, room: RoomPlanItem, edgeIndex: number) {
    if (event.button !== 0 || pinchRef.current) return;
    event.stopPropagation();
    const inserted = insertRoomVertex(room, edgeIndex);
    if (!inserted) {
      setFeedback(t("Room outlines are limited to 200 vertices."));
      return;
    }
    applyRoomEdit([inserted]);
    vertexDragRef.current = { roomId: room.id, index: edgeIndex + 1 };
  }

  function removeVertex(room: RoomPlanItem, index: number) {
    const reduced = deleteRoomVertex(room, index);
    if (!reduced) {
      setFeedback(t("A vertex cannot be deleted if the outline would have fewer than 3 vertices or cross itself."));
      return;
    }
    applyRoomEdit([reduced]);
  }

  function zoomCanvas(factor: number) {
    setViewBox((current) => zoomViewBox(current, factor, { x: 0.5, y: 0.5 }));
  }

  function handleTouchDown(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "touch") return;
    touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchesRef.current.size !== 2) return;
    const [first, second] = [...touchesRef.current.values()];
    pinchRef.current = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    };
    dragRef.current = null;
    panRef.current = null;
    for (const id of touchesRef.current.keys()) event.currentTarget.setPointerCapture(id);
  }

  function handleTouchMove(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType !== "touch" || !touchesRef.current.has(event.pointerId)) return;
    touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    const svg = svgRef.current;
    if (!pinch || !svg || touchesRef.current.size !== 2) return;
    const [first, second] = [...touchesRef.current.values()];
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const matrix = svg.getScreenCTM();
    if (matrix && pinch.distance > 0 && distance > 0) {
      const inverse = matrix.inverse();
      const point = svgPoint(svg, { clientX: pinch.midpoint.x, clientY: pinch.midpoint.y });
      const rendered = svg.viewBox.baseVal;
      const anchor = { x: (point.x - rendered.x) / rendered.width, y: (point.y - rendered.y) / rendered.height };
      const dx = midpoint.x - pinch.midpoint.x;
      const dy = midpoint.y - pinch.midpoint.y;
      const factor = pinch.distance / distance;
      setViewBox((current) => {
        const zoomed = zoomViewBox(current, factor, anchor);
        const ratio = zoomed.width / current.width;
        return panViewBox(zoomed, -(inverse.a * dx + inverse.c * dy) * ratio, -(inverse.b * dx + inverse.d * dy) * ratio);
      });
    }
    pinchRef.current = { distance, midpoint };
  }

  function handlePointerEnd(event: PointerEvent<SVGSVGElement>) {
    if (holeDraft && event.type === "pointerup") {
      const room = data.rooms.find((item) => item.id === holeDraft.roomId);
      const result = room ? addRectangularRoomHole(room, holeDraft.start, holeDraft.end) : null;
      if (room && result?.ok) {
        update({ rooms: data.rooms.map((item) => item.id === room.id ? result.value : item) });
        setFeedback(t("Room hole added."));
      } else {
        setFeedback(result
          ? t("The hole must fit inside the room without overlapping another hole.")
          : t("Drag to draw a hole with a positive width and height."));
      }
      setHoleDraft(null);
      setTool("select");
    }
    if (event.type === "pointercancel") {
      setHoleDraft(null);
      setTool("select");
    }
    touchesRef.current.delete(event.pointerId);
    if (touchesRef.current.size < 2) pinchRef.current = null;
    dragRef.current = null;
    vertexDragRef.current = null;
    if (panRef.current?.pointerId === event.pointerId) panRef.current = null;
  }

  function groupSelectedPlacements() {
    if (selectedPlacements.length < 2) {
      setFeedback(t("Select at least two installation points to create a mounting group."));
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
    setFeedback(t("Mounting group created."));
  }

  function saveCustomComponent() {
    const name = customLabel.trim();
    if (!name) {
      setFeedback(t("Enter a name for the custom symbol."));
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
    setFeedback(t("Custom symbol saved to the library."));
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
    const label = window.prompt(t("Plan note"), t("Note"));
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
    if (!backgroundSrc) {
      setFeedback(t("Import a floor-plan image before detecting rooms."));
      return;
    }
    try {
      const image = new Image();
      image.src = backgroundSrc;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(t("Could not decode floor-plan image.")));
      });
      if (!image.naturalWidth || !image.naturalHeight) throw new Error(t("Could not decode floor-plan image."));
      const shrink = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * shrink));
      const height = Math.max(1, Math.round(image.naturalHeight * shrink));
      const canvas = window.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error(t("Could not analyze floor-plan image."));
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      const longSide = Math.max(width, height);
      const regions = detectRooms({ data: pixels.data, width, height }, {
        threshold: "otsu",
        gapClosePx: Math.max(1, Math.round(longSide / 400)),
        minAreaPx: Math.max(100, Math.round(width * height * 0.0015)),
        simplifyEpsilonPx: Math.max(1, longSide / 800),
        plan: { crop: data.image_crop, registration: resolveRegistration(data), rotationDeg: data.background_rotation },
      });
      const { rooms, skipped } = buildDetectedRooms(
        regions.slice(0, 30),
        data.rooms,
        activeLayerId,
        newId,
        (index) => `${t("Detected room")} ${index}`,
      );
      if (rooms.length === 0) {
        setFeedback(t("No new enclosed room areas found. Walls must be dark, continuous lines; add rooms manually or try a clearer plan."));
        return;
      }
      update({ rooms: [...data.rooms, ...rooms] });
      setDetectedRooms(true);
      setFeedback(`${rooms.length} ${t("room regions detected by heuristic raster analysis. Check every outline and area against the plan, then mark each room as reviewed.")}${skipped ? ` (${skipped} ${t("skipped: overlapping or over the limit")})` : ""}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : t("Could not detect room regions."));
    }
  }

  async function changePdfPage(pageNumber: number) {
    if (!pdfDocument) return;
    const generation = ++blueprintGenerationRef.current;
    let url: string | null = null;
    try {
      url = await renderPdfPageToUrl(pdfDocument, pageNumber);
      if (generation !== blueprintGenerationRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      if (hasBlueprint) await projectsApi.setBlueprintPage(projectId, floorId, pageNumber);
      if (generation !== blueprintGenerationRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setPdfPage(pageNumber);
      showBlueprintUrl(url);
    } catch (error) {
      if (url) URL.revokeObjectURL(url);
      if (generation === blueprintGenerationRef.current) setFeedback(error instanceof Error ? error.message : t("Could not render the PDF page."));
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.type === "application/pdf") {
      if (file.size > 25_000_000) {
        setFeedback(t("Floor-plan PDFs must be 25 MB or smaller."));
        return;
      }
      await storeBlueprint(file, file.name);
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setFeedback(t("Choose a PDF, PNG, JPEG, or WebP floor-plan file."));
      return;
    }
    if (file.size > 25_000_000) {
      setFeedback(t("Floor-plan images must be 25 MB or smaller."));
      return;
    }
    await storeBlueprint(file, file.name);
  }

  function addRcd() {
    if (!boards.data || boards.isFetching) return;
    const availableBoards = boards.data.boards;
    const boardId = resolveRcdBoard(availableBoards, newRcdBoardId);
    if (boardId === undefined) {
      setFeedback(t("Choose a distribution board for the new RCD."));
      return;
    }
    const rcd: ResidualCurrentDevice = {
      id: newId(),
      board_id: boardId,
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
      name: t("Final circuit"),
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
      name: `${t(labels[kind])} ${data.electrical_components.filter((item) => item.kind === kind).length + 1}`,
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
      setFeedback(t("Add outgoing circuits before generating their terminal strip."));
      return;
    }
    const rcdIndex = data.rcds.findIndex((item) => item.id === rcdId) + 1;
    const strip: TerminalStrip = {
      id: newId(),
      name: `${t("Terminal strip")} X${rcdIndex}`,
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
      setFeedback(t("Enter a positive distance greater than zero."));
      return;
    }
    update({ scale_m_per_100_units: scale });
    setCalibrationStart(null);
    setCalibrationEnd(null);
    setCalibrationMeters("");
    setFeedback(t("Scale calibrated. Save to store this measurement."));
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
    setFeedback(t("Selection copied."));
  }

  function pasteSelection() {
    if (!clipboard.rooms.length && !clipboard.placements.length) return;
    const ids = new Map<string, string>();
    for (const item of [...clipboard.rooms, ...clipboard.placements]) ids.set(item.id, newId());
    const rooms = clipboard.rooms.map((item) => translateRoom(
      { ...item, id: ids.get(item.id)! },
      clamp(item.x + 20, 0, 1000 - item.width),
      clamp(item.y + 20, 0, 700 - item.height),
    ));
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
    if (placementIds.size > 0) setFeedback(t("Selection duplicated."));
  }

  function mergeSelectedRooms() {
    if (selectedRooms.length !== 2 || selectedIds.length !== 2) {
      setFeedback(t("Select exactly two adjacent rooms to merge them."));
      return;
    }
    const [first, second] = selectedRooms;
    const result = mergeRooms(first, second);
    if (!result.ok) {
      setFeedback(t("These rooms cannot be merged: they must share an edge, not overlap, and be on the same layer."));
      return;
    }
    const merged = { ...result.value, needs_review: Boolean(first.needs_review || second.needs_review) };
    update({
      rooms: data.rooms.filter((room) => room.id !== second.id).map((room) => (room.id === first.id ? merged : room)),
      placements: data.placements.map((item) => (item.room_id === second.id ? { ...item, room_id: first.id } : item)),
    });
    setSelection({ kind: "room", id: first.id });
    setSelectedIds([first.id]);
    setFeedback(t("Rooms merged. Review the result."));
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
      [t("Type"), t("Description"), t("Quantity")],
      ...symbolKinds
        .map(({ kind, label }) => [t(label), t(label), String(data.placements.filter((item) => item.kind === kind).length)])
        .filter((row) => row[2] !== "0"),
      ...data.rcds.map((rcd, index) => ["RCD", `${rcd.name} (${rcd.rated_current_ma} mA, ${rcd.poles}-pole)`, "1"]),
      ...data.circuits.map((circuit) => [t("Circuit protection"), `${circuitNumber(circuit, data.rcds, data.circuits)} ${circuit.breaker_type}${circuit.rated_current_a} - ${circuit.cable}`, "1"]),
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
      for (const ring of [roomOutline(room), ...roomHoles(room)]) {
        ring.forEach((from, index) => {
          const to = ring[(index + 1) % ring.length];
          line(layer, from.x, from.y, to.x, to.y);
        });
      }
      const anchor = hasPolygon(room) ? labelAnchor(room) : { x: room.x + 8, y: room.y + 18 };
      text(layer, room.name, anchor.x, anchor.y);
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

  if (query.isLoading) return <p className="editor-status">{t("Loading floor workspace…")}</p>;
  if (query.isError) return <p className="editor-error">{t("Could not load this floor workspace.")}</p>;

  return (
    <section className="workspace">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">{t("FLOOR WORKSPACE")}</p>
          <h3>{floorName}</h3>
        </div>
        <div className="workspace-actions">
          <button type="button" className="button-secondary" onClick={exportDxf}>{t("Export CAD (DXF)")}</button>
          <button type="button" className="button-secondary" onClick={exportMaterials}>{t("Export materials CSV")}</button>
          <button type="button" className="button-secondary" onClick={() => window.print()}>{t("Print / PDF")}</button>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              const submitted = data;
              save.mutate(submitted, {
                onSuccess: (saved) => {
                  acknowledgedSaveRef.current = saved;
                  setFeedback(t("Save completed. Changes made while saving remain unsaved."));
                },
                onError: (error) => setFeedback(error instanceof ApiError && error.status === 409
                  ? t("Save conflict. Your changes remain here; reload the workspace and reapply them after checking project topology.")
                  : t("Save failed. Your unsaved changes are still here.")),
              });
            }}
            disabled={save.isPending}
          >
            {save.isPending ? t("Saving…") : t("Save workspace")}
          </button>
        </div>
      </header>
      {(data.topology_warnings?.length ?? 0) > 0 && (
        <div className="editor-error" role="alert">
          <strong>{t("Some project topology cannot be shown in the circuit editor:")}</strong>
          <ul>{data.topology_warnings?.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
        </div>
      )}
      <div className="workspace-tabs" role="tablist" aria-label={t("Floor workspace")}>
        <button type="button" role="tab" aria-selected={tab === "layout"} className={tab === "layout" ? "active" : ""} onClick={() => setTab("layout")}>{t("Floor plan")}</button>
        <button type="button" role="tab" aria-selected={tab === "circuits"} className={tab === "circuits" ? "active" : ""} onClick={() => setTab("circuits")}>{t("Circuits & board")}</button>
        <button type="button" role="tab" aria-selected={tab === "schematic"} className={tab === "schematic" ? "active" : ""} onClick={() => setTab("schematic")}>{t("Schematic preview")}</button>
        <button type="button" role="tab" aria-selected={tab === "cabinet"} className={tab === "cabinet" ? "active" : ""} onClick={() => setTab("cabinet")}>{t("Cabinet layout")}</button>
        <button type="button" role="tab" aria-selected={tab === "smart"} className={tab === "smart" ? "active" : ""} onClick={() => setTab("smart")}>{t("Smart systems")}</button>
        <button type="button" role="tab" aria-selected={tab === "documentation"} className={tab === "documentation" ? "active" : ""} onClick={() => setTab("documentation")}>{t("Documentation")}</button>
      </div>
      {tab === "layout" ? (
        <div className="plan-layout">
          <aside className="plan-sidebar">
            <label className="upload-button">
              <span>{t("Upload floor-plan image or PDF")}</span>
              <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={handleFile} />
            </label>
            <p className="field-hint">{t("PDF up to 10 MB or PNG, JPEG, WebP up to 2.5 MB")}</p>
            {pdfDocument && pdfPageCount > 1 && (
              <label className="field-label">{t("PDF page")}
                <select value={pdfPage} onChange={(event) => {
                  void changePdfPage(Number(event.target.value));
                }}>
                  {Array.from({ length: pdfPageCount }, (_, index) => <option key={index + 1} value={index + 1}>{t("Page {{number}}", { number: index + 1 })}</option>)}
                </select>
              </label>
            )}
            {backgroundSrc && <button className="text-button" type="button" onClick={() => void removeBackground()}>{t("Remove image")}</button>}
            {backgroundSrc && (
              <>
                <label className="field-label">{t("Plan opacity")}
                  <input type="range" min="0.1" max="1" step="0.05" value={data.background_opacity} onChange={(event) => update({ background_opacity: Number(event.target.value) })} />
                </label>
                <label className="field-label">{t("Plan rotation")}
                  <select value={data.background_rotation} onChange={(event) => update({ background_rotation: Number(event.target.value) })}>
                    {[0, 90, 180, 270].map((degrees) => <option key={degrees} value={degrees}>{degrees}°</option>)}
                  </select>
                </label>
                <button type="button" className="tool" onClick={() => update(editCrop(data, data.image_crop ? null : [0.05, 0.05, 0.9, 0.9]))}>
                  {data.image_crop ? t("Reset plan crop") : t("Crop plan edges")}
                </button>
                {data.image_crop && <div className="crop-controls">
                  {data.image_crop.map((value, index) => (
                    <label className="field-label" key={index}>{t(["Left", "Top", "Width", "Height"][index])}
                      <input type="range" min={index < 2 ? 0 : 0.2} max={index === 0 ? 1 - data.image_crop![2] : index === 1 ? 1 - data.image_crop![3] : index === 2 ? 1 - data.image_crop![0] : 1 - data.image_crop![1]} step="0.01" value={value} onChange={(event) => {
                        update(editCrop(data, setCropValue(data.image_crop, index as 0 | 1 | 2 | 3, Number(event.target.value))));
                      }} />
                    </label>
                  ))}
                </div>}
              </>
            )}
            {pdfDocument && <button type="button" className="text-button" onClick={() => { setPdfDocument(null); setPdfPageCount(0); }}>{t("Close PDF page selector")}</button>}
            <label className="field-label" htmlFor="plan-scale">{t("Scale (metres per 100 canvas units)")}</label>
            <input id="plan-scale" type="number" min="0.01" max="1000" step="0.01" placeholder={t("Not calibrated")} value={data.scale_m_per_100_units ?? ""} onChange={(event) => update({ scale_m_per_100_units: event.target.value ? Number(event.target.value) : null })} />
            <button type="button" className={tool === "scale" ? "tool active" : "tool"} onClick={() => { setCalibrationStart(null); setCalibrationEnd(null); setTool(tool === "scale" ? "select" : "scale"); setFeedback(t("Click two points that mark a known distance.")); }}>{t("Calibrate from two points")}</button>
            {!isClientPresentation && data.dimensions.map((dimension) => (
              <div className="mounting-point-row" key={dimension.id}>
                <input aria-label={t("Dimension label")} value={dimension.label} onChange={(event) => update({ dimensions: data.dimensions.map((item) => item.id === dimension.id ? { ...item, label: event.target.value } : item) })} />
                <button type="button" className="icon-button" aria-label={t("Delete dimension")} onClick={() => update({ dimensions: data.dimensions.filter((item) => item.id !== dimension.id) })}>×</button>
              </div>
            ))}
            {calibrationEnd && calibrationStart && (
              <div className="calibration-form">
                <label className="field-label" htmlFor="calibration-distance">{t("Distance between points (m)")}</label>
                <input id="calibration-distance" type="number" min="0.01" step="0.01" value={calibrationMeters} onChange={(event) => setCalibrationMeters(event.target.value)} />
                <button type="button" className="button-secondary" onClick={applyScaleCalibration}>{t("Apply calibration")}</button>
              </div>
            )}
            <p className="field-hint">{t("Calibrate against a known wall or dimension on the plan.")}</p>
            <div className="sidebar-divider" />
            <p className="field-label">{t("Layers")}</p>
            <label className="field-label">{t("Active layer")}
              <select value={activeLayerId} onChange={(event) => setActiveLayerId(event.target.value)}>
                {data.layers.map((layer) => <option key={layer.id} value={layer.id}>{t(layer.name)}</option>)}
              </select>
            </label>
            <div className="layer-list">
              {data.layers.map((layer) => (
                <label key={layer.id} className="layer-option">
                  <input type="checkbox" checked={layer.visible} onChange={(event) => update({ layers: data.layers.map((item) => item.id === layer.id ? { ...item, visible: event.target.checked } : item) })} />
                  <input aria-label={t("{{name}} layer name", { name: layer.name })} value={layer.name} onChange={(event) => update({ layers: data.layers.map((item) => item.id === layer.id ? { ...item, name: event.target.value } : item) })} />
                </label>
              ))}
            </div>
            <button type="button" className="text-button" onClick={() => {
              const layer: PlanLayer = {
                id: newId(),
                name: `${t("Layer")} ${data.layers.length + 1}`,
                visible: true,
                color: "#7c5cbd",
                purpose: "custom",
              };
              update({ layers: [...data.layers, layer] });
              setActiveLayerId(layer.id);
            }}>{`＋ ${t("Add layer")}`}</button>
            <label className="layer-option">
              <input type="checkbox" checked={isClientPresentation} onChange={(event) => update({ annotation: { ...data.annotation, presentation_mode: event.target.checked ? "client" : "planning" } })} />
              {t("Client presentation mode")}
            </label>
            <label className="layer-option"><input type="checkbox" checked={showElementIds} onChange={(event) => setShowElementIds(event.target.checked)} />{t("Element IDs")}</label>
            <label className="layer-option"><input type="checkbox" checked={showBusAddresses} onChange={(event) => setShowBusAddresses(event.target.checked)} />{t("Bus addresses")}</label>
            <label className="layer-option"><input type="checkbox" checked={showCircuitNames} onChange={(event) => setShowCircuitNames(event.target.checked)} />{t("Circuit labels")}</label>
            <label className="layer-option"><input type="checkbox" checked={showFuseAssignments} onChange={(event) => setShowFuseAssignments(event.target.checked)} />{t("Fuse references")}</label>
            <label className="layer-option"><input type="checkbox" checked={showGroupLabels} onChange={(event) => setShowGroupLabels(event.target.checked)} />{t("Mounting-group labels")}</label>
            <label className="layer-option"><input type="checkbox" checked={showRoomOverlays} onChange={(event) => setShowRoomOverlays(event.target.checked)} />{t("Room overlays")}</label>
            <div className="sidebar-divider" />
            <p className="field-label">{t("Rooms")}</p>
            <div className="tool-list">
              <button type="button" className={tool === "room" ? "tool active" : "tool"} onClick={() => setTool(tool === "room" ? "select" : "room")}>＋ {t("Draw room")}</button>
              <button type="button" className={tool === "dimension" ? "tool active" : "tool"} onClick={() => { setMeasurementStart(null); setTool(tool === "dimension" ? "select" : "dimension"); }}>＋ {t("Add dimension")}</button>
              <button type="button" className="tool" onClick={addFreeNote}>＋ {t("Add note")}</button>
              <button type="button" className="tool" onClick={() => void detectRoomRegions()}>{detectedRooms ? t("Detect more rooms") : t("Detect rooms (beta)")}</button>
              {selectedRoom && <button type="button" className={tool === "hole" ? "tool active" : "tool"} onClick={() => {
                setHoleDraft(null);
                setTool(tool === "hole" ? "select" : "hole");
                setFeedback(tool === "hole" ? "" : t("Drag inside the selected room to draw a hole."));
              }}>{t("Draw room hole")}</button>}
              {data.rooms.some((room) => room.needs_review) && (
                <p className="room-warning" role="status">{data.rooms.filter((room) => room.needs_review).length} {t("detected rooms still need review. Detection is heuristic; verify outlines and areas against the plan.")}</p>
              )}
              <button type="button" className="tool" onClick={() => addRoom(t("Living room"), [
                { kind: "light", label: t("Ceiling light"), dx: 90, dy: 45 },
                { kind: "switch", label: t("Switch"), dx: 20, dy: 20 },
                { kind: "socket", label: t("Socket"), dx: 30, dy: 90 },
                { kind: "socket", label: t("Socket"), dx: 150, dy: 90 },
              ])}>{t("Living room template")}</button>
              <button type="button" className="tool" onClick={() => addRoom(t("Kitchen"), [
                { kind: "light", label: t("Ceiling light"), dx: 90, dy: 45 },
                { kind: "switch", label: t("Switch"), dx: 20, dy: 20 },
                { kind: "socket", label: t("Worktop socket"), dx: 35, dy: 85 },
                { kind: "socket", label: t("Worktop socket"), dx: 90, dy: 85 },
                { kind: "socket", label: t("Appliance socket"), dx: 150, dy: 85 },
              ])}>{t("Kitchen template")}</button>
              <button type="button" className="tool" onClick={() => addRoom(t("Bedroom"), [
                { kind: "light", label: t("Ceiling light"), dx: 90, dy: 45 },
                { kind: "switch", label: t("Switch"), dx: 20, dy: 20 },
                { kind: "socket", label: t("Socket"), dx: 35, dy: 90 },
                { kind: "socket", label: t("Socket"), dx: 145, dy: 90 },
              ])}>{t("Bedroom template")}</button>
            </div>
            <div className="sidebar-divider" />
            <p className="field-label">{t("Symbol library")}</p>
            <p className="field-hint">{t("Floor-plan symbols are illustrative and have not been verified against DIN EN 60617 / IEC 60617.")}</p>
            <div className="tool-list symbol-tools">
              {symbolKinds.map(({ kind, glyph, label }) => (
                <button type="button" key={kind} className={tool === kind ? "tool active" : "tool"} onClick={() => setTool(tool === kind ? "select" : kind)}>
                  <span className="symbol-glyph">{glyph}</span>{t(label)}
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
                    <button type="button" className="icon-button" aria-label={`${t(component.favorite ? "Unfavorite" : "Favorite")} ${component.name}`} onClick={() => update({ custom_components: data.custom_components.map((item) => item.id === component.id ? { ...item, favorite: !item.favorite } : item) })}>{component.favorite ? "★" : "☆"}</button>
                  </div>
                ))}
              </div>
            )}
            {tool === "custom" && (
              <>
                <input aria-label={t("Custom symbol label")} placeholder={t("Custom symbol name")} value={customLabel} onChange={(event) => setCustomLabel(event.target.value)} />
                <button type="button" className="text-button" onClick={saveCustomComponent}>{t("Save to custom library")}</button>
              </>
            )}
            {selectedRooms.length === 2 && selectedIds.length === 2 && (
              <button type="button" className="tool" onClick={mergeSelectedRooms}>{t("Merge rooms")}</button>
            )}
            {selectedRoom && (
              <>
                <RoomMetadataEditor
                  key={selectedRoom.id}
                  value={selectedRoom}
                  t={t}
                  onSave={(next) => update({ rooms: data.rooms.map((room) => room.id === next.id ? next : room) })}
                />
                {selectedRoom.needs_review && (
                  <div className="room-warning" role="alert">
                    <p>{t("Detected automatically by a heuristic raster analysis. Walls, doors, furniture and scan noise can distort the outline and area. Verify against the plan before relying on it.")}</p>
                    <button type="button" className="tool" onClick={() => update({ rooms: data.rooms.map((room) => room.id === selectedRoom.id ? { ...room, needs_review: false } : room) })}>{t("Mark as reviewed")}</button>
                  </div>
                )}
                <p className="field-label">
                  {(() => {
                    const area = roomAreaM2(selectedRoom, data.scale_m_per_100_units);
                    return area === null ? t("Area: calibrate the plan scale to see m²") : `${t("Area")}: ${area.toFixed(2)} m²${roomHoles(selectedRoom).length ? ` (${t("holes excluded")})` : ""}`;
                  })()}
                </p>
                {roomHoles(selectedRoom).map((_, index) => (
                  <button
                    type="button"
                    className="text-button"
                    key={`hole-${index}`}
                    onClick={() => {
                      const result = removeRoomHole(selectedRoom, index);
                      if (result.ok) update({ rooms: data.rooms.map((room) => room.id === selectedRoom.id ? result.value : room) });
                    }}
                  >
                    {t("Remove hole {{number}}", { number: index + 1 })}
                  </button>
                ))}
                {hasPolygon(selectedRoom) ? (
                  <>
                    <button type="button" className={splitState?.roomId === selectedRoom.id ? "tool active" : "tool"} onClick={() => {
                      const active = splitState?.roomId === selectedRoom.id;
                      setSplitState(active ? null : { roomId: selectedRoom.id, first: null });
                      setFeedback(active ? "" : t("Click the first vertex of the cut."));
                    }}>{t("Split room")}</button>
                    <p className="field-label">{t("Drag vertices to reshape; click a + handle to add a vertex; double-click a vertex to delete it.")}</p>
                  </>
                ) : (
                  <button type="button" className="tool" onClick={() => applyRoomEdit([toPolygonRoom(selectedRoom)])}>{t("Edit outline")}</button>
                )}
              </>
            )}
            {selectedPlacement && (
              <>
                <label className="field-label" htmlFor="selected-symbol-name">{t("Selected symbol")}</label>
                <input id="selected-symbol-name" value={selectedPlacement.label} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, label: event.target.value } : item) })} />
                <label className="field-label">{t("Circuit assignment")}
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
                    <option value="">{t("Unassigned")}</option>
                    {data.circuits.map((circuit) => <option key={circuit.id} value={circuit.id}>{circuitNumber(circuit, data.rcds, data.circuits)} · {circuit.name}</option>)}
                  </select>
                </label>
                <label className="field-label">{t("Room")}
                  <select value={selectedPlacement.room_id ?? ""} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, room_id: event.target.value || null } : item) })}>
                    <option value="">{t("No room")}</option>
                    {data.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                  </select>
                </label>
                <label className="field-label">{t("Layer")}
                  <select value={selectedPlacement.layer_id} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, layer_id: event.target.value } : item) })}>
                    {data.layers.map((layer) => <option key={layer.id} value={layer.id}>{t(layer.name)}</option>)}
                  </select>
                </label>
                <label className="field-label">{t("Element ID")}
                  <input value={selectedPlacement.element_id ?? ""} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, element_id: event.target.value || null } : item) })} />
                </label>
                <label className="field-label">{t("Bus address")}
                  <input value={selectedPlacement.bus_address ?? ""} onChange={(event) => update({ placements: data.placements.map((item) => item.id === selectedPlacement.id ? { ...item, bus_address: event.target.value || null } : item) })} />
                </label>
                <div className="button-row">
                  <button type="button" className="tool" onClick={() => rotateSelection(-45)}>{t("Rotate −45°")}</button>
                  <button type="button" className="tool" onClick={() => rotateSelection(45)}>{t("Rotate +45°")}</button>
                </div>
              </>
            )}
            {selectedPlacements.length > 1 && <button type="button" className="tool" onClick={groupSelectedPlacements}>{t("Group mounting points")}</button>}
            {!isClientPresentation && data.mounting_points.map((point) => (
              <div className="mounting-point-row" key={point.id}>
                <input aria-label={t("Mounting group name")} value={point.name} onChange={(event) => update({ mounting_points: data.mounting_points.map((item) => item.id === point.id ? { ...item, name: event.target.value } : item) })} />
                <button type="button" className="text-button" onClick={() => update({
                  mounting_points: data.mounting_points.filter((item) => item.id !== point.id),
                  placements: data.placements.map((item) => item.mounting_point_id === point.id ? { ...item, mounting_point_id: null } : item),
                })}>{t("Ungroup")}</button>
              </div>
            ))}
            {!isClientPresentation && data.free_canvas.filter((item) => item.kind === "note").map((note) => (
              <div className="mounting-point-row" key={note.id}>
                <input aria-label={t("Plan note text")} value={note.label} onChange={(event) => update({ free_canvas: data.free_canvas.map((item) => item.id === note.id ? { ...item, label: event.target.value } : item) })} />
                <button type="button" className="icon-button" aria-label={t("Delete plan note")} onClick={() => update({ free_canvas: data.free_canvas.filter((item) => item.id !== note.id) })}>×</button>
              </div>
            ))}
            {selectedIds.length > 0 && <button type="button" className="button-danger" onClick={removeSelection}>{t("Delete selection")}</button>}
          </aside>
          <div className="canvas-column">
            <div className="canvas-instructions">
              <span>{t("Choose a room or symbol, then click to place. Drag to move; middle-drag or Shift-drag to pan. Scroll to zoom; use two fingers to pan or pinch.")}</span>
              <div className="button-row">
                <button type="button" className="tool" aria-label={t("Zoom out")} onClick={() => zoomCanvas(1.2)}>−</button>
                <button type="button" className="tool" aria-label={t("Zoom in")} onClick={() => zoomCanvas(0.8)}>＋</button>
                <button type="button" className="tool" onClick={() => setViewBox({ x: 0, y: 0, width: 1000, height: 700 })}>{t("Reset view")}</button>
                <button type="button" className="tool" onClick={copySelection} disabled={!selectedIds.length}>{t("Copy")}</button>
                <button type="button" className="tool" onClick={pasteSelection} disabled={!clipboard.rooms.length && !clipboard.placements.length}>{t("Paste")}</button>
              </div>
            </div>
            <svg
              ref={svgRef}
              className="floor-canvas"
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              role="img"
              aria-label={`${floorName} floor-plan canvas`}
              onPointerDownCapture={handleTouchDown}
              onPointerMoveCapture={handleTouchMove}
              onPointerDown={handleCanvasDown}
              onPointerMove={handleCanvasMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            >
              <defs>
                <pattern id="canvas-grid" width="25" height="25" patternUnits="userSpaceOnUse">
                  <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e9edf3" strokeWidth="1" />
                </pattern>
                <clipPath id="plan-image-clip"><rect width="1000" height="700" /></clipPath>
              </defs>
              <rect width="1000" height="700" fill="#fff" />
              <rect width="1000" height="700" fill="url(#canvas-grid)" />
              {backgroundSrc && (() => {
                const layout = cropLayout(data, data.background_rotation);
                return (
                  <g clipPath="url(#plan-image-clip)" opacity={data.background_opacity}>
                    {layout.clip && <clipPath id="plan-source-crop"><rect {...layout.clip} /></clipPath>}
                    <g transform={layout.transform}>
                      <image
                        href={backgroundSrc}
                        {...layout.image}
                        preserveAspectRatio="none"
                        clipPath={layout.clip ? "url(#plan-source-crop)" : undefined}
                      />
                    </g>
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
                  {hasPolygon(room)
                    ? <path d={roomPath(room)} fillRule="evenodd" style={{ fill: room.color }} className={`room-shape${selectedIds.includes(room.id) ? " selected" : ""}${room.needs_review ? " review" : ""}`} />
                    : <rect x={room.x} y={room.y} width={room.width} height={room.height} rx="5" style={{ fill: room.color }} className={selectedIds.includes(room.id) ? "room-shape selected" : "room-shape"} />}
                  {hasPolygon(room)
                    ? <text x={labelAnchor(room).x} y={labelAnchor(room).y} textAnchor="middle" className="room-label">{room.name}{room.needs_review ? " ⚠" : ""}</text>
                    : <text x={room.x + 12} y={room.y + 24} className="room-label">{room.name}</text>}
                  {!hasPolygon(room) && selectedIds.includes(room.id) && <rect x={room.x + room.width - 6} y={room.y + room.height - 6} width="12" height="12" className="selection-handle" />}
                </g>
              ))}
              {holeDraft && (
                <rect
                  x={Math.min(holeDraft.start.x, holeDraft.end.x)}
                  y={Math.min(holeDraft.start.y, holeDraft.end.y)}
                  width={Math.abs(holeDraft.end.x - holeDraft.start.x)}
                  height={Math.abs(holeDraft.end.y - holeDraft.start.y)}
                  className="room-hole-preview"
                  pointerEvents="none"
                />
              )}
              {tool === "select" && selectedRoom && hasPolygon(selectedRoom) && selectedIds.length === 1 && layerIsVisible(selectedRoom.layer_id) && (() => {
                const outline = roomOutline(selectedRoom);
                const splitting = splitState?.roomId === selectedRoom.id;
                return (
                  <g className="room-vertices">
                    {!splitting && outline.map((from, index) => {
                      const to = outline[(index + 1) % outline.length];
                      return (
                        <g key={`edge-${index}`} transform={`translate(${(from.x + to.x) / 2},${(from.y + to.y) / 2})`} onPointerDown={(event) => beginEdgeInsert(event, selectedRoom, index)} className="vertex-add">
                          <circle r="7" />
                          <path d="M-3.5,0H3.5M0,-3.5V3.5" />
                        </g>
                      );
                    })}
                    {outline.map((point, index) => (
                      <circle
                        key={`vertex-${index}`}
                        cx={point.x}
                        cy={point.y}
                        r="7"
                        className={splitting && splitState?.first === index ? "vertex-handle split-start" : "vertex-handle"}
                        onPointerDown={(event) => beginVertex(event, selectedRoom, index)}
                        onDoubleClick={() => removeVertex(selectedRoom, index)}
                      />
                    ))}
                  </g>
                );
              })()}
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
                    {!isClientPresentation && showCircuitNames && item.circuit_id && <text y="70" textAnchor="middle" className="placement-label">{data.circuits.find((circuit) => circuit.id === item.circuit_id)?.name ?? t("Circuit")}</text>}
                    {!isClientPresentation && showFuseAssignments && item.circuit_id && <text y="83" textAnchor="middle" className="placement-label">{(() => {
                      const circuit = data.circuits.find((entry) => entry.id === item.circuit_id);
                      return circuit ? circuitNumber(circuit, data.rcds, data.circuits) : "";
                    })()}</text>}
                  </g>
                );
              })}
            </svg>
            <div className="canvas-footer">
              <span>{data.rooms.length} {t("rooms")} · {data.placements.length} {t("installation points")}</span>
              <span>{data.scale_m_per_100_units ? `${t("Scale set")}: ${data.scale_m_per_100_units} m / 100 ${t("units")}` : t("Scale not set")}</span>
            </div>
          </div>
        </div>
      ) : tab === "circuits" ? (
        <div className="circuits-panel">
          <div className="circuits-intro">
            <div><p className="eyebrow">{t("DISTRIBUTION DOCUMENTATION")}</p><h4>{t("Protective devices and outgoing circuits")}</h4><p>{t("Circuits are numbered automatically below each RCD. Terminal references follow the same grouping.")}</p><p className="field-hint">{t("New device and circuit values are examples; verify every rating and cable against the design.")}</p></div>
            <div>
              {(boards.data?.boards.length ?? 0) > 1 && (
                <label>{t("Distribution board")}
                  <select value={newRcdBoardId} onChange={(event) => setNewRcdBoardId(event.target.value)}>
                    <option value="">{t("Choose a distribution board")}</option>
                    {boards.data?.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
                  </select>
                </label>
              )}
              {boards.isError && <p className="editor-error" role="alert">{t("Could not load distribution boards.")}</p>}
              <button type="button" className="button-primary" onClick={addRcd} disabled={!boards.data || boards.isFetching}>＋ {t("Add RCD")}</button>
            </div>
          </div>
          <section className="electrical-component-panel">
            <header><strong>{t("Main devices, contacts and terminals")}</strong></header>
            <div className="button-row">
              {(["main_switch", "surge_protection", "contactor", "relay", "terminal", "power_supply", "potential_free_contact"] as ElectricalComponent["kind"][]).map((kind) => (
                <button key={kind} type="button" className="tool" onClick={() => addElectricalComponent(kind)}>＋ {t(kind.replace(/_/g, " "))}</button>
              ))}
            </div>
            {data.electrical_components.map((component) => (
              <div className="electrical-component-row" key={component.id}>
                <input aria-label={t("Electrical component name")} value={component.name} onChange={(event) => update({ electrical_components: data.electrical_components.map((item) => item.id === component.id ? { ...item, name: event.target.value } : item) })} />
                <input aria-label={t("Electrical component reference")} placeholder={t("Reference")} value={component.reference ?? ""} onChange={(event) => update({ electrical_components: data.electrical_components.map((item) => item.id === component.id ? { ...item, reference: event.target.value || null } : item) })} />
                <select
                  aria-label={t("Controlled circuits")}
                  multiple
                  size={Math.min(Math.max(data.circuits.length, 2), 4)}
                  value={component.circuit_ids}
                  onChange={(event) => update({ electrical_components: data.electrical_components.map((item) => item.id === component.id ? { ...item, circuit_ids: Array.from(event.currentTarget.selectedOptions, (option) => option.value) } : item) })}
                >
                  {data.circuits.map((circuit) => <option key={circuit.id} value={circuit.id}>{circuitNumber(circuit, data.rcds, data.circuits)} · {circuit.name}</option>)}
                </select>
                <button type="button" className="icon-button" aria-label={t("Remove {{name}}", { name: component.name })} onClick={() => update({ electrical_components: data.electrical_components.filter((item) => item.id !== component.id), cabinet: { ...data.cabinet, modules: data.cabinet.modules.filter((module) => module.component_id !== component.id) } })}>×</button>
              </div>
            ))}
          </section>
          {data.rcds.length === 0 && <div className="empty-panel">{t("Add an RCD to start documenting its outgoing circuits.")}</div>}
          <div className="rcd-list">
            {data.rcds.map((rcd) => {
              const rcdIndex = data.rcds.findIndex((item) => item.id === rcd.id) + 1;
              const circuits = data.circuits.filter((item) => item.rcd_id === rcd.id);
              return (
                <section key={rcd.id} className="rcd-card">
                  <header className="rcd-heading">
                    <div className="number-badge">F{rcdIndex}</div>
                    <input aria-label={t("RCD name")} value={rcd.name} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, name: event.target.value } : item) })} />
                    {rcd.board_id && <span>{t("Distribution board")}: {boards.data?.boards.find((board) => board.id === rcd.board_id)?.name ?? t("Assigned board unavailable")}</span>}
                    <label>{t("Rated current (mA)")}<input type="number" min="10" max="1000" value={rcd.rated_current_ma} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, rated_current_ma: Number(event.target.value) } : item) })} /></label>
                    <label>{t("Poles")}<select value={rcd.poles} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, poles: Number(event.target.value) as 2 | 4 } : item) })}><option value={2}>{t("2-pole")}</option><option value={4}>{t("4-pole")}</option></select></label>
                    <label>{t("Type")}<select value={rcd.type} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, type: event.target.value as ResidualCurrentDevice["type"] } : item) })}><option>A</option><option>F</option><option>B</option></select></label>
                    <label>{t("Upstream RCD")}<select value={rcd.upstream_id ?? ""} onChange={(event) => update({ rcds: data.rcds.map((item) => item.id === rcd.id ? { ...item, upstream_id: event.target.value || null } : item) })}><option value="">{t("None")}</option>{data.rcds.filter((item) => item.id !== rcd.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <button type="button" className="text-button" onClick={() => removeRcd(rcd.id)}>{t("Remove")}</button>
                  </header>
                  <div className="circuit-schematic" aria-label={t("Schematic for {{name}}", { name: rcd.name })}>
                    <div className="schematic-rcd">
                      <strong>F{rcdIndex}</strong>
                      <span>RCD · {t("Type")} {rcd.type} · {rcd.rated_current_ma} mA</span>
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
                    ) : <p className="schematic-empty">{t("Outgoing circuits appear here.")}</p>}
                  </div>
                  <div className="circuit-table-wrap">
                    <table className="circuit-table">
                      <thead><tr><th>{t("Ref.")}</th><th>{t("Circuit")}</th><th>{t("Breaker")}</th><th>{t("Rated current")}</th><th>{t("Poles / supply")}</th><th>{t("Cable")}</th><th>{t("Connected plan points")}</th><th>{t("Terminal")}</th><th /></tr></thead>
                      <tbody>
                        {circuits.map((circuit) => (
                          <tr key={circuit.id}>
                            <td><span className="circuit-ref">{circuitNumber(circuit, data.rcds, data.circuits)}</span></td>
                            <td><input aria-label={t("Circuit name")} value={circuit.name} onChange={(event) => updateCircuit(circuit.id, { name: event.target.value })} /></td>
                            <td><select value={circuit.breaker_type} onChange={(event) => updateCircuit(circuit.id, { breaker_type: event.target.value as ElectricalCircuit["breaker_type"] })}><option>B</option><option>C</option><option>D</option></select></td>
                            <td><label className="unit-input"><input aria-label={t("Rated current in amps")} type="number" min="1" max="125" value={circuit.rated_current_a} onChange={(event) => updateCircuit(circuit.id, { rated_current_a: Number(event.target.value) })} /> A</label></td>
                            <td>
                              <select aria-label={t("Circuit poles")} value={circuit.poles} onChange={(event) => updateCircuit(circuit.id, { poles: Number(event.target.value) as ElectricalCircuit["poles"] })}>
                                {[1, 2, 3, 4].map((poles) => <option key={poles} value={poles}>{poles}-pole</option>)}
                              </select>
                              <select aria-label={t("Circuit supply type")} value={circuit.supply} onChange={(event) => updateCircuit(circuit.id, { supply: event.target.value as ElectricalCircuit["supply"] })}>
                                <option value="1n">1N~</option><option value="3n">3N~</option><option value="emergency">{t("Emergency")}</option><option value="phase_selector">{t("Phase selector")}</option><option value="transfer">{t("Transfer")}</option>
                              </select>
                            </td>
                            <td><input aria-label={t("Cable cross section")} value={circuit.cable} onChange={(event) => updateCircuit(circuit.id, { cable: event.target.value })} /></td>
                            <td>
                              <select
                                aria-label={t("Connected floor-plan points")}
                                multiple
                                size={Math.min(Math.max(data.placements.length, 2), 4)}
                                value={circuit.loads}
                                disabled={topologyPlacements.isLoading || topologyPlacements.isError}
                                onChange={(event) => updateCircuit(circuit.id, { loads: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}
                              >
                                {[
                                  ...data.placements.map((placement) => ({
                                  id: placement.id,
                                  floor_id: floorId,
                                  floor_name: floorName,
                                  label: placement.label,
                                  })),
                                  ...(topologyPlacements.data ?? []).filter((placement) => placement.floor_id !== floorId),
                                ].map((placement) => (
                                  <option key={`${placement.floor_id}-${placement.id}`} value={placement.id}>
                                    {placement.floor_name} · {placement.label}
                                  </option>
                                ))}
                              </select>
                              {topologyPlacements.isError && <p className="editor-error" role="alert">{t("Project-wide floor-plan points could not be loaded. Circuit load editing is disabled.")}</p>}
                            </td>
                            <td><span className="terminal-ref">X{rcdIndex}.{circuits.findIndex((item) => item.id === circuit.id) + 1}</span></td>
                            <td><button className="icon-button" aria-label={t("Remove {{name}}", { name: circuit.name })} type="button" onClick={() => removeCircuit(circuit.id)}>×</button></td>
                          </tr>
                        ))}
                        {circuits.length === 0 && <tr><td colSpan={9} className="empty-row">{t("No outgoing circuits yet.")}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <footer className="rcd-footer"><span>{circuitCounts.get(rcd.id) ?? 0} {t("circuits")} · X{rcdIndex} {t("terminal group")}</span><div className="button-row"><button type="button" className="text-button" onClick={() => generateTerminalStrip(rcd.id)}>{t("Generate terminal strip")}</button><button type="button" className="text-button" onClick={() => addCircuit(rcd.id)}>＋ {t("Add circuit")}</button></div></footer>
                </section>
              );
            })}
          </div>
          <div className="board-summary"><strong>{t("Board summary")}</strong><span>{data.rcds.length} {t("RCDs")}</span><span>{data.circuits.length} {t("outgoing circuits")}</span><span>{data.placements.filter((item) => item.kind === "knx").length} {t("KNX points on floor plan")}</span></div>
          {data.terminal_strips.length > 0 && (
            <section className="terminal-strip-list">
              <h4>{t("Terminal plan")}</h4>
              {data.terminal_strips.map((strip) => (
                <article className="terminal-strip-card" key={strip.id}>
                  <input aria-label={t("Terminal strip name")} value={strip.name} onChange={(event) => update({ terminal_strips: data.terminal_strips.map((item) => item.id === strip.id ? { ...item, name: event.target.value } : item) })} />
                  <span>{strip.kind}</span>
                  <span>{strip.circuit_ids.length} {t("circuits")} · {strip.terminals_per_circuit} {t("terminals each")} · {strip.terminal_width_mm} mm</span>
                  <button type="button" className="icon-button" aria-label={t("Remove {{name}}", { name: strip.name })} onClick={() => update({ terminal_strips: data.terminal_strips.filter((item) => item.id !== strip.id) })}>×</button>
                </article>
              ))}
            </section>
          )}
        </div>
      ) : tab === "schematic" ? (
        <SchematicView
          data={data}
          topologyPlacements={topologyPlacements.isError ? undefined : topologyPlacements.data?.filter((placement) => placement.floor_id !== floorId)}
          topologyPlacementsStatus={topologyPlacements.isLoading ? "loading" : topologyPlacements.isError ? "unavailable" : "available"}
        />
      ) : tab === "cabinet" ? (
        <CabinetEditor data={data} onChange={update} />
      ) : tab === "smart" ? (
        <SmartSystemsEditor data={data} onChange={update} />
      ) : null}
      <DocumentationPanel
        data={{ ...data, background_image: backgroundSrc }}
        projectName={projectName}
        floorName={floorName}
        active={tab === "documentation"}
        onChange={update}
      />
      {feedback && <p className={feedback.includes("failed") || feedback.includes("Choose") || feedback.includes("smaller") ? "editor-error" : "editor-status"} role="status">{feedback}</p>}
      {save.isError && !feedback && <p className="editor-error" role="alert">{t("Could not save this workspace.")}</p>}
    </section>
  );
}
