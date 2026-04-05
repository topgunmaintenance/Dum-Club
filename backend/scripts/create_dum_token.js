#!/usr/bin/env node
/**
 * DUM Token — Create the global DUM SPL token on Solana.
 *
 * Usage:
 *   DUM_TREASURY_KEYPAIR=<base58-secret-key> node scripts/create_dum_token.js create
 *   DUM_TREASURY_KEYPAIR=<base58-secret-key> DUM_MINT=<mint-address> node scripts/create_dum_token.js mint-to <wallet> <amount>
 *
 * Commands:
 *   create     — Create the DUM SPL token mint (run once)
 *   mint-to    — Mint DUM tokens to a user's wallet
 *
 * Environment:
 *   DUM_TREASURY_KEYPAIR  — Base58 secret key of the treasury (mint authority)
 *   DUM_MINT              — Mint address (required for mint-to, output of create)
 *   SOLANA_RPC_URL        — RPC endpoint (default: devnet)
 */

const { Connection, Keypair, PublicKey, clusterApiUrl } = require("@solana/web3.js");
const { createMint, getOrCreateAssociatedTokenAccount, mintTo } = require("@solana/spl-token");
const bs58Module = require("bs58");
const bs58 = bs58Module.default || bs58Module;

const RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
const DECIMALS = 9; // Standard Solana token decimals

// IMPORTANT: DUM_TREASURY_KEYPAIR must be a BASE58-encoded secret string.
// Railway env var must NOT be a JSON array like [118,103,...].
// To convert: use base58.encode(Uint8Array.from(jsonArray))

function loadKeypair() {
  const secret = process.env.DUM_TREASURY_KEYPAIR;
  if (!secret) {
    console.error("ERROR: DUM_TREASURY_KEYPAIR env var required (base58 secret key)");
    process.exit(1);
  }
  const trimmed = secret.trim();
  if (trimmed.startsWith("[")) {
    console.error("ERROR: DUM_TREASURY_KEYPAIR is JSON-array formatted; expected base58 secret string.");
    console.error("Convert with: base58.encode(Uint8Array.from(JSON.parse(key)))");
    process.exit(1);
  }
  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length !== 64) {
      console.error(`ERROR: DUM_TREASURY_KEYPAIR decoded to ${decoded.length} bytes; expected 64`);
      process.exit(1);
    }
    return Keypair.fromSecretKey(decoded);
  } catch (err) {
    console.error(`ERROR: DUM_TREASURY_KEYPAIR is not valid base58: ${err.message}`);
    process.exit(1);
  }
}

async function createDumToken() {
  const connection = new Connection(RPC_URL, "confirmed");
  const treasury = loadKeypair();

  console.log("Creating DUM SPL token...");
  console.log(`  RPC: ${RPC_URL}`);
  console.log(`  Treasury: ${treasury.publicKey.toBase58()}`);
  console.log(`  Decimals: ${DECIMALS}`);

  const mint = await createMint(
    connection,
    treasury,        // payer
    treasury.publicKey, // mint authority
    treasury.publicKey, // freeze authority (can be null)
    DECIMALS
  );

  console.log("\n✓ DUM Token created!");
  console.log(`  Mint address: ${mint.toBase58()}`);
  console.log(`\nSet this in your environment:`);
  console.log(`  DUM_MINT=${mint.toBase58()}`);

  return mint.toBase58();
}

async function mintTokens(walletAddress, amount) {
  const mintAddress = process.env.DUM_MINT;
  if (!mintAddress) {
    console.error("ERROR: DUM_MINT env var required");
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const treasury = loadKeypair();
  const mint = new PublicKey(mintAddress);
  const destination = new PublicKey(walletAddress);

  // Get or create the user's Associated Token Account
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    treasury,     // payer
    mint,         // token mint
    destination   // owner
  );

  // Mint tokens (amount is in raw units with decimals)
  const rawAmount = BigInt(amount) * BigInt(10 ** DECIMALS);
  const txSignature = await mintTo(
    connection,
    treasury,           // payer
    mint,               // token mint
    ata.address,        // destination ATA
    treasury.publicKey, // mint authority
    rawAmount
  );

  // Output JSON for backend parsing
  const result = {
    signature: txSignature,
    ata: ata.address.toBase58(),
    mint: mintAddress,
    recipient: walletAddress,
    amount: Number(amount),
  };
  console.log(JSON.stringify(result));
  return result;
}

// ── CLI ──
const [command, ...args] = process.argv.slice(2);

(async () => {
  try {
    if (command === "create") {
      await createDumToken();
    } else if (command === "mint-to") {
      const [wallet, amount] = args;
      if (!wallet || !amount) {
        console.error("Usage: node create_dum_token.js mint-to <wallet> <amount>");
        process.exit(1);
      }
      await mintTokens(wallet, parseInt(amount));
    } else {
      console.log("DUM Token CLI");
      console.log("  create              — Create DUM SPL token mint");
      console.log("  mint-to <w> <amt>   — Mint DUM to a wallet");
    }
  } catch (err) {
    console.error("Error:", err.message || err);
    process.exit(1);
  }
})();
