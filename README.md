# elplan

Electrical planning platform combining:
- **Layout planning on floor plans** (Jetplan-style)
- **Electrical schematic/documentation workflows** (stromlaufplan-style)

## Stack

- Backend: **Python + FastAPI + SQLAlchemy + Alembic**
- Frontend: **React + TypeScript + TanStack** (Router, Query, Form, Table, Virtual, Store)
- Database: **PostgreSQL**
- Reverse proxy: **Nginx**

## Quick start (Docker)

```bash
docker compose up --build                              # production (compiled frontend)
docker compose -f docker-compose.dev.yml up --build    # development (hot reload)
```

Open: http://localhost:8080

- Frontend is served via proxy at `/`
- Backend API is proxied at `/api`
- Health check: http://localhost:8080/api/v1/health

## Project structure

- `backend/` FastAPI service
- `frontend/` React + TypeScript app
- `proxy/` Nginx reverse proxy config
- `postgres/` DB bootstrap scripts

## Database migrations (Alembic)

Migrations run automatically on backend start (`alembic upgrade head`). Manually (from `backend/`):

```bash
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

## Users, organizations and teams

- Register/log in in the UI (JWT bearer auth). Production requires `SECRET_KEY` (e.g. `SECRET_KEY=$(openssl rand -hex 32) docker compose up --build`).
- Projects belong to an organization and are visible only to its members.
- Organization roles: `owner`, `admin` (manage members and teams), `member`.
- A project may be assigned to a team; it is then visible/editable/deletable only by team members. Project-related items must use `require_project_access` (`backend/app/services/access.py`).
- Upgrading: migration `0002` deletes pre-existing projects (they have no organization).
