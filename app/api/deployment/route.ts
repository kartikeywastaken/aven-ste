import { NextResponse } from "next/server";
import {
  ATTESTATION_CONTRACT_ID,
  NETWORK_LABEL,
  NETWORK_PASSPHRASE,
  REPUTATION_CONTRACT_ID,
  STREAM_CONTRACT_ID,
  XLM_ASSET_ID,
} from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      streamContractId: STREAM_CONTRACT_ID,
      attestationContractId: ATTESTATION_CONTRACT_ID,
      reputationContractId: REPUTATION_CONTRACT_ID,
      xlmAssetId: XLM_ASSET_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      networkLabel: NETWORK_LABEL,
      revision:
        process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.VERCEL_DEPLOYMENT_ID ??
        "local",
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
