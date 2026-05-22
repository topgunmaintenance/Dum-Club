"""Pre-deploy smoke test: import the FastAPI app.

Catches import-time errors (undefined names, bad imports, missing
dependencies) in ~1 second, BEFORE Railway tries to boot uvicorn and
crash-loops. Exits non-zero on any failure so a build/CI step can block
the deploy instead of shipping a container that boots, crashes on
import, restarts, and repeats forever.

Why this exists: a missing `from typing import Optional` in
api/routes/health.py once shipped to production and put the backend in
an infinite crash loop. `python -m py_compile` passed (the syntax was
valid) — the NameError only fires at IMPORT time. This script imports
the app, which transitively imports every route module, so any
import-time error fails here first.

Run from the backend root:  python scripts/smoke_import.py
"""
import os
import sys

# Ensure the backend root is importable when run from anywhere.
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

try:
    from main import app  # noqa: F401  (import side effect is the test)
except Exception as exc:  # noqa: BLE001
    print(f"[smoke_import] FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
    sys.exit(1)

print("[smoke_import] OK — app imported cleanly")
