/**
 * Solana wallet checkout helpers.
 *
 * Two HTTP calls (`getSolQuote`, `confirmSolPayment`) plus one
 * orchestration helper (`payOfferWithSol`) that strings them
 * together with the on-chain transfer in between.
 *
 * The buy flow is:
 *   1. POST /api/checkout/sol-quote     — locks lamports for 90s
 *   2. SystemProgram.transfer to treasury, signed by the buyer
 *   3. wait for "confirmed" commitment
 *   4. POST /api/checkout/sol-confirm   — backend re-verifies on-chain,
 *                                         creates paid order, runs the
 *                                         same side-effects as Stripe
 *
 * Wallet abstraction: both Privy embedded Solana wallets
 * (`useSolanaWallets`) and the `@solana/wallet-adapter-react`
 * `useWallet()` adapters (Phantom / Solflare) expose the same
 * `sendTransaction(tx, connection)` signature, so we collapse
 * them into a single `SolPayWallet` shape and let the caller
 * pick which one to hand in.
 *
 * Stripe flow is NOT touched by this module.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { API_BASE } from "./apiBase";

// ── Feature flag ────────────────────────────────────────────────
//
// Off by default. Backend doesn't gate on it — quote/confirm
// endpoints are always live; the UI is what's flagged off.
export const SOL_CHECKOUT_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_SOL_CHECKOUT === "true";

// ── Wire shapes ─────────────────────────────────────────────────

export type SolQuote = {
  quote_id: string;
  sol_amount: number;
  lamports: number;
  usd_amount: number;
  treasury: string;
  expires_at: number;
};

export type SolConfirmResponse = {
  order_id: string;
  status: "paid";
  tx_signature: string;
  sol_amount: number;
  lamports: number;
  usd_amount: number;
};

export class SolCheckoutError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
    // Restore prototype chain so `instanceof SolCheckoutError`
    // works after the TypeScript→JS class-extension downgrade.
    Object.setPrototypeOf(this, SolCheckoutError.prototype);
  }
}

// ── Wallet shim ─────────────────────────────────────────────────
//
// Common interface that both wallet sources implement. We only
// need (address, sendTransaction) for the SOL transfer — Privy's
// embedded wallet and the wallet-adapter API agree on the
// `sendTransaction(tx, connection)` signature.

export type SolPayWallet = {
  kind: "privy" | "adapter";
  address: string;
  sendTransaction: (
    tx: Transaction,
    connection: Connection,
  ) => Promise<string>;
};

type PrivyWalletLike = {
  address: string;
  sendTransaction?: unknown;
};

type AdapterWalletLike = {
  publicKey: { toBase58: () => string } | null;
  sendTransaction?: unknown;
};

/**
 * Pick the best available Solana wallet for the buyer.
 *
 * Preference order:
 *   1. Privy embedded wallet (auto-provisioned for every signed-in
 *      Privy user — no extra step for the buyer).
 *   2. External wallet adapter (Phantom / Solflare via
 *      @solana/wallet-adapter-react).
 *
 * Returns null if neither has a usable wallet — caller is expected
 * to surface a helpful "no wallet" message in that case.
 */
export function pickSolPayWallet(
  privyWallets: ReadonlyArray<PrivyWalletLike> | null | undefined,
  adapter: AdapterWalletLike | null | undefined,
): SolPayWallet | null {
  const privy = privyWallets?.[0];
  if (privy && typeof privy.sendTransaction === "function") {
    const send = privy.sendTransaction as SolPayWallet["sendTransaction"];
    return {
      kind: "privy",
      address: privy.address,
      // Bind so internal `this` references stay valid when we call
      // through the abstraction.
      sendTransaction: (tx, connection) =>
        (send as Function).call(privy, tx, connection),
    };
  }
  if (
    adapter?.publicKey &&
    typeof adapter.sendTransaction === "function"
  ) {
    const send = adapter.sendTransaction as SolPayWallet["sendTransaction"];
    return {
      kind: "adapter",
      address: adapter.publicKey.toBase58(),
      sendTransaction: (tx, connection) =>
        (send as Function).call(adapter, tx, connection),
    };
  }
  return null;
}

