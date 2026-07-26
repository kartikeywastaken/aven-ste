"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { signMessage } from "@stellar/freighter-api";
import { useWallet } from "@/components/WalletProvider";
import { ConfirmModal } from "@/components/ConfirmModal";
import type { WorkSession } from "@/lib/work-session";
import { STREAM_CONTRACT_ID, STELLAR_EXPLORER } from "@/lib/contracts";
import { ensureCurrentDeployment } from "@/lib/deployment-client";
import {
  getStream,
  computeAvailable,
  pauseStream,
  resumeStream,
  cancelStream,
  approveReviewedWithdrawal,
  disputeReviewedWithdrawal,
  withdrawReviewed,
  StreamObject,
} from "@/lib/stellar";
import styles from "./page.module.css";

const STATUS_LABELS: Record<string, string> = {
  active: "🟢 Active",
  paused: "🟡 Paused",
  completed: "✅ Completed",
  cancelled: "🔴 Cancelled",
};

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}H ${minutes}M` : `${minutes}M`;
}

function deadlineLabel(deadline?: string) {
  if (!deadline) return "No deadline";
  const remaining = Math.max(0, Date.parse(deadline) - Date.now());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  return remaining === 0 ? "Review window expired" : `${hours}H ${minutes}M remaining`;
}

function sumRequested(sessions: WorkSession[], statuses: WorkSession["status"][]) {
  return sessions
    .filter((session) => statuses.includes(session.status))
    .reduce((total, session) => total + Number(session.requestedAmount ?? "0"), 0);
}

type ManagedRepository = {
  fullName: string;
  name: string;        // bare repo name (e.g. "aven-11-my-project")
  htmlUrl: string;
  cloneUrl: string;    // HTTPS clone URL
  sshUrl: string;      // SSH clone URL
  status: "CREATING" | "ACTIVE" | "TRANSFER_PENDING" | "TRANSFERRED" | "TRANSFER_FAILED";
  transferDestination?: string;
  lastError?: string;
};

type GithubConnection = {
  connected: boolean;
  oauthConfigured?: boolean;
  githubLogin?: string;
  avatarUrl?: string;
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  return (
    <button
      type="button"
      className={styles["copy-btn"]}
      aria-label={label}
      onClick={handleCopy}
      data-copy-state={state}
    >
      {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy"}
    </button>
  );
}

export default function StreamDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { address, connected } = useWallet();

  const [stream, setStream] = useState<StreamObject | null>(null);
  const [availableEscrow, setAvailableEscrow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [txResult, setTxResult] = useState<string | null>(null);
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [sessionAction, setSessionAction] = useState<string | null>(null);
  const [approveSession, setApproveSession] = useState<WorkSession | null>(null);
  const [disputeSession, setDisputeSession] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [repository, setRepository] = useState<ManagedRepository | null>(null);
  const [repositoryBusy, setRepositoryBusy] = useState(false);
  const [githubConnection, setGithubConnection] = useState<GithubConnection | null>(null);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [transferDestination, setTransferDestination] = useState("");

  async function load() {
    setLoading(true);
    try {
      const s = await getStream(id, address ?? undefined);
      setStream(s);
      if (s) {
        const e = await computeAvailable(id, address ?? undefined);
        setAvailableEscrow(e);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load stream");
    } finally {
      setLoading(false);
    }
  }

  async function loadSessions() {
    if (!address) {
      setSessions([]);
      return;
    }
    setSessionsLoading(true);
    try {
      await ensureBrowserSession();
      const sessionsPath = `/api/streams/${encodeURIComponent(id)}/work-sessions`;
      const repositoryPath = `/api/streams/${encodeURIComponent(id)}/repository`;
      const [response, repositoryResponse, connectionResponse] = await Promise.all([
        fetch(sessionsPath, { cache: "no-store" }),
        fetch(repositoryPath, { cache: "no-store" }),
        fetch("/api/github/connection", { cache: "no-store" }),
      ]);
      const responseContract = response.headers.get("x-aven-stream-contract");
      if (
        responseContract &&
        responseContract.trim().toUpperCase() !== STREAM_CONTRACT_ID.trim().toUpperCase()
      ) {
        window.location.reload();
        throw new Error("A newer contract deployment is active. Refreshing this page.");
      }
      if (repositoryResponse.ok) {
        setRepository(await repositoryResponse.json() as ManagedRepository);
      } else if (repositoryResponse.status === 404) {
        setRepository(null);
      }
      if (connectionResponse.ok) {
        const connection = await connectionResponse.json() as GithubConnection;
        setGithubConnection(connection);
        if (connection.connected && connection.githubLogin) {
          setTransferDestination(connection.githubLogin);
        }
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to load work sessions.");
      const loaded = data as WorkSession[];
      const expired = loaded.filter(
        (session) =>
          session.status === "PENDING_CLIENT_REVIEW" &&
          !session.report?.session.projectEnded &&
          session.reviewDeadlineAt &&
          Date.parse(session.reviewDeadlineAt) <= Date.now(),
      );
      if (expired.length > 0) {
        await Promise.all(
          expired.map((session) =>
            fetch(`/api/work-sessions/${encodeURIComponent(session.id)}/finalize-timeout`, {
              method: "POST",
            }),
          ),
        );
        const refreshed = await fetch(sessionsPath, { cache: "no-store" });
        const refreshedData = await refreshed.json();
        if (refreshed.ok) setSessions(refreshedData as WorkSession[]);
        else setSessions(loaded);
      } else {
        setSessions(loaded);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, address]);

  useEffect(() => {
    loadSessions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, address]);

  async function ensureBrowserSession(): Promise<void> {
    if (!address) throw new Error("Connect your wallet first.");
    const storageKey = `aven:browser-session:${address.toUpperCase()}`;
    const cached = window.sessionStorage.getItem(storageKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { expiresAt: number };
        if (parsed.expiresAt > Date.now() + 30_000) return; // session still valid
      } catch {
        window.sessionStorage.removeItem(storageKey);
      }
    }

    // Step 1: Get a single-line challenge (no newlines) from the server.
    const challengeResponse = await fetch("/api/auth/wallet/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress: address }),
    });
    const challengeData = await challengeResponse.json();
    if (!challengeResponse.ok) throw new Error(challengeData.error ?? "Failed to create auth challenge.");
    const { challenge, expiresAt } = challengeData as { challenge: string; expiresAt: number };

    // Safety assertion: challenge must have no newline characters.
    if (/[\r\n]/.test(challenge)) throw new Error("Server returned an invalid challenge.");

    // Step 2: Sign the single-line challenge with the wallet.
    const signed = await signMessage(challenge, { address });
    if (signed.error || !signed.signedMessage) {
      throw new Error(signed.error?.message ?? "The wallet did not return a signature.");
    }
    if (signed.signerAddress && signed.signerAddress.toUpperCase() !== address.toUpperCase()) {
      throw new Error("Freighter signed with a different account. Switch wallets and try again.");
    }
    const signature = typeof signed.signedMessage === "string"
      ? signed.signedMessage
      : window.btoa(Array.from(signed.signedMessage, (byte) => String.fromCharCode(byte)).join(""));

    // Step 3: Verify on the server — server sets the aven_session HttpOnly cookie.
    const verifyResponse = await fetch("/api/auth/wallet/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress: address, challenge, signature }),
    });
    const verifyData = await verifyResponse.json();
    if (!verifyResponse.ok) throw new Error(verifyData.error ?? "Wallet verification failed.");

    // Cache the expiry so we know when to renew.
    window.sessionStorage.setItem(storageKey, JSON.stringify({ expiresAt }));
  }

  async function mutateSession(sessionId: string, action: "request-withdrawal" | "approve" | "dispute" | "release", body?: object) {
    const path = `/api/work-sessions/${encodeURIComponent(sessionId)}/${action}`;
    setSessionAction(`${sessionId}:${action}`);
    setError(null);
    try {
      await ensureCurrentDeployment();
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (address && session) {
        if (action === "approve") await approveReviewedWithdrawal(id, address, session.id);
        if (action === "dispute") await disputeReviewedWithdrawal(id, address, session.id);
      }
      await ensureBrowserSession();
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Work-session action failed.");
      setApproveSession(null);
      setDisputeSession(null);
      setDisputeReason("");
      await loadSessions();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSessionAction(null);
    }
  }

  async function createManagedRepository() {
    setRepositoryBusy(true);
    setRepositoryError(null);
    try {
      await ensureBrowserSession();
      const response = await fetch(`/api/streams/${encodeURIComponent(id)}/repository`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectTitle: stream?.title ?? `stream-${id}` }),
      });
      const data = await response.json() as ManagedRepository & {
        error?: string;
        missingParty?: "sender" | "recipient";
      };
      if (!response.ok) {
        if (data.missingParty === "sender") {
          throw new Error("Connect the client GitHub account before creating the repository.");
        }
        if (data.missingParty === "recipient") {
          throw new Error("The employee still needs to connect their GitHub account from this stream.");
        }
        throw new Error(data.error ?? "Could not create the managed repository.");
      }
      setRepository(data as ManagedRepository);
    } catch (caught) {
      setRepositoryError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRepositoryBusy(false);
    }
  }

  async function connectGithub() {
    setRepositoryBusy(true);
    setRepositoryError(null);
    try {
      await ensureBrowserSession();
      const returnTo = `/stream/${encodeURIComponent(id)}`;
      window.location.assign(`/api/github/connect?returnTo=${encodeURIComponent(returnTo)}`);
    } catch (caught) {
      setRepositoryError(caught instanceof Error ? caught.message : String(caught));
      setRepositoryBusy(false);
    }
  }

  async function transferManagedRepository() {
    setRepositoryBusy(true);
    setError(null);
    try {
      await ensureBrowserSession();
      const base = `/api/streams/${encodeURIComponent(id)}/repository/transfer`;
      const preflight = await fetch(`${base}/preflight`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: transferDestination }),
      });
      const preflightData = await preflight.json();
      if (!preflight.ok || preflightData.eligible !== true) {
        throw new Error(preflightData.reason ?? preflightData.error ?? "Repository transfer is not eligible.");
      }
      const response = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destination: transferDestination }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Repository transfer failed.");
      setRepository((current) => current ? {
        ...current,
        status: "TRANSFER_PENDING",
        transferDestination,
        lastError: undefined,
      } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await loadSessions();
    } finally {
      setRepositoryBusy(false);
    }
  }

  async function reconcileManagedRepository() {
    setRepositoryBusy(true);
    try {
      await ensureBrowserSession();
      const response = await fetch(`/api/streams/${encodeURIComponent(id)}/repository/transfer`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not refresh the repository transfer.");
      setRepository(data as ManagedRepository);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRepositoryBusy(false);
    }
  }

  async function releaseSession(session: WorkSession) {
    if (!address) return;
    setSessionAction(`${session.id}:release`);
    setError(null);
    setTxResult(null);
    let transactionSucceeded = false;
    const preparePath = `/api/work-sessions/${encodeURIComponent(session.id)}/release/prepare`;
    const cancelPath = `/api/work-sessions/${encodeURIComponent(session.id)}/release/cancel`;
    try {
      await ensureCurrentDeployment();
      await ensureBrowserSession();
      const prepared = await fetch(preparePath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const preparedData = await prepared.json();
      if (!prepared.ok) throw new Error(preparedData.error ?? "The release could not be prepared.");
      const result = await withdrawReviewed(id, address, session.id);
      transactionSucceeded = true;
      const path = `/api/work-sessions/${encodeURIComponent(session.id)}/release`;
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash: result.txHash }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "The transaction succeeded but its record could not be updated. Do not submit another withdrawal.");
      }
      setTxResult(`Released ${result.amount.toFixed(7)} ${stream?.asset} · tx: ${result.txHash.slice(0, 10)}…`);
      await Promise.all([load(), loadSessions()]);
    } catch (caught) {
      if (!transactionSucceeded) {
        try {
          await fetch(cancelPath, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          });
        } catch {
          // Preserve the original wallet/transaction error.
        }
      }
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSessionAction(null);
    }
  }

  async function doAction(action: string) {
    if (!address) return;
    setActionLoading(action);
    setError(null);
    setTxResult(null);
    try {
      await ensureCurrentDeployment();
      if (action === "pause") await pauseStream(id, address);
      if (action === "resume") await resumeStream(id, address);
      if (action === "cancel") await cancelStream(id, address);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Transaction failed");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="stream-detail-loading">
        <div className="dash-spinner" />
        <span>Loading stream #{id}…</span>
      </div>
    );
  }

  if (!stream) {
    return (
      <div className="stream-detail-empty">
        <h2>Stream Not Found</h2>
        <p>No stream with ID #{id} exists on-chain.</p>
        <button className="form-btn" onClick={() => router.push("/dashboard")}>← Dashboard</button>
      </div>
    );
  }

  const isSender = address && stream.sender.toLowerCase() === address.toLowerCase();
  const isRecipient = address && stream.recipient.toLowerCase() === address.toLowerCase();
  const pct = stream.totalDeposited > 0
    ? Math.min(100, (stream.totalWithdrawn / stream.totalDeposited) * 100)
    : 0;
  const pendingAmount = sumRequested(sessions, ["WITHDRAWAL_REQUESTED", "PENDING_CLIENT_REVIEW", "APPROVED"]);
  const releasedAmount = sumRequested(sessions, ["RELEASED", "RELEASE_ELIGIBLE", "RELEASING"]);
  const disputedAmount = sumRequested(sessions, ["DISPUTED", "RESPONSE_SUBMITTED"]);

  return (
    <div className="stream-detail-wrap">
      <div className="stream-detail-nav">
        <button className="stream-back-btn" onClick={() => router.push("/dashboard")}>← Back</button>
        <span className="stream-detail-id">Stream #{id}</span>
      </div>

      {error && <div className="form-error">{error}</div>}
      {txResult && <div className="form-success-banner">{txResult}</div>}

      <div className="stream-detail-card">
        <div className="stream-detail-header">
          <div>
            <h1 className="stream-detail-title">{stream.title}</h1>
            <div className="stream-detail-meta">
              <span className="stream-cat-badge" style={{ background: "#6366f1" }}>{stream.category}</span>
              <span className="stream-asset-badge">{stream.asset}</span>
            </div>
          </div>
          <div className="stream-detail-status">{STATUS_LABELS[stream.status]}</div>
        </div>

        {/* Progress */}
        <div className="stream-detail-progress-wrap">
          <div className="stream-detail-progress-bar">
            <div className="stream-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="stream-detail-progress-labels">
            <span>{stream.totalWithdrawn.toFixed(4)} withdrawn</span>
            <span>{stream.totalDeposited.toFixed(2)} total</span>
          </div>
        </div>

        {(stream.status === "active" || stream.status === "paused") && (
          <div className="stream-detail-earned-wrap">
            <div className="stream-detail-earned-label">Unreserved escrow</div>
            <div className="stream-detail-earned-value">
              {availableEscrow.toFixed(6)} <span className="stream-detail-earned-asset">{stream.asset}</span>
            </div>
            <p className="stream-detail-earned-label">
              This changes only when an npm-tracked work session reserves or releases payment.
            </p>
          </div>
        )}

        {/* Addresses */}
        <div className="stream-detail-addresses">
          <div className="stream-addr-row">
            <span className="stream-addr-label">Sender</span>
            <code className="stream-addr-value">{stream.sender}</code>
          </div>
          <div className="stream-addr-row">
            <span className="stream-addr-label">Recipient</span>
            <code className="stream-addr-value">{stream.recipient}</code>
          </div>
        </div>

        {/* Info grid */}
        <div className="stream-detail-grid">
          <div className="stream-detail-item">
            <div className="stream-detail-item-label">Rate / active second</div>
            <div className="stream-detail-item-value">{(stream.ratePerLedger / 5).toFixed(7)} {stream.asset}</div>
          </div>
          <div className="stream-detail-item">
            <div className="stream-detail-item-label">Duration (ledgers)</div>
            <div className="stream-detail-item-value">{stream.durationLedgers.toLocaleString()}</div>
          </div>
          <div className="stream-detail-item">
            <div className="stream-detail-item-label">Start Ledger</div>
            <div className="stream-detail-item-value">#{stream.startLedger.toLocaleString()}</div>
          </div>
          <div className="stream-detail-item">
            <div className="stream-detail-item-label">Work evidence</div>
            <div className="stream-detail-item-value">
              {!address
                ? "Connect wallet to view"
                : sessions.length > 0
                  ? `${sessions.length} session record${sessions.length === 1 ? "" : "s"}`
                  : "No sessions yet"}
            </div>
          </div>
        </div>

        {address && (isSender || isRecipient) && (
          <section className={styles["repository-panel"]}>
            <div className={styles["repository-copy"]}>
              <div className={styles["repository-heading"]}>
                <div className={styles["repository-icon"]} aria-hidden="true">GH</div>
                <div>
                  <span>Project repository</span>
                  <h3>Managed GitHub workspace</h3>
                </div>
                <small data-status={repository?.status ?? "SETUP"}>
                  {repository?.status.replaceAll("_", " ") ?? "SETUP REQUIRED"}
                </small>
              </div>
              {repository ? (
                <a className={styles["repository-name"]} href={repository.htmlUrl} target="_blank" rel="noopener noreferrer">
                  {repository.fullName} <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <p className={styles["repository-description"]}>
                  The client creates a private workspace after both participants connect GitHub.
                  The employee receives write access automatically.
                </p>
              )}
              <div className={styles["repository-connection"]}>
                <span className={githubConnection?.connected ? styles["is-connected"] : ""} aria-hidden="true" />
                <div>
                  <small>Your GitHub account</small>
                  <strong>
                    {githubConnection?.connected
                      ? `@${githubConnection.githubLogin}`
                      : "Not connected"}
                  </strong>
                </div>
              </div>
              {(repositoryError || repository?.lastError) && (
                <p className={styles["repository-error"]} role="alert">
                  {repositoryError ?? repository?.lastError}
                </p>
              )}
              {githubConnection?.oauthConfigured === false && (
                <p className={styles["repository-error"]} role="alert">
                  GitHub OAuth is not configured for this environment. Add the three
                  GITHUB_OAUTH_* variables and restart the app.
                </p>
              )}
              {/* Employee repository details — only shown to the recipient when a repo exists */}
              {isRecipient && repository && (
                <div className={styles["repo-employee-details"]}>
                  <div className={styles["repo-detail-row"]}>
                    <span className={styles["repo-detail-label"]}>Status</span>
                    <span
                      className={styles["repo-status-badge"]}
                      data-status={repository.status}
                    >
                      {repository.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <div className={styles["repo-detail-row"]}>
                    <a
                      className={styles["repo-open-btn"]}
                      href={repository.htmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open repository ↗
                    </a>
                  </div>
                  <div className={styles["repo-clone-row"]}>
                    <span className={styles["repo-detail-label"]}>HTTPS clone</span>
                    <code className={styles["repo-clone-url"]}>{repository.cloneUrl}</code>
                    <CopyButton value={repository.cloneUrl} label="Copy HTTPS clone URL" />
                  </div>
                  <div className={styles["repo-clone-row"]}>
                    <span className={styles["repo-detail-label"]}>SSH clone</span>
                    <code className={styles["repo-clone-url"]}>{repository.sshUrl}</code>
                    <CopyButton value={repository.sshUrl} label="Copy SSH clone URL" />
                  </div>
                  <p className={styles["repo-invite-note"]}>
                    Accept the GitHub collaborator invitation from your GitHub notifications or
                    email before you clone.
                  </p>
                </div>
              )}
            </div>
            <div className={styles["repository-actions"]}>
              {!githubConnection?.connected && (
                <button
                  type="button"
                  disabled={repositoryBusy || githubConnection?.oauthConfigured === false}
                  onClick={connectGithub}
                >
                  {repositoryBusy ? "Opening GitHub…" : "Connect GitHub"}
                </button>
              )}
              {githubConnection?.connected && (
                <button className={styles["repository-secondary"]} type="button" disabled={repositoryBusy} onClick={connectGithub}>
                  Change account
                </button>
              )}
              {!repository && isSender && (
                <button
                  className={styles["repository-primary"]}
                  type="button"
                  disabled={repositoryBusy || !githubConnection?.connected}
                  onClick={createManagedRepository}
                >
                  {repositoryBusy ? "Creating…" : "Create repository"}
                </button>
              )}
              {!repository && isRecipient && (
                <small>
                  {githubConnection?.connected
                    ? "Connected. The client can now create the repository."
                    : "Connect the employee account, then ask the client to create the repository."}
                </small>
              )}
              {repository && isSender && (repository.status === "ACTIVE" || repository.status === "TRANSFER_FAILED") && (
                <>
                  <input
                    aria-label="GitHub transfer destination"
                    value={transferDestination}
                    placeholder="Linked GitHub username"
                    readOnly
                  />
                  <button
                    type="button"
                    disabled={repositoryBusy || !transferDestination.trim()}
                    onClick={transferManagedRepository}
                  >
                    {repositoryBusy
                      ? "Checking…"
                      : repository.status === "TRANSFER_FAILED"
                        ? "Retry transfer"
                        : "Transfer after final payment"}
                  </button>
                </>
              )}
              {repository?.status === "TRANSFER_PENDING" && (
                <button type="button" disabled={repositoryBusy} onClick={reconcileManagedRepository}>
                  {repositoryBusy ? "Refreshing…" : "Refresh transfer status"}
                </button>
              )}
              {/* Client: copy onboarding link so they can share it with the employee */}
              {isSender && (
                <CopyButton
                  value={typeof window !== "undefined" ? `${window.location.origin}/stream/${id}` : `/stream/${id}`}
                  label="Copy employee onboarding link"
                />
              )}
            </div>
          </section>
        )}

        {/* Employee onboarding checklist — only shown to the recipient */}
        {isRecipient && (
          <section className={styles["onboarding-panel"]}>
            <div className={styles["onboarding-heading"]}>
              <span className={styles["onboarding-eyebrow"]}>EMPLOYEE SETUP</span>
              <h3 className={styles["onboarding-title"]}>Start working</h3>
            </div>

            {!repository ? (
              <ol className={styles["onboarding-list"]}>
                <li>
                  {!githubConnection?.connected ? (
                    <button type="button" className={styles["onboarding-link-btn"]} onClick={connectGithub}>
                      Connect GitHub
                    </button>
                  ) : (
                    <span>Connect GitHub <span className={styles["onboarding-done"]}>✓ connected as @{githubConnection.githubLogin}</span></span>
                  )}
                </li>
                <li>Wait for the client to create the repository</li>
                <li>Accept the GitHub collaborator invitation</li>
                <li>Clone the repository</li>
                <li>Enter the repository directory</li>
                <li>Start an Aven work session</li>
                <li>Commit and push changes</li>
                <li>Stop and submit the session</li>
              </ol>
            ) : (
              <ol className={styles["onboarding-list"]}>
                <li>
                  {!githubConnection?.connected ? (
                    <button type="button" className={styles["onboarding-link-btn"]} onClick={connectGithub}>
                      Connect GitHub
                    </button>
                  ) : (
                    <span>Connect GitHub <span className={styles["onboarding-done"]}>✓ @{githubConnection.githubLogin}</span></span>
                  )}
                </li>
                <li><span className={styles["onboarding-done"]}>✓ Repository created</span></li>
                <li>
                  Accept the GitHub collaborator invitation from your GitHub notifications or email
                  before cloning.
                </li>
                <li>
                  <span className={styles["onboarding-step-label"]}>Clone the repository</span>
                  <div className={styles["onboarding-cmd-row"]}>
                    <code className={styles["onboarding-cmd"]}>git clone {repository.cloneUrl}</code>
                    <CopyButton value={`git clone ${repository.cloneUrl}`} label="Copy git clone command" />
                  </div>
                </li>
                <li>
                  <span className={styles["onboarding-step-label"]}>Enter the repository directory</span>
                  <div className={styles["onboarding-cmd-row"]}>
                    <code className={styles["onboarding-cmd"]}>cd {repository.name}</code>
                    <CopyButton value={`cd ${repository.name}`} label="Copy cd command" />
                  </div>
                </li>
                <li>
                  <span className={styles["onboarding-step-label"]}>Start an Aven work session</span>
                  <div className={styles["onboarding-cmd-row"]}>
                    <code className={styles["onboarding-cmd"]}>
                      {`npx aven-stellar start --stream ${id} --dashboard ${typeof window !== "undefined" ? window.location.origin : ""}`}
                    </code>
                    <CopyButton
                      value={`npx aven-stellar start --stream ${id} --dashboard ${typeof window !== "undefined" ? window.location.origin : ""}`}
                      label="Copy aven-stellar start command"
                    />
                  </div>
                </li>
                <li>
                  <span className={styles["onboarding-step-label"]}>For each work session — commit and push</span>
                  <div className={styles["onboarding-cmd-row"]}>
                    <code className={styles["onboarding-cmd"]}>git add .</code>
                    <CopyButton value="git add ." label="Copy git add command" />
                  </div>
                  <div className={styles["onboarding-cmd-row"]}>
                    <code className={styles["onboarding-cmd"]}>git commit -m &quot;Describe completed work&quot;</code>
                    <CopyButton value='git commit -m "Describe completed work"' label="Copy git commit command" />
                  </div>
                  <div className={styles["onboarding-cmd-row"]}>
                    <code className={styles["onboarding-cmd"]}>git push</code>
                    <CopyButton value="git push" label="Copy git push command" />
                  </div>
                  <div className={styles["onboarding-cmd-row"]}>
                    <code className={styles["onboarding-cmd"]}>npx aven-stellar stop</code>
                    <CopyButton value="npx aven-stellar stop" label="Copy aven-stellar stop command" />
                  </div>
                </li>
                <li>
                  <span className={styles["onboarding-step-label"]}>Final delivery — push all branches first</span>
                  <p className={styles["onboarding-final-note"]}>
                    Push all delivery branches before running{" "}
                    <code>stop --ended</code>. If any selected final-delivery branch has not been
                    pushed, the repository transfer will be blocked.
                  </p>
                  <div className={styles["onboarding-cmd-row"]}>
                    <code className={styles["onboarding-cmd"]}>git push</code>
                    <CopyButton value="git push" label="Copy final git push command" />
                  </div>
                  <div className={styles["onboarding-cmd-row"]}>
                    <code className={styles["onboarding-cmd"]}>npx aven-stellar stop --ended</code>
                    <CopyButton value="npx aven-stellar stop --ended" label="Copy aven-stellar stop --ended command" />
                  </div>
                </li>
              </ol>
            )}
          </section>
        )}

        <section className={styles["work-session-section"]}>
          <div className={styles["work-session-heading"]}>
            <div>
              <span className={styles["work-session-eyebrow"]}>STREAM / WORK RECORD</span>
              <h2>Work Sessions</h2>
            </div>
            <span className={styles["work-session-count"]}>{sessions.length.toString().padStart(2, "0")}</span>
          </div>

          <div className={styles["work-session-summary"]}>
            <div><span>Unreserved escrow</span><strong>{availableEscrow.toFixed(7)} {stream.asset}</strong></div>
            <div><span>Pending review</span><strong>{pendingAmount.toFixed(7)} {stream.asset}</strong></div>
            <div><span>Release eligible</span><strong>{releasedAmount.toFixed(7)} {stream.asset}</strong></div>
            <div><span>Disputed</span><strong>{disputedAmount.toFixed(7)} {stream.asset}</strong></div>
          </div>

          {isRecipient && (
            <div className={styles["work-session-setup"]}>
              <span>Connect a project</span>
              <code>npx aven-stellar start</code>
              <code>npx aven-stellar stop</code>
              <p>The package records Git metadata and change statistics. It does not execute your code or upload full files.</p>
            </div>
          )}

          {!address ? (
            <div className={styles["work-session-empty"]}>
              Connect the sender or recipient wallet to view private work-session metadata.
            </div>
          ) : sessionsLoading ? (
            <div className={styles["work-session-empty"]}>Loading work sessions…</div>
          ) : sessions.length === 0 ? (
            <div className={styles["work-session-empty"]}>
              No work sessions have been submitted for this stream.
            </div>
          ) : (
            <div className={styles["work-session-list"]}>
              {sessions.map((session, index) => {
                const report = session.report;
                const expanded = expandedSession === session.id;
                const actionBusy = sessionAction?.startsWith(`${session.id}:`) ?? false;
                return (
                  <article className={styles["work-session-card"]} key={session.id}>
                    <button
                      className={styles["work-session-card-header"]}
                      type="button"
                      onClick={() => setExpandedSession(expanded ? null : session.id)}
                    >
                      <div>
                        <span>Session #{sessions.length - index}</span>
                        <strong>{report ? new Date(report.session.endedAt).toLocaleDateString() : "REPORT PENDING"}</strong>
                        {report?.session.projectEnded && <code>FINAL PROJECT SESSION</code>}
                      </div>
                      <div>
                        <span>{session.status.replaceAll("_", " ")}</span>
                        <strong>{report ? formatDuration(report.session.totalSeconds) : "—"}</strong>
                      </div>
                    </button>

                    <div className={styles["work-session-card-metrics"]}>
                      <span>{report?.changes.changedFiles.length ?? 0} files changed</span>
                      <span>{report?.changes.additions.toLocaleString() ?? 0} additions</span>
                      <span>{report?.changes.deletions.toLocaleString() ?? 0} deletions</span>
                      <span>{session.requestedAmount ?? report?.paymentRequest.requestedAmount ?? "0.0000000"} {stream.asset}</span>
                    </div>

                    {session.status === "PENDING_CLIENT_REVIEW" && (
                      <div className={styles["work-session-deadline"]}>
                        {report?.session.projectEnded
                          ? "Aven dashboard requires client approval · legacy on-chain timeout still applies"
                          : deadlineLabel(session.reviewDeadlineAt)}
                      </div>
                    )}

                    {expanded && report && (
                      <div className={styles["work-session-expanded"]}>
                        <div className={styles["work-session-statement"]}>
                          <span>Worker statement</span>
                          <p>{report.workerStatement?.message ?? "No worker statement was provided."}</p>
                          {report.session.projectEnded && (
                            <p>
                              Final settlement requested. The report records{" "}
                              {report.session.activeSeconds.toLocaleString()} real active seconds;
                              the legacy contract receives{" "}
                              {report.paymentRequest.settlementSeconds ?? "a server-calculated number of"}{" "}
                              settlement-equivalent seconds.
                            </p>
                          )}
                        </div>
                        <div className={styles["work-session-verification"]}>
                          <span>Verification</span>
                          <p>{session.verificationSummary ?? report.localVerification.summary}</p>
                          {session.reportDigest && (
                            <code title={session.reportDigest}>On-chain report {session.reportDigest.slice(0, 12)}…</code>
                          )}
                          {(session.verificationFlags ?? report.localVerification.flags).length > 0 && (
                            <div>{(session.verificationFlags ?? report.localVerification.flags).map((flag) => <code key={flag}>{flag}</code>)}</div>
                          )}
                        </div>
                        <div className={styles["work-session-files"]}>
                          <span>
                            Changed files
                            {report.privacy.excludedFileCount > 0
                              ? ` · ${report.privacy.excludedFileCount} privacy-excluded`
                              : ""}
                          </span>
                          {report.changes.changedFiles.filter((file) => file.includedInVerification).map((file) => (
                            <div key={`${file.path}:${file.changeType}`}>
                              <code>{file.path}</code>
                              <span>{file.changeType} · +{file.additions ?? 0} / -{file.deletions ?? 0}</span>
                            </div>
                          ))}
                        </div>
                        <div className={styles["work-session-timeline"]}>
                          <span>Timeline</span>
                          {(session.timeline ?? []).map((event, eventIndex) => (
                            <div key={`${event.at}:${eventIndex}`}>
                              <time>{new Date(event.at).toLocaleString()}</time>
                              <strong>{event.status.replaceAll("_", " ")}</strong>
                              {event.note && <p>{event.note}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className={styles["work-session-actions"]}>
                      <button type="button" onClick={() => setExpandedSession(expanded ? null : session.id)}>
                        {expanded ? "Hide details ↑" : "View details ↓"}
                      </button>
                      {isRecipient && session.status === "VERIFICATION_COMPLETE" && (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => mutateSession(session.id, "request-withdrawal")}
                        >
                          {actionBusy
                            ? "Requesting…"
                            : report?.session.projectEnded
                              ? "Request final settlement"
                              : "Request withdrawal"}
                        </button>
                      )}
                      {isRecipient && session.status === "RELEASE_ELIGIBLE" && (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() => releaseSession(session)}
                        >
                          {actionBusy ? "Releasing…" : `Withdraw ${session.requestedAmount ?? report?.paymentRequest.requestedAmount ?? "0.0000000"} ${stream.asset}`}
                        </button>
                      )}
                      {isSender && session.status === "PENDING_CLIENT_REVIEW" && (
                        <>
                          <button data-action="approve" type="button" disabled={actionBusy} onClick={() => setApproveSession(session)}>Approve</button>
                          <button data-action="dispute" type="button" disabled={actionBusy} onClick={() => setDisputeSession(disputeSession === session.id ? null : session.id)}>Dispute</button>
                        </>
                      )}
                    </div>

                    {isSender && disputeSession === session.id && (
                      <div className={styles["work-session-dispute"]}>
                        <label htmlFor={`dispute-${session.id}`}>Explain the dispute</label>
                        <textarea
                          id={`dispute-${session.id}`}
                          value={disputeReason}
                          onChange={(event) => setDisputeReason(event.target.value)}
                          placeholder="Explain what appears incomplete or misleading (minimum 20 characters)."
                        />
                        <button
                          type="button"
                          disabled={disputeReason.trim().length < 20 || actionBusy}
                          onClick={() => mutateSession(session.id, "dispute", { reason: disputeReason })}
                        >
                          Submit dispute
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Actions */}
        {connected && (
          <div className="stream-detail-actions">
            {isSender && stream.status === "active" && (
              <button
                className="stream-action-btn stream-action-btn--warn"
                onClick={() => doAction("pause")}
                disabled={!!actionLoading}
                id="stream-pause-btn"
              >
                {actionLoading === "pause" ? "…" : "Pause Stream"}
              </button>
            )}
            {isSender && stream.status === "paused" && (
              <button
                className="stream-action-btn stream-action-btn--success"
                onClick={() => doAction("resume")}
                disabled={!!actionLoading}
                id="stream-resume-btn"
              >
                {actionLoading === "resume" ? "…" : "Resume Stream"}
              </button>
            )}
            {isSender && (stream.status === "active" || stream.status === "paused") && (
              <button
                className="stream-action-btn stream-action-btn--danger"
                onClick={() => doAction("cancel")}
                disabled={!!actionLoading}
                id="stream-cancel-btn"
              >
                {actionLoading === "cancel" ? "…" : "Cancel Stream"}
              </button>
            )}
          </div>
        )}

        {/* Explorer link */}
        <a
          className="stream-explorer-link"
          href={`${STELLAR_EXPLORER}/contract/${STREAM_CONTRACT_ID}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Stellar Expert ↗
        </a>
      </div>

      <ConfirmModal
        open={Boolean(approveSession)}
        title="Approve work session"
        description={`Approve ${approveSession?.requestedAmount ?? approveSession?.report?.paymentRequest.requestedAmount ?? "0.0000000"} ${stream.asset} for release?`}
        confirmLabel="Approve session"
        onClose={() => setApproveSession(null)}
        onConfirm={() => {
          if (approveSession) void mutateSession(approveSession.id, "approve");
        }}
      />
    </div>
  );
}
