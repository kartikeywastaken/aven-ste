import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import {
  getRepository,
  putRepository,
} from "@/lib/github-repository-store";
import { getRepositoryOwner } from "@/lib/github-service";
import { checkTransferEligibility } from "@/lib/github-transfer";
import { createOAuthState } from "@/lib/github-identity-store";
import { getGithubOAuthEnv } from "@/lib/github-env";
import { authenticateBrowserSession, addressesEqual, getOnchainStream } from "@/lib/work-session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ streamId: string }> };

/**
 * POST /api/streams/[streamId]/repository/transfer
 *
 * Starts the one-time GitHub user authorization required to transfer ownership.
 * Runs all preflight checks again internally — never trusts a prior preflight call.
 * Body: { destination: string }
 */
export async function POST(request: Request, context: Params) {
  const { streamId } = await context.params;
  try {
    const walletAddress = await authenticateBrowserSession(request);
    if (!walletAddress) return apiError("Authentication required.", 401);

    const body = await request.json().catch(() => null);
    const destination = typeof body?.destination === "string" ? body.destination.trim() : "";
    if (!destination) return apiError("destination is required.", 400);

    const eligibility = await checkTransferEligibility({ streamId, walletAddress, destination });
    if (!eligibility.eligible) return apiError(eligibility.reason, eligibility.status);
    const env = getGithubOAuthEnv();
    const returnTo = `/stream/${encodeURIComponent(streamId)}`;
    const state = await createOAuthState(walletAddress, returnTo, {
      type: "repository_transfer",
      streamId,
      destination,
    });
    const params = new URLSearchParams({
      client_id: env.oauthClientId,
      redirect_uri: env.oauthRedirectUri,
      state,
    });

    return NextResponse.json({
      authorizationUrl: `https://github.com/login/oauth/authorize?${params.toString()}`,
    });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * GET /api/streams/[streamId]/repository/transfer
 *
 * Reconciliation endpoint — checks actual GitHub repo owner and updates status.
 * TRANSFER_PENDING → TRANSFERRED (if owner matches destination)
 * TRANSFER_PENDING → TRANSFER_FAILED (if unexpected owner)
 */
export async function GET(request: Request, context: Params) {
  const { streamId } = await context.params;
  try {
    const walletAddress = await authenticateBrowserSession(request);
    if (!walletAddress) return apiError("Authentication required.", 401);

    const stream = await getOnchainStream(streamId);
    if (!stream) return apiError("Stream not found.", 404);

    const isSender = addressesEqual(stream.sender, walletAddress);
    const isRecipient = addressesEqual(stream.recipient, walletAddress);
    if (!isSender && !isRecipient) return apiError("Access denied.", 403);

    const repository = await getRepository(streamId);
    if (!repository) return apiError("No repository found.", 404);

    if (repository.status !== "TRANSFER_PENDING") {
      return NextResponse.json(repository);
    }

    const currentOwner = await getRepositoryOwner(repository.githubRepositoryId);
    const expectedDestination = repository.transferDestination;
    const now = new Date().toISOString();

    if (expectedDestination && currentOwner.toLowerCase() === expectedDestination.toLowerCase()) {
      await putRepository({
        ...repository,
        status: "TRANSFERRED",
        transferredAt: now,
        updatedAt: now,
      });
    } else if (currentOwner.toLowerCase() === repository.owner.toLowerCase()) {
      // Still in original org — transfer pending with GitHub
      // Keep status as-is
    } else {
      // Unexpected owner
      await putRepository({
        ...repository,
        status: "TRANSFER_FAILED",
        lastError: `Unexpected owner after transfer: ${currentOwner}`,
        updatedAt: now,
      });
    }

    return NextResponse.json(await getRepository(streamId));
  } catch (error) {
    return apiError(error);
  }
}