// ── HTTP: quote + confirm ───────────────────────────────────────

export async function getSolQuote(args: {
  offerId: string;
  authToken: string;
  auctionId?: string;
  overridePrice?: number;
}): Promise<SolQuote> {
  const res = await fetch(`${API_BASE}/api/checkout/sol-quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.authToken}`,
    },
    body: JSON.stringify({
      offer_id: args.offerId,
      ...(args.auctionId ? { auction_id: args.auctionId } : {}),
      ...(args.overridePrice != null
        ? { override_price: args.overridePrice }
        : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const msg =
      typeof detail.detail === "string"
        ? detail.detail
        : `Quote failed (HTTP ${res.status})`;
    throw new SolCheckoutError(msg, res.status);
  }
  return res.json();
}

export async function confirmSolPayment(args: {
  offerId: string;
  quoteId: string;
  txSignature: string;
  walletAddress: string;
  source: string;
  auctionId?: string;
  authToken: string;
}): Promise<SolConfirmResponse> {
  const res = await fetch(`${API_BASE}/api/checkout/sol-confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.authToken}`,
    },
    body: JSON.stringify({
      offer_id: args.offerId,
      quote_id: args.quoteId,
      tx_signature: args.txSignature,
      wallet_address: args.walletAddress,
      source: args.source,
      ...(args.auctionId ? { auction_id: args.auctionId } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const msg =
      typeof detail.detail === "string"
        ? detail.detail
        : `Confirm failed (HTTP ${res.status})`;
    throw new SolCheckoutError(msg, res.status);
  }
  return res.json();
}

// ── Orchestrator ────────────────────────────────────────────────

export type PayOfferStep =
  | "quoting"
  | "building"
  | "signing"
  | "confirming"
  | "verifying"
  | "done";

export async function payOfferWithSol(args: {
  offerId: string;
  source: string;
  auctionId?: string;
  overridePrice?: number;
  wallet: SolPayWallet;
  authToken: string;
  rpcUrl: string;
  onStep?: (step: PayOfferStep) => void;
}): Promise<SolConfirmResponse> {
  const step = (s: PayOfferStep) => args.onStep?.(s);

  // 1. Quote.
  step("quoting");
  const quote = await getSolQuote({
    offerId: args.offerId,
    authToken: args.authToken,
    auctionId: args.auctionId,
    overridePrice: args.overridePrice,
  });

  // 2. Build the transfer.
  step("building");
  const connection = new Connection(args.rpcUrl, "confirmed");
  const fromPubkey = new PublicKey(args.wallet.address);
  const toPubkey = new PublicKey(quote.treasury);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    feePayer: fromPubkey,
    blockhash,
    lastValidBlockHeight,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: quote.lamports,
    }),
  );

  // 3. Sign + send via the buyer's wallet.
  step("signing");
  let signature: string;
  try {
    signature = await args.wallet.sendTransaction(tx, connection);
  } catch (err: unknown) {
    const msg =
      err instanceof Error ? err.message : "Wallet declined the transaction";
    throw new SolCheckoutError(msg, 0);
  }

  // 4. Wait for "confirmed" commitment so the backend's RPC
  //    lookup will see the tx. Without this, sol-confirm can race
  //    the buyer's RPC and return "Transaction not found".
  step("confirming");
  try {
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : "Transaction did not confirm. Try again.";
    throw new SolCheckoutError(msg, 0);
  }

  // 5. Backend re-verifies the on-chain transfer, then creates
  //    the paid order and runs the same side-effects as Stripe.
  step("verifying");
  const result = await confirmSolPayment({
    offerId: args.offerId,
    quoteId: quote.quote_id,
    txSignature: signature,
    walletAddress: args.wallet.address,
    source: args.source,
    auctionId: args.auctionId,
    authToken: args.authToken,
  });
  step("done");
  return result;
}
