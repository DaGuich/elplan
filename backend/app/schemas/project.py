from itertools import pairwise
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProjectCreate(BaseModel):
    organization_id: int
    team_id: int | None = None
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    team_id: int | None = None
    archived: bool | None = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    organization_id: int
    team_id: int | None = None
    name: str
    description: str | None = None
    archived: bool = False


class ProjectShareCreate(BaseModel):
    client_view: bool = True
    password: str | None = Field(default=None, min_length=8, max_length=128)


class ProjectShareRead(BaseModel):
    id: int
    token: str
    client_view: bool


class ProjectTransfer(BaseModel):
    organization_id: int
    team_id: int | None = None


class FloorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class FloorRead(FloorCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sort_order: int


class BuildingCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    floors: list[FloorCreate] = Field(min_length=1, max_length=100)


class BuildingUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class FloorUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class BuildingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    name: str
    floors: list[FloorRead]


class RoomPlanItem(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    x: float = Field(ge=0, le=1000)
    y: float = Field(ge=0, le=700)
    width: float = Field(gt=0, le=1000)
    height: float = Field(gt=0, le=700)
    color: str = Field(default="#eaf3f1", pattern=r"^#[0-9A-Fa-f]{6}$")
    layer_id: str = Field(default="installation", min_length=1, max_length=80)

    @model_validator(mode="after")
    def stays_on_canvas(self):
        if self.x + self.width > 1000 or self.y + self.height > 700:
            raise ValueError("Room must fit inside the floor-plan canvas")
        return self


class PlanPlacement(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    kind: Literal[
        "socket", "light", "switch", "smoke_detector", "network", "distribution",
        "pv", "knx", "custom", "doorbell", "data_outlet", "thermostat", "motion_sensor",
        "camera", "alarm", "speaker", "door_contact", "blind", "dali", "loxone",
        "free_at_home", "homematic", "ekey", "gira_door", "led_driver", "actuator",
        "binary_input", "presence_detector", "bus_coupler", "power_supply", "surge_protection",
        "main_switch", "contactor", "relay", "terminal"
    ]
    label: str = Field(min_length=1, max_length=120)
    x: float = Field(ge=0, le=1000)
    y: float = Field(ge=0, le=700)
    rotation: float = Field(default=0, ge=-360, le=360)
    room_id: str | None = Field(default=None, max_length=80)
    mounting_point_id: str | None = Field(default=None, max_length=80)
    circuit_id: str | None = Field(default=None, max_length=80)
    device_id: str | None = Field(default=None, max_length=80)
    channel_id: str | None = Field(default=None, max_length=80)
    layer_id: str = Field(default="installation", min_length=1, max_length=80)
    color: str = Field(default="#2b8270", pattern=r"^#[0-9A-Fa-f]{6}$")
    element_id: str | None = Field(default=None, max_length=80)
    bus_address: str | None = Field(default=None, max_length=100)
    cable_type: str | None = Field(default=None, max_length=100)
    target_location: str | None = Field(default=None, max_length=160)
    metadata: dict[str, str] = Field(default_factory=dict, max_length=30)


class PlanLayer(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    visible: bool = True
    color: str = Field(default="#2b8270", pattern=r"^#[0-9A-Fa-f]{6}$")
    purpose: Literal["technical", "client", "notes", "architecture", "custom"] = "technical"


class MountingPoint(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    x: float = Field(ge=0, le=1000)
    y: float = Field(ge=0, le=700)
    rotation: float = Field(default=0, ge=-360, le=360)
    placement_ids: list[str] = Field(default_factory=list, max_length=100)


class PlanDimension(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    x1: float = Field(ge=0, le=1000)
    y1: float = Field(ge=0, le=700)
    x2: float = Field(ge=0, le=1000)
    y2: float = Field(ge=0, le=700)
    label: str = Field(min_length=1, max_length=100)


class FreeCanvasItem(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    kind: Literal["note", "line", "rectangle", "polyline", "group", "placeholder"]
    label: str = Field(default="", max_length=500)
    points: list[tuple[float, float]] = Field(default_factory=list, max_length=100)
    color: str = Field(default="#68778a", pattern=r"^#[0-9A-Fa-f]{6}$")
    layer_id: str = Field(default="notes", min_length=1, max_length=80)
    width: float = Field(default=2, gt=0, le=100)


class DeviceChannel(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["switching", "dimming", "0-10v", "binary_input", "blind", "heating", "dali", "bus"]
    address: str | None = Field(default=None, max_length=100)
    load_ids: list[str] = Field(default_factory=list, max_length=100)
    circuit_id: str | None = Field(default=None, max_length=80)


class SmartDevice(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=140)
    system: Literal["knx", "loxone", "dali", "free_at_home", "homematic", "ekey", "gira_door", "other"]
    kind: Literal[
        "actuator", "binary_input", "presence_detector", "line_coupler", "ip_interface",
        "miniserver", "extension", "power_supply", "tree_device", "audioserver", "energy_meter",
        "led_driver", "dali_gateway", "door_station", "fingerprint", "custom"
    ]
    model: str | None = Field(default=None, max_length=120)
    line: str | None = Field(default=None, max_length=80)
    address: str | None = Field(default=None, max_length=100)
    bus_id: str | None = Field(default=None, max_length=80)
    circuit_id: str | None = Field(default=None, max_length=80)
    te_width: float = Field(default=0, ge=0, le=72)
    color: str = Field(default="#6574a5", pattern=r"^#[0-9A-Fa-f]{6}$")
    channels: list[DeviceChannel] = Field(default_factory=list, max_length=128)


class ElectricalComponent(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    kind: Literal[
        "main_switch", "surge_protection", "contactor", "relay", "terminal", "power_supply",
        "transfer_switch", "phase_selector", "potential_free_contact", "distribution_link"
    ]
    name: str = Field(min_length=1, max_length=140)
    reference: str | None = Field(default=None, max_length=80)
    rated_current_a: int | None = Field(default=None, ge=1, le=125)
    poles: Literal[1, 2, 3, 4] = 1
    te_width: float = Field(default=1, gt=0, le=72)
    terminal_count: int = Field(default=0, ge=0, le=1000)
    contact_count: int = Field(default=0, ge=0, le=128)
    controlled_component_id: str | None = Field(default=None, max_length=80)
    circuit_ids: list[str] = Field(default_factory=list, max_length=200)
    color: str = Field(default="#68778a", pattern=r"^#[0-9A-Fa-f]{6}$")
    price: float = Field(default=0, ge=0, le=1_000_000)


class TerminalStrip(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["internal", "external", "bus"] = "external"
    circuit_ids: list[str] = Field(default_factory=list, max_length=200)
    terminals_per_circuit: int = Field(default=3, ge=1, le=24)
    terminal_width_mm: float = Field(default=5.2, gt=0, le=100)
    end_brackets: int = Field(default=2, ge=0, le=20)
    separators: int = Field(default=0, ge=0, le=100)

    @property
    def calculated_width_mm(self) -> float:
        terminals = len(self.circuit_ids) * self.terminals_per_circuit
        return terminals * self.terminal_width_mm + (
            self.end_brackets + self.separators
        ) * self.terminal_width_mm


class CustomComponent(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=140)
    kind: str = Field(min_length=1, max_length=80)
    te_width: float = Field(default=1, gt=0, le=72)
    channel_kinds: list[str] = Field(default_factory=list, max_length=64)
    color: str = Field(default="#6574a5", pattern=r"^#[0-9A-Fa-f]{6}$")
    favorite: bool = False


class CabinetRail(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    modules: int = Field(ge=1, le=72)
    height_mm: float = Field(default=0, ge=0, le=1000)
    spacing_mm: float = Field(default=125, ge=0, le=1000)


class CabinetModule(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    component_id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=140)
    rail_id: str = Field(min_length=1, max_length=80)
    position: int = Field(ge=0, le=72)
    te_width: float = Field(gt=0, le=72)
    color: str = Field(default="#dbe8e4", pattern=r"^#[0-9A-Fa-f]{6}$")


class CabinetConfiguration(BaseModel):
    name: str = Field(default="Distribution board", min_length=1, max_length=140)
    manufacturer: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    rows: int = Field(default=3, ge=1, le=24)
    columns: int = Field(default=12, ge=1, le=72)
    page_size: Literal["A4", "A3", "A2", "custom"] = "A4"
    scale: float = Field(default=1, gt=0, le=10)
    rails: list[CabinetRail] = Field(default_factory=list, max_length=24)
    modules: list[CabinetModule] = Field(default_factory=list, max_length=300)
    spare_modules_per_rail: int = Field(default=2, ge=0, le=72)
    mounting_notes: str = Field(default="", max_length=2000)


class PriceEntry(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=160)
    category: Literal["device", "labor", "cable", "other"]
    quantity: float = Field(gt=0, le=1_000_000)
    unit: str = Field(default="piece", max_length=40)
    unit_price: float = Field(default=0, ge=0, le=1_000_000)
    source_id: str | None = Field(default=None, max_length=80)


class TestMeasurement(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    circuit_id: str | None = Field(default=None, max_length=80)
    kind: Literal[
        "continuity", "insulation", "loop_impedance", "rcd_trip_time", "rcd_trip_current",
        "voltage", "polarity", "earth_resistance", "other"
    ]
    measured_value: float
    unit: str = Field(min_length=1, max_length=24)
    limit_value: float | None = None
    passed: bool
    measured_at: str | None = Field(default=None, max_length=40)
    notes: str = Field(default="", max_length=1000)


class ProjectAnnotation(BaseModel):
    title: str = Field(default="", max_length=200)
    legend: str = Field(default="", max_length=4000)
    notes: str = Field(default="", max_length=8000)
    customer_name: str = Field(default="", max_length=200)
    project_number: str = Field(default="", max_length=100)
    presentation_mode: Literal["planning", "client"] = "planning"


class ResidualCurrentDevice(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    rated_current_ma: int = Field(ge=10, le=1000)
    poles: Literal[2, 4] = 4
    type: Literal["A", "F", "B"] = "A"
    upstream_id: str | None = Field(default=None, max_length=80)
    price: float = Field(default=0, ge=0, le=1_000_000)


class ElectricalCircuit(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    rcd_id: str = Field(min_length=1, max_length=80)
    breaker_type: Literal["B", "C", "D"] = "B"
    rated_current_a: int = Field(ge=1, le=125)
    poles: Literal[1, 2, 3, 4] = 1
    cable: str = Field(min_length=1, max_length=40)
    loads: list[str] = Field(default_factory=list, max_length=100)
    supply: Literal["1n", "3n", "emergency", "phase_selector", "transfer"] = "1n"
    price: float = Field(default=0, ge=0, le=1_000_000)


class FloorPlanData(BaseModel):
    background_image: str | None = Field(default=None, max_length=4_000_000)
    background_opacity: float = Field(default=0.8, ge=0, le=1)
    background_rotation: float = Field(default=0, ge=-360, le=360)
    image_crop: tuple[float, float, float, float] | None = None
    scale_m_per_100_units: float | None = Field(default=None, gt=0, le=1000)
    rooms: list[RoomPlanItem] = Field(default_factory=list, max_length=100)
    placements: list[PlanPlacement] = Field(default_factory=list, max_length=500)
    rcds: list[ResidualCurrentDevice] = Field(default_factory=list, max_length=40)
    circuits: list[ElectricalCircuit] = Field(default_factory=list, max_length=200)
    layers: list[PlanLayer] = Field(
        default_factory=lambda: [
            PlanLayer(id="architecture", name="Architecture", purpose="architecture", color="#64748b"),
            PlanLayer(id="installation", name="Electrical installation", purpose="technical"),
            PlanLayer(id="client", name="Client view", purpose="client", color="#338b76"),
            PlanLayer(id="notes", name="Notes", purpose="notes", color="#ca834c"),
        ],
        max_length=40,
    )
    mounting_points: list[MountingPoint] = Field(default_factory=list, max_length=300)
    dimensions: list[PlanDimension] = Field(default_factory=list, max_length=300)
    free_canvas: list[FreeCanvasItem] = Field(default_factory=list, max_length=500)
    smart_devices: list[SmartDevice] = Field(default_factory=list, max_length=200)
    electrical_components: list[ElectricalComponent] = Field(default_factory=list, max_length=200)
    terminal_strips: list[TerminalStrip] = Field(default_factory=list, max_length=100)
    custom_components: list[CustomComponent] = Field(default_factory=list, max_length=200)
    cabinet: CabinetConfiguration = Field(default_factory=CabinetConfiguration)
    prices: list[PriceEntry] = Field(default_factory=list, max_length=1000)
    measurements: list[TestMeasurement] = Field(default_factory=list, max_length=2000)
    annotation: ProjectAnnotation = Field(default_factory=ProjectAnnotation)

    @model_validator(mode="after")
    def validate_plan(self):
        if self.image_crop is not None:
            left, top, width, height = self.image_crop
            if (
                min(left, top) < 0
                or min(width, height) <= 0
                or left + width > 1
                or top + height > 1
            ):
                raise ValueError("Floor-plan image crop must fit within its bounds")
        if self.background_image is not None and not self.background_image.startswith(
            ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,")
        ):
            raise ValueError("Floor-plan image must be PNG, JPEG, or WebP")
        rcd_ids = {rcd.id for rcd in self.rcds}
        if any(circuit.rcd_id not in rcd_ids for circuit in self.circuits):
            raise ValueError("Every circuit must be assigned to an existing RCD")
        placement_ids = {placement.id for placement in self.placements}
        if any(load_id not in placement_ids for circuit in self.circuits for load_id in circuit.loads):
            raise ValueError("Circuit loads must reference existing floor-plan symbols")
        if any(placement.room_id and placement.room_id not in {room.id for room in self.rooms} for placement in self.placements):
            raise ValueError("Floor-plan symbols must reference existing rooms")
        if any(placement.circuit_id and placement.circuit_id not in {circuit.id for circuit in self.circuits} for placement in self.placements):
            raise ValueError("Floor-plan symbols must reference existing circuits")
        if any(device.circuit_id and device.circuit_id not in {circuit.id for circuit in self.circuits} for device in self.smart_devices):
            raise ValueError("Smart devices must reference existing circuits")
        smart_device_ids = {device.id for device in self.smart_devices}
        smart_channel_ids = {
            channel.id for device in self.smart_devices for channel in device.channels
        }
        if any(placement.device_id and placement.device_id not in smart_device_ids for placement in self.placements):
            raise ValueError("Floor-plan symbols must reference existing smart devices")
        if any(placement.channel_id and placement.channel_id not in smart_channel_ids for placement in self.placements):
            raise ValueError("Floor-plan symbols must reference existing device channels")
        if any(
            channel.circuit_id and channel.circuit_id not in {circuit.id for circuit in self.circuits}
            for device in self.smart_devices
            for channel in device.channels
        ):
            raise ValueError("Smart-device channels must reference existing circuits")
        if any(
            load_id not in placement_ids
            for device in self.smart_devices
            for channel in device.channels
            for load_id in channel.load_ids
        ):
            raise ValueError("Smart-device channels must reference existing floor-plan symbols")
        known_circuit_ids = {circuit.id for circuit in self.circuits}
        if any(
            item.circuit_id and item.circuit_id not in known_circuit_ids
            for item in self.measurements
        ):
            raise ValueError("Test measurements must reference existing circuits")
        if any(
            circuit_id not in known_circuit_ids
            for strip in self.terminal_strips
            for circuit_id in strip.circuit_ids
        ):
            raise ValueError("Terminal strips must reference existing circuits")
        component_ids = {component.id for component in self.electrical_components}
        if any(
            component.controlled_component_id
            and component.controlled_component_id not in component_ids
            for component in self.electrical_components
        ):
            raise ValueError("Electrical component contacts must reference an existing component")
        if any(
            circuit_id not in known_circuit_ids
            for component in self.electrical_components
            for circuit_id in component.circuit_ids
        ):
            raise ValueError("Electrical components must reference existing circuits")
        layer_ids = {layer.id for layer in self.layers}
        if any(room.layer_id not in layer_ids for room in self.rooms):
            raise ValueError("Rooms must reference existing layers")
        if any(placement.layer_id not in layer_ids for placement in self.placements):
            raise ValueError("Floor-plan symbols must reference existing layers")
        mounting_ids = {point.id for point in self.mounting_points}
        if any(point_id not in placement_ids for point in self.mounting_points for point_id in point.placement_ids):
            raise ValueError("Mounting points must reference existing floor-plan symbols")
        if any(placement.mounting_point_id and placement.mounting_point_id not in mounting_ids for placement in self.placements):
            raise ValueError("Floor-plan symbols must reference existing mounting points")
        rail_ids = {rail.id for rail in self.cabinet.rails}
        if any(module.rail_id not in rail_ids for module in self.cabinet.modules):
            raise ValueError("Cabinet modules must reference existing DIN rails")
        for module in self.cabinet.modules:
            rail = next(rail for rail in self.cabinet.rails if rail.id == module.rail_id)
            if module.position + module.te_width > rail.modules:
                raise ValueError("Cabinet module exceeds DIN rail capacity")
        for rail in self.cabinet.rails:
            rail_modules = sorted(
                (module for module in self.cabinet.modules if module.rail_id == rail.id),
                key=lambda module: module.position,
            )
            if any(
                left.position + left.te_width > right.position
                for left, right in pairwise(rail_modules)
            ):
                raise ValueError("DIN-rail modules cannot overlap")
        if len({item.id for item in self.rooms}) != len(self.rooms):
            raise ValueError("Room IDs must be unique")
        if len({item.id for item in self.placements}) != len(self.placements):
            raise ValueError("Placement IDs must be unique")
        if len({item.id for item in self.rcds}) != len(self.rcds):
            raise ValueError("RCD IDs must be unique")
        if len({item.id for item in self.circuits}) != len(self.circuits):
            raise ValueError("Circuit IDs must be unique")
        ids = [
            [item.id for item in self.layers],
            [item.id for item in self.mounting_points],
            [item.id for item in self.dimensions],
            [item.id for item in self.free_canvas],
            [item.id for item in self.smart_devices],
            [item.id for item in self.electrical_components],
            [item.id for item in self.terminal_strips],
            [item.id for item in self.custom_components],
            [item.id for item in self.prices],
            [item.id for item in self.measurements],
            [item.id for item in self.cabinet.rails],
            [item.id for item in self.cabinet.modules],
        ]
        if any(len(values) != len(set(values)) for values in ids):
            raise ValueError("Item IDs must be unique within each collection")
        return self


class PublicFloorRead(BaseModel):
    id: int
    name: str
    plan_data: FloorPlanData


class PublicBuildingRead(BaseModel):
    name: str
    floors: list[PublicFloorRead]


class PublicProjectRead(BaseModel):
    name: str
    description: str | None
    buildings: list[PublicBuildingRead]


class ProjectFloorImport(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    plan_data: FloorPlanData


class ProjectBuildingImport(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    floors: list[ProjectFloorImport] = Field(min_length=1, max_length=100)


class ProjectImport(BaseModel):
    organization_id: int
    team_id: int | None = None
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    buildings: list[ProjectBuildingImport] = Field(default_factory=list, max_length=100)
