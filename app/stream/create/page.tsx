"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/WalletProvider";
import {
  computeStreamRatePerSecond,
  createUsdcTrustline,
  createStream,
  CREATE_STREAM_CATEGORIES,
  CreateStreamCategory,
  CreateStreamInput,
  getUsdcTrustlineStatus,
  isValidStellarAccountAddress,
} from "@/lib/stellar";
import { STELLAR_EXPLORER } from "@/lib/contracts";
import { ensureCurrentDeployment } from "@/lib/deployment-client";

type Asset = "USDC" | "XLM";
type TrustlineState = "idle" | "checking" | "ready" | "missing" | "blocked" | "error";
type CreateStep = 1 | 2 | 3 | 4;

const CREATE_STEPS: Array<{ number: CreateStep; label: string; detail: string }> = [
  { number: 1, label: "Identity", detail: "Name the agreement and its recipient." },
  { number: 2, label: "Funding", detail: "Set escrow, duration, and asset readiness." },
  { number: 3, label: "Verification", detail: "Choose how completed work is verified." },
  { number: 4, label: "Review", detail: "Confirm every term before signing." },
];

const CATEGORY_DETAILS: Record<CreateStreamCategory, { label: string; description: string }> = {
  Freelance: {
    label: "Freelance",
    description: "Client-funded work completed by an independent contributor.",
  },
  AgentTask: {
    label: "Agent Task",
    description: "A scoped task assigned to an autonomous software agent.",
  },
};

// Approximate: 5 sec/ledger on testnet
const SECONDS_PER_LEDGER = 5;
const LEDGERS_PER_HOUR = Math.round(3600 / SECONDS_PER_LEDGER);
const LEDGERS_PER_DAY = LEDGERS_PER_HOUR * 24;

