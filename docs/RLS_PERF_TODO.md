# RLS performance audit (scaling to 1,000+ merchants)

Audited every `CREATE POLICY` in `backend/db/migrations/` for patterns
that degrade at scale (per-row subqueries, cross-table joins in policy
expressions, function calls that aren't memoized).

## Result: no scale problems found

The policies in this schema are simple and index-friendly:

- **Public reads** use `USING (true)` (e.g. `public_read_profiles`,
  `public_read_posts`, `categories_public_read`). Constant predicate,
  no per-row work.
- **Owner writes** use `auth.uid() = id` (e.g. `owner_write_profile`).
  `auth.uid()` is memoized per query by Postgres/Supabase, so this is
  evaluated once, not per row, and compares against an indexed PK.

No policy contains a subquery (`WHERE id IN (SELECT ...)`), a join across
tables, or an un-memoized volatile function call. Nothing to flag for
rewrite.

## Important context: the backend bypasses RLS

`backend/db/supabase.py` creates the client with the service-role key
(`create_client(SUPABASE_URL, key)`), which bypasses RLS entirely. RLS
is the safety net for any direct anon/authenticated PostgREST access
(and for the default-deny posture on tables like `categories` and
`projects`), not the primary access path for the FastAPI backend. So
RLS-expression cost is not on the hot request path regardless.

## If policies grow more complex later

Re-audit when adding policies that:
- reference another table (join or `IN (SELECT ...)`),
- call a non-memoized function per row, or
- depend on a column without a supporting index.

Wrap any new subquery-based policy's lookup column in an index, and
prefer `(SELECT auth.uid())` over bare `auth.uid()` in complex policies
so Postgres treats it as a one-time init-plan value.
