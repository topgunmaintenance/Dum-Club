# NEXT_TASK.md — Immediate Next Action
# Updated: April 2026

## Right Now

Execute these 5 tasks in order.
Do not proceed to Phase 1 until task 5 is confirmed.

---

### TASK 1 — Remove DUM Points from navbar
File: frontend/components/Navbar.tsx
Action: Remove "DUM Points" / "DUM Hub" link from both
        mobile hamburger menu and desktop nav bar
Note: /hub page still exists and works at direct URL
      Do not delete the page — just remove the nav link
Commit: "fix: remove DUM Points from navbar — Phase 2 only"

---

### TASK 2 — Bump FOUNDING_CAP to 100
File: backend/api/routes/merchant.py
Action: FOUNDING_CAP = 100
Also update:
- Any hardcoded "50" or "59" in frontend copy
- All 4 email templates in backend/services/email.py
- Founding 100 banner on merchant signup page
- Any API responses that return the founding cap number
Commit: "fix: bump FOUNDING_CAP to 100 everywhere"

---

### TASK 3 — Build Topgun Maintenance storefront
Full spec: CLAUDE.md Section 7
Services, photos, bio, contact, verified status
Pinned first on /discover
Discover page stat: 1 verified merchant (not 0)
Commit: "feat: Topgun Maintenance founding merchant — Phase 0B"

---

### TASK 4 — Update homepage comparison table
Remove competitors: Base44, Lovable, Venice.ai, Angi, Thumbtack
Add competitors:
  - Whatnot: 8% commission + 2.9% + $0.30 per sale
  - Commonsold: % per sale + monthly fees
  - Google Maps: free listing, pay $500-$2,000/mo to rank
  - DUM Club ★: Flat $29-$99/month, 0% per sale, ever
Commit: "fix: homepage comparison — Whatnot/Commonsold/Google vs DUM Club"

---

### TASK 5 — Confirm 1 real paid Stripe transaction
This is not a code task — this is Julian's task
Send /project/topgun-maintenance link to 20 real contacts
One real payment = Phase 0B complete = Phase 1 unlocks
Report back when confirmed

---

## After Task 5 — Begin Phase 1
See CURRENT_SPRINT.md Phase 1 task list
First Phase 1 task: Whatnot scraping agent
