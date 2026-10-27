import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { useOrganizations, useTeams } from "../../organizations/queries";
import { useCreateProject } from "../queries";

export function ProjectForm() {
  const createProject = useCreateProject();
  const { data: orgs = [] } = useOrganizations();
  const [orgId, setOrgId] = useState<number | undefined>();
  const [teamId, setTeamId] = useState<number | null>(null);
  const activeOrg = orgId ?? orgs[0]?.id;
  const { data: teams = [] } = useTeams(activeOrg);

  const form = useForm({
    defaultValues: {
      name: "",
      description: "",
    },
    onSubmit: async ({ value }) => {
      await createProject.mutateAsync({ ...value, organization_id: activeOrg!, team_id: teamId });
      form.reset();
    },
  });

  if (orgs.length === 0) {
    return <p>Create an organization first to add projects.</p>;
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      style={{ display: "grid", gap: 8, maxWidth: 560 }}
    >
      <select
        value={activeOrg}
        onChange={(e) => {
          setOrgId(Number(e.target.value));
          setTeamId(null);
        }}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Whole organization</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            Team: {t.name}
          </option>
        ))}
      </select>
      <input
        placeholder="Project name"
        value={form.state.values.name}
        onChange={(e) => form.setFieldValue("name", e.target.value)}
      />
      <textarea
        placeholder="Description"
        rows={4}
        value={form.state.values.description}
        onChange={(e) => form.setFieldValue("description", e.target.value)}
      />
      <button type="submit" disabled={createProject.isPending}>
        {createProject.isPending ? "Creating..." : "Create project"}
      </button>
    </form>
  );
}
