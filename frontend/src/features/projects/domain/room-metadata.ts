/** Pure helpers for optional per-room metadata (room type, installation standard). */

export interface RoomMetadata {
  name: string;
  room_type?: string | null;
  installation_standard?: string | null;
}

export const ROOM_TYPE_MAX = 80;
export const INSTALLATION_STANDARD_MAX = 200;

/** Free-text suggestions only; the user may pick one or type anything. No equipment counts. */
export const ROOM_TYPE_SUGGESTIONS = ["Wohnzimmer", "Küche", "Bad", "Schlafzimmer", "Flur", "Keller"] as const;
export const STANDARD_SUGGESTIONS = ["RAL-RG 678", "DIN 18015-2", "Eigene Vorgabe"] as const;

export function normalizeOptionalText(value: string | null | undefined, max: number): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

export function normalizeRoomMetadata(value: RoomMetadata): RoomMetadata {
  return {
    name: value.name.trim(),
    room_type: normalizeOptionalText(value.room_type, ROOM_TYPE_MAX),
    installation_standard: normalizeOptionalText(value.installation_standard, INSTALLATION_STANDARD_MAX),
  };
}

export function validateRoomMetadata(value: RoomMetadata): { name?: "required" | "too_long"; room_type?: "too_long"; installation_standard?: "too_long" } {
  const errors: ReturnType<typeof validateRoomMetadata> = {};
  if (value.name.trim() === "") errors.name = "required";
  else if (value.name.trim().length > 120) errors.name = "too_long";
  if ((value.room_type ?? "").trim().length > ROOM_TYPE_MAX) errors.room_type = "too_long";
  if ((value.installation_standard ?? "").trim().length > INSTALLATION_STANDARD_MAX) errors.installation_standard = "too_long";
  return errors;
}

export function isRoomMetadataEqual(a: RoomMetadata, b: RoomMetadata): boolean {
  const x = normalizeRoomMetadata(a);
  const y = normalizeRoomMetadata(b);
  return x.name === y.name && x.room_type === y.room_type && x.installation_standard === y.installation_standard;
}
