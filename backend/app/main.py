"""DataRoom AI Backend — FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import deals, processing, upload, webhooks


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    yield
    # Shutdown


app = FastAPI(
    title="DataRoom AI API",
    version="0.1.0",
    description="Dataroom Intelligence Platform — backend API",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(deals.router, prefix="/api/deals", tags=["deals"])
app.include_router(upload.router, prefix="/api/deals", tags=["upload"])
app.include_router(processing.router, prefix="/api/deals", tags=["processing"])
app.include_router(webhooks.router, prefix="/api/webhooks", tags=["webhooks"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "dataroom-ai-backend"}
