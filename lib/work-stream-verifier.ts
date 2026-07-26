import "server-only";

import { createHash } from "node:crypto";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { Client as StreamClient } from "../contracts/bindings/stream/src/index";
import {
  NETWORK_PASSPHRASE,
  SOROBAN_RPC_URL,
  STREAM_CONTRACT_ID,
} from "./contracts";
import type { WorkSessionReport } from "./work-session";
import {
  assertWorkVerifierMatches,
  isLegacyVerifierGetterMissing,
  isVerifierNotConfigured,
  WorkVerifierConfigurationError,
} from "./work-stream-verifier-config";

function unwrap<T>(value: unknown): T {
  return ((value as { unwrap?: () => T })?.unwrap?.() ?? value) as T;
}

function confirmedTransactionHash(sent: any): string {
  const value =
    sent?.sendTransactionResponse?.hash ??
    sent?.getTransactionResponse?.txHash ??
    sent?.hash;
  if (typeof value === "string" && /^[a-f\d]{64}$/i.test(value)) return value.toLowerCase();
  if (value instanceof Uint8Array && value.byteLength === 32) {
    return Buffer.from(value).toString("hex");
  }
  throw new Error("The verifier transaction was confirmed without a readable transaction hash.");
}

function reportDigest(report: WorkSessionReport) {
  return createHash("sha256").update(JSON.stringify(report)).digest();
}

async function verifierClient() {
  const secret = process.env.AVEN_VERIFIER_SECRET?.trim();
  if (!secret) throw new Error("AVEN_VERIFIER_SECRET is not configured on the server.");
  if (!STREAM_CONTRACT_ID) {
    throw new Error("NEXT_PUBLIC_STREAM_CONTRACT_ID is not configured.");
  }

  const keypair = Keypair.fromSecret(secret);
  const client = new StreamClient({
    contractId: STREAM_CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: SOROBAN_RPC_URL,
    publicKey: keypair.publicKey(),
    signTransaction: async (xdr: string) => {
      const transaction = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
      transaction.sign(keypair);
      return { signedTxXdr: transaction.toXDR(), signerAddress: keypair.publicKey() };
    },
  });
  try {
    const configured = await client.get_verifier();
    assertWorkVerifierMatches(keypair.publicKey(), configured.result);
  } catch (error) {
    if (!isLegacyVerifierGetterMissing(error)) throw error;
    // Legacy testnet contracts still enforce the configured verifier through
    // require_auth() in verify_work. A mismatched server key therefore fails
    // during simulation instead of being able to reserve any escrow.
  }
  return client;
}

export async function recordVerifiedWork(input: {
  streamId: string;
  sessionId: string;
  amountUnits: bigint;
  report: WorkSessionReport;
  onchainActiveSeconds?: bigint | number;
  workStartLedger?: number;
}) {
  const client = await verifierClient();
  const digest = reportDigest(input.report);

  try {
    const transaction = await client.verify_work({
      stream_id: BigInt(input.streamId),
      request_id: input.sessionId,
      amount: input.amountUnits,
      evidence_hash: digest,
      active_duration_seconds: BigInt(
        input.onchainActiveSeconds ?? input.report.session.activeSeconds ?? 0,
      ),
      work_start_ledger: input.workStartLedger ?? 0,
    });
    const sent = await transaction.signAndSend();
    const claimTx = await client.get_withdrawal({
      stream_id: BigInt(input.streamId),
      request_id: input.sessionId,
    });
    const claim = unwrap<any>(claimTx.result);

    return {
      transactionHash: confirmedTransactionHash(sent),
      reportDigest: digest.toString("hex"),
      reviewDeadlineLedger: Number(claim.deadline_ledger),
    };
  } catch (error) {
    if (isVerifierNotConfigured(error)) {
      throw new WorkVerifierConfigurationError(
        "Withdrawal service is unavailable because this stream contract was deployed without configuring its verifier.",
      );
    }
    throw error;
  }
}
