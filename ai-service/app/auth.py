import jwt
from fastapi import Request, HTTPException
from app.config import settings


def get_user_from_headers(request: Request) -> dict:
    user_id = request.headers.get("X-User-ID")
    if not user_id:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing authentication")

        token = auth_header[7:]
        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
            return {
                "user_id": payload.get("user_id"),
                "email": payload.get("email", ""),
                "username": payload.get("username", ""),
            }
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Invalid token")

    return {
        "user_id": user_id,
        "email": request.headers.get("X-User-Email", ""),
        "username": request.headers.get("X-User-Username", ""),
    }
