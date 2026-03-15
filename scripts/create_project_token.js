import {
  Connection,
  Keypair,
  clusterApiUrl
} from "@solana/web3.js";

import {
  createMint
} from "@solana/spl-token";

import fs from "fs";

async function main() {

  const rpc = "https://api.devnet.solana.com";
  const keyPath = "./keys/token-creator.json";

  const connection = new Connection(rpc);

  const secret = JSON.parse(fs.readFileSync(keyPath));
  const payer = Keypair.fromSecretKey(new Uint8Array(secret));

  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    9
  );

  console.log(JSON.stringify({
    success: true,
    mintAddress: mint.toBase58()
  }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
