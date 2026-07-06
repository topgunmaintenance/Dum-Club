# Task: hero-demo-button

## Goal
Make the homepage demo findable from the hero. Turn the small
"See how it works ↓" text link into a real button that sits next
to "List your business", jumping to the #demo section.

## Why
Founder couldn't find the demo visually (2026-07-06): it lives
~5 screens down and the only pointers are two small text links.
The example tiles now link to #demo (feature/demo-tiles-to-demo);
the hero should too, with real visual weight.

## Scope
- The homepage hero only (the component that renders "Your local
  shops, selling live." + "List your business").
- Style the demo button as a secondary button (outline or muted
  surface) so "List your business" (mint fill) stays the primary
  action. Label: "Watch the demo" or "See it in action" — pick
  one, keep it short, no banned words.
- Smooth-scroll to #demo (same anchor the current text link uses).

## WHAT NOT TO DO
- Do not move or restyle the demo section itself.
- Do not touch the example-shop rail, businesses grid, or pitch.
- Do not add a second primary (mint-fill) button to the hero.
- Do not remove the "List your business" button.

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
