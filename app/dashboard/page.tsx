"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/WalletProvider";
import { getSenderStreams, getRecipientStreams, StreamObject, getWorkerAttestations } from "@/lib/stellar";
import { pauseStream, resumeStream, cancelStream } from "@/lib/stellar";
import { ensureCurrentDeployment } from "@/lib/deployment-client";
import "./dashboard-v2.css";

type Tab = "sending" | "receiving";

const isOpenStream = (stream: StreamObject) =>
  stream.status === "active" || stream.status === "paused";

const STATUS_COLOR: Record<string, string> = {
  active: "#22c55e",
  paused: "#f59e0b",
  completed: "#6366f1",
  cancelled: "#ef4444",
};

const CATEGORY_COLORS: Record<string, string> = {
  Freelance: "#8b5cf6",
  Salary: "#06b6d4",
  Bounty: "#f97316",
  Grant: "#10b981",
  AgentTask: "#ec4899",
  Subscription: "#64748b",
};

export default function DashboardPage() {
  const { connected, address, openConnectModal } = useWallet();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("sending");
  const [sendingStreams, setSendingStreams] = useState<StreamObject[]>([]);
  const [receivingStreams, setReceivingStreams] = useState<StreamObject[]>([]);
  const [totalReceived, setTotalReceived] = useState(0);
  const [attestationCount, setAttestationCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const [sent, received, attestations] = await Promise.all([
        getSenderStreams(address),
        getRecipientStreams(address),
        getWorkerAttestations(address),
      ]);
      // Terminal streams remain immutable on Stellar and reachable by direct
      // URL, but the dashboard focuses on work that can still be managed.
      setSendingStreams(sent.filter(isOpenStream));
      setReceivingStreams(received.filter(isOpenStream));
      setTotalReceived(received.reduce((sum, stream) => sum + stream.totalWithdrawn, 0));
      setAttestationCount(attestations.length);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load streams");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (connected) load();
  }, [connected, load]);

  const streams = tab === "sending" ? sendingStreams : receivingStreams;
  const activeCount = [...sendingStreams, ...receivingStreams].filter((s) => s.status === "active").length;

  async function handleAction(action: string, stream: StreamObject) {
    if (!address) return;
    const key = `${action}-${stream.id}`;
    setActionLoading(key);
    try {
      await ensureCurrentDeployment();
      if (action === "pause") await pauseStream(stream.id, address);
      if (action === "resume") await resumeStream(stream.id, address);
      if (action === "cancel") await cancelStream(stream.id, address);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Transaction failed");
    } finally {
      setActionLoading(null);
    }
  }

  if (!connected) {
    return (
      <div className="dashboard-wrap dashboard-wrap--empty">
        <div className="dash-empty-state">
          <div className="dash-empty-icon">◇</div>
          <h2>Connect Your Wallet</h2>
          <p>Connect your Freighter wallet to view and manage your payment streams.</p>
          <button className="dash-connect-btn" onClick={openConnectModal} id="dashboard-connect-wallet">
            Connect Freighter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-wrap">
      <header className="app-page-header">
        <span className="app-page-kicker">AVEN / STREAMS</span>
        <h1>Payment Streams</h1>
        <p>Manage funded work, verified session payments, and on-chain records.</p>
      </header>
      <section className="dash-stats" aria-label="Stream overview">
        <div className="dash-stat">
          <div className="dash-stat-value">{activeCount}</div>
          <div className="dash-stat-label">Active Streams</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">{totalReceived.toFixed(2)}</div>
          <div className="dash-stat-label">Total Received</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">{attestationCount}</div>
          <div className="dash-stat-label">Attestations</div>
        </div>
      </section>

      <div className="dash-header">
        <div className="dash-tabs">
          <button
            className={`dash-tab ${tab === "sending" ? "active" : ""}`}
            onClick={() => setTab("sending")}
          >
            Sending ({sendingStreams.length})
          </button>
          <button
            className={`dash-tab ${tab === "receiving" ? "active" : ""}`}
            onClick={() => setTab("receiving")}
          >
            Receiving ({receivingStreams.length})
          </button>
        </div>
        <button
          className="dash-create-btn"
          onClick={() => router.push("/stream/create")}
          id="dashboard-create-stream"
        >
          + New Stream
        </button>
      </div>

      {error && <div className="dash-error">{error}</div>}

      {loading ? (
        <div className="dash-loading">
          <div className="dash-spinner" />
          <span>Loading on-chain streams…</span>
        </div>
      ) : streams.length === 0 ? (
        <div className="dash-no-streams">
          <p>No active {tab} streams found.</p>
          {tab === "sending" && (
            <button className="dash-create-btn" onClick={() => router.push("/stream/create")}>
              Create your first stream →
            </button>
          )}
        </div>
      ) : (
        <div className="stream-list">
          {streams.map((stream) => (
            <StreamCard
              key={stream.id}
              stream={stream}
              isSender={tab === "sending"}
              address={address!}
              actionLoading={actionLoading}
              onAction={handleAction}
              onView={() => router.push(`/stream/${stream.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StreamCard({
  stream,
  isSender,
  address,
  actionLoading,
  onAction,
  onView,
}: {
  stream: StreamObject;
  isSender: boolean;
  address: string;
  actionLoading: string | null;
  onAction: (action: string, stream: StreamObject) => void;
  onView: () => void;
}) {
  const isLoading = (action: string) => actionLoading === `${action}-${stream.id}`;
  const pct = stream.totalDeposited > 0
    ? Math.min(100, (stream.totalWithdrawn / stream.totalDeposited) * 100)
    : 0;

  return (
    <article className={`stream-card stream-card--${stream.status}`} onClick={onView}>
      <div className="stream-card-header">
        <div>
          <div className="stream-card-title">{stream.title}</div>
          <div className="stream-card-meta">
            <span className="stream-cat-badge" style={{ background: CATEGORY_COLORS[stream.category] }}>
              {stream.category}
            </span>
            <span className="stream-asset-badge">{stream.asset}</span>
          </div>
        </div>
        <div className="stream-card-status" title={stream.status}>
          <i style={{ background: STATUS_COLOR[stream.status] }} aria-hidden="true" />
          <span>{stream.status}</span>
        </div>
      </div>

      <div className="stream-card-amounts" aria-label="Stream payment progress">
        <span className="stream-amount-withdrawn">
          {stream.totalWithdrawn.toFixed(4)} {stream.asset}
        </span>
        <span className="stream-amount-total">
          of {stream.totalDeposited.toFixed(2)} {stream.asset}
        </span>
        <span className="stream-amount-percent">{pct.toFixed(0)}%</span>
      </div>

      <div className="stream-progress-bar">
        <div className="stream-progress-fill" style={{ width: `${pct}%`, background: STATUS_COLOR[stream.status] }} />
      </div>

      <div className="stream-card-footer" onClick={(e) => e.stopPropagation()}>
        {isSender ? (
          <>
            {stream.status === "active" && (
              <button
                className="stream-action-btn stream-action-btn--warn"
                onClick={() => onAction("pause", stream)}
                disabled={isLoading("pause")}
              >
                {isLoading("pause") ? "…" : "Pause"}
              </button>
            )}
            {stream.status === "paused" && (
              <button
                className="stream-action-btn stream-action-btn--success"
                onClick={() => onAction("resume", stream)}
                disabled={isLoading("resume")}
              >
                {isLoading("resume") ? "…" : "Resume"}
              </button>
            )}
            {(stream.status === "active" || stream.status === "paused") && (
              <button
                className="stream-action-btn stream-action-btn--danger"
                onClick={() => onAction("cancel", stream)}
                disabled={isLoading("cancel")}
              >
                {isLoading("cancel") ? "…" : "Cancel"}
              </button>
            )}
          </>
        ) : null}
        <button className="stream-view-btn" onClick={onView}>
          View →
        </button>
      </div>
    </article>
  );
}
