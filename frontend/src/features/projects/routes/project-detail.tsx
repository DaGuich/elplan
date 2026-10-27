import { useParams } from "@tanstack/react-router";

export function ProjectDetailPage() {
  const { projectId } = useParams({ from: "/projects/$projectId" });

  return (
    <div>
      <h2>Project detail</h2>
      <p>Project ID: {projectId}</p>
      <p>Detail view scaffold ready for floorplans, symbols, and schematic pages.</p>
    </div>
  );
}
