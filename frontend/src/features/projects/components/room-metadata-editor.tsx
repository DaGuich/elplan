import { useId, useState } from "react";
import {
  INSTALLATION_STANDARD_MAX,
  ROOM_TYPE_MAX,
  ROOM_TYPE_SUGGESTIONS,
  STANDARD_SUGGESTIONS,
  isRoomMetadataEqual,
  normalizeRoomMetadata,
  validateRoomMetadata,
  type RoomMetadata,
} from "../domain/room-metadata";

/** Translation keys used by the editor; callers supply `t` (any lookup returning a string). */
export const ROOM_METADATA_I18N_KEYS = [
  "Room name",
  "Room type",
  "Equipment standard / norm",
  "Free text, e.g. RAL-RG 678. A note only: compliance is not checked and no equipment is derived automatically.",
  "optional",
  "Required",
  "Input is too long",
  "Save room",
  "Reset",
] as const;

export type RoomMetadataEditorProps<T extends RoomMetadata = RoomMetadata> = {
  value: T;
  onSave: (value: T) => void;
  t: (key: string) => string;
  disabled?: boolean;
};

export function RoomMetadataEditor<T extends RoomMetadata>({ value, onSave, t, disabled = false }: RoomMetadataEditorProps<T>) {
  const id = useId();
  const [draft, setDraft] = useState<RoomMetadata>({
    name: value.name,
    room_type: value.room_type ?? "",
    installation_standard: value.installation_standard ?? "",
  });
  const errors = validateRoomMetadata(draft);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = !isRoomMetadataEqual(draft, value);
  const errorText = (code?: "required" | "too_long") =>
    code === "required" ? t("Required") : code === "too_long" ? t("Input is too long") : null;

  return (
    <form
      className="room-metadata-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!hasErrors) onSave({ ...value, ...normalizeRoomMetadata(draft) });
      }}
    >
      <label htmlFor={`${id}-name`}>{t("Room name")}</label>
      <input id={`${id}-name`} value={draft.name} disabled={disabled} aria-invalid={!!errors.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      {errors.name && <p role="alert">{errorText(errors.name)}</p>}

      <label htmlFor={`${id}-type`}>{`${t("Room type")} (${t("optional")})`}</label>
      <input id={`${id}-type`} list={`${id}-types`} value={draft.room_type ?? ""} disabled={disabled}
        maxLength={ROOM_TYPE_MAX + 20} aria-invalid={!!errors.room_type}
        onChange={(e) => setDraft({ ...draft, room_type: e.target.value })} />
      <datalist id={`${id}-types`}>{ROOM_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
      {errors.room_type && <p role="alert">{errorText(errors.room_type)}</p>}

      <label htmlFor={`${id}-std`}>{`${t("Equipment standard / norm")} (${t("optional")})`}</label>
      <input id={`${id}-std`} list={`${id}-stds`} value={draft.installation_standard ?? ""} disabled={disabled}
        maxLength={INSTALLATION_STANDARD_MAX + 20} aria-invalid={!!errors.installation_standard}
        aria-describedby={`${id}-hint`}
        onChange={(e) => setDraft({ ...draft, installation_standard: e.target.value })} />
      <datalist id={`${id}-stds`}>{STANDARD_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
      <p id={`${id}-hint`}>{t("Free text, e.g. RAL-RG 678. A note only: compliance is not checked and no equipment is derived automatically.")}</p>
      {errors.installation_standard && <p role="alert">{errorText(errors.installation_standard)}</p>}

      <button type="submit" disabled={disabled || hasErrors || !dirty}>{t("Save room")}</button>
      <button type="button" disabled={disabled || !dirty}
        onClick={() => setDraft({ name: value.name, room_type: value.room_type ?? "", installation_standard: value.installation_standard ?? "" })}>
        {t("Reset")}
      </button>
    </form>
  );
}
