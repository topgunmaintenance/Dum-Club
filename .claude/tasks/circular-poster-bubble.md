# TASK: circular-poster-bubble

**Goal:** Replace the rectangular identity-card "bubble" rendered by
`frontend/public/embed.js` on the merchant's own website with a true
Loom-style circular floating bubble. Poster + initials only — no live
video on the host origin yet. Click opens the existing centered
overlay iframe (unchanged).

This is the approved MVP path from the audit (Option A). Live IVS
inside the host-page bubble is explicitly deferred.

---

## WHAT TO DO

1. Modify only `frontend/public/embed.js`. No backend, no React
   components, no new files outside this task file.
2. In the `displayMode === "bubble"` branch, replace the 340px
   white identity card with:
   - Single circular element, 140px desktop / 96px mobile
   - `border-radius: 50%`, `overflow: hidden` on the avatar wrapper
   - Avatar image (when `popin_config.avatar_url` is provided) or
     monogram initials fallback (same logic as today)
   - Gold ring (`box-shadow`) when `is_live === true`
   - Pulsing red "LIVE" badge anchored to the bottom edge, only
     when live
   - Small dismiss `×` in the top-right corner of the bubble's
     bounding box (only visible on hover/focus on desktop, always
     visible on touch viewports)
3. Preserve everything else:
   - `popinConfig` fetch + storage helpers
   - `once_per_session` / first-visit / returning logic
   - Overlay iframe creation (centered modal opening on click)
   - Escape-key + backdrop-click to close overlay
   - `embed-resize` postMessage protocol for the inline full mode
   - `__DUM_EMBED_LOADED__` deduplication
   - Sandbox + allow attributes on the iframe
4. Remove the now-redundant separate `[data-dum-embed-launcher]`
   element. The circular bubble IS the launcher.
5. Greeting copy is dropped from the host-site bubble surface (no
   room in a 140px circle). Greeting copy still lives in the
   dashboard config and continues to be returned by the API.
6. Optional Phase 2 (only if low-risk): draggable positioning with
   `localStorage["dum-embed-position:<businessId>"]` and viewport
   clamping. Skip if it materially increases risk.
7. Run `npm run build` from `frontend/`. Run
   `npm run check:human-copy` from repo root.

---

## WHAT NOT TO DO

- Do NOT change `IVSStageViewer`, `LiveChatIVS`, `PopInSeller`,
  or any React component in `frontend/components/`.
- Do NOT change `frontend/app/embed/[businessId]/page.tsx`.
- Do NOT touch any backend route, Stripe code, Privy code, or
  WebSocket wiring.
- Do NOT stream IVS into the host-page bubble (deferred — see
  AUDIT_REPORT for the architectural reasons).
- Do NOT add new dependencies.
- Do NOT change `EmbedDisplayModeCard` or `PopInSettings` — the
  dashboard mode pickers stay as they are; only the visual shape
  of `bubble` mode on the host page changes.

---

## FILES TO TOUCH

- `frontend/public/embed.js` — bubble branch (lines ~312-878)
- `.claude/tasks/circular-poster-bubble.md` — this file

---

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
