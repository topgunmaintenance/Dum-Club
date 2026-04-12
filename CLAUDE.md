━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SECTION 25 — UI DUPLICATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Scope:
  Applies to all owner-facing project pages and any
  future merchant dashboards derived from this layout.

Definition:
  Primary source = the most complete and actionable
  representation of a piece of information.
  Secondary source = any partial or repeated display
  of that same information elsewhere on the page.

Owner/merchant pages:
  Business Status card is the primary owner-facing
  source of truth for review, publication, and setup
  state. Do not render secondary banners, pills,
  headings, or descriptions that repeat information
  already visible in:
    - the Business Status card
    - the page hero
    - the About section

  Exception:
    Elements that include unique actions — buttons,
    inputs, or workflows — must NOT be removed even
    if they display overlapping information. Only
    purely informational duplicates are eliminated.

  Placement rule:
    The Business Status card must remain visible
    above the fold on both desktop and mobile in
    owner view. Do not move it below other sections.

  Approved branch:
    - show operational status only
    - preserve live / rewards / checkout controls
    - do not surface setup or review UI
      merchant is live, those states are resolved

  Unapproved branch:
    - show status cards
    - show next-step guidance
    - show action buttons only
    - do not repeat hero or about content

  Enforcement:
    - Before adding any owner-facing UI element check
      whether the same information already exists in
      any of the three sources above
    - If it does — do not add it
    - If a future audit finds duplication — remove the
      secondary instance and keep the primary source
    - Exception applies — never remove interactive
      elements during a duplication audit
    - TypeScript type-check must pass after any removal
    - Visually verify both approved and unapproved
      merchant page states after any change to this area

  Rule to lock in:
    Every UI element must earn its place — or get deleted.
