# Debug Report Template

Use this structure for every bug investigation and fix.

---

## Bug
Short name:

## Classification
One of: code bug / deployment mismatch / env/config issue / DB/RLS issue / stale cache / third-party service / user-flow misunderstanding

## Symptom
What the user sees:

## Impact
Who it affects:
- [ ] owner
- [ ] public visitor
- [ ] buyer
- [ ] token trader

## Exact Surface Area
- Frontend handler:
- Backend route:
- DB table(s):
- Deployment target(s):

## Root Cause
State the exact root cause, not guesses.

## Files Changed
- `path/to/file` -- why changed
- `path/to/file` -- why changed

## Fix Applied
Describe minimal change only. No unrelated refactoring.

## Verification

| Step | Status |
|------|--------|
| Request fired | PASS / FAIL |
| Backend route hit | PASS / FAIL |
| DB write succeeded | PASS / FAIL |
| UI refreshed correctly | PASS / FAIL |

## Manual Test Steps
1.
2.
3.

## Deployment Status
- GitHub `main`:
- Vercel:
- Railway:
- Aligned: YES / NO

## Remaining Risk
Anything still unverified:
