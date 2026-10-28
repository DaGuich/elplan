import { useState } from "react";

import { DeviceChannel, FloorPlanData, PlanPlacement, SmartDevice } from "../api";
import { useI18n } from "../../../i18n";

type Props = { data: FloorPlanData; onChange: (patch: Partial<FloorPlanData>) => void };
type Preset = Pick<SmartDevice, "system" | "kind" | "name" | "te_width">;

const presets: Preset[] = [
  { system: "knx", kind: "actuator", name: "KNX switching actuator", te_width: 8 },
  { system: "knx", kind: "actuator", name: "KNX blind actuator", te_width: 8 },
  { system: "knx", kind: "actuator", name: "KNX dimming actuator", te_width: 8 },
  { system: "knx", kind: "binary_input", name: "KNX binary input", te_width: 4 },
  { system: "knx", kind: "line_coupler", name: "KNX line coupler", te_width: 2 },
  { system: "knx", kind: "ip_interface", name: "KNX IP interface", te_width: 2 },
  { system: "loxone", kind: "miniserver", name: "Loxone Miniserver", te_width: 9 },
  { system: "loxone", kind: "extension", name: "Loxone Extension", te_width: 9 },
  { system: "loxone", kind: "power_supply", name: "24 V power supply", te_width: 4 },
  { system: "loxone", kind: "audioserver", name: "Loxone Audioserver", te_width: 9 },
  { system: "dali", kind: "dali_gateway", name: "DALI gateway", te_width: 4 },
  { system: "dali", kind: "led_driver", name: "24 V LED driver", te_width: 4 },
  { system: "free_at_home", kind: "actuator", name: "free@home actuator", te_width: 8 },
  { system: "homematic", kind: "actuator", name: "Homematic IP Wired actuator", te_width: 8 },
  { system: "ekey", kind: "fingerprint", name: "ekey fingerprint interface", te_width: 4 },
  { system: "gira_door", kind: "door_station", name: "Gira door communication", te_width: 6 },
];

const channelTypes: DeviceChannel["kind"][] = [
  "switching", "dimming", "0-10v", "binary_input", "blind", "heating", "dali", "bus",
];

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `system-${Date.now()}-${Math.random()}`;
}

