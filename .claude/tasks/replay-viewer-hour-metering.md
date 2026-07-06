# Task: replay-viewer-hour-metering

## Goal
Replay watch time meters against the merchant's viewer-hour budget
exactly like live watch time (founder decision 2026-07-06). This is
what makes always-on replays revenue-positive: VOD delivery costs
cents per viewer-hour while overage bills at $0.08-$0.13.

## Depends on
replay-storefront-loop (the replay player must exist).

## Scope
1. Replay player emits the same viewer-hour heartbeats the live
   player emits, tagged `source=replay` so usage rows distinguish
   replay hours from live hours.
2. Metering/billing reads both sources into the same monthly
   viewer-hour total: included budget, overage rate, concurrent
   ceiling, and the no-double-bill rule (§3) all apply unchanged.
3. Host usage meter (the dashboard viewer-hour meter) shows the
   combined total, with a small live/replay split so merchants
   understand the bill.
4. Tests: metering math with mixed live+replay hours, and the
   no-double-bill netting over the combined total.

## WHAT NOT TO DO
- No new rates, no plan_limits changes — same meter, same rates.
- Do not bill replay hours retroactively for periods before this
  ships.
- Do not surface replay viewer counts publicly (metering is
  internal; public live-style counts on replays are banned by the
  replay honesty rules).

Do not modify any code outside the named files for this task.
If more files are needed, stop and ask first.
