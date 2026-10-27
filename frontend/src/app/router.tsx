import { Link, createRouter, createRoute, createRootRoute, Outlet } from "@tanstack/react-router";
import { AuthGate } from "../features/auth/auth-gate";
import { OrganizationsPage } from "../features/organizations/routes/organizations";
import { ProjectsListPage } from "../features/projects/routes/projects-list";
import { ProjectDetailPage } from "../features/projects/routes/project-detail";

const rootRoute = createRootRoute({
  component: () => (
    <div style={{ padding: 20 }}>
      <h1>elplan</h1>
      <AuthGate>
        <nav style={{ display: "flex", gap: 12, margin: "12px 0" }}>
          <Link to="/">Projects</Link>
          <Link to="/organizations">Organizations</Link>
        </nav>
        <Outlet />
      </AuthGate>
    </div>
  ),
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

const routeTree = rootRoute.addChildren([projectsRoute, projectDetailRoute, organizationsRoute]);

export const router = createRouter({ routeTree });
