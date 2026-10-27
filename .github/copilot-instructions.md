# Copilot instructions for elplan

## Purpose
elplan is an electrical planning platform combining floor-plan layout planning (Jetplan-style) and electrical schematic/documentation workflows (stromlaufplan-style). Correctness and traceability of electrical data matter more than cosmetic polish.

The goal is to more or less mirror the functionality of these two products. Consult their documentation as the reference for features, terminology, and workflows before designing new ones:
- Jetplan (floor-plan layout planning): https://intercom.help/jetplan/de/collections/2457137-hilfe-artikel
- Stromlaufplan (schematics/documentation): https://stromlaufplan.de/documentation/erste-schritte/

Both are in German; use their terminology for domain concepts where sensible.

## Stack and layout
- `backend/`: Python, FastAPI, SQLAlchemy, Alembic. Layers: `api/v1` (routes) → `services` (logic) → `models` (ORM); `schemas` are Pydantic I/O models.
- `frontend/`: React + TypeScript + TanStack (Router, Query, Form, Table, Virtual, Store). Organized by feature under `src/features/<name>/` (`api.ts`, `queries.ts`, `components/`, `routes/`).
- `postgres/` bootstrap, `proxy/` Nginx (`/` → frontend, `/api` → backend).
- Run everything with `docker compose up --build` (http://localhost:8080).

## Conventions
- Keep routes thin; put business logic in services.
- Any schema change needs an Alembic migration in `backend/alembic/versions/`.
- Version API routes under `/api/v1`.
- Frontend: strict TypeScript, no `any`; server state via TanStack Query, API calls via `lib/api-client.ts`.
- Follow existing patterns in neighbouring files before introducing new ones.

## Quality criteria
- Changes are small, focused, and consistent with existing style.
- Add or update tests for new behavior; make sure the backend and frontend build/type-check.
- Validate all external input with Pydantic schemas; never commit secrets (use `.env.example`).
- Update README/docs when behavior or setup changes.
