import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Member, Role, Team, orgApi } from "../api";
import { useOrganizations, useTeams } from "../queries";
import { useI18n } from "../../../i18n";

export function OrganizationsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: orgs = [] } = useOrganizations();
  const [selected, setSelected] = useState<number | undefined>();
  const [newOrg, setNewOrg] = useState("");
  const org = orgs.find((o) => o.id === (selected ?? orgs[0]?.id));
  const isAdmin = org?.role === "owner" || org?.role === "admin";

  return (
    <div className="grid gap-6">
      <h2>{t("Organizations")}</h2>
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const created = await orgApi.create(newOrg);
          setNewOrg("");
          setSelected(created.id);
          qc.invalidateQueries({ queryKey: ["orgs"] });
        }}
      >
        <input className="min-w-0 flex-1" placeholder={t("New organization")} value={newOrg} onChange={(e) => setNewOrg(e.target.value)} required />
        <button type="submit">{t("Create")}</button>
      </form>

      {orgs.length > 0 && (
        <select className="w-full" value={org?.id} onChange={(e) => setSelected(Number(e.target.value))}>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({t(o.role)})
            </option>
          ))}
        </select>
      )}
      </div>

      {org && <Members orgId={org.id} isAdmin={isAdmin} />}
      {org && <Teams orgId={org.id} isAdmin={isAdmin} />}
    </div>
  );
}

function Members({ orgId, isAdmin }: { orgId: number; isAdmin: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: members = [] } = useQuery({ queryKey: ["members", orgId], queryFn: () => orgApi.members(orgId) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["members", orgId] });

  return (
    <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3>{t("Members")}</h3>
      <ul className="m-0 list-none divide-y divide-slate-100 p-0">
        {members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{m.name}</span>{" "}
              <span className="text-sm text-slate-500">{m.email}</span>
              {!isAdmin && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs">{t(m.role)}</span>}
            </span>
            {isAdmin && (
              <div className="flex gap-2">
                <select
                  value={m.role}
                  onChange={async (e) => {
                    setError(null);
                    await orgApi.setRole(orgId, m.user_id, e.target.value as Role).catch(() => setError(t("Not allowed")));
                    refresh();
                  }}
                >
                  <option value="member">{t("member")}</option>
                  <option value="admin">{t("admin")}</option>
                  <option value="owner">{t("owner")}</option>
                </select>
                <button
                  className="!border-red-200 !text-red-700 hover:!bg-red-50"
                  onClick={async () => {
                    setError(null);
                    await orgApi.removeMember(orgId, m.user_id).catch(() => setError(t("Not allowed")));
                    refresh();
                    qc.invalidateQueries({ queryKey: ["projects"] });
                  }}
                >
                  {t("Remove")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await orgApi.addMember(orgId, email, role);
              setEmail("");
              refresh();
            } catch {
              setError(t("Could not add user (must be registered and not yet a member)"));
            }
          }}
        >
          <input className="min-w-0 flex-1" placeholder={t("User email")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">{t("member")}</option>
            <option value="admin">{t("admin")}</option>
            <option value="owner">{t("owner")}</option>
          </select>
          <button type="submit">{t("Add member")}</button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

function Teams({ orgId, isAdmin }: { orgId: number; isAdmin: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: teams = [] } = useTeams(orgId);
  const [name, setName] = useState("");

  return (
    <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3>{t("Teams")}</h3>
      {isAdmin && (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await orgApi.createTeam(orgId, name);
            setName("");
            qc.invalidateQueries({ queryKey: ["teams", orgId] });
          }}
        >
          <input className="min-w-0 flex-1" placeholder={t("New team")} value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit">{t("Create team")}</button>
        </form>
      )}
      {teams.map((t) => (
        <TeamCard key={t.id} orgId={orgId} team={t} isAdmin={isAdmin} />
      ))}
    </section>
  );
}

function TeamCard({ orgId, team, isAdmin }: { orgId: number; team: Team; isAdmin: boolean }) {
  const { t } = useI18n();
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
    <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
      <strong>{team.name}</strong>
      {isAdmin && (
        <button
          className="!border-red-200 !text-red-700 hover:!bg-red-50"
          onClick={async () => {
            await orgApi.deleteTeam(orgId, team.id);
            qc.invalidateQueries({ queryKey: ["teams", orgId] });
            qc.invalidateQueries({ queryKey: ["projects"] });
          }}
        >
          {t("Delete team")}
        </button>
      )}
      </div>
      <ul className="m-0 list-none divide-y divide-slate-200 p-0">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            {m.name}
            {isAdmin && (
              <button
                onClick={async () => {
                  await orgApi.removeTeamMember(orgId, team.id, m.user_id);
                  refresh();
                }}
              >
                {t("Remove")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && candidates.length > 0 && (
        <select
          className="sm:max-w-xs"
          value=""
          onChange={async (e) => {
            await orgApi.addTeamMember(orgId, team.id, Number(e.target.value));
            refresh();
          }}
        >
          <option value="">{t("Add member…")}</option>
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
