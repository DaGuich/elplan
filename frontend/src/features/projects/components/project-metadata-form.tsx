import type { FormEvent } from "react";
import { useState } from "react";

import { GRID_SYSTEMS, GridSystem, PROJECT_STATUSES, PricingTemplate, ProjectDetails, ProjectStatus } from "../api";
import { useProjectDetails, useUpdateProjectDetails } from "../queries";
import { useI18n } from "../../../i18n";

type TextKey =
  | "project_number" | "client_name" | "client_email" | "client_phone" | "client_address"
  | "site_street" | "site_postal_code" | "site_city" | "site_country";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  planning: "In planning",
  quoted: "Quoted",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
};

function toNumber(value: string): number | null {
  const parsed = Number(value.replace(",", "."));
  return value.trim() === "" || !Number.isFinite(parsed) ? null : parsed;
}

function MetadataFields({ initial, projectId }: { initial: ProjectDetails; projectId: number }) {
  const { t } = useI18n();
  const update = useUpdateProjectDetails(projectId);
  const [form, setForm] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [numbers, setNumbers] = useState({
    main_fuse_a: initial.main_fuse_a?.toString() ?? "",
    short_circuit_ka: initial.short_circuit_ka?.toString() ?? "",
    hourly_rate: initial.hourly_rate?.toString() ?? "",
    vat_percent: initial.vat_percent?.toString() ?? "",
    material_markup_percent: String(initial.material_markup_percent),
    nominal_voltage_v: initial.nominal_voltage_v?.toString() ?? "",
  });
  const [templatePrices, setTemplatePrices] = useState(
    initial.pricing_templates.map((template) => String(template.unit_price)),
  );
  const [localError, setLocalError] = useState("");

  function patch(changes: Partial<ProjectDetails>) {
    setSaved(false);
    setForm((current) => ({ ...current, ...changes }));
  }
  function setNumber(key: keyof typeof numbers, value: string) {
    setSaved(false);
    setNumbers((current) => ({ ...current, [key]: value }));
  }
  function text(key: TextKey, label: string, type = "text", maxLength = 200) {
    return (
      <label>{label}<input type={type} maxLength={maxLength} value={form[key] ?? ""} onChange={(event) => patch({ [key]: event.target.value || null })} /></label>
    );
  }
  function patchTemplate(index: number, changes: Partial<PricingTemplate>) {
    patch({ pricing_templates: form.pricing_templates.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) });
  }
  function setTemplatePrice(index: number, value: string) {
    setSaved(false);
    setTemplatePrices((current) => current.map((price, itemIndex) => itemIndex === index ? value : price));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const markup = toNumber(numbers.material_markup_percent);
    const pricingTemplates = form.pricing_templates.map((template, index) => ({
      ...template,
      unit_price: toNumber(templatePrices[index]) ?? Number.NaN,
    }));
    const invalidOptional = (["nominal_voltage_v", "vat_percent", "main_fuse_a", "short_circuit_ka", "hourly_rate"] as const)
      .some((key) => numbers[key].trim() !== "" && toNumber(numbers[key]) === null);
    if (markup === null || invalidOptional || pricingTemplates.some((item) => !Number.isFinite(item.unit_price))) {
      setLocalError(t("Enter valid numbers; only the markup is required."));
      return;
    }
    setLocalError("");
    update.mutate({
      ...form,
      pricing_templates: pricingTemplates,
      nominal_voltage_v: toNumber(numbers.nominal_voltage_v),
      vat_percent: toNumber(numbers.vat_percent),
      material_markup_percent: markup,
      main_fuse_a: toNumber(numbers.main_fuse_a),
      short_circuit_ka: toNumber(numbers.short_circuit_ka),
      hourly_rate: toNumber(numbers.hourly_rate),
    }, { onSuccess: () => setSaved(true) });
  }

  return (
    <form className="metadata-form" onSubmit={submit}>
      <fieldset>
        <legend>{t("Project status")}</legend>
        <label>{t("Status")}
          <select value={form.status} onChange={(event) => patch({ status: event.target.value as ProjectStatus })}>
            {PROJECT_STATUSES.map((status) => <option key={status} value={status}>{t(STATUS_LABELS[status])}</option>)}
          </select>
        </label>
      </fieldset>
      <fieldset>
        <legend>{t("Client")}</legend>
        {text("project_number", t("Project number"), "text", 100)}
        {text("client_name", t("Customer / client"))}
        {text("client_email", t("Client email"), "email")}
        {text("client_phone", t("Client phone"), "tel", 50)}
        {text("client_address", t("Client address"), "text", 500)}
      </fieldset>
      <fieldset>
        <legend>{t("Site address")}</legend>
        {text("site_street", t("Street and number"))}
        {text("site_postal_code", t("Postal code"), "text", 20)}
        {text("site_city", t("City"), "text", 100)}
        {text("site_country", t("Country"), "text", 100)}
      </fieldset>
      <fieldset>
        <legend>{t("Global electrical parameters")}</legend>
        <label>{t("Nominal voltage (V)")}<input inputMode="numeric" value={numbers.nominal_voltage_v} onChange={(event) => setNumber("nominal_voltage_v", event.target.value)} /></label>
        <label>{t("Phases")}
          <select value={form.phases ?? ""} onChange={(event) => patch({ phases: event.target.value ? Number(event.target.value) as 1 | 3 : null })}>
            <option value="">{t("Not specified")}</option>
            <option value={1}>{t("Single-phase (1~)")}</option>
            <option value={3}>{t("Three-phase (3~)")}</option>
          </select>
        </label>
        <label>{t("Frequency (Hz)")}
          <select value={form.frequency_hz ?? ""} onChange={(event) => patch({ frequency_hz: event.target.value ? Number(event.target.value) as 50 | 60 : null })}>
            <option value="">{t("Not specified")}</option>
            <option value={50}>50</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label>{t("Grid system")}
          <select value={form.grid_system ?? ""} onChange={(event) => patch({ grid_system: event.target.value ? event.target.value as GridSystem : null })}>
            <option value="">{t("Not specified")}</option>
            {GRID_SYSTEMS.map((system) => <option key={system} value={system}>{system}</option>)}
          </select>
        </label>
        <label>{t("Main fuse (A)")}<input inputMode="decimal" value={numbers.main_fuse_a} onChange={(event) => setNumber("main_fuse_a", event.target.value)} /></label>
        <label>{t("Short-circuit current (kA)")}<input inputMode="decimal" value={numbers.short_circuit_ka} onChange={(event) => setNumber("short_circuit_ka", event.target.value)} /></label>
      </fieldset>
      <fieldset>
        <legend>{t("Pricing")}</legend>
        <label>{t("Currency")}<input maxLength={3} pattern="[A-Z]{3}" title={t("Three uppercase letters, e.g. EUR")} value={form.currency} onChange={(event) => patch({ currency: event.target.value.toUpperCase() })} /></label>
        <label>{t("VAT (%)")}<input inputMode="decimal" value={numbers.vat_percent} onChange={(event) => setNumber("vat_percent", event.target.value)} /></label>
        <label>{t("Hourly rate")}<input inputMode="decimal" value={numbers.hourly_rate} onChange={(event) => setNumber("hourly_rate", event.target.value)} /></label>
        <label>{t("Material markup (%)")}<input inputMode="decimal" value={numbers.material_markup_percent} onChange={(event) => setNumber("material_markup_percent", event.target.value)} /></label>
        <p className="field-hint">{t("Electrical parameters stay unspecified until you choose them; nothing is assumed.")}</p>
        <p className="field-label">{t("Pricing templates")}</p>
        {form.pricing_templates.map((template, index) => (
          <div className="pricing-template-row" key={index}>
            <input required maxLength={100} aria-label={t("Template name")} placeholder={t("Template name")} value={template.name} onChange={(event) => patchTemplate(index, { name: event.target.value })} />
            <input required maxLength={20} aria-label={t("Unit")} placeholder={t("Unit")} value={template.unit} onChange={(event) => patchTemplate(index, { unit: event.target.value })} />
            <input required inputMode="decimal" aria-label={t("Unit price")} placeholder={t("Unit price")} value={templatePrices[index] ?? ""} onChange={(event) => setTemplatePrice(index, event.target.value)} />
            <button type="button" className="icon-button" aria-label={t("Remove pricing template")} onClick={() => {
              patch({ pricing_templates: form.pricing_templates.filter((_, itemIndex) => itemIndex !== index) });
              setTemplatePrices((current) => current.filter((_, itemIndex) => itemIndex !== index));
            }}>×</button>
          </div>
        ))}
        <button type="button" className="text-button" onClick={() => {
          patch({ pricing_templates: [...form.pricing_templates, { name: "", unit: "piece", unit_price: 0 }] });
          setTemplatePrices((current) => [...current, "0"]);
        }}>＋ {t("Add pricing template")}</button>
      </fieldset>
      {localError && <p className="editor-error" role="alert">{localError}</p>}
      {update.isError && <p className="editor-error" role="alert">{t("Could not save project metadata. Check the values and try again.")}</p>}
      {saved && <p className="editor-status" role="status">{t("Project metadata saved.")}</p>}
      <button className="button-primary" type="submit" disabled={update.isPending}>{update.isPending ? t("Saving…") : t("Save metadata")}</button>
    </form>
  );
}

export function ProjectMetadataForm({ projectId }: { projectId: number }) {
  const { t } = useI18n();
  const details = useProjectDetails(projectId);
  if (details.isLoading) return <p className="editor-status">{t("Loading project metadata…")}</p>;
  if (details.isError || !details.data) return <p className="editor-error">{t("Could not load project metadata.")}</p>;
  return <MetadataFields initial={details.data} projectId={projectId} />;
}
