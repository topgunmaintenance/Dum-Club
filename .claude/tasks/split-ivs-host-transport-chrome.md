TASK: split-ivs-host-transport-chrome

Split IVSStageHost into a headless publish-transport child and the
visible host chrome, so the owner's "view as customer" preview shows
ZERO admin chrome WITHOUT unmounting the publisher (which would end the
live broadcast).

Trigger: runs as its own task AFTER PR #414 merges. Do not start before.

Problem:
components/IVSStageHost.tsx is a combined transport + chrome component.
It both (a) drives the publish lifecycle — stage create/join/publish,
heartbeat, end-stage — and (b) renders host-facing UI: "Go Live" /
"Start camera", "End Stream", "Try Again", and the trial-suspended
notice. On the storefront it is gated on bare `isOwner`
(app/project/[id]/page.tsx, the IVSStageHost block ~5239:
`isOwner && IVS_REALTIME_ENABLED && (!project?.is_live || isIVSSession(project))`).

It is deliberately NOT gated on `showOwnerInlineUi` because gating it
there would unmount the component the instant the owner toggles "view
as customer" — and unmounting the publisher tears down the stage
connection and ENDS the live broadcast. The cost of leaving it on
`isOwner`: in customer-preview the owner still sees the host panel — a
preview-fidelity leak (NOT a security leak; non-owners never reach it,
and server-side owner enforcement on pin/offer endpoints is independent
— see offers.py _verify_project_owner and projects.py pin_offer).

Goal:
Exact preview fidelity (owner in view-as-customer sees what a customer
sees) without dropping the broadcast on the preview toggle.

Proposed approach (frontend only):
1. Extract a headless transport child from IVSStageHost — e.g.
   IVSHostTransport: owns the stage create/join/publish, the heartbeat
   poll, and end-stage. Renders NO visible DOM (or a 0-size element).
   Mounted on bare `isOwner` (same condition that protects the stream
   today) so it persists across the view-as-customer toggle and the
   broadcast never drops.
2. Keep the visible chrome (Go Live / Start camera / End Stream / Try
   Again / trial-suspended notice / preview <video>) in IVSStageHost
   (or a renamed IVSStageHostChrome), gated on `showOwnerInlineUi` so it
   disappears under preview.
3. The two communicate via the existing callback props (onLive, onEnd,
   onError) and a shared handle/ref or a small context so chrome buttons
   drive the transport. The publish MediaStream and stage instance must
   live in the transport (the part that stays mounted), not the chrome.
4. autoStart / ?golive=1 deep-link: the autoStart path must target the
   transport so going live still works; the scroll-to-anchor stays with
   the chrome.

Risks / must-verify:
- The live broadcast MUST NOT drop when toggling view-as-customer
  (the whole reason for the split). Test: go live, toggle preview both
  ways, confirm the stream stays up and viewers keep seeing video.
- Camera/mic getUserMedia and the published tracks live in the
  transport; ensure they aren't re-acquired or torn down when the
  chrome mounts/unmounts.
- Do not change the viewer path (IVSStageViewer) or the audio bus.
- No backend, IVS infra, DB, or env changes. Frontend only.

Out of scope:
- Any server-side change. Owner enforcement already exists server-side.
- The audio-bus and chat-gate work (shipped in #414).

Do not modify any code outside the named files for this task
(components/IVSStageHost.tsx, a new transport component, and the
IVSStageHost render site in app/project/[id]/page.tsx). If more files
are needed, stop and ask first.
