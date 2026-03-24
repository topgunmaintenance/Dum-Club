from fastapi import HTTPException, Request

from db.supabase import get_client


async def get_verified_user_id(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    token = auth_header.split(" ", 1)[1]
    supabase = get_client()
    try:
        result = supabase.auth.get_user(token)
        if not result.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return result.user.id
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_project_owner_or_403(project_id: str, user_id: str, supabase) -> dict:
    res = (
        supabase.table("projects")
        .select("id, owner_id, token_symbol")
        .eq("id", project_id)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Project not found")
    if res.data["owner_id"] != user_id:
        raise HTTPException(status_code=403, detail="Not project owner")
    return res.data
