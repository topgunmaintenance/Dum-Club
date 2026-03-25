"use client";

import { useState } from "react";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function VaultPage() {
  const { wallets } = useSolanaWallets();
  const wallet = wallets[0];
  const address = wallet?.address;
  const connection = new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com"
  );

  const [creatorWallet, setCreatorWallet] = useState("");
  const [amount, setAmount]               = useState("0.1");
  const [status, setStatus]               = useState<"idle" | "sending" | "done" | "error">("idle");
  const [txSig, setTxSig]                 = useState("");

  async function handleVault() {
    if (!wallet || !address) return alert("Connect your wallet first");
    setStatus("sending");

    try {
      const creator = new PublicKey(creatorWallet);
      const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

      const fromPubkey = new PublicKey(address);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey:   creator,
          lamports,
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = fromPubkey;

      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      // Record in backend
      await fetch(`${API}/api/vault/record`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supporter_wallet: address,
          creator_wallet:   creatorWallet,
          amount_sol:       parseFloat(amount),
          tx_signature:     sig,
        }),
      });

      setTxSig(sig);
      setStatus("done");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  return (
    <div className="max-w-lg mx-auto mt-12">
      <h1 className="text-3xl font-bold mb-2">Vault SOL</h1>
      <p className="text-zinc-400 mb-8">Support a creator by vaulting SOL. You can withdraw anytime.</p>

      <div className="bg-zinc-900 rounded-2xl p-6 space-y-4 border border-zinc-800">
        <div>
          <label className="text-sm text-zinc-400 block mb-1">Creator wallet address</label>
          <input
            className="w-full bg-zinc-800 rounded-lg px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Creator's Solana address"
            value={creatorWallet}
            onChange={e => setCreatorWallet(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm text-zinc-400 block mb-1">Amount (SOL)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="w-full bg-zinc-800 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </div>

        <button
          onClick={handleVault}
          disabled={status === "sending" || !wallet || !address}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 transition rounded-xl py-3 font-semibold text-sm"
        >
          {status === "sending" ? "Sending…" : "Vault SOL →"}
        </button>

        {status === "done" && (
          <div className="text-green-400 text-sm break-all">
            ✅ Vaulted! Tx: <a
              href={`https://solscan.io/tx/${txSig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >{txSig.slice(0, 20)}…</a>
          </div>
        )}
        {status === "error" && <p className="text-red-400 text-sm">Transaction failed. Check the console.</p>}
      </div>
    </div>
  );
}
