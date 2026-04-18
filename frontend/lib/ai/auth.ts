import { jwtVerify, createRemoteJWKSet } from "jose";

const PRIVY_APP_ID =
  process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.PRIVY_APP_ID || "";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    if (!PRIVY_APP_ID) throw new Error("PRIVY_APP_ID not configured");
    jwks = createRemoteJWKSet(
      new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/jwks.json`)
    );
  }
  return jwks;
}

export async function verifyPrivyToken(
  token: string
): Promise<{ sub: string }> {
  const { payload } = await jwtVerify(token, getJWKS(), {
    issuer: "privy.io",
    audience: PRIVY_APP_ID,
  });
  if (!payload.sub) throw new Error("Missing sub claim");
  return { sub: payload.sub as string };
}

export function extractBearerToken(
  authHeader: string | null
): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}
