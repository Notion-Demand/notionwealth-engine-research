"""
FastAPI dependency: verify Supabase JWT and return the caller's user_id.

Usage:
    from api.auth import get_current_user

    @router.get("/protected")
    async def handler(user_id: str = Depends(get_current_user)):
        ...
"""

import os
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

load_dotenv()

_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]
_ALGORITHM = "HS256"
_AUDIENCE = "authenticated"

_bearer = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)],
) -> str:
    """Decode the Bearer JWT issued by Supabase Auth and return user_id (sub)."""
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            _JWT_SECRET,
            algorithms=[_ALGORITHM],
            audience=_AUDIENCE,
        )
        user_id: str = payload.get("sub", "")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing sub",
            )
        return user_id
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Could not validate credentials: {exc}",
        ) from exc
