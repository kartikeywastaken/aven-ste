import dotenv from "dotenv";
import {
  Contract,
  Keypair,
  StrKey,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { Client as StreamClient } from "../contracts/bindings/stream/dist/index.js";
import { Client as AttestationClient } from "../contracts/bindings/attestation/dist/index.js";
import { Client as ReputationClient } from "../contracts/bindings/reputation/dist/index.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

const vercelOnly = process.argv.includes("--vercel-only");
if (vercelOnly && process.env.VERCEL !== "1") {
  console.log("Deployment preflight skipped outside Vercel. Run `npm run verify:deployment` explicitly.");
  process.exit(0);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for deployment verification.`);
  return value;
}

function dataNamespace() {
  const value = required("AVEN_DATA_NAMESPACE");
  if (value === process.env.AVEN_VERIFIER_SECRET?.trim()) {
    throw new Error(
      "AVEN_DATA_NAMESPACE must not contain AVEN_VERIFIER_SECRET. Use a stable non-secret label.",
    );
  }
  if (/^S[A-Z2-7]{55}$/.test(value)) {
    throw new Error("AVEN_DATA_NAMESPACE must not be a Stellar secret seed.");
  }
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/.test(value)) {
    throw new Error(
      "AVEN_DATA_NAMESPACE must be 3-64 lowercase letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return value;
}

function contractId(name) {
  const value = required(name);
  if (!StrKey.isValidContract(value)) {
    throw new Error(`${name} is not a valid Stellar contract address.`);
  }
  return value;
}

function unwrap(value) {
  return value?.unwrap?.() ?? value;
}

async function readInstanceStorage(server, id) {
  const response = await server.getLedgerEntries(new Contract(id).getFootprint());
  const entry = response.entries[0];
  if (!entry) throw new Error(`Contract instance ${id} was not found.`);
  const storage = entry.val.contractData().val().instance().storage() ?? [];
  return new Map(
    storage.map((item) => {
      const key = scValToNative(item.key());
      const name = Array.isArray(key) ? key[0] : key;
      return [String(name), scValToNative(item.val())];
    }),
  );
}

async function main() {
  const persistenceNamespace = dataNamespace();
  const rpcUrl = required("NEXT_PUBLIC_SOROBAN_RPC_URL");
  const networkPassphrase = required("NEXT_PUBLIC_NETWORK_PASSPHRASE");
  const streamId = contractId("NEXT_PUBLIC_STREAM_CONTRACT_ID");
  const attestationId = contractId("NEXT_PUBLIC_ATTESTATION_CONTRACT_ID");
  const reputationId = contractId("NEXT_PUBLIC_REPUTATION_CONTRACT_ID");
  const xlmAssetId = contractId("NEXT_PUBLIC_XLM_ASSET_ID");
  const verifier = Keypair.fromSecret(required("AVEN_VERIFIER_SECRET")).publicKey();
  const publicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const options = { rpcUrl, networkPassphrase, publicKey };

  const stream = new StreamClient({ ...options, contractId: streamId });
  const attestation = new AttestationClient({ ...options, contractId: attestationId });
  const reputation = new ReputationClient({ ...options, contractId: reputationId });
  const server = new rpc.Server(rpcUrl);

  const [
    configuredVerifierTx,
    streamAdminTx,
    xlmAllowedTx,
    attestationAdminTx,
    reputationAdminTx,
    streamStorage,
    attestationStorage,
    reputationStorage,
  ] =
    await Promise.all([
      stream.get_verifier(),
      stream.get_admin(),
      stream.is_allowed_asset({ asset: xlmAssetId }),
      attestation.get_admin(),
      reputation.get_admin(),
      readInstanceStorage(server, streamId),
      readInstanceStorage(server, attestationId),
      readInstanceStorage(server, reputationId),
    ]);

  const configuredVerifier = unwrap(configuredVerifierTx.result);
  if (!configuredVerifier) {
    throw new Error("The stream contract has no verifier configured.");
  }
  if (configuredVerifier.toUpperCase() !== verifier.toUpperCase()) {
    throw new Error(
      `AVEN_VERIFIER_SECRET resolves to ${verifier}, but the stream contract expects ${configuredVerifier}.`,
    );
  }
  if (xlmAllowedTx.result !== true) {
    throw new Error("The configured native XLM asset is not allowlisted by the stream contract.");
  }

  const admins = [
    ["stream", unwrap(streamAdminTx.result)],
    ["attestation", unwrap(attestationAdminTx.result)],
    ["reputation", unwrap(reputationAdminTx.result)],
  ];
  for (const [name, value] of admins) {
    if (!StrKey.isValidEd25519PublicKey(value)) {
      throw new Error(`The ${name} contract did not return a valid initialized admin.`);
    }
  }

  const links = [
    ["stream contract's attestation", streamStorage.get("AttestationContract"), attestationId],
    ["attestation contract's stream", attestationStorage.get("StreamContract"), streamId],
    ["reputation contract's attestation", reputationStorage.get("AttestationContract"), attestationId],
  ];
  for (const [name, actual, expected] of links) {
    if (
      typeof actual !== "string" ||
      actual.toUpperCase() !== expected.toUpperCase()
    ) {
      throw new Error(`${name} link is ${String(actual)}, expected ${expected}.`);
    }
  }

  console.log(`Deployment verified on ${process.env.NEXT_PUBLIC_NETWORK_LABEL ?? "configured network"}.`);
  console.log(`Data namespace: ${persistenceNamespace}`);
  console.log(`Stream:      ${streamId}`);
  console.log(`Attestation: ${attestationId}`);
  console.log(`Reputation:  ${reputationId}`);
  console.log(`Verifier:    ${configuredVerifier}`);
  console.log("Native XLM is allowlisted.");
  console.log("Cross-contract links match.");
}

main().catch((error) => {
  console.error(`Deployment verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
