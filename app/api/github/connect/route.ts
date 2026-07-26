import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { apiError } from "@/lib/api-response";
import { createOAuthState } from "@/lib/github-identity-store";
import { getGithubOAuthEnv } from "@/lib/github-env";
import { authenticateBrowserSession } from "@/lib/work-session-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/github/connect
 *
 * Initiates GitHub OAuth flow for the authenticated browser user.
 * Generates a cryptographically random state, stores it in Redis with a
 * 10-minute TTL, then redirects to GitHub's OAuth authorization endpoint.
 */
export async function GET(request: Request) {
  try {
    const walletAddress = await authenticateBrowserSession(request);
    if (!walletAddress) return apiError("Authentication required.", 401);

    const requestUrl = new URL(request.url);
    const requestedReturnTo = requestUrl.searchParams.get("returnTo");
    const returnTo =
      requestedReturnTo &&
      requestedReturnTo.startsWith("/") &&
      !requestedReturnTo.startsWith("//") &&
      requestedReturnTo.length <= 2_048
        ? requestedReturnTo
        : undefined;
    const env = getGithubOAuthEnv();
    const state = await createOAuthState(walletAddress, returnTo);

    const params = new URLSearchParams({
      client_id: env.oauthClientId,
      redirect_uri: env.oauthRedirectUri,
      state,
    });

    return NextResponse.redirect(
      `https://github.com/login/oauth/authorize?${params.toString()}`,
    );
  } catch (error) {
    return apiError(error);
  }
}
