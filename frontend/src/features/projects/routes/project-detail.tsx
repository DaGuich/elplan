import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { FloorPlanEditor } from "../components/floor-plan-editor";
import { Project, projectsApi } from "../api";
import { useBuildings, useCreateBuilding, useManageProjectStructure, useProject } from "../queries";
import { useI18n } from "../../../i18n";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ProjectDetailPage() {
  const { t } = useI18n();
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const id = Number(projectId);
  const project = useProject(id);
  const buildings = useBuildings(id);
  const createBuilding = useCreateBuilding(id);
  const structure = useManageProjectStructure(id);
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [floorNames, setFloorNames] = useState([t("Ground floor")]);
  const [selectedFloorId, setSelectedFloorId] = useState<number>();
  const [sharePassword, setSharePassword] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [targetOrganizationId, setTargetOrganizationId] = useState("");
  const [targetTeamId, setTargetTeamId] = useState("");
  const shares = useQuery({
    queryKey: ["projects", id, "shares"],
    queryFn: () => projectsApi.shares(id),
  });
  const saveProject = useMutation({
    mutationFn: (patch: Partial<Pick<Project, "name" | "description" | "archived" | "team_id">>) => projectsApi.updateProject(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects", id] });
    },
  });
  const duplicateProject = useMutation({
    mutationFn: () => projectsApi.duplicateProject(id),
    onSuccess: (copy) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setFeedback(t("Project duplicated as “{{name}}”.", { name: copy.name }));
    },
  });
  const createShare = useMutation({
    mutationFn: () => projectsApi.createShare(id, true, sharePassword || undefined),
    onSuccess: (share) => {
      const url = `${window.location.origin}/share/${share.token}`;
      setShareUrl(url);
      setSharePassword("");
      queryClient.invalidateQueries({ queryKey: ["projects", id, "shares"] });
    },
  });
  const deleteShare = useMutation({
    mutationFn: (shareId: number) => projectsApi.deleteShare(id, shareId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects", id, "shares"] }),
  });
  const transferProject = useMutation({
    mutationFn: () => projectsApi.transferProject(
      id,
      Number(targetOrganizationId),
      targetTeamId ? Number(targetTeamId) : null
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects", id] });
      setFeedback(t("Project transferred."));
    },
  });

  useEffect(() => {
    const availableFloors = buildings.data?.flatMap((building) => building.floors) ?? [];
    if (availableFloors.length && !availableFloors.some((floor) => floor.id === selectedFloorId)) {
      setSelectedFloorId(availableFloors[0].id);
    }
  }, [buildings.data, selectedFloorId]);

  function submitBuilding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createBuilding.mutate(
      { name: buildingName, floors: floorNames.map((name) => ({ name })) },
      {
        onSuccess: (building) => {
          setBuildingName("");
          setFloorNames([t("Ground floor")]);
          setSelectedFloorId(building.floors[0]?.id);
        },
      }
    );
  }

  async function exportProject() {
    try {
      const value = await projectsApi.exportProject(id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.data?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "project"}.elplan.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setFeedback(t("Project export downloaded."));
    } catch {
      setFeedback(t("Could not export this project."));
    }
  }

  function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 20_000_000) {
      setFeedback(t("Project files must be 20 MB or smaller."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        if (!isRecord(parsed) || !Array.isArray(parsed.buildings) || typeof parsed.name !== "string") {
          setFeedback(t("The selected file is not a valid elplan project export."));
          return;
        }
        projectsApi.importProject({
          ...parsed,
          organization_id: project.data!.organization_id,
          team_id: project.data!.team_id ?? null,
        }).then((created) => {
          queryClient.invalidateQueries({ queryKey: ["projects"] });
          setFeedback(t("Project imported as “{{name}}”.", { name: created.name }));
        }).catch(() => setFeedback(t("Could not import this project file.")));
      } catch {
        setFeedback(t("Could not parse the selected project file."));
      }
    };
    reader.onerror = () => setFeedback(t("Could not read the selected project file."));
    reader.readAsText(file);
  }

  if (project.isLoading) return <p className="editor-status">{t("Loading project…")}</p>;
  if (project.isError || !project.data) return <p className="editor-error">{t("Failed to load project.")}</p>;

  const floors = buildings.data?.flatMap((building) => building.floors) ?? [];
  const selectedFloor = floors.find((floor) => floor.id === selectedFloorId);

  return (
    <div className="project-page">
      <header className="project-heading">
        <div>
          <p className="eyebrow">{t("PROJECT")}</p>
          <h2>{project.data.name}</h2>
          {project.data.description && <p className="project-description">{project.data.description}</p>}
        </div>
        <div className="project-actions">
          <button type="button" className="button-secondary" onClick={() => duplicateProject.mutate()} disabled={duplicateProject.isPending}>{t("Duplicate")}</button>
          <button type="button" className="button-secondary" onClick={() => saveProject.mutate({ archived: !project.data.archived })}>
            {project.data.archived ? t("Restore project") : t("Archive project")}
          </button>
          <span className="project-tag">{project.data.archived ? t("Archived") : t("Electrical planning")}</span>
        </div>
      </header>

      <div className="project-content">
        <section className="structure-panel">
          <section className="project-management-card">
            <h3>{t("Project details")}</h3>
            <label>{t("Project name")}<input key={project.data.name} defaultValue={project.data.name} onBlur={(event) => {
              const name = event.currentTarget.value.trim();
              if (name && name !== project.data?.name) saveProject.mutate({ name });
            }} /></label>
            <label>{t("Description")}<textarea key={project.data.description ?? ""} defaultValue={project.data.description ?? ""} rows={2} onBlur={(event) => {
              const description = event.currentTarget.value.trim();
              if (description !== (project.data?.description ?? "")) saveProject.mutate({ description });
            }} /></label>
            <div className="button-row">
              <button type="button" className="button-secondary" onClick={() => void exportProject()}>{t("Export project JSON")}</button>
              <label className="button-secondary import-file-button">{t("Import project JSON")}<input type="file" accept=".json,application/json" onChange={importProject} /></label>
            </div>
            <form className="transfer-form" onSubmit={(event) => { event.preventDefault(); transferProject.mutate(); }}>
              <label>{t("Transfer to organization ID")}<input type="number" min="1" required value={targetOrganizationId} onChange={(event) => setTargetOrganizationId(event.target.value)} /></label>
              <label>{t("Team ID (optional)")}<input type="number" min="1" value={targetTeamId} onChange={(event) => setTargetTeamId(event.target.value)} /></label>
              <button className="button-secondary" type="submit" disabled={transferProject.isPending}>{t("Transfer project")}</button>
            </form>
            {transferProject.isError && <p className="editor-error">{t("Could not transfer project. Check organization access and team assignment.")}</p>}
          </section>
          <section className="project-management-card">
            <h3>{t("Client sharing")}</h3>
            <p className="field-hint">{t("Creates a public client-view link with technical details and pricing filtered out.")}</p>
            <form onSubmit={(event) => { event.preventDefault(); createShare.mutate(); }}>
              <label>{t("Optional password")}<input type="password" autoComplete="new-password" value={sharePassword} onChange={(event) => setSharePassword(event.target.value)} /></label>
              <button type="submit" className="button-secondary" disabled={createShare.isPending}>{t("Create client link")}</button>
            </form>
            {createShare.isError && <p className="editor-error">{t("Could not create the share link. Passwords must be at least 8 characters.")}</p>}
            {shareUrl && <div className="share-result"><QRCodeSVG value={shareUrl} size={120} /><a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a><button type="button" className="text-button" onClick={() => navigator.clipboard.writeText(shareUrl)}>{t("Copy link")}</button></div>}
            {shares.data?.map((share) => {
              const url = `${window.location.origin}/share/${share.token}`;
              return <div className="share-row" key={share.id}><QRCodeSVG value={url} size={70} /><a href={url} target="_blank" rel="noreferrer">{t("Client view")} · {share.token.slice(0, 8)}…</a><button type="button" className="icon-button" aria-label={t("Revoke share link")} onClick={() => deleteShare.mutate(share.id)}>×</button></div>;
            })}
            {shares.isError && <p className="editor-error">{t("Could not load client links.")}</p>}
          </section>
          <div className="section-heading">
            <div><p className="eyebrow">{t("PROJECT STRUCTURE")}</p><h3>{t("Buildings & floors")}</h3></div>
            <span className="count-pill">{floors.length} {t("floors")}</span>
          </div>
          {buildings.isLoading && <p className="editor-status">{t("Loading buildings…")}</p>}
          {buildings.isError && <p className="editor-error">{t("Failed to load buildings.")}</p>}
          <div className="building-list">
            {buildings.data?.map((building) => (
              <article key={building.id} className="building-card">
                <input aria-label={t("Building name")} defaultValue={building.name} onBlur={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (name && name !== building.name) structure.updateBuilding.mutate({ buildingId: building.id, name });
                }} />
                <div className="floor-list">
                  {building.floors.map((floor) => (
                    <div className="floor-management-row" key={floor.id}>
                      <button type="button" className={selectedFloorId === floor.id ? "floor-option selected" : "floor-option"} onClick={() => setSelectedFloorId(floor.id)}>
                        <span className="floor-icon">⌂</span>{floor.name}<span className="floor-chevron">›</span>
                      </button>
                      <button type="button" className="icon-button" aria-label={t("Duplicate {{name}}", { name: floor.name })} onClick={() => structure.duplicateFloor.mutate(floor.id)}>⧉</button>
                      <button type="button" className="icon-button" aria-label={t("Rename {{name}}", { name: floor.name })} onClick={() => {
                        const name = window.prompt(t("Floor name"), floor.name)?.trim();
                        if (name && name !== floor.name) structure.updateFloor.mutate({ floorId: floor.id, name });
                      }}>✎</button>
                      <button type="button" className="icon-button" aria-label={t("Delete {{name}}", { name: floor.name })} onClick={() => {
                        if (window.confirm(t("Delete floor “{{name}}” and its plan?", { name: floor.name }))) structure.deleteFloor.mutate(floor.id);
                      }}>×</button>
                    </div>
                  ))}
                </div>
                <form className="add-floor-form" onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const name = String(new FormData(form).get("floor") ?? "").trim();
                  if (name) structure.createFloor.mutate({ buildingId: building.id, name }, { onSuccess: (floor) => { setSelectedFloorId(floor.id); form.reset(); } });
                }}>
                  <input name="floor" required placeholder={t("New floor name")} aria-label={t("New floor in {{name}}", { name: building.name })} />
                  <button type="submit" className="text-button">＋ {t("Floor")}</button>
                </form>
                <button type="button" className="text-button" onClick={() => {
                  if (window.confirm(t("Delete building “{{name}}” and its floors?", { name: building.name }))) structure.deleteBuilding.mutate(building.id);
                }}>{t("Delete building")}</button>
              </article>
            ))}
            {buildings.data?.length === 0 && <p className="empty-panel">{t("No buildings yet. Add one to start planning.")}</p>}
          </div>
          <form onSubmit={submitBuilding} className="building-form">
            <p className="field-label">{t("Add building")}</p>
            <input required maxLength={200} aria-label={t("Building name")} placeholder={t("Building name")} value={buildingName} onChange={(event) => setBuildingName(event.target.value)} />
            <div className="floor-name-fields">
              {floorNames.map((name, index) => (
                <div key={index} className="floor-name-row">
                  <input
                    required
                    maxLength={200}
                    aria-label={t("Floor {{number}} name", { number: index + 1 })}
                    placeholder={t("Floor {{number}}", { number: index + 1 })}
                    value={name}
                    onChange={(event) => setFloorNames((current) => current.map((floor, floorIndex) => floorIndex === index ? event.target.value : floor))}
                  />
                  <button type="button" className="icon-button" aria-label={t("Remove floor {{number}}", { number: index + 1 })} disabled={floorNames.length === 1} onClick={() => setFloorNames((current) => current.filter((_, floorIndex) => floorIndex !== index))}>×</button>
                </div>
              ))}
            </div>
            <button type="button" className="text-button" onClick={() => setFloorNames((current) => [...current, ""])}>＋ {t("Add floor")}</button>
            {createBuilding.isError && <p className="editor-error">{t("Could not create building.")}</p>}
            <button className="button-primary" type="submit" disabled={createBuilding.isPending}>{createBuilding.isPending ? t("Creating…") : t("Create building")}</button>
          </form>
        </section>

        <main className="workspace-column">
          {selectedFloor ? (
            <FloorPlanEditor projectId={id} floorId={selectedFloor.id} floorName={selectedFloor.name} projectName={project.data?.name ?? ""} />
          ) : (
            <section className="workspace empty-workspace">
              <div className="empty-icon">⌂</div>
              <h3>{t("Your planning workspace")}</h3>
              <p>{t("Create a building and floor to import a floor plan, place installation symbols, and document distribution circuits.")}</p>
            </section>
          )}
        </main>
      </div>
      {feedback && <p className="editor-status" role="status">{feedback}</p>}
    </div>
  );
}
