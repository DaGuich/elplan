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

Project details, client and site information, electrical parameters, and project pricing templates are edited at `/projects/:id/details`. Customer (client name) and project number live in the project details; handbook covers use them and fall back read-only to legacy per-floor values (kept in floor data, never deleted) only when unset. Document title, legend and notes stay per floor. Templates can fill unpriced, automatically generated floor BOM rows when name and unit match uniquely. Manual prices are preserved; floor totals do not include VAT, markup, or the project hourly rate.

Distribution boards are project-scoped and can have an optional floor location; a floor may contain multiple boards or none, and circuits can reference placements on different floors. Boards can be managed in Project Details. Existing floor-level circuit data is migrated when the project topology or a floor workspace is opened, and project export, import, and duplication preserve topology links. The floor editor reports incomplete topology that cannot be represented in its circuit view instead of inventing electrical ratings.

When adding an RCD in a project with several boards, select its board first; the outgoing circuits belong to the same board. Moving an existing RCD between boards is not supported in the floor editor. Newly added device and circuit values are examples that must be checked against the electrical design.

Topology edits use optimistic concurrency. Floor-plan clients must send the returned `topology_revision` on save; board, circuit, and load API mutations must send the revision from `X-Topology-Revision` in `If-Match`. A stale revision returns HTTP 409; reload and reconcile changes before retrying. Older clients need to be updated alongside the backend.

Plan crop: `image_crop` (`[x, y, w, h]`, fractions of the source image) is the visible window. `image_crop_reference` (same format, optional) is the source window stretched over the plan; when absent (legacy plans) the saved crop is used, so existing plans render unchanged. The first crop edit stores the reference, after which cropping only clips the image: blueprint position, measured scale (`scale_m_per_100_units`), overlay coordinates and rotation stay fixed. No data migration is needed.

Room detection analyzes a raster image (including a rendered PDF page) and marks detected polygons for review. Verify every boundary and calibrated area: open doors, annotations, poor scans, and cropped rooms can produce incomplete or incorrect results. Outline vertices can be edited, rooms split between vertices, adjacent rooms sharing an edge merged, and rectangular holes drawn or removed. Room type and installation standard are optional notes, not automated compliance checks.

The schematic preview displays stored relationships in single- and multi-line modes. Its hatched IEC/DIN symbol boxes are placeholders, not actual symbols: it is **not** a DIN EN 60617 / IEC 60617 compliant drawing and does not determine conductor or terminal assignments. Floor-plan symbols have not been verified against those standards either. Do not use the preview as an executable electrical design.

On the floor plan, use the mouse wheel to zoom around the pointer, or the zoom buttons to zoom around the center. Pan with middle-mouse drag, Shift-drag in selection mode, or two-finger trackpad scrolling; pinch to zoom. Wheel events over the canvas do not scroll the surrounding page. Because browsers do not identify the wheel device, small pixel-based scrolls are interpreted as trackpad panning.

Projects can be duplicated, archived, imported/exported as JSON, and transferred between organizations. Password-protected client links expose a filtered presentation with technical assignments, cabinet details, testing records, and prices removed; use the share-management panel to create or revoke links and display their QR codes. Floor and project workspaces persist as validated floor-level JSON.

## Blueprint and asset storage

Blueprint files are stored through a storage adapter (`backend/app/storage`), selected with `STORAGE_BACKEND`:

| Variable | Description |
|---|---|
| `STORAGE_BACKEND` | `filesystem` (default) or `s3` |
| `STORAGE_LOCAL_ROOT` | Filesystem root; default `./data/uploads` (`/data/uploads` in Docker, on the `uploads` volume) |
| `STORAGE_MAX_UPLOAD_BYTES` | Upload limit, default 25 MiB |
| `S3_BUCKET`, `S3_PREFIX` | Bucket and optional key prefix |
| `S3_ENDPOINT_URL`, `S3_REGION` | Endpoint for MinIO/Ceph; region |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credentials (omit to use the default boto3 credential chain) |
| `S3_ADDRESSING_STYLE` | `auto`, `path` (usually MinIO/Ceph) or `virtual` |
| `S3_PRESIGN_DOWNLOADS`, `S3_PRESIGN_EXPIRES_SECONDS` | Redirect downloads to presigned URLs instead of streaming |

API (all under `/api/v1/projects/{project_id}/floors/{floor_id}/blueprint`, project access rules apply): `POST` upload (multipart `file` plus optional `scale_mm_per_pixel`, `origin_x`, `origin_y`, `rotation_deg`, `crop=left,top,width,height`), `PUT` replace file, `GET` metadata (hash, size, version, calibration), `PATCH /calibration`, `GET /content`, `DELETE`. PNG, JPEG, WebP, PDF and SVG are accepted (type detected from content). Replacing the file keeps the calibration, origin, rotation, crop and the floor's `plan_data` untouched. Uploaded PDFs are stored as the original file; the selected page (`pdf_page`, set via `PATCH /calibration`) is rendered in the browser and restored after reload. Share links expose the stored blueprint through `GET /api/v1/projects/shared/{token}/floors/{floor_id}/blueprint/content` (same `X-Share-Password` rules as the shared project). Floor/project duplication copies the stored file; project JSON export/import embeds it as base64. The browser's JSON import limit is 20 MB, so larger exports cannot currently be re-imported through the UI. Deleting floors, buildings or projects removes the stored files. The stored objects are not migrated when `STORAGE_BACKEND` changes.

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