export function SmartSystemsEditor({ data, onChange }: Props) {
  const { t } = useI18n();
  const [selectedPreset, setSelectedPreset] = useState(0);

  function addDevice(preset = presets[selectedPreset]) {
    const device: SmartDevice = {
      id: makeId(),
      ...preset,
      name: t(preset.name),
      model: null,
      line: preset.system === "knx" ? "1.1" : null,
      address: null,
      bus_id: preset.system === "knx" ? "KNX line 1" : preset.system.toUpperCase(),
      circuit_id: null,
      color: preset.system === "dali" ? "#b18445" : "#6574a5",
      channels: [],
    };
    onChange({ smart_devices: [...data.smart_devices, device] });
  }

  function updateDevice(id: string, patch: Partial<SmartDevice>) {
    const updated = data.smart_devices.map((device) => device.id === id ? { ...device, ...patch } : device);
    const device = updated.find((item) => item.id === id);
    if (!device) return;
    const channelIds = new Set(device.channels.map((channel) => channel.id));
    onChange({
      smart_devices: updated,
      placements: data.placements.map((placement) => channelIds.has(placement.channel_id ?? "")
        ? {
            ...placement,
            bus_address: [device.line, device.address, device.channels.find((channel) => channel.id === placement.channel_id)?.address].filter(Boolean).join(" / ") || null,
          }
        : placement),
    });
  }

  function addChannel(device: SmartDevice, kind: DeviceChannel["kind"]) {
    const channel: DeviceChannel = {
      id: makeId(),
      name: `${t(kind.replace("_", " "))} ${device.channels.length + 1}`,
      kind,
      address: null,
      load_ids: [],
      circuit_id: null,
    };
    updateDevice(device.id, { channels: [...device.channels, channel] });
  }

  function updateChannel(device: SmartDevice, channelId: string, patch: Partial<DeviceChannel>) {
    let channels = device.channels.map((channel) => channel.id === channelId ? { ...channel, ...patch } : channel);
    let changed = channels.find((channel) => channel.id === channelId);
    const previous = device.channels.find((channel) => channel.id === channelId);
    if (!changed || !previous) return;
    if (Object.prototype.hasOwnProperty.call(patch, "load_ids")) {
      const selectedLoads = new Set(changed.load_ids);
      channels = channels.map((channel) => channel.id === channelId
        ? channel
        : { ...channel, load_ids: channel.load_ids.filter((loadId) => !selectedLoads.has(loadId)) });
      changed = channels.find((channel) => channel.id === channelId);
      if (!changed) return;
    }

    const linkedLoads = new Set([...previous.load_ids, ...changed.load_ids]);
    let placements = data.placements.map((placement) => {
      if (changed!.load_ids.includes(placement.id)) {
        return {
          ...placement,
          device_id: device.id,
          channel_id: channelId,
          bus_address: [device.line, device.address, changed!.address].filter(Boolean).join(" / ") || null,
          circuit_id: changed!.circuit_id ?? (previous.circuit_id ? null : placement.circuit_id),
        };
      }
      if (previous.load_ids.includes(placement.id) && placement.channel_id === channelId) {
        return { ...placement, device_id: null, channel_id: null, bus_address: null, circuit_id: null };
      }
      return placement;
    });

    let circuits = data.circuits;
    if (previous.circuit_id !== changed.circuit_id || previous.load_ids.some((loadId) => !changed!.load_ids.includes(loadId))) {
      circuits = circuits.map((circuit) => circuit.id === previous.circuit_id
        ? { ...circuit, loads: circuit.loads.filter((loadId) => !linkedLoads.has(loadId) || changed!.circuit_id === previous.circuit_id && changed!.load_ids.includes(loadId)) }
        : circuit);
    }
    if (changed.circuit_id) {
      const assigned = new Set(changed.load_ids);
      circuits = circuits.map((circuit) => circuit.id === changed!.circuit_id
        ? { ...circuit, loads: [...circuit.loads.filter((loadId) => !assigned.has(loadId)), ...changed!.load_ids] }
        : circuit.id !== previous.circuit_id
          ? { ...circuit, loads: circuit.loads.filter((loadId) => !assigned.has(loadId)) }
          : circuit);
      placements = placements.map((placement) => assigned.has(placement.id) ? { ...placement, circuit_id: changed!.circuit_id } : placement);
    }
    onChange({
      smart_devices: data.smart_devices.map((item) => item.id === device.id ? { ...item, channels } : item),
      placements,
      circuits,
    });
  }

  function deleteChannel(device: SmartDevice, channelId: string) {
    const channel = device.channels.find((item) => item.id === channelId);
    if (!channel) return;
    const loadIds = new Set(channel.load_ids);
    onChange({
      smart_devices: data.smart_devices.map((item) => item.id === device.id
        ? { ...item, channels: item.channels.filter((entry) => entry.id !== channelId) }
        : item),
      placements: data.placements.map((placement) => placement.channel_id === channelId
        ? {
            ...placement,
            device_id: null,
            channel_id: null,
            bus_address: null,
            circuit_id: placement.circuit_id === channel.circuit_id ? null : placement.circuit_id,
          }
        : placement),
      circuits: channel.circuit_id
        ? data.circuits.map((circuit) => circuit.id === channel.circuit_id
          ? { ...circuit, loads: circuit.loads.filter((loadId) => !loadIds.has(loadId)) }
          : circuit)
        : data.circuits,
    });
  }

  function deleteDevice(deviceId: string) {
    const device = data.smart_devices.find((item) => item.id === deviceId);
    const channelIds = new Set(device?.channels.map((item) => item.id));
    const linkedLoads = new Set(device?.channels.flatMap((item) => item.load_ids));
    const circuitIds = new Set(device?.channels.map((item) => item.circuit_id).filter((id): id is string => Boolean(id)));
    onChange({
      smart_devices: data.smart_devices.filter((item) => item.id !== deviceId),
      placements: data.placements.map((item) => {
        const channel = device?.channels.find((entry) => entry.id === item.channel_id);
        return channelIds.has(item.channel_id ?? "")
          ? {
              ...item,
              device_id: null,
              channel_id: null,
              bus_address: null,
              circuit_id: item.circuit_id === channel?.circuit_id ? null : item.circuit_id,
            }
          : item;
      }),
      circuits: data.circuits.map((circuit) => circuitIds.has(circuit.id)
        ? { ...circuit, loads: circuit.loads.filter((loadId) => !linkedLoads.has(loadId)) }
        : circuit),
    });
  }

  const systemCounts = data.smart_devices.reduce<Record<string, number>>((counts, device) => {
    counts[device.system] = (counts[device.system] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <div className="smart-systems">
      <header className="circuits-intro">
        <div>
          <p className="eyebrow">{t("SMART BUILDING & BUS SYSTEMS")}</p>
          <h4>{t("Devices, bus lines and channel mapping")}</h4>
          <p>{t("Link channels to floor-plan loads and protection circuits. Address and load assignments stay synchronized.")}</p>
        </div>
      </header>
      <div className="system-summary">
        {["knx", "loxone", "dali", "free_at_home", "homematic", "ekey", "gira_door"].map((system) => (
          <span key={system}><strong>{systemCounts[system] ?? 0}</strong> {t(system.replace(/_/g, " "))}</span>
        ))}
      </div>
      <div className="smart-add-row">
        <select value={selectedPreset} onChange={(event) => setSelectedPreset(Number(event.target.value))}>
          {presets.map((preset, index) => <option key={`${preset.system}-${preset.name}`} value={index}>{preset.system.toUpperCase()} · {t(preset.name)} · {preset.te_width} TE</option>)}
        </select>
        <button type="button" className="button-primary" onClick={() => addDevice()}>＋ {t("Add smart device")}</button>
      </div>
      {data.smart_devices.length === 0 && <div className="empty-panel">{t("Add a KNX, Loxone, DALI, free@home, Homematic, ekey, or Gira device to define its channels.")}</div>}
      <div className="smart-device-list">
        {data.smart_devices.map((device) => (
          <article className="smart-device-card" key={device.id}>
            <header className="smart-device-heading">
              <span className="system-tag" style={{ backgroundColor: `${device.color}20`, color: device.color }}>{device.system.toUpperCase()}</span>
              <input aria-label={t("Smart device name")} value={t(device.name)} onChange={(event) => updateDevice(device.id, { name: event.target.value })} />
              <span className="te-label">{device.te_width || "—"} TE</span>
              <button type="button" className="icon-button" aria-label={t("Remove {{name}}", { name: device.name })} onClick={() => deleteDevice(device.id)}>×</button>
            </header>
            <div className="smart-device-meta">
              <label>{t("Product / model")}<input value={device.model ?? ""} placeholder={t("Optional")} onChange={(event) => updateDevice(device.id, { model: event.target.value || null })} /></label>
              <label>{t("Bus / line")}<input value={device.line ?? ""} placeholder={t("e.g. 1.1")} onChange={(event) => updateDevice(device.id, { line: event.target.value || null })} /></label>
              <label>{t("Physical address")}<input value={device.address ?? ""} placeholder={t("e.g. 1.1.10")} onChange={(event) => updateDevice(device.id, { address: event.target.value || null })} /></label>
              <label>{t("Bus / power supply")}<input value={device.bus_id ?? ""} placeholder={t("Line or bus")} onChange={(event) => updateDevice(device.id, { bus_id: event.target.value || null })} /></label>
            </div>
            <div className="channel-heading"><strong>{t("Channels ({{count}})", { count: device.channels.length })}</strong><span>{t("Link outputs to room symbols and circuits")}</span></div>
            {device.channels.map((channel) => (
              <div className="channel-row" key={channel.id}>
                <input aria-label={t("Channel name")} value={channel.name} onChange={(event) => updateChannel(device, channel.id, { name: event.target.value })} />
                <select aria-label={t("Channel function")} value={channel.kind} onChange={(event) => updateChannel(device, channel.id, { kind: event.target.value as DeviceChannel["kind"] })}>
                  {channelTypes.map((type) => <option key={type} value={type}>{t(type)}</option>)}
                </select>
                <input aria-label={t("Channel address")} placeholder={t("Address")} value={channel.address ?? ""} onChange={(event) => updateChannel(device, channel.id, { address: event.target.value || null })} />
                <select
                  aria-label={t("Channel loads")}
                  multiple
                  size={Math.min(Math.max(data.placements.length, 2), 3)}
                  value={channel.load_ids}
                  onChange={(event) => updateChannel(device, channel.id, { load_ids: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}
                >
                  {data.placements.map((placement: PlanPlacement) => <option key={placement.id} value={placement.id}>{placement.label}</option>)}
                </select>
                <select aria-label={t("Channel circuit")} value={channel.circuit_id ?? ""} onChange={(event) => updateChannel(device, channel.id, { circuit_id: event.target.value || null })}>
                  <option value="">{t("No circuit")}</option>
                  {data.circuits.map((circuit) => <option key={circuit.id} value={circuit.id}>{circuit.name}</option>)}
                </select>
                <button type="button" className="icon-button" aria-label={t("Remove channel {{name}}", { name: channel.name })} onClick={() => deleteChannel(device, channel.id)}>×</button>
              </div>
            ))}
            <div className="channel-add-buttons">
              {channelTypes.map((kind) => <button type="button" key={kind} className="text-button" onClick={() => addChannel(device, kind)}>＋ {t(kind)}</button>)}
            </div>
          </article>
        ))}
      </div>
      <div className="empty-panel">{t("Bus loads linked to channel assignments are reflected on the floor plan and in the distribution circuit documentation.")}</div>
    </div>
  );
}
