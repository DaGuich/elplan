import type { FormEvent } from "react";
import { useState } from "react";
import { useParams } from "@tanstack/react-router";

import { useBuildings, useCreateBuilding, useProject } from "../queries";

export function ProjectDetailPage() {
  const { projectId } = useParams({ from: "/projects/$projectId" });
  const id = Number(projectId);
  const project = useProject(id);
  const buildings = useBuildings(id);
  const createBuilding = useCreateBuilding(id);
  const [buildingName, setBuildingName] = useState("");
  const [floorNames, setFloorNames] = useState(["Ground floor"]);

  function submitBuilding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createBuilding.mutate(
      { name: buildingName, floors: floorNames.map((name) => ({ name })) },
      {
        onSuccess: () => {
          setBuildingName("");
          setFloorNames(["Ground floor"]);
        },
      }
    );
  }

  if (project.isLoading) return <p>Loading project...</p>;
  if (project.isError || !project.data) return <p>Failed to load project.</p>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2>{project.data.name}</h2>
      {project.data.description && <p>{project.data.description}</p>}

      <section style={{ display: "grid", gap: 12 }}>
        <h3>Buildings</h3>
        {buildings.isLoading && <p>Loading buildings...</p>}
        {buildings.isError && <p>Failed to load buildings.</p>}
        {buildings.data?.map((building) => (
          <article key={building.id}>
            <h4>{building.name}</h4>
            <ol>
              {building.floors.map((floor) => (
                <li key={floor.id}>{floor.name}</li>
              ))}
            </ol>
          </article>
        ))}
        {buildings.data?.length === 0 && <p>No buildings yet.</p>}

        <form onSubmit={submitBuilding} style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <h4>Create building</h4>
          <input
            required
            maxLength={200}
            placeholder="Building name"
            value={buildingName}
            onChange={(event) => setBuildingName(event.target.value)}
          />
          {floorNames.map((name, index) => (
            <div key={index} style={{ display: "flex", gap: 8 }}>
              <input
                required
                maxLength={200}
                aria-label={`Floor ${index + 1} name`}
                placeholder={`Floor ${index + 1}`}
                value={name}
                onChange={(event) =>
                  setFloorNames((floors) =>
                    floors.map((floor, floorIndex) => (floorIndex === index ? event.target.value : floor))
                  )
                }
              />
              <button
                type="button"
                disabled={floorNames.length === 1}
                onClick={() => setFloorNames((floors) => floors.filter((_, floorIndex) => floorIndex !== index))}
              >
                Remove floor
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setFloorNames((floors) => [...floors, ""])}>
            Add floor
          </button>
          {createBuilding.isError && <p>Failed to create building.</p>}
          <button type="submit" disabled={createBuilding.isPending}>
            {createBuilding.isPending ? "Creating..." : "Create building"}
          </button>
        </form>
      </section>
    </div>
  );
}
