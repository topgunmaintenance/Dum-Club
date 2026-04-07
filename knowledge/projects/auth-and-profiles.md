# Auth & Profiles

## Auth flow

1. User clicks "Sign In" or triggers auth-required action
2. Privy modal opens → Google sign-in
3. Privy creates embedded Solana wallet automatically
4. Frontend calls POST /api/auth/sync with privy_id, email, wallet
5. Backend upserts user in users table
6. Auth context stores: privyId, email, walletAddress, isAdmin

## Key files

- Frontend: frontend/lib/auth/AuthContext.tsx
- Backend: backend/auth/privy.py
- Backend: backend/api/routes/auth.py (sync endpoint)

## Privy integration

- PRIVY_APP_ID required on both frontend and backend
- Frontend: @privy-io/react-auth + @privy-io/react-auth/solana
- Backend: JWT verification via Privy JWKS endpoint
- Token passed as Bearer in Authorization header

## Business profiles

- business_profiles table: business_name, category, verification_status
- Linked to projects via owner_privy_id
- Verification: unverified → pending → verified (manual review)
- Verified badge shown on project pages
