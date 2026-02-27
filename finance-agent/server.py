"""
Production FastAPI server for NotionWealth Intelligence Engine.

Start with:
    uvicorn server:app --host 0.0.0.0 --port 8000 --reload

Mounts all api/ routers under /api/v1 prefix.
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.connections import router as connections_router
from api.analyze import router as analyze_router
from api.gmail import router as gmail_router
from api.slack_webhook import router as slack_router

load_dotenv()

_FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000")

app = FastAPI(
    title="NotionWealth Intelligence Engine API",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[_FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount all routers under /api/v1
_PREFIX = "/api/v1"
app.include_router(connections_router, prefix=_PREFIX)
app.include_router(analyze_router, prefix=_PREFIX)
app.include_router(gmail_router, prefix=_PREFIX)
app.include_router(slack_router, prefix=_PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok"}