export default function CreateStreamPage() {
  const { connected, address, openConnectModal } = useWallet();
  const router = useRouter();
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  const [currentStep, setCurrentStep] = useState<CreateStep>(1);
  const [recipient, setRecipient] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [durationDays, setDurationDays] = useState("7");
  const [category, setCategory] = useState<CreateStreamCategory>("Freelance");
  const [asset, setAsset] = useState<Asset>("USDC");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [addingTrustline, setAddingTrustline] = useState(false);
  const [senderTrustline, setSenderTrustline] = useState<TrustlineState>("idle");
  const [recipientTrustline, setRecipientTrustline] = useState<TrustlineState>("idle");
  const [trustlineTxHash, setTrustlineTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ streamId: string; txHash: string } | null>(null);

  const durationLedgers = durationDays ? Math.round(parseFloat(durationDays) * LEDGERS_PER_DAY) : 0;
  const computedRateValue = computeStreamRatePerSecond(
    parseFloat(totalAmount),
    durationLedgers,
  );
  const computedRate = computedRateValue > 0 ? computedRateValue.toFixed(7) : "";
  const hourlyRate = computedRateValue > 0 ? (computedRateValue * 3600).toFixed(6) : "—";

  function moveToStep(step: CreateStep) {
    setCurrentStep(step);
    setError(null);
    window.requestAnimationFrame(() => {
      stepHeadingRef.current?.focus({ preventScroll: true });
      stepHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function validateCurrentStep(): string | null {
    if (currentStep === 1) {
      if (!title.trim()) return "Give this agreement a clear title before continuing.";
      if (!isValidStellarAccountAddress(recipient.trim())) {
        return "Enter a valid Stellar recipient address starting with G.";
      }
      if (address && recipient.trim().toUpperCase() === address.trim().toUpperCase()) {
        return "Sender and recipient must be different Stellar wallets.";
      }
    }

    if (currentStep === 2) {
      const total = parseFloat(totalAmount);
      const days = parseFloat(durationDays);
      if (!total || total <= 0) return "Enter a total escrow amount greater than zero.";
      if (!days || days <= 0) return "Enter an agreement duration greater than zero days.";
    }

    return null;
  }

  function continueFlow() {
    const validationError = validateCurrentStep();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (currentStep < 4) moveToStep((currentStep + 1) as CreateStep);
  }

  useEffect(() => {
    let active = true;

    if (asset !== "USDC" || !address) {
      setSenderTrustline("idle");
      return () => { active = false; };
    }

    setSenderTrustline("checking");
    void getUsdcTrustlineStatus(address)
      .then((status) => {
        if (!active) return;
        if (!status.accountExists || !status.exists) {
          setSenderTrustline("missing");
        } else {
          setSenderTrustline(status.authorized ? "ready" : "blocked");
        }
      })
      .catch(() => {
        if (active) setSenderTrustline("error");
      });

    return () => { active = false; };
  }, [address, asset]);

  useEffect(() => {
    let active = true;
    const cleanRecipient = recipient.trim();

    if (asset !== "USDC" || !isValidStellarAccountAddress(cleanRecipient)) {
      setRecipientTrustline("idle");
      return () => { active = false; };
    }

    setRecipientTrustline("checking");
    const checkTimer = window.setTimeout(() => {
      void getUsdcTrustlineStatus(cleanRecipient)
        .then((status) => {
          if (!active) return;
          if (!status.accountExists || !status.exists) {
            setRecipientTrustline("missing");
          } else {
            setRecipientTrustline(status.authorized ? "ready" : "blocked");
          }
        })
        .catch(() => {
          if (active) setRecipientTrustline("error");
        });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(checkTimer);
    };
  }, [asset, recipient]);

  function friendlyError(raw: string): string {
    if (raw.includes("trustline entry is missing")) {
      const acct = raw.match(/GDW[A-Z0-9]{53}|G[A-Z0-9]{54}/)?.[0] ?? "your account";
      return `USDC trustline missing on ${acct.slice(0, 8)}…${acct.slice(-6)}. ` +
        `Add the Circle testnet USDC trustline from the funding section before creating a USDC stream. ` +
        `(Or switch the asset to XLM — XLM needs no trustline.)`;
    }
    if (raw.includes("insufficient funds") || raw.includes("balance would go below")) {
      return "Insufficient balance. Make sure you have enough funds to cover the stream amount plus transaction fees.";
    }
    if (raw.includes("User declined") || raw.includes("user rejected")) {
      return "Transaction was cancelled in Freighter.";
    }
    return raw;
  }

  async function handleAddUsdcTrustline() {
    if (!connected || !address) {
      openConnectModal();
      return;
    }

    setAddingTrustline(true);
    setError(null);
    setTrustlineTxHash(null);
    try {
      await ensureCurrentDeployment();
      const result = await createUsdcTrustline(address);
      setTrustlineTxHash(result.txHash);
      const status = await getUsdcTrustlineStatus(address);
      setSenderTrustline(status.exists && status.authorized ? "ready" : "blocked");
    } catch (trustlineError: any) {
      setError(friendlyError(trustlineError?.message ?? "Could not add the USDC trustline."));
    } finally {
      setAddingTrustline(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (currentStep < 4) {
      continueFlow();
      return;
    }
    if (!connected || !address) return openConnectModal();

    const total = parseFloat(totalAmount);
    const days = parseFloat(durationDays);

    if (!recipient.startsWith("G") || recipient.length < 56) {
      setError("Recipient must be a valid Stellar address starting with G");
      return;
    }
    if (recipient.trim().toUpperCase() === address.trim().toUpperCase()) {
      setError("Sender and recipient must be different Stellar wallets.");
      return;
    }
    if (!title.trim()) { setError("Title is required"); return; }
    if (!total || total <= 0) { setError("Total amount must be > 0"); return; }
    if (!days || days <= 0) { setError("Duration must be > 0"); return; }

    setLoading(true);
    setError(null);
    try {
      await ensureCurrentDeployment();
      if (asset === "USDC") {
        const senderStatus = await getUsdcTrustlineStatus(address);
        if (!senderStatus.accountExists || !senderStatus.exists || !senderStatus.authorized) {
          setSenderTrustline(senderStatus.exists ? "blocked" : "missing");
          throw new Error("Your funding wallet must add the Circle testnet USDC trustline first.");
        }

        const recipientStatus = await getUsdcTrustlineStatus(recipient);
        if (!recipientStatus.accountExists || !recipientStatus.exists || !recipientStatus.authorized) {
          setRecipientTrustline(recipientStatus.exists ? "blocked" : "missing");
          throw new Error("The recipient wallet must add the Circle testnet USDC trustline before this agreement can be created.");
        }
      }

      const input: CreateStreamInput = {
        recipient,
        totalAmount: total,
        asset,
        durationLedgers: Math.round(days * LEDGERS_PER_DAY),
        category,
        title: title.trim(),
      };
      const result = await createStream(input, address);
      setSuccess(result);
    } catch (e: any) {
      setError(friendlyError(e?.message ?? "Transaction failed. Check Freighter for details."));
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="stream-created">
        <header className="stream-created__intro">
          <div className="stream-created__mark" aria-hidden="true" />
          <div>
            <span className="stream-created__kicker">AVEN / AGREEMENT CONFIRMED</span>
            <h1>Ready for work.</h1>
            <p>
              Stream #{success.streamId} is funded on Stellar testnet. The recipient
              can now connect a project and submit npm-tracked work sessions.
            </p>
          </div>
          <div className="stream-created__status">
            <i aria-hidden="true" />
            <span>Active</span>
          </div>
        </header>

        <section className="stream-created__receipt" aria-label="Created stream receipt">
          <div className="stream-created__receipt-bar">
            <span>STREAM RECORD / #{success.streamId}</span>
            <strong>STELLAR TESTNET / ONCHAIN</strong>
          </div>

          <div className="stream-created__facts">
            <div>
              <span>Funding</span>
              <strong>Escrow locked</strong>
            </div>
            <div>
              <span>Work signal</span>
              <strong>npm active time</strong>
            </div>
            <div>
              <span>Next action</span>
              <strong>Connect project</strong>
            </div>
          </div>

          <div className="stream-created__transaction">
            <span>Transaction hash</span>
            <a
              href={`${STELLAR_EXPLORER}/tx/${success.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {success.txHash.slice(0, 12)}…{success.txHash.slice(-8)}
              <span aria-hidden="true"> ↗</span>
            </a>
          </div>

          <div className="stream-created__flow" aria-label="Stream lifecycle">
            {["Funded", "Track work", "Review", "Release"].map((step, index) => (
              <div key={step}>
                <span>0{index + 1}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>

          <footer className="stream-created__footer">
            <p>Agreement created successfully. No additional setup is required from the sender.</p>
            <div className="stream-created__actions">
              <button
                className="stream-created__primary"
                onClick={() => router.push(`/stream/${success.streamId}`)}
              >
                View stream <span aria-hidden="true">→</span>
              </button>
              <button
                className="stream-created__secondary"
                onClick={() => router.push("/dashboard")}
              >
                Dashboard
              </button>
            </div>
          </footer>
        </section>
      </div>
    );
  }

  return (
    <div className="create-stream-wrap">
      <div className="create-stream-header">
        <span className="create-stream-kicker">NEW AGREEMENT / STELLAR TESTNET</span>
        <div className="create-stream-heading">
          <h1 className="create-stream-title">
            Fund verified
            <br />
            work.
          </h1>
          <p className="create-stream-sub">
            Lock a work budget in a Stellar contract. Funds become eligible only from
            npm-tracked active work sessions that follow these terms.
          </p>
        </div>
      </div>

      {!connected && (
        <div className="create-connect-banner">
          <div>
            <strong>Wallet required</strong>
            <span>Connect the funding account before initializing this agreement.</span>
          </div>
          <button className="wallet-btn" onClick={openConnectModal} id="create-connect-wallet">
            Connect Freighter
          </button>
        </div>
      )}

      <form
        className="create-stream-form create-stream-wizard"
        onSubmit={handleSubmit}
        id="create-stream-form"
      >
        <div className="create-form-bar">
          <div>
            <span>STEP 0{currentStep} OF 04</span>
            <strong>{CREATE_STEPS[currentStep - 1].label}</strong>
          </div>
          <span>{connected ? "WALLET CONNECTED" : "AWAITING WALLET"}</span>
        </div>

        <ol className="create-step-progress" aria-label="Agreement setup progress">
          {CREATE_STEPS.map((step) => (
            <li
              className={
                step.number === currentStep
                  ? "is-current"
                  : step.number < currentStep
                    ? "is-complete"
                    : ""
              }
              key={step.number}
            >
              <button
                type="button"
                onClick={() => moveToStep(step.number)}
                disabled={step.number > currentStep}
                aria-current={step.number === currentStep ? "step" : undefined}
              >
                <span>0{step.number}</span> {step.label}
              </button>
            </li>
          ))}
        </ol>

        <div className="create-wizard-layout">
          <section className="create-wizard-stage" aria-labelledby="create-step-heading">
            <header className="create-wizard-stage__header">
              <span>0{currentStep}</span>
              <div>
                <h2 id="create-step-heading" ref={stepHeadingRef} tabIndex={-1}>
                  {CREATE_STEPS[currentStep - 1].label}
                </h2>
                <small>{CREATE_STEPS[currentStep - 1].detail}</small>
              </div>
            </header>

            {currentStep === 1 && (
              <div className="create-step-content">
                <div className="form-section">
                  <label className="form-label" htmlFor="stream-title">
                    Agreement title *
                  </label>
                  <input
                    className="form-input"
                    placeholder="Smart Contract Audit — Phase 1"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                    autoFocus
                    id="stream-title"
                  />
                  <small className="form-label-hint">
                    Use a name both parties will recognize in their stream history.
                  </small>
                </div>

                <div className="form-section">
                  <label className="form-label" htmlFor="stream-recipient">
                    Recipient Stellar address *
                  </label>
                  <input
                    className="form-input form-input--mono"
                    placeholder="G…"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    aria-describedby="stream-recipient-help"
                    required
                    id="stream-recipient"
                  />
                  <small id="stream-recipient-help" className="form-label-hint">
                    Payment can only be released to this address. It must differ from the sender.
                  </small>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="create-step-content">
                <div className="create-funding-grid">
                  <div className="form-section create-amount-field">
                    <label className="form-label" htmlFor="stream-total-amount">
                      Total escrow *
                    </label>
                    <input
                      className="form-input"
                      type="number"
                      placeholder="1000"
                      min="0"
                      step="any"
                      value={totalAmount}
                      onChange={(e) => setTotalAmount(e.target.value)}
                      required
                      id="stream-total-amount"
                    />
                  </div>
                  <div className="form-section">
                    <label className="form-label" htmlFor="stream-asset">Asset</label>
                    <select
                      className="form-select"
                      value={asset}
                      onChange={(e) => setAsset(e.target.value as Asset)}
                      id="stream-asset"
                    >
                      <option value="USDC">USDC</option>
                      <option value="XLM">XLM</option>
                    </select>
                  </div>
                  <div className="form-section">
                    <label className="form-label" htmlFor="stream-duration">Duration *</label>
                    <div className="create-input-suffix">
                      <input
                        className="form-input"
                        type="number"
                        placeholder="7"
                        min="1"
                        value={durationDays}
                        onChange={(e) => setDurationDays(e.target.value)}
                        required
                        id="stream-duration"
                      />
                      <span>Days</span>
                    </div>
                  </div>
                </div>

                {asset === "USDC" && (
                  <div className="create-trustline-card" aria-live="polite">
                    <div className="create-trustline-card__header">
                      <div>
                        <span>Circle USDC / Stellar testnet</span>
                        <strong>Trustline readiness</strong>
                      </div>
                      <small>Required to hold and release USDC</small>
                    </div>

                    <div className="create-trustline-row">
                      <div>
                        <span>Funding wallet</span>
                        <strong>
                          {!connected ? "Connect wallet" : senderTrustline === "checking" ? "Checking network…" : senderTrustline === "ready" ? "Ready" : senderTrustline === "missing" ? "Trustline required" : senderTrustline === "blocked" ? "Not authorized" : senderTrustline === "error" ? "Check failed" : "Waiting"}
                        </strong>
                      </div>
                      {connected && senderTrustline !== "ready" && senderTrustline !== "checking" && (
                        <button
                          type="button"
                          onClick={handleAddUsdcTrustline}
                          disabled={addingTrustline || senderTrustline === "blocked"}
                        >
                          {addingTrustline ? "Signing…" : "Add USDC trustline ↗"}
                        </button>
                      )}
                    </div>

                    <div className="create-trustline-row">
                      <div>
                        <span>Recipient wallet</span>
                        <strong>
                          {!isValidStellarAccountAddress(recipient) ? "Enter recipient" : recipientTrustline === "checking" ? "Checking network…" : recipientTrustline === "ready" ? "Ready" : recipientTrustline === "missing" ? "Recipient action required" : recipientTrustline === "blocked" ? "Not authorized" : recipientTrustline === "error" ? "Check failed" : "Waiting"}
                        </strong>
                      </div>
                      <small>The recipient adds this trustline from their own wallet before release.</small>
                    </div>

                    {trustlineTxHash && (
                      <a href={`${STELLAR_EXPLORER}/tx/${trustlineTxHash}`} target="_blank" rel="noopener noreferrer">
                        Trustline confirmed · View transaction ↗
                      </a>
                    )}
                  </div>
                )}

                <output className="create-rate-output" id="stream-rate" aria-live="polite">
                  <div>
                    <span>Contract-derived rate</span>
                    <strong>{computedRate || "—"}</strong>
                    <small>{asset} / active second</small>
                  </div>
                  <p>
                    Total escrow is divided across the agreement duration. The contract
                    reserves value only while verified active work is recorded.
                  </p>
                </output>
              </div>
            )}

            {currentStep === 3 && (
              <div className="create-step-content">
                <div className="create-verification-intro">
                  <strong>One agreement, two work paths.</strong>
                  <p>
                    Both paths use npm-tracked active sessions. The classification keeps
                    reputation and proof records understandable later.
                  </p>
                </div>
                <div className="form-category-grid" id="stream-category-grid">
                  {CREATE_STREAM_CATEGORIES.map((cat, index) => (
                    <button
                      key={cat}
                      type="button"
                      className={`form-cat-btn ${category === cat ? "selected" : ""}`}
                      onClick={() => setCategory(cat)}
                      id={`cat-${cat.toLowerCase()}`}
                      aria-pressed={category === cat}
                    >
                      <span>0{index + 1}</span>
                      <strong>{CATEGORY_DETAILS[cat].label}</strong>
                      <small>{CATEGORY_DETAILS[cat].description}</small>
                      <i aria-hidden="true">{category === cat ? "Selected" : "Select"} →</i>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="create-step-content create-review">
                <div className="create-review__headline">
                  <span>FINAL AGREEMENT</span>
                  <strong>{title || "Untitled agreement"}</strong>
                  <p>
                    Creating this stream locks the full escrow in the Stellar contract.
                    Review these terms before approving the transaction in Freighter.
                  </p>
                </div>
                <dl className="create-review__terms">
                  <div><dt>Recipient</dt><dd>{recipient || "—"}</dd></div>
                  <div><dt>Escrow</dt><dd>{totalAmount ? `${totalAmount} ${asset}` : "—"}</dd></div>
                  <div><dt>Duration</dt><dd>{durationDays ? `${durationDays} days` : "—"}</dd></div>
                  <div><dt>Hourly equivalent</dt><dd>{hourlyRate === "—" ? "—" : `${hourlyRate} ${asset}`}</dd></div>
                  <div><dt>Work type</dt><dd>{CATEGORY_DETAILS[category].label}</dd></div>
                  <div><dt>Network</dt><dd>Stellar testnet</dd></div>
                </dl>
                <div className="create-review__notice">
                  <strong>What happens next</strong>
                  <p>
                    Freighter opens once. After signing, the recipient can attach a project,
                    submit tracked sessions, and build a verifiable work record.
                  </p>
                </div>
              </div>
            )}

            {error && <div className="form-error">{error}</div>}

            <footer className="create-wizard-actions">
              <button
                className="create-wizard-back"
                type="button"
                onClick={() => moveToStep((currentStep - 1) as CreateStep)}
                disabled={currentStep === 1 || loading}
              >
                ← Back
              </button>
              {currentStep < 4 ? (
                <button className="create-wizard-next" type="button" onClick={continueFlow}>
                  Continue <span>→</span>
                </button>
              ) : (
                <button
                  className="form-submit-btn"
                  type="submit"
                  disabled={loading || !connected || (asset === "USDC" && senderTrustline !== "ready")}
                  id="create-stream-submit"
                >
                  {loading ? <span className="form-spinner" /> : <><span>Initialize agreement</span><span>↗</span></>}
                </button>
              )}
            </footer>
          </section>

        </div>
      </form>
    </div>
  );
}
