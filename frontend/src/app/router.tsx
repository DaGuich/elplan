import { Link, createRouter, createRoute, createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AuthGate } from "../features/auth/auth-gate";
import { OrganizationsPage } from "../features/organizations/routes/organizations";
import { ProjectsListPage } from "../features/projects/routes/projects-list";
import { ProjectDetailPage } from "../features/projects/routes/project-detail";
import { ProjectDetailsPage } from "../features/projects/routes/project-details";
import { PublicSharePage } from "../features/projects/routes/public-share";
import { LanguageSelect, useI18n } from "../i18n";

function RootLayout() {
  const { t } = useI18n();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.startsWith("/share/")) return <Outlet />;
  return (
    <div className="app-shell">
      <AuthGate>
        <header className="app-header">
          <Link to="/" className="app-brand">el<span>plan</span></Link>
          <div className="flex items-center gap-4">
            <nav className="app-nav">
              <Link to="/">{t("Projects")}</Link>
              <Link to="/organizations">{t("Organizations")}</Link>
            </nav>
            <LanguageSelect />
          </div>
        </header>
        <div className="page-container"><Outlet /></div>
      </AuthGate>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ProjectsListPage,
});

const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId",
  validateSearch: (search: Record<string, unknown>): { floor?: number } => {
    const floor = Number(search.floor);
    return Number.isInteger(floor) && floor > 0 ? { floor } : {};
  },
  component: ProjectDetailPage,
});

const projectDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/details",
  component: ProjectDetailsPage,
});

const organizationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/organizations",
  component: OrganizationsPage,
});

const publicShareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share/$token",
  component: PublicSharePage,
});

const routeTree = rootRoute.addChildren([projectsRoute, projectDetailRoute, projectDetailsRoute, organizationsRoute, publicShareRoute]);

export const router = createRouter({ routeTree });
