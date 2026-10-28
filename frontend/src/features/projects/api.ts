import { api } from "../../lib/api-client";

export type Project = {
  id: number;
  organization_id: number;
  team_id?: number | null;
  name: string;
  description?: string | null;
  archived: boolean;
};

export type ProjectCreate = {
  organization_id: number;
  team_id?: number | null;
  name: string;
  description?: string;
};

export type Floor = {
  id: number;
  name: string;
  sort_order: number;
};

export type Building = {
  id: number;
  project_id: number;
  name: string;
  floors: Floor[];
};

export type ProjectShare = { id: number; token: string; client_view: boolean };
export type SharedProject = {
  name: string;
  description: string | null;
  buildings: {
    name: string;
    floors: { id: number; name: string; plan_data: FloorPlanData }[];
  }[];
};

export type BuildingCreate = {
  name: string;
  floors: { name: string }[];
};

export type RoomPlanItem = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  layer_id: string;
};

export type PlacementKind =
  | "socket" | "light" | "switch" | "smoke_detector" | "network" | "distribution" | "pv" | "knx" | "custom"
  | "doorbell" | "data_outlet" | "thermostat" | "motion_sensor" | "camera" | "alarm" | "speaker"
  | "door_contact" | "blind" | "dali" | "loxone" | "free_at_home" | "homematic" | "ekey" | "gira_door"
  | "led_driver" | "actuator" | "binary_input" | "presence_detector" | "bus_coupler" | "power_supply"
  | "surge_protection" | "main_switch" | "contactor" | "relay" | "terminal";

export type PlanPlacement = {
  id: string;
  kind: PlacementKind;
  label: string;
  x: number;
  y: number;
  rotation: number;
  room_id: string | null;
  mounting_point_id: string | null;
  circuit_id: string | null;
  device_id: string | null;
  channel_id: string | null;
  layer_id: string;
  color: string;
  element_id: string | null;
  bus_address: string | null;
  cable_type: string | null;
  target_location: string | null;
  metadata: Record<string, string>;
};

export type PlanLayer = {
  id: string;
  name: string;
  visible: boolean;
  color: string;
  purpose: "technical" | "client" | "notes" | "architecture" | "custom";
};

export type MountingPoint = {
  id: string;
  name: string;
  x: number;
  y: number;
  rotation: number;
  placement_ids: string[];
};

export type PlanDimension = { id: string; x1: number; y1: number; x2: number; y2: number; label: string };
export type FreeCanvasItem = {
  id: string;
  kind: "note" | "line" | "rectangle" | "polyline" | "group" | "placeholder";
  label: string;
  points: [number, number][];
  color: string;
  layer_id: string;
  width: number;
};

export type DeviceChannel = {
  id: string;
  name: string;
  kind: "switching" | "dimming" | "0-10v" | "binary_input" | "blind" | "heating" | "dali" | "bus";
  address: string | null;
  load_ids: string[];
  circuit_id: string | null;
};

export type SmartDevice = {
  id: string;
  name: string;
  system: "knx" | "loxone" | "dali" | "free_at_home" | "homematic" | "ekey" | "gira_door" | "other";
  kind: "actuator" | "binary_input" | "presence_detector" | "line_coupler" | "ip_interface" | "miniserver" | "extension" | "power_supply" | "tree_device" | "audioserver" | "energy_meter" | "led_driver" | "dali_gateway" | "door_station" | "fingerprint" | "custom";
  model: string | null;
  line: string | null;
  address: string | null;
  bus_id: string | null;
  circuit_id: string | null;
  te_width: number;
  color: string;
  channels: DeviceChannel[];
};

export type ElectricalComponent = {
  id: string;
  kind: "main_switch" | "surge_protection" | "contactor" | "relay" | "terminal" | "power_supply" | "transfer_switch" | "phase_selector" | "potential_free_contact" | "distribution_link";
  name: string;
  reference: string | null;
  rated_current_a: number | null;
  poles: 1 | 2 | 3 | 4;
  te_width: number;
  terminal_count: number;
  contact_count: number;
  controlled_component_id: string | null;
  circuit_ids: string[];
  color: string;
  price: number;
};

