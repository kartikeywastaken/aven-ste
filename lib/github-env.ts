import "server-only";

import { normalizeGithubPrivateKey } from "./github-private-key";

/**
 * GitHub environment variable loaders.
 *
 * OAuth account linking and GitHub App repository management are separate
 * integrations. Keep their validation separate so a developer can link an
 * identity locally without configuring repository automation first.
 *
 * Never prefetch or cache globally; env vars are validated on every call to
 * surface misconfiguration clearly.
 */

export type GithubOAuthEnv = {
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRedirectUri: string;
};

export type GithubAppEnv = {
  appId: string;
  privateKey: string;
  installationId: number;
  avenOrg: string;
};

export type GithubWebhookEnv = {
  webhookSecret: string;
};

export type GithubEnv = GithubAppEnv & GithubWebhookEnv & GithubOAuthEnv;

function rejectPlaceholder(name: string, value: string): string {
  if (/^(your_|replace_|changeme|todo)/i.test(value)) {
    throw new Error(`${name} still contains a placeholder value.`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return rejectPlaceholder(name, value);
}

function positiveInteger(name: string): number {
  const raw = required(name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function callbackUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error();
    }
    return parsed.toString();
  } catch {
    throw new Error("GITHUB_OAUTH_REDIRECT_URI must be a valid HTTP(S) URL.");
  }
}

export function getGithubAppEnv(): GithubAppEnv {
  const appId = required("GITHUB_APP_ID");
  if (!/^\d+$/.test(appId)) {
    throw new Error("GITHUB_APP_ID must be the numeric App ID, not the Client ID.");
  }

  const avenOrg = required("GITHUB_AVEN_ORG");
  if (
    avenOrg.length > 39 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(avenOrg)
  ) {
    throw new Error("GITHUB_AVEN_ORG must be the GitHub organization login, not a URL.");
  }

  return {
    appId,
    privateKey: normalizeGithubPrivateKey(required("GITHUB_APP_PRIVATE_KEY")),
    installationId: positiveInteger("GITHUB_APP_INSTALLATION_ID"),
    avenOrg,
  };
}

export function getGithubWebhookEnv(): GithubWebhookEnv {
  return {
    webhookSecret: required("GITHUB_WEBHOOK_SECRET"),
  };
}

export function getGithubOAuthEnv(): GithubOAuthEnv {
  const oauthClientId = required("GITHUB_OAUTH_CLIENT_ID");
  if (!/^Iv/.test(oauthClientId)) {
    throw new Error(
      "GITHUB_OAUTH_CLIENT_ID must be the GitHub App client ID and start with capital Iv.",
    );
  }

  return {
    oauthClientId,
    oauthClientSecret: required("GITHUB_OAUTH_CLIENT_SECRET"),
    oauthRedirectUri: callbackUrl(required("GITHUB_OAUTH_REDIRECT_URI")),
  };
}

export function getGithubEnv(): GithubEnv {
  return {
    ...getGithubAppEnv(),
    ...getGithubWebhookEnv(),
    ...getGithubOAuthEnv(),
  };
}
