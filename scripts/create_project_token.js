import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

import fs from "fs";

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const keyPath = process.env.TOKEN_CREATOR_KEYPAIR || "./keys/token-creator.json";

function loadPayer() {
  const secret = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  return Keypair.fromSecretKey(new Uint8Array(secret));
}

async function createMintMode() {
  const connection = new Connection(rpc);
  const payer = loadPayer();

  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    9
  );

  console.log(
    JSON.stringify({
      success: true,
      mode: "create-mint",
      mintAddress: mint.toBase58(),
      mintAuthority: payer.publicKey.toBase58(),
      rpc,
    })
  );
}

async function mintSupplyMode() {
  const [
    ,
    ,
    mode,
    mintAddress,
    totalSupplyArg,
    decimalsArg,
    projectTreasuryWallet,
    projectAmountArg,
    dumTreasuryWallet,
    dumAmountArg,
  ] = process.argv;

  if (!mintAddress || !totalSupplyArg || !decimalsArg || !projectTreasuryWallet || !projectAmountArg || !dumTreasuryWallet || !dumAmountArg) {
    throw new Error(
      "mint-supply mode requires: mintAddress totalSupply decimals projectTreasuryWallet projectAmount dumTreasuryWallet dumAmount"
    );
  }

  const connection = new Connection(rpc);
  const payer = loadPayer();

  const mint = new PublicKey(mintAddress);
  const projectWallet = new PublicKey(projectTreasuryWallet);
  const dumWallet = new PublicKey(dumTreasuryWallet);

  const decimals = Number(decimalsArg);
  const projectAmount = Number(projectAmountArg);
  const dumAmount = Number(dumAmountArg);

  if (Number.isNaN(decimals) || Number.isNaN(projectAmount) || Number.isNaN(dumAmount)) {
    throw new Error("Invalid numeric arguments passed to mint-supply");
  }

  const multiplier = 10 ** decimals;
  const projectBaseUnits = BigInt(Math.round(projectAmount * multiplier));
  const dumBaseUnits = BigInt(Math.round(dumAmount * multiplier));

  const projectAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    projectWallet
  );

  const dumAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    dumWallet
  );

  const projectMintSig = await mintTo(
    connection,
    payer,
    mint,
    projectAta.address,
    payer,
    projectBaseUnits
  );

  const dumMintSig = await mintTo(
    connection,
    payer,
    mint,
    dumAta.address,
    payer,
    dumBaseUnits
  );

  console.log(
    JSON.stringify({
      success: true,
      mode: "mint-supply",
      mintAddress: mint.toBase58(),
      projectTreasuryWallet: projectWallet.toBase58(),
      projectTreasuryAta: projectAta.address.toBase58(),
      projectAmount,
      dumTreasuryWallet: dumWallet.toBase58(),
      dumTreasuryAta: dumAta.address.toBase58(),
      dumAmount,
      signatures: {
        projectMint: projectMintSig,
        dumMint: dumMintSig,
      },
      rpc,
    })
  );
}

async function main() {
  const mode = process.argv[2] || "create-mint";

  if (mode === "create-mint") {
    await createMintMode();
    return;
  }

  if (mode === "mint-supply") {
    await mintSupplyMode();
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
