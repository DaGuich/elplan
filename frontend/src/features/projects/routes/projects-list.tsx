import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import { Project, projectsApi } from "../api";
import { ProjectForm } from "../components/project-form";
import { useProjects } from "../queries";
import { useI18n } from "../../../i18n";

const col = createColumnHelper<Project>();

export function ProjectsListPage() {
  const { t } = useI18n();
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
        header: t("Name"),
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
        header: t("Description"),
        cell: (info) => info.getValue() ?? "",
      }),
      col.accessor("archived", {
        header: t("Status"),
        cell: (info) => info.getValue() ? t("Archived") : t("Active"),
      }),
      col.display({
        id: "actions",
        header: t("Actions"),
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="button-row">
              <button type="button" className="text-button" onClick={() => duplicateProject.mutate(row.id)}>{t("Duplicate")}</button>
              <button type="button" className="text-button" onClick={() => updateProject.mutate({ id: row.id, archived: !row.archived })}>{row.archived ? t("Restore") : t("Archive")}</button>
            </div>
          );
        },
      }),
    ], [duplicateProject, t, updateProject]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="grid gap-6">
      <h2>{t("Projects")}</h2>
      <ProjectForm />
      <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="size-4 accent-emerald-700" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />{t("Show archived projects")}</label>

      {isLoading && <p className="text-slate-500">{t("Loading projects...")}</p>}
      {isError && <p className="text-red-600">{t("Failed to load projects.")}</p>}
      {!isLoading && !isError && data.length === 0 && <p className="text-slate-500">{t("No projects yet. Create your first one above.")}</p>}

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
