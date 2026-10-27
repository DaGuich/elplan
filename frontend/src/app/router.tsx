import { createRouter, createRoute, createRootRoute, Outlet } from "@tanstack/react-router";
import { ProjectsListPage } from "../features/projects/routes/projects-list";
import { ProjectDetailPage } from "../features/projects/routes/project-detail";

const rootRoute = createRootRoute({
  component: () => (
    <div style={{ padding: 20 }}>
      <h1>elplan</h1>
      <Outlet />
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

const routeTree = rootRoute.addChildren([projectsRoute, projectDetailRoute]);

export const router = createRouter({ routeTree });
