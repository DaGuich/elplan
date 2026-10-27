import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import { Project } from "../api";
import { ProjectForm } from "../components/project-form";
import { useProjects } from "../queries";

const col = createColumnHelper<Project>();

export function ProjectsListPage() {
  const { data = [], isLoading, isError } = useProjects();

  const columns = useMemo(
    () => [
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
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2>Projects</h2>
      <ProjectForm />

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
