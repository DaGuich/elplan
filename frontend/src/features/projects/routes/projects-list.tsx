import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import { Project, projectsApi } from "../api";
import { ProjectForm } from "../components/project-form";
import { useProjects } from "../queries";

const col = createColumnHelper<Project>();

export function ProjectsListPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const queryClient = useQueryClient();
  const { data = [], isLoading, isError } = useProjects(includeArchived);
  const updateProject = useMutation({
    mutationFn: ({ id, archived }: { id: number; archived: boolean }) =>
      projectsApi.updateProject(id, { archived }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
  const duplicateProject = useMutation({
    mutationFn: projectsApi.duplicateProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const columns = useMemo(() => [
      col.accessor("id", {
        header: "ID",
        cell: (info) => info.getValue(),
      }),
      col.accessor("name", {
        header: "Name",
        cell: (info) => {
          const row = info.row.original;
          return (
            <Link to="/projects/$projectId" params={{ projectId: String(row.id) }}>
              {info.getValue()}
            </Link>
          );
        },
      }),
      col.accessor("description", {
        header: "Description",
        cell: (info) => info.getValue() ?? "",
      }),
      col.accessor("archived", {
        header: "Status",
        cell: (info) => info.getValue() ? "Archived" : "Active",
      }),
      col.display({
        id: "actions",
        header: "Actions",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="button-row">
              <button type="button" className="text-button" onClick={() => duplicateProject.mutate(row.id)}>Duplicate</button>
              <button type="button" className="text-button" onClick={() => updateProject.mutate({ id: row.id, archived: !row.archived })}>{row.archived ? "Restore" : "Archive"}</button>
            </div>
          );
        },
      }),
    ], [duplicateProject, updateProject]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2>Projects</h2>
      <ProjectForm />
      <label className="layer-option"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />Show archived projects</label>

      {isLoading && <p>Loading projects...</p>}
      {isError && <p>Failed to load projects.</p>}

      <table border={1} cellPadding={8} style={{ borderCollapse: "collapse" }}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id}>
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
