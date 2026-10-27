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
docker compose up --build
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
