from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.auth import router as auth_router
from app.api.v1.blueprints import router as blueprints_router
from app.api.v1.blueprints import shared_router as shared_blueprints_router
from app.api.v1.health import router as health_router
from app.api.v1.organizations import router as organizations_router
from app.api.v1.project_details import router as project_details_router
from app.api.v1.projects import router as projects_router
from app.api.v1.topology import router as topology_router
from app.core.config import settings

app = FastAPI(title=settings.APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    expose_headers=["X-Topology-Warnings", "X-Topology-Revision"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api/v1")
app.include_router(projects_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(organizations_router, prefix="/api/v1")
app.include_router(blueprints_router, prefix="/api/v1")
app.include_router(shared_blueprints_router, prefix="/api/v1")
app.include_router(topology_router, prefix="/api/v1")
app.include_router(project_details_router, prefix="/api/v1")
