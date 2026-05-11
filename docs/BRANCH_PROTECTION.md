# Branch Protection — `main`

This document defines the required protection ruleset for the `main` branch of `topgunmaintenance/Dum-Club`. These rules must be enabled manually in **Settings → Branches** (or via Repository Rulesets) by a repository administrator.

## Required Rules

1. **Require a pull request before merging**
2.    - Required approvals: **1**
      -    - Dismiss stale pull request approvals when new commits are pushed: **Yes**
           -    - Require review from Code Owners (if `CODEOWNERS` is added): **Recommended**
            
                - 2. **Require status checks to pass before merging**
                  3.    - Require branches to be up to date before merging: **Yes**
                        -    - Required checks: Vercel Preview deployment, plus any CI workflows (lint, type-check, tests) once added
                         
                             - 3. **Require conversation resolution before merging**
                               4.    - All review comments must be resolved before merge
                                 
                                     - 4. **Block force pushes**
                                       5.    - No `git push --force` allowed to `main`
                                         
                                             - 5. **Block branch deletion**
                                               6.    - `main` cannot be deleted
                                                 
                                                     - 6. **Apply to administrators**
                                                       7.    - Include repository admins in the rules (no bypass)
                                                         
                                                             - ## Why
                                                         
                                                             - With production deployments running on Vercel + Railway and live Stripe Connect payouts in flight, `main` is effectively the production source of truth. Branch protection prevents accidental force-pushes, untested merges, and unreviewed direct commits from reaching production.
                                                         
                                                             - ## How to Enable
                                                         
                                                             - 1. Go to **Settings → Branches** (or **Settings → Rules → Rulesets**).
                                                               2. 2. Click **Add branch ruleset** (preferred) or **Add classic branch protection rule**.
                                                                  3. 3. Target branch: `main`.
                                                                     4. 4. Enable each rule listed above.
                                                                        5. 5. Save.
                                                                          
                                                                           6. No automation performs this step — it is intentionally a manual administrative action.
                                                                           7. 