export type TerminalStrip = {
  id: string;
  name: string;
  kind: "internal" | "external" | "bus";
  circuit_ids: string[];
  terminals_per_circuit: number;
  terminal_width_mm: number;
  end_brackets: number;
  separators: number;
};

export type CustomComponent = {
  id: string;
  name: string;
  kind: string;
  te_width: number;
  channel_kinds: string[];
  color: string;
  favorite: boolean;
};

export type CabinetRail = { id: string; name: string; modules: number; height_mm: number; spacing_mm: number };
export type CabinetModule = { id: string; component_id: string; name: string; rail_id: string; position: number; te_width: number; color: string };
export type CabinetConfiguration = {
  name: string;
  manufacturer: string | null;
  model: string | null;
  rows: number;
  columns: number;
  page_size: "A4" | "A3" | "A2" | "custom";
  scale: number;
  rails: CabinetRail[];
  modules: CabinetModule[];
  spare_modules_per_rail: number;
  mounting_notes: string;
};

export type PriceEntry = {
  id: string;
  name: string;
  category: "device" | "labor" | "cable" | "other";
  quantity: number;
  unit: string;
  unit_price: number;
  source_id: string | null;
};

export type TestMeasurement = {
  id: string;
  circuit_id: string | null;
  kind: "continuity" | "insulation" | "loop_impedance" | "rcd_trip_time" | "rcd_trip_current" | "voltage" | "polarity" | "earth_resistance" | "other";
  measured_value: number;
  unit: string;
  limit_value: number | null;
  passed: boolean;
  measured_at: string | null;
  notes: string;
};

export type ProjectAnnotation = {
  title: string;
  legend: string;
  notes: string;
  customer_name: string;
  project_number: string;
  presentation_mode: "planning" | "client";
};

export type ResidualCurrentDevice = {
  id: string;
  name: string;
  rated_current_ma: number;
  poles: 2 | 4;
  type: "A" | "F" | "B";
  upstream_id: string | null;
  price: number;
};

export type ElectricalCircuit = {
  id: string;
  name: string;
  rcd_id: string;
  breaker_type: "B" | "C" | "D";
  rated_current_a: number;
  poles: 1 | 2 | 3 | 4;
  cable: string;
  loads: string[];
  supply: "1n" | "3n" | "emergency" | "phase_selector" | "transfer";
  price: number;
};

export type FloorPlanData = {
  background_image: string | null;
  background_opacity: number;
  background_rotation: number;
  image_crop: [number, number, number, number] | null;
  scale_m_per_100_units: number | null;
  rooms: RoomPlanItem[];
  placements: PlanPlacement[];
  rcds: ResidualCurrentDevice[];
  circuits: ElectricalCircuit[];
  layers: PlanLayer[];
  mounting_points: MountingPoint[];
  dimensions: PlanDimension[];
  free_canvas: FreeCanvasItem[];
  smart_devices: SmartDevice[];
  electrical_components: ElectricalComponent[];
  terminal_strips: TerminalStrip[];
  custom_components: CustomComponent[];
  cabinet: CabinetConfiguration;
  prices: PriceEntry[];
  measurements: TestMeasurement[];
  annotation: ProjectAnnotation;
};

