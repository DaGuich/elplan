import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Member, Role, Team, orgApi } from "../api";
import { useOrganizations, useTeams } from "../queries";

export function OrganizationsPage() {
  const qc = useQueryClient();
  const { data: orgs = [] } = useOrganizations();
  const [selected, setSelected] = useState<number | undefined>();
  const [newOrg, setNewOrg] = useState("");
  const org = orgs.find((o) => o.id === (selected ?? orgs[0]?.id));
  const isAdmin = org?.role === "owner" || org?.role === "admin";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2>Organizations</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const created = await orgApi.create(newOrg);
          setNewOrg("");
          setSelected(created.id);
          qc.invalidateQueries({ queryKey: ["orgs"] });
        }}
      >
        <input placeholder="New organization" value={newOrg} onChange={(e) => setNewOrg(e.target.value)} required />
        <button type="submit">Create</button>
      </form>

      {orgs.length > 0 && (
        <select value={org?.id} onChange={(e) => setSelected(Number(e.target.value))}>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.role})
            </option>
          ))}
        </select>
      )}

      {org && <Members orgId={org.id} isAdmin={isAdmin} />}
      {org && <Teams orgId={org.id} isAdmin={isAdmin} />}
    </div>
  );
}

function Members({ orgId, isAdmin }: { orgId: number; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: members = [] } = useQuery({ queryKey: ["members", orgId], queryFn: () => orgApi.members(orgId) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["members", orgId] });

  return (
    <section>
      <h3>Members</h3>
      <ul>
        {members.map((m) => (
          <li key={m.user_id}>
            {m.name} ({m.email}) – {m.role}
            {isAdmin && (
              <>
                {" "}
                <select
                  value={m.role}
                  onChange={async (e) => {
                    setError(null);
                    await orgApi.setRole(orgId, m.user_id, e.target.value as Role).catch(() => setError("Not allowed"));
                    refresh();
                  }}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
                <button
                  onClick={async () => {
                    setError(null);
                    await orgApi.removeMember(orgId, m.user_id).catch(() => setError("Not allowed"));
                    refresh();
                    qc.invalidateQueries({ queryKey: ["projects"] });
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await orgApi.addMember(orgId, email, role);
              setEmail("");
              refresh();
            } catch {
              setError("Could not add user (must be registered and not yet a member)");
            }
          }}
        >
          <input placeholder="User email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">member</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
          <button type="submit">Add member</button>
        </form>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </section>
  );
}

function Teams({ orgId, isAdmin }: { orgId: number; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: teams = [] } = useTeams(orgId);
  const [name, setName] = useState("");

  return (
    <section>
      <h3>Teams</h3>
      {isAdmin && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await orgApi.createTeam(orgId, name);
            setName("");
            qc.invalidateQueries({ queryKey: ["teams", orgId] });
          }}
        >
          <input placeholder="New team" value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit">Create team</button>
        </form>
      )}
      {teams.map((t) => (
        <TeamCard key={t.id} orgId={orgId} team={t} isAdmin={isAdmin} />
      ))}
    </section>
  );
}

function TeamCard({ orgId, team, isAdmin }: { orgId: number; team: Team; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { data: members = [] } = useQuery({
    queryKey: ["team-members", team.id],
    queryFn: () => orgApi.teamMembers(orgId, team.id),
  });
  const { data: orgMembers = [] } = useQuery({ queryKey: ["members", orgId], queryFn: () => orgApi.members(orgId) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["team-members", team.id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
  const candidates = orgMembers.filter((m: Member) => !members.some((x) => x.user_id === m.user_id));

  return (
    <div style={{ border: "1px solid #ccc", padding: 8, margin: "8px 0" }}>
      <strong>{team.name}</strong>
      {isAdmin && (
        <button
          onClick={async () => {
            await orgApi.deleteTeam(orgId, team.id);
            qc.invalidateQueries({ queryKey: ["teams", orgId] });
            qc.invalidateQueries({ queryKey: ["projects"] });
          }}
        >
          Delete team
        </button>
      )}
      <ul>
        {members.map((m) => (
          <li key={m.user_id}>
            {m.name}
            {isAdmin && (
              <button
                onClick={async () => {
                  await orgApi.removeTeamMember(orgId, team.id, m.user_id);
                  refresh();
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && candidates.length > 0 && (
        <select
          value=""
          onChange={async (e) => {
            await orgApi.addTeamMember(orgId, team.id, Number(e.target.value));
            refresh();
          }}
        >
          <option value="">Add member…</option>
          {candidates.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
