import "server-only";

import { randomBytes } from "node:crypto";
import { assertProductionPersistence, dataNamespace, sharedRedis } from "./server-persistence";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GithubIdentityRecord = {
  walletAddress: string;
  githubUserId: number;   // immutable — primary identity key
  githubLogin: string;    // display only — usernames can change
  avatarUrl?: string;
  linkedAt: string;
  updatedAt: string;
};

export type OAuthStateAction = {
  type: "repository_transfer";
  streamId: string;
  destination: string;
};

export type OAuthStateValue = {
  walletAddress: string;
  issuedAt: string;
  returnTo?: string;
  action?: OAuthStateAction;
};

// ─── In-memory local fallbacks (when Redis is not configured) ─────────────────

const localIdentities = new Map<string, GithubIdentityRecord>(); // key: walletAddress
const localOAuthStates = new Map<string, { value: OAuthStateValue; expiresAt: number }>();

// ─── TTLs ─────────────────────────────────────────────────────────────────────

const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes

// ─── Redis key helpers ────────────────────────────────────────────────────────

function identityKey(walletAddress: string) {
  return `${dataNamespace}:github-identity:${walletAddress.toLowerCase()}`;
}

function oauthStateKey(state: string) {
  return `${dataNamespace}:github-oauth-state:${state}`;
}

// ─── GitHub Identity store ────────────────────────────────────────────────────

export async function getIdentity(
  walletAddress: string,
): Promise<GithubIdentityRecord | null> {
  assertProductionPersistence();
  if (sharedRedis) {
    return (await sharedRedis.get<GithubIdentityRecord>(identityKey(walletAddress))) ?? null;
  }
  return localIdentities.get(walletAddress.toLowerCase()) ?? null;
}

export async function putIdentity(record: GithubIdentityRecord): Promise<void> {
  assertProductionPersistence();
  if (sharedRedis) {
    const claimed = await sharedRedis.set(
      userIdIndexKey(record.githubUserId),
      record.walletAddress,
      { nx: true },
    );
    if (claimed === null) {
      const owner = await sharedRedis.get<string>(userIdIndexKey(record.githubUserId));
      if (owner && owner.toLowerCase() !== record.walletAddress.toLowerCase()) {
        throw new Error("This GitHub account is already linked to a different Aven wallet.");
      }
    }
    const previous = await getIdentity(record.walletAddress);
    if (previous && previous.githubUserId !== record.githubUserId) {
      const previousOwner = await sharedRedis.get<string>(userIdIndexKey(previous.githubUserId));
      if (previousOwner?.toLowerCase() === record.walletAddress.toLowerCase()) {
        await sharedRedis.del(userIdIndexKey(previous.githubUserId));
      }
    }
    await sharedRedis.set(identityKey(record.walletAddress), record);
  } else {
    localIdentities.set(record.walletAddress.toLowerCase(), record);
  }
}

export async function deleteIdentity(walletAddress: string): Promise<void> {
  assertProductionPersistence();
  if (sharedRedis) {
    const existing = await getIdentity(walletAddress);
    if (!existing) return;
    const indexedWallet = await sharedRedis.get<string>(userIdIndexKey(existing.githubUserId));
    await sharedRedis.del(identityKey(walletAddress));
    if (indexedWallet && indexedWallet.toLowerCase() === walletAddress.toLowerCase()) {
      await sharedRedis.del(userIdIndexKey(existing.githubUserId));
    }
  } else {
    localIdentities.delete(walletAddress.toLowerCase());
  }
}

export async function findByGithubUserId(
  userId: number,
): Promise<GithubIdentityRecord | null> {
  assertProductionPersistence();
  if (sharedRedis) {
    const walletAddress = await sharedRedis.get<string>(userIdIndexKey(userId));
    return walletAddress ? getIdentity(walletAddress) : null;
  }
  for (const record of localIdentities.values()) {
    if (record.githubUserId === userId) return record;
  }
  return null;
}

// ─── OAuth state (temporary, 10-minute TTL, atomic GETDEL on consume) ─────────

export async function createOAuthState(
  walletAddress: string,
  returnTo?: string,
  action?: OAuthStateAction,
): Promise<string> {
  assertProductionPersistence();
  const state = randomBytes(32).toString("hex");
  const value: OAuthStateValue = {
    walletAddress,
    issuedAt: new Date().toISOString(),
    returnTo,
    action,
  };
  if (sharedRedis) {
    await sharedRedis.set(oauthStateKey(state), value, { ex: OAUTH_STATE_TTL_SECONDS });
  } else {
    localOAuthStates.set(state, {
      value,
      expiresAt: Date.now() + OAUTH_STATE_TTL_SECONDS * 1_000,
    });
  }
  return state;
}

/**
 * Atomically consume an OAuth state value.
 * Returns the associated wallet address or null if missing/expired.
 * Prevents replay attacks — the state can only be used once.
 */
export async function consumeOAuthState(
  state: string,
): Promise<OAuthStateValue | null> {
  assertProductionPersistence();
  if (sharedRedis) {
    // GETDEL is atomic: read + delete in one round-trip (same pattern as nonces)
    const value = await sharedRedis.getdel<OAuthStateValue>(oauthStateKey(state));
    return value ?? null;
  }
  const entry = localOAuthStates.get(state);
  if (!entry) return null;
  localOAuthStates.delete(state);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.value;
}

// ─── Reverse-index for Redis (userId → walletAddress) ─────────────────────────
// Maintained alongside identity records to allow conflict detection in Redis.

function userIdIndexKey(userId: number) {
  return `${dataNamespace}:github-userid:${userId}`;
}

export async function findWalletByGithubUserId(
  userId: number,
): Promise<string | null> {
  assertProductionPersistence();
  if (sharedRedis) {
    return (await sharedRedis.get<string>(userIdIndexKey(userId))) ?? null;
  }
  for (const record of localIdentities.values()) {
    if (record.githubUserId === userId) return record.walletAddress;
  }
  return null;
}

export async function putIdentityWithIndex(record: GithubIdentityRecord): Promise<void> {
  return putIdentity(record);
}

export async function deleteIdentityWithIndex(
  walletAddress: string,
  githubUserId: number,
): Promise<void> {
  void githubUserId;
  return deleteIdentity(walletAddress);
}
