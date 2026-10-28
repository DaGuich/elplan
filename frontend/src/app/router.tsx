import { Link, createRouter, createRoute, createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AuthGate } from "../features/auth/auth-gate";
import { OrganizationsPage } from "../features/organizations/routes/organizations";
import { ProjectsListPage } from "../features/projects/routes/projects-list";
import { ProjectDetailPage } from "../features/projects/routes/project-detail";
import { PublicSharePage } from "../features/projects/routes/public-share";

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (pathname.startsWith("/share/")) return <Outlet />;
  return (
    <div className="app-shell">
      <AuthGate>
        <header className="app-header">
          <Link to="/" className="app-brand">el<span>plan</span></Link>
          <nav className="app-nav">
            <Link to="/">Projects</Link>
            <Link to="/organizations">Organizations</Link>
          </nav>
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
  component: ProjectDetailPage,
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

const routeTree = rootRoute.addChildren([projectsRoute, projectDetailRoute, organizationsRoute, publicShareRoute]);

export const router = createRouter({ routeTree });
