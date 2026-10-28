import { FormEvent, useEffect, useId, useState } from "react";
import { GlobalWorkerOptions, PDFDocumentLoadingTask, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { FloorPlanData, SharedProject, projectsApi } from "../api";
import { renderPdfPageToUrl } from "../components/blueprint-render";
import { cropLayout } from "../domain/plan-crop";
import { hasPolygon, labelAnchor, roomPath } from "../domain/plan-rooms";
import { LanguageSelect, useI18n } from "../../../i18n";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function SharedFloor({
  floor,
  token,
  password,
}: {
  floor: SharedProject["buildings"][number]["floors"][number];
  token: string;
  password: string;
}) {
  const { t } = useI18n();
  const plan = floor.plan_data;
  const [blueprintUrl, setBlueprintUrl] = useState<string | null>(null);
  const [blueprintError, setBlueprintError] = useState(false);
  const blueprintVersion = floor.blueprint?.version;
  const blueprintPage = floor.blueprint?.pdf_page;
  const blueprintType = floor.blueprint?.content_type;
  const clipId = `shared-plan-clip-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;

  useEffect(() => {
    setBlueprintUrl(null);
    setBlueprintError(false);
    if (!floor.blueprint) return;
    let cancelled = false;
    let url: string | null = null;
    let task: PDFDocumentLoadingTask | null = null;
    (async () => {
      try {
        const blob = await projectsApi.sharedBlueprintContent(token, floor.id, password);
        if (floor.blueprint?.content_type === "application/pdf") {
          task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
          const pdf = await task.promise;
          url = cancelled ? null : await renderPdfPageToUrl(pdf, Math.min(floor.blueprint.pdf_page, pdf.numPages));
        } else {
          url = URL.createObjectURL(blob);
        }
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          url = null;
        } else {
          setBlueprintUrl(url);
        }
      } catch {
        if (!cancelled) setBlueprintError(true);
      } finally {
        void task?.destroy();
        task = null;
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [token, password, floor.id, blueprintVersion, blueprintPage, blueprintType]);

  const backgroundSrc = blueprintUrl ?? plan.background_image;
  const layout = cropLayout(plan, plan.background_rotation);
  return (
    <article className="shared-floor">
      <h3>{floor.name}</h3>
      {blueprintError && <p role="alert" className="editor-status">{t("Could not load the stored floor-plan file.")}</p>}
      <svg viewBox="0 0 1000 700" role="img" aria-label={`${floor.name} floor plan`}>
        <defs>
          <clipPath id={clipId}><rect width="1000" height="700" /></clipPath>
          {layout.clip && <clipPath id={`${clipId}-crop`}><rect {...layout.clip} /></clipPath>}
        </defs>
        {backgroundSrc && (
          <g clipPath={`url(#${clipId})`} opacity={plan.background_opacity}>
            <g transform={`rotate(${plan.background_rotation},500,350)`}>
              <image
                href={backgroundSrc}
                {...layout.image}
                preserveAspectRatio="none"
                clipPath={layout.clip ? `url(#${clipId}-crop)` : undefined}
              />
            </g>
          </g>
        )}
        {plan.rooms.map((room) => (
          <g key={room.id}>
            {hasPolygon(room)
              ? <path d={roomPath(room)} fillRule="evenodd" fill={room.color} fillOpacity=".45" stroke="#68877f" strokeWidth="2" />
              : <rect x={room.x} y={room.y} width={room.width} height={room.height} fill={room.color} fillOpacity=".45" stroke="#68877f" strokeWidth="2" />}
            {hasPolygon(room)
              ? <text x={labelAnchor(room).x} y={labelAnchor(room).y} textAnchor="middle">{room.name}</text>
              : <text x={room.x + 10} y={room.y + 22}>{room.name}</text>}
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
              <div className="shared-floor-list">{building.floors.map((floor) => <SharedFloor key={floor.id} floor={floor} token={token} password={submitted ? password : ""} />)}</div>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