export const emptyFloorPlan: FloorPlanData = {
  background_image: null,
  background_opacity: 0.8,
  background_rotation: 0,
  image_crop: null,
  scale_m_per_100_units: null,
  rooms: [],
  placements: [],
  rcds: [],
  circuits: [],
  layers: [
    { id: "architecture", name: "Architecture", visible: true, color: "#64748b", purpose: "architecture" },
    { id: "installation", name: "Electrical installation", visible: true, color: "#2b8270", purpose: "technical" },
    { id: "client", name: "Client view", visible: true, color: "#338b76", purpose: "client" },
    { id: "notes", name: "Notes", visible: true, color: "#ca834c", purpose: "notes" },
  ],
  mounting_points: [],
  dimensions: [],
  free_canvas: [],
  smart_devices: [],
  electrical_components: [],
  terminal_strips: [],
  custom_components: [],
  cabinet: {
    name: "Distribution board",
    manufacturer: null,
    model: null,
    rows: 3,
    columns: 12,
    page_size: "A4",
    scale: 1,
    rails: [],
    modules: [],
    spare_modules_per_rail: 2,
    mounting_notes: "",
  },
  prices: [],
  measurements: [],
  annotation: {
    title: "",
    legend: "",
    notes: "",
    customer_name: "",
    project_number: "",
    presentation_mode: "planning",
  },
};

export const projectsApi = {
  list: (includeArchived = false) => api<Project[]>(`/projects?include_archived=${includeArchived}`),
  get: (projectId: number) => api<Project>(`/projects/${projectId}`),
  create: (payload: ProjectCreate) =>
    api<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  buildings: (projectId: number) => api<Building[]>(`/projects/${projectId}/buildings`),
  createBuilding: (projectId: number, payload: BuildingCreate) =>
    api<Building>(`/projects/${projectId}/buildings`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateProject: (projectId: number, patch: Partial<Pick<Project, "name" | "description" | "archived" | "team_id">>) =>
    api<Project>(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  duplicateProject: (projectId: number) =>
    api<Project>(`/projects/${projectId}/duplicate`, { method: "POST" }),
  exportProject: (projectId: number) => api<Record<string, unknown>>(`/projects/${projectId}/export`),
  importProject: (payload: Record<string, unknown>) =>
    api<Project>("/projects/import", { method: "POST", body: JSON.stringify(payload) }),
  createShare: (projectId: number, clientView = true, password?: string) =>
    api<ProjectShare>(`/projects/${projectId}/shares`, {
      method: "POST",
      body: JSON.stringify({ client_view: clientView, password: password || null }),
    }),
  shares: (projectId: number) => api<ProjectShare[]>(`/projects/${projectId}/shares`),
  deleteShare: (projectId: number, shareId: number) =>
    api<void>(`/projects/${projectId}/shares/${shareId}`, { method: "DELETE" }),
  transferProject: (projectId: number, organizationId: number, teamId: number | null) =>
    api<Project>(`/projects/${projectId}/transfer`, {
      method: "POST",
      body: JSON.stringify({ organization_id: organizationId, team_id: teamId }),
    }),
  floorPlan: (projectId: number, floorId: number) =>
    api<FloorPlanData>(`/projects/${projectId}/floors/${floorId}/plan`),
  saveFloorPlan: (projectId: number, floorId: number, payload: FloorPlanData) =>
    api<FloorPlanData>(`/projects/${projectId}/floors/${floorId}/plan`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  updateBuilding: (projectId: number, buildingId: number, name: string) =>
    api<Building>(`/projects/${projectId}/buildings/${buildingId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteBuilding: (projectId: number, buildingId: number) =>
    api<void>(`/projects/${projectId}/buildings/${buildingId}`, { method: "DELETE" }),
  createFloor: (projectId: number, buildingId: number, name: string) =>
    api<Floor>(`/projects/${projectId}/buildings/${buildingId}/floors`, { method: "POST", body: JSON.stringify({ name }) }),
  updateFloor: (projectId: number, floorId: number, name: string) =>
    api<Floor>(`/projects/${projectId}/floors/${floorId}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  duplicateFloor: (projectId: number, floorId: number) =>
    api<Floor>(`/projects/${projectId}/floors/${floorId}/duplicate`, { method: "POST" }),
  deleteFloor: (projectId: number, floorId: number) =>
    api<void>(`/projects/${projectId}/floors/${floorId}`, { method: "DELETE" }),
  sharedProject: (token: string, password?: string) =>
    api<SharedProject>(`/projects/shared/${token}`, password ? { headers: { "X-Share-Password": password } } : undefined),
};
