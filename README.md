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

- Sign in exclusively through the configured identity provider (JWT bearer auth). Password-based login and registration are disabled. Production requires `SECRET_KEY` (e.g. `SECRET_KEY=$(openssl rand -hex 32) docker compose up --build`).
- Projects belong to an organization and are visible only to its members.
- Organization roles: `owner`, `admin` (manage members and teams), `member`.
- A project may be assigned to a team; it is then visible/editable/deletable only by team members. Project-related items must use `require_project_access` (`backend/app/services/access.py`).
- Upgrading: migration `0002` deletes pre-existing projects (they have no organization).

## Floor planning and electrical documentation

Each project can contain buildings and floors. A floor workspace supports raster and PDF plan import, room templates and beta room-region detection, layers and client presentation, scale calibration, dimensions, symbol placement, mounting-point groups, snapping, multi-selection, pan/zoom, notes, and DXF export. Circuit schedules connect floor symbols to RCDs and outgoing circuits; smart-device channels, terminal groups, and DIN-rail cabinet layouts are managed alongside the plan. Project documentation includes a bill of materials, pricing, test measurements, terminal sizing, CSV import/export, and a printable handbook.

Projects can be duplicated, archived, imported/exported as JSON, and transferred between organizations. Password-protected client links expose a filtered presentation with technical assignments, cabinet details, testing records, and prices removed; use the share-management panel to create or revoke links and display their QR codes. Floor and project workspaces persist as validated floor-level JSON.

## OAuth2 / OIDC login (e.g. Authentik)

The backend performs the authorization-code flow (with PKCE) itself and exchanges the code with the provider server-side (back-channel). Configure it only via environment variables (put them in a `.env` file next to the compose file, or export them):

Identity-provider login is required. Register the exact `OAUTH_REDIRECT_URI` with your provider, configure the client credentials and discovery URL in the compose-level `.env`, then restart the backend. Without a configured provider, users cannot sign in.

| Variable | Description |
|---|---|
| `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` | Client credentials; OAuth login is enabled when the ID is set |
| `OAUTH_DISCOVERY_URL` | OIDC discovery URL, e.g. `https://authentik.example.com/application/o/elplan/.well-known/openid-configuration` |
| `OAUTH_AUTHORIZE_URL`, `OAUTH_TOKEN_URL`, `OAUTH_USERINFO_URL` | Explicit endpoints (instead of / overriding discovery) |
| `OAUTH_SCOPES` | Default `openid email profile` |
| `OAUTH_REDIRECT_URI` | Register this at the provider; default `http://localhost:8080/api/v1/auth/oauth/callback` |
| `OAUTH_PROVIDER_NAME` | Label of the login button |
| `OAUTH_TRUST_EMAIL` | Link to existing local accounts by email even if the provider doesn't mark it verified (default `false`) |
| `FRONTEND_URL` | Where the browser returns after login |

Users are identified by (issuer, `sub`); unknown users are created on first login. Existing accounts are not automatically linked by default; set `OAUTH_TRUST_EMAIL=true` only for a provider you trust to assert email ownership. Password login and registration API endpoints are disabled; existing users must authenticate through the identity provider.
