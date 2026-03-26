# Backend Agent Instructions

## API Response Convention

All endpoints must return the common `ApiResponse<T>` wrapper from `app.models.schemas`.

```json
{
  "success": true | false,
  "data": T | null,
  "error": { "code": "ERROR_CODE", "message": "Human-readable message" } | null
}
```

### How to use

```python
from app.models.schemas import ApiResponse

# Success
return ApiResponse.ok({"id": "abc", "name": "My Deal"})

# Failure
return ApiResponse.fail("NOT_FOUND", "Deal not found")
```

### Rules

- **Every endpoint** returns `ApiResponse`. No bare dicts, no raw strings.
- For success, use `ApiResponse.ok(data)`.
- For expected errors, use `ApiResponse.fail(code, message)`.
- For unexpected errors, global exception handlers in `main.py` catch them and wrap automatically.
- Raise `HTTPException` for 4xx errors — the global handler converts them to `ApiResponse.fail()`.
- **Error codes** are UPPER_SNAKE_CASE (e.g. `NOT_FOUND`, `VALIDATION_ERROR`, `DB_UNAVAILABLE`, `UNAUTHORIZED`).
- Do **not** return `JSONResponse` or plain dicts from route handlers.

## Database Access

- Use `get_supabase()` from `app.db.client` for Supabase client queries.
- When querying for a single row, use `.execute()` and check `result.data` (a list). Do **not** use `.maybe_single()` or `.single()` — both throw or return `None` instead of a safe empty result.
- Access the first row as `result.data[0]`, after checking `if result.data:`.

## Auth

- Use `Depends(get_current_user_id)` (or the alias `CurrentUserId`) from `app.auth` for protected endpoints.
- The dependency verifies the Clerk JWT and ensures the user row exists in the DB.
