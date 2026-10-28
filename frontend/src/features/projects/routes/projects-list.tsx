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
    <div className="grid gap-6">
      <h2>Projects</h2>
      <ProjectForm />
      <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="size-4 accent-emerald-700" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />Show archived projects</label>

      {isLoading && <p className="text-slate-500">Loading projects...</p>}
      {isError && <p className="text-red-600">Failed to load projects.</p>}
      {!isLoading && !isError && data.length === 0 && <p className="text-slate-500">No projects yet. Create your first one above.</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="px-4 py-3 font-semibold">
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 align-middle">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
