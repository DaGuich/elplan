import { useState } from "react";
import { useOrganizations, useTeams } from "../../organizations/queries";
import { useCreateProject } from "../queries";

export function ProjectForm() {
  const createProject = useCreateProject();
  const { data: orgs = [] } = useOrganizations();
  const [orgId, setOrgId] = useState<number | undefined>();
  const [teamId, setTeamId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const activeOrg = orgId ?? orgs[0]?.id;
  const { data: teams = [] } = useTeams(activeOrg);

  if (orgs.length === 0) {
    return <p>Create an organization first to add projects.</p>;
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeOrg === undefined) return;
    createProject.mutate({
      name: name.trim(),
      description: description.trim(),
      organization_id: activeOrg,
      team_id: teamId,
    }, {
      onSuccess: () => {
        setName("");
        setDescription("");
      },
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-3 sm:grid-cols-2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
        className="sm:col-span-2"
        placeholder="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={200}
        required
      />
      <textarea
        className="sm:col-span-2"
        placeholder="Description"
        rows={4}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
      />
      <button type="submit" className="sm:col-span-2" disabled={createProject.isPending}>
        {createProject.isPending ? "Creating..." : "Create project"}
      </button>
      {createProject.isError && (
        <p className="editor-error sm:col-span-2" role="alert">
          Could not create project. Check your organization and team access, then try again.
        </p>
      )}
    </form>
  );
}
