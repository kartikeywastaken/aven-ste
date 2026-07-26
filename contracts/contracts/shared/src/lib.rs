#![no_std]

use soroban_sdk::{contracttype, Address, BytesN, String};

/// Minimum remaining TTL before we extend (30 days at ~5 s/ledger).
pub const BUMP_THRESHOLD: u32 = 518_400; // 30 * 17_280

/// Target TTL after bumping (120 days at ~5 s/ledger).
pub const BUMP_AMOUNT: u32 = 2_073_600; // 120 * 17_280

/// Backward-compatible alias — callers that imported LEDGER_BUMP keep compiling.
/// New code should use BUMP_THRESHOLD / BUMP_AMOUNT directly.
pub const LEDGER_BUMP: u32 = BUMP_THRESHOLD;

/// Seconds per ledger used to convert a per-second rate into a per-ledger rate.
pub const LEDGERS_PER_UNIT: i128 = 5;

/// Hard cap on checkpoints per stream. Keeps loops bounded.
pub const MAX_CHECKPOINTS: u32 = 30;

/// Maximum UTF-8 byte length of human-readable stream/attestation titles.
pub const MAX_TITLE_LEN: u32 = 80;

/// Hard cap on how many attestation ids reputation reads in one call.
pub const MAX_HISTORY_READ: u32 = 100;

/// Hard cap on how many ids are stored against a single address.
pub const MAX_HISTORY_LEN: u32 = 1000;

/// Maximum UTF-8 byte length of a withdrawal / work-session request ID.
pub const MAX_REQUEST_ID_LEN: u32 = 64;

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StreamStatus {
    Active,
    Paused,
    Completed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Category {
    Freelance,
    Salary,
    Bounty,
    Grant,
    AgentTask,
    Subscription,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttestationKind {
    Checkpoint,       // legacy finalized checkpoint payment
    WorkSession,      // verified npm work-session payment (verifier-backed)
    LegacyReviewed,   // legacy request_withdrawal path (no verifier)
    StreamCompletion, // one final record used for reputation scoring
}

#[contracttype]
#[derive(Clone)]
pub struct StreamRecord {
    pub id: u64,
    pub sender: Address,
    pub recipient: Address,
    pub rate_per_ledger: i128,
    pub asset: Address,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub start_ledger: u32,
    pub duration_ledgers: u32,
    pub status: StreamStatus,
    pub category: Category,
    pub title: String,
    pub paused_at_ledger: u32,
    pub paused_duration_ledgers: u32,
    pub checkpoint_count: u32,
    pub checkpoint_span_ledgers: u32,
    pub withdrawable_cap_percent: u32,
    pub approval_timeout_ledgers: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct CheckpointRecord {
    pub stream_id: u64,
    pub index: u32,
    pub due_ledger: u32,
    pub submitted: bool,
    pub evidence_hash: BytesN<32>,
    pub approved: bool,
    pub auto_approved: bool,
    pub attestation_id: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct AttestationRecord {
    pub id: u64,
    pub kind: AttestationKind,
    pub stream_id: u64,
    pub request_id: String, // session/request ID; empty string for checkpoint
    pub checkpoint_index: u32, // 0 for work-session / legacy
    pub sender: Address,
    pub recipient: Address,
    pub amount_paid: i128,
    pub asset: Address,
    pub category: Category,
    pub title: String,
    pub period_start_ledger: u32,
    pub period_end_ledger: u32,
    pub active_duration_seconds: u64, // 0 for checkpoint / legacy
    pub minted_at_ledger: u32,
    pub client_confirmed: bool,
    pub auto_released: bool, // true when deadline expired without client action
    pub verifier: Option<Address>, // None for checkpoint / legacy paths
    pub report_hash: Option<BytesN<32>>, // SHA-256 of verification report; None otherwise
}
