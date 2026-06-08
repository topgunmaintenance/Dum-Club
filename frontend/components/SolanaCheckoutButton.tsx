"use client";

/**
 * SolanaCheckoutButton — lazy-loaded wallet-adapter mount.
 *
 * Mounted via next/dynamic({ ssr: false }) only when SOL_CHECKOUT_ENABLED
 * is true (defaults to false in prod), so the @solana/wallet-adapter-react
 * and @solana/wallet-adapter-react-ui packages — plus the Phantom/Solflare
 * adapters and the wallet-modal CSS — never enter the consumer page chunk
 * when the feature is off. Doctrine §8 / §12.3: no Solana code path is
 * ever exercised on consumer pages in prod.
 *
 * Render-prop API: the wrapper mounts WalletProviders (which provides the
 * ConnectionProvider + WalletProvider + WalletModalProvider context for
 * @solana/wallet-adapter-react hooks), then an inner component calls
 * `useSolanaWallets()` from Privy + `useWallet()` from the wallet adapter
 * and surfaces the resolved values via the children render-prop. The
 * consumer page's existing SOL handler keeps its full body intact — it
 * just receives `wallets` and `adapterWallet` as arguments instead of
 * reading them from a closure over top-level hooks.
 *
 * Backwards-compat: when SOL_CHECKOUT_ENABLED is false, this component is
 * never rendered → next/dynamic never fetches the chunk → buyers receive
 * zero wallet-adapter bytes. When true (dev/preview only), the mount
 * fetches the chunk on first render and the existing SOL flow runs
 * identically to before.
 */

import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletProviders } from "./WalletProviders";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export type SolanaCheckoutApi = {
  /** Privy-managed Solana wallets — array of `{address, walletClientType}`-shaped entries. */
  wallets: ReturnType<typeof useSolanaWallets>["wallets"];
  /** @solana/wallet-adapter-react useWallet() return value. */
  adapterWallet: WalletContextState;
};

type Props = {
  /** Render-prop: receives the resolved wallet API and returns the
   *  consumer page's existing SOL CTA JSX (button + state-machine label).
   *  Click handlers should pass `api.wallets` + `api.adapterWallet` to
   *  the existing page-level SOL handler. */
  children: (api: SolanaCheckoutApi) => React.ReactNode;
};

function Inner({ children }: Props) {
  const { wallets } = useSolanaWallets();
  const adapterWallet = useWallet();
  return <>{children({ wallets, adapterWallet })}</>;
}

export function SolanaCheckoutButton({ children }: Props) {
  return (
    <WalletProviders>
      <Inner>{children}</Inner>
    </WalletProviders>
  );
}
