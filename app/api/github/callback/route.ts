import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { consumeOAuthState, findByGithubUserId, getIdentity, putIdentity } from "@/lib/github-identity-store";
import { getGithubOAuthEnv } from "@/lib/github-env";
import { authenticateBrowserSession } from "@/lib/work-session-server";
import { addressesEqual } from "@/lib/work-session-server";
import { checkTransferEligibility } from "@/lib/github-transfer";
import {
  acquireRepositoryTransfer,
  putRepository,
  releaseRepositoryTransfer,
} from "@/lib/github-repository-store";
import { transferRepositoryAsUser } from "@/lib/github-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/github/callback
 *
 * Handles the GitHub OAuth callback:
 * 1. Reads `code` and `state` from query params
 * 2. Atomically consumes the state (GETDEL) — rejects if missing/expired
 * 3. Uses the wallet bound to the single-use server-side state
 *    (and rejects a different active browser wallet, if present)
 * 4. Exchanges code for access token
 * 5. Fetches GitHub user identity
 * 6. Checks for conflicting wallet ownership
 * 7. Stores GithubIdentityRecord
 * 8. Redirects to /profile/{walletAddress}
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return apiError("Missing code or state parameter.", 400);
    }

    // Atomically consume state — prevents replay attacks
    const stateValue = await consumeOAuthState(state);
    if (!stateValue) {
      return apiError("Invalid or expired OAuth state. Please try connecting again.", 400);
    }

    // The state was created only after wallet authentication, is stored
    // server-side, contains 256 bits of randomness, expires after 10 minutes,
    // and was atomically consumed above. It is therefore the authoritative
    // wallet binding for this OAuth round trip. A SameSite/browser policy may
    // omit the Aven cookie on GitHub's cross-site callback, so do not require
    // that cookie to be present. If it is present, it must still agree.
    const browserWallet = await authenticateBrowserSession(request);
    if (browserWallet && !addressesEqual(browserWallet, stateValue.walletAddress)) {
      return apiError("Session wallet does not match OAuth state. Please try again.", 403);
    }
    const walletAddress = stateValue.walletAddress;

    const env = getGithubOAuthEnv();

    // Exchange authorization code for access token
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: env.oauthClientId,
        client_secret: env.oauthClientSecret,
        code,
        redirect_uri: env.oauthRedirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      return apiError("Failed to exchange authorization code with GitHub.", 502);
    }

    const tokenData = await tokenResponse.json() as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error || !tokenData.access_token) {
      return apiError(
        tokenData.error_description ?? tokenData.error ?? "GitHub did not return an access token.",
        400,
      );
    }

    const accessToken = tokenData.access_token;

    // Fetch GitHub user identity using the access token
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!userResponse.ok) {
      return apiError("Failed to fetch GitHub user information.", 502);
    }

    const userData = await userResponse.json() as {
      id: number;
      login: string;
      avatar_url?: string;
    };

    const githubUserId = userData.id;
    const githubLogin = userData.login;

    // Check if another wallet already owns this GitHub account
    const [existingOwner, existingIdentity] = await Promise.all([
      findByGithubUserId(githubUserId),
      getIdentity(walletAddress),
    ]);
    if (existingOwner && !addressesEqual(existingOwner.walletAddress, walletAddress)) {
      return apiError(
        `This GitHub account (@${githubLogin}) is already linked to a different Aven wallet.`,
        409,
      );
    }

    // Store the identity record (access token is NOT stored — used only above)
    const now = new Date().toISOString();
    await putIdentity({
      walletAddress,
      githubUserId,
      githubLogin,
      avatarUrl: userData.avatar_url,
      linkedAt: existingIdentity?.linkedAt ?? now,
      updatedAt: now,
    });

    if (stateValue.action?.type === "repository_transfer") {
      const { streamId, destination } = stateValue.action;
      const eligibility = await checkTransferEligibility({
        streamId,
        walletAddress,
        destination,
      });
      if (!eligibility.eligible) {
        return apiError(eligibility.reason, eligibility.status);
      }
      if (!await acquireRepositoryTransfer(streamId)) {
        return apiError("A repository transfer is already in progress.", 409);
      }

      const { repository } = eligibility;
      try {
        await putRepository({
          ...repository,
          status: "TRANSFER_PENDING",
          transferDestination: destination,
          lastError: undefined,
          updatedAt: new Date().toISOString(),
        });
        try {
          await transferRepositoryAsUser(
            repository.fullName,
            destination,
            accessToken,
          );
        } catch (error) {
          await putRepository({
            ...repository,
            status: "TRANSFER_FAILED",
            transferDestination: destination,
            lastError: error instanceof Error ? error.message : String(error),
            updatedAt: new Date().toISOString(),
          });
          const failureDestination = new URL(
            stateValue.returnTo ?? `/stream/${encodeURIComponent(streamId)}`,
            request.url,
          );
          failureDestination.searchParams.set("github", "connected");
          failureDestination.searchParams.set("githubTransfer", "failed");
          return NextResponse.redirect(failureDestination);
        }
      } finally {
        await releaseRepositoryTransfer(streamId);
      }
    }

    // Return users to the page that initiated OAuth. This is especially
    // important for repository setup, where both stream participants link
    // their accounts independently.
    const destination = new URL(
      stateValue.returnTo ?? `/profile/${walletAddress}`,
      request.url,
    );
    destination.searchParams.set("github", "connected");
    if (stateValue.action?.type === "repository_transfer") {
      destination.searchParams.set("githubTransfer", "pending");
    }
    return NextResponse.redirect(destination);
  } catch (error) {
    return apiError(error);
  }
}
