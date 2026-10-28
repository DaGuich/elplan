import { FormEvent, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { FloorPlanData, SharedProject, projectsApi } from "../api";
import { LanguageSelect, useI18n } from "../../../i18n";

function SharedFloor({ floor }: { floor: SharedProject["buildings"][number]["floors"][number] }) {
  const { t } = useI18n();
  const plan = floor.plan_data;
  return (
    <article className="shared-floor">
      <h3>{floor.name}</h3>
      <svg viewBox="0 0 1000 700" role="img" aria-label={`${floor.name} floor plan`}>
        {plan.background_image && (
          <image
            href={plan.background_image}
            width="1000"
            height="700"
            preserveAspectRatio="none"
            opacity={plan.background_opacity}
            transform={`rotate(${plan.background_rotation},500,350)`}
          />
        )}
        {plan.rooms.map((room) => (
          <g key={room.id}>
            <rect x={room.x} y={room.y} width={room.width} height={room.height} fill={room.color} fillOpacity=".45" stroke="#68877f" strokeWidth="2" />
            <text x={room.x + 10} y={room.y + 22}>{room.name}</text>
          </g>
        ))}
        {plan.placements.map((item) => (
          <g key={item.id} transform={`translate(${item.x},${item.y}) rotate(${item.rotation})`}>
            <circle r="14" fill={item.color} />
            <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize="10">{item.kind.slice(0, 3).toUpperCase()}</text>
            <text y="25" textAnchor="middle" fontSize="12">{item.label}</text>
          </g>
        ))}
      </svg>
      <p>{plan.rooms.length} {t("rooms")} · {plan.placements.length} {t("installation points")}</p>
    </article>
  );
}

export function PublicSharePage() {
  const { t } = useI18n();
  const { token } = useParams({ from: "/share/$token" });
  const [password, setPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const query = useQuery({
    queryKey: ["shared-project", token, submitted ? password : ""],
    queryFn: () => projectsApi.sharedProject(token, submitted ? password : ""),
    enabled: true,
    retry: false,
  });

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  const project = query.data;
  const passwordRequired = query.isError && query.error instanceof Error && query.error.message.toLowerCase().includes("password");

  return (
    <main className="public-share-page">
      <div className="flex justify-end"><LanguageSelect /></div>
      {query.isLoading && <p className="editor-status">{t("Loading shared project…")}</p>}
      {query.isError && (
        <section className="public-share-gate">
          <h1>{t("Shared electrical plan")}</h1>
          <p>{passwordRequired ? t("This project is password protected.") : t("This share link is unavailable or has expired.")}</p>
          {passwordRequired && (
            <form onSubmit={submitPassword}>
              <label>{t("Password")}<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <button className="button-primary" type="submit">{t("Open shared project")}</button>
            </form>
          )}
        </section>
      )}
      {project && (
        <>
          <header className="public-share-header">
            <p className="eyebrow">{t("ELPLAN · CLIENT VIEW")}</p>
            <h1>{project.name}</h1>
            {project.description && <p>{project.description}</p>}
          </header>
          {project.buildings.map((building, index) => (
            <section className="shared-building" key={`${building.name}-${index}`}>
              <h2>{building.name}</h2>
              <div className="shared-floor-list">{building.floors.map((floor) => <SharedFloor key={floor.id} floor={floor} />)}</div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
