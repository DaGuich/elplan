import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";

import { FloorPlanEditor } from "../components/floor-plan-editor";
import { useBuildings, useProject } from "../queries";
import { useI18n } from "../../../i18n";

export function ProjectDetailPage() {
  const { t } = useI18n();
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const { floor: floorParam } = useSearch({ from: "/projects/$projectId" });
  const navigate = useNavigate();
  const id = Number(projectId);
  const project = useProject(id);
  const buildings = useBuildings(id);
  const [selectedFloorId, setSelectedFloorId] = useState<number | undefined>(floorParam);

  const floors = buildings.data?.flatMap((building) => building.floors) ?? [];

  useEffect(() => {
    if (floorParam !== undefined) setSelectedFloorId(floorParam);
  }, [floorParam]);

  useEffect(() => {
    if (floors.length && !floors.some((floor) => floor.id === selectedFloorId)) {
      setSelectedFloorId(floors[0].id);
    }
  }, [floors, selectedFloorId]);

  if (project.isLoading) return <p className="editor-status">{t("Loading project…")}</p>;
  if (project.isError || !project.data) return <p className="editor-error">{t("Failed to load project.")}</p>;

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
          <Link to="/projects/$projectId/details" params={{ projectId }} className="button-secondary">{t("Project details")}</Link>
          <span className="project-tag">{project.data.archived ? t("Archived") : t("Electrical planning")}</span>
        </div>
      </header>

      <div className="project-content">
        <section className="structure-panel">
          <div className="section-heading">
            <div><p className="eyebrow">{t("PROJECT STRUCTURE")}</p><h3>{t("Buildings & floors")}</h3></div>
            <span className="count-pill">{floors.length} {t("floors")}</span>
          </div>
          {buildings.isLoading && <p className="editor-status">{t("Loading buildings…")}</p>}
          {buildings.isError && <p className="editor-error">{t("Failed to load buildings.")}</p>}
          <div className="building-list">
            {buildings.data?.map((building) => (
              <article key={building.id} className="building-card">
                <strong>{building.name}</strong>
                <div className="floor-list">
                  {building.floors.map((floor) => (
                    <button
                      type="button"
                      key={floor.id}
                      className={selectedFloorId === floor.id ? "floor-option selected" : "floor-option"}
                      onClick={() => {
                        setSelectedFloorId(floor.id);
                        void navigate({ to: "/projects/$projectId", params: { projectId }, search: { floor: floor.id }, replace: true });
                      }}
                    >
                      <span className="floor-icon">⌂</span>{floor.name}<span className="floor-chevron">›</span>
                    </button>
                  ))}
                </div>
              </article>
            ))}
            {buildings.data?.length === 0 && <p className="empty-panel">{t("No buildings yet. Add one to start planning.")}</p>}
          </div>
          <Link to="/projects/$projectId/details" params={{ projectId }} className="text-button">{t("Manage buildings & floors")}</Link>
        </section>

        <main className="workspace-column">
          {selectedFloor ? (
            <FloorPlanEditor projectId={id} floorId={selectedFloor.id} floorName={selectedFloor.name} projectName={project.data.name} />
          ) : (
            <section className="workspace empty-workspace">
              <div className="empty-icon">⌂</div>
              <h3>{t("Your planning workspace")}</h3>
              <p>{t("Create a building and floor to import a floor plan, place installation symbols, and document distribution circuits.")}</p>
              <Link to="/projects/$projectId/details" params={{ projectId }} className="button-primary">{t("Open project details")}</Link>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
