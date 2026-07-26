#![no_std]

use shared::{
    AttestationKind, Category, StreamRecord, StreamStatus, BUMP_AMOUNT, BUMP_THRESHOLD,
    LEDGERS_PER_UNIT, MAX_HISTORY_LEN, MAX_TITLE_LEN,
};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, vec, Address,
    BytesN, Env, IntoVal, String, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    AttestationContract,
    NextStreamId,
    Stream(u64),
    SenderStreams(Address),
    RecipientStreams(Address),
    Withdrawal(u64, String),
    ReservedWithdrawals(u64),
    Verifier,
    AllowedAsset(Address),
}

const MAX_WITHDRAWAL_REQUEST_ID_LEN: u32 = 64;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WithdrawalStatus {
    Pending,
    Approved,
    Disputed,
    Withdrawn,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawalRecord {
    pub stream_id: u64,
    pub request_id: String,
    pub amount: i128,
    pub requested_at_ledger: u32,
    pub deadline_ledger: u32,
    pub status: WithdrawalStatus,
    pub evidence_hash: Option<BytesN<32>>,
    pub work_start_ledger: u32,
    pub active_duration_seconds: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidRate = 3,
    InvalidDeposit = 4,
    InvalidDuration = 5,
    TitleTooLong = 6,
    InsufficientDeposit = 7,
    StreamNotFound = 8,
    NotSender = 9,
    NotRecipient = 10,
    WrongStatus = 11,
    NothingToWithdraw = 12,
    Overflow = 13,
    HistoryFull = 14,
    InvalidCheckpointCount = 15,
    DurationNotDivisible = 16,
    InvalidCapPercent = 17,
    InvalidTimeout = 18,
    IndexOutOfRange = 19,
    CheckpointNotSubmitted = 20,
    CheckpointAlreadyFinalized = 21,
    InvalidRequestId = 22,
    InvalidAmount = 23,
    AmountExceedsWithdrawable = 24,
    WithdrawalNotFound = 25,
    WithdrawalAlreadyExists = 26,
    WithdrawalNotApproved = 27,
    WithdrawalDisputed = 28,
    WithdrawalApprovalRequired = 29,
    NotAdmin = 30,
    VerifierNotConfigured = 31,
    VerificationRequired = 32,
    SenderMatchesRecipient = 33,
    InvalidActiveDuration = 34,
    PaymentMismatch = 35,
    OutstandingWithdrawals = 36,
    AssetNotAllowed = 37,
}

#[contractevent(topics = ["stream_created"])]
pub struct StreamCreated {
    #[topic]
    pub stream_id: u64,
    #[topic]
    pub sender: Address,
    #[topic]
    pub recipient: Address,
    pub asset: Address,
    pub total_deposited: i128,
}

#[contractevent(topics = ["work_verified"])]
pub struct WorkVerified {
    #[topic]
    pub stream_id: u64,
    #[topic]
    pub recipient: Address,
    pub request_id: String,
    pub amount: i128,
    pub active_duration_seconds: u64,
    pub evidence_hash: BytesN<32>,
    pub deadline_ledger: u32,
}

#[contractevent(topics = ["withdrawal_requested"])]
pub struct WithdrawalRequested {
    #[topic]
    pub stream_id: u64,
    #[topic]
    pub recipient: Address,
    pub request_id: String,
    pub amount: i128,
    pub deadline_ledger: u32,
}

#[contractevent(topics = ["withdrawal_approved"])]
pub struct WithdrawalApproved {
    #[topic]
    pub stream_id: u64,
    #[topic]
    pub sender: Address,
    pub request_id: String,
}

#[contractevent(topics = ["withdrawal_disputed"])]
pub struct WithdrawalDisputed {
    #[topic]
    pub stream_id: u64,
    #[topic]
    pub sender: Address,
    pub request_id: String,
}

#[contractevent(topics = ["stream_withdrawn"])]
pub struct StreamWithdrawn {
    #[topic]
    pub stream_id: u64,
    #[topic]
    pub recipient: Address,
    pub amount: i128,
}

#[contractevent(topics = ["stream_paused"])]
pub struct StreamPaused {
    #[topic]
    pub stream_id: u64,
    pub paused_at_ledger: u32,
}

#[contractevent(topics = ["stream_resumed"])]
pub struct StreamResumed {
    #[topic]
    pub stream_id: u64,
    pub resumed_at_ledger: u32,
}

#[contractevent(topics = ["stream_cancelled"])]
pub struct StreamCancelled {
    #[topic]
    pub stream_id: u64,
    pub paid_to_recipient: i128,
    pub refunded_to_sender: i128,
}

#[contract]
pub struct StreamContract;

#[contractimpl]
impl StreamContract {
    pub fn __constructor(env: Env, admin: Address, attestation_contract: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AttestationContract, &attestation_contract);
        env.storage().instance().set(&DataKey::NextStreamId, &1u64);
        bump_instance(&env);
    }

    /// Legacy init — kept so existing deployed instances can still be called during
    /// a migration window, but new deployments use `__constructor`.
    pub fn init(env: Env, admin: Address, attestation_contract: Address) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AttestationContract, &attestation_contract);
        env.storage().instance().set(&DataKey::NextStreamId, &1u64);
        bump_instance(&env);
        Ok(())
    }

    /// Return the current stored administrator address.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Transfer administrator rights to a new address.
    /// The *stored* admin must authenticate — not a caller-supplied address.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
        Ok(())
    }

    /// Replace the running contract WASM while preserving the contract ID,
    /// all storage, all streams, and all withdrawal records.
    /// Only the stored admin may call this.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        bump_instance(&env);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Return the current verifier address, if configured.
    pub fn get_verifier(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Verifier)
    }

    pub fn set_verifier(env: Env, admin: Address, verifier: Address) -> Result<(), Error> {
        let expected: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        expected.require_auth();
        if admin != expected {
            return Err(Error::NotAdmin);
        }
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        bump_instance(&env);
        Ok(())
    }

    // ─── Asset allowlist ───────────────────────────────────────────────────────

    /// Approve an asset for use in new streams. Only the stored admin may call this.
    pub fn add_allowed_asset(env: Env, asset: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let key = DataKey::AllowedAsset(asset);
        env.storage().instance().set(&key, &true);
        bump_instance(&env);
        Ok(())
    }

    /// Remove an asset from the allowlist. Existing streams using it are unaffected.
    pub fn remove_allowed_asset(env: Env, asset: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        let key = DataKey::AllowedAsset(asset);
        env.storage().instance().remove(&key);
        bump_instance(&env);
        Ok(())
    }

    /// Return whether an asset is currently approved for new streams.
    pub fn is_allowed_asset(env: Env, asset: Address) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::AllowedAsset(asset))
            .unwrap_or(false)
    }

    /// Reserves payment for one npm-tracked work session.
    ///
    /// The verifier cannot choose an arbitrary amount: the contract recomputes
    /// `rate_per_second * active_duration_seconds` and caps it at the unreserved
    /// escrow remaining. Ledger time and checkpoints do not unlock funds.
    pub fn verify_work(
        env: Env,
        stream_id: u64,
        request_id: String,
        amount: i128,
        evidence_hash: BytesN<32>,
        active_duration_seconds: u64,
        work_start_ledger: u32,
    ) -> Result<(), Error> {
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(Error::VerifierNotConfigured)?;
        verifier.require_auth();
        bump_instance(&env);

        let stream = load_stream(&env, stream_id)?;
        require_payable_status(&stream)?;
        validate_request_id(&request_id)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if active_duration_seconds == 0 {
            return Err(Error::InvalidActiveDuration);
        }

        let key = DataKey::Withdrawal(stream_id, request_id.clone());
        if let Some(existing) = env.storage().persistent().get::<_, WithdrawalRecord>(&key) {
            if existing.amount == amount
                && existing.evidence_hash == Some(evidence_hash.clone())
                && existing.active_duration_seconds == active_duration_seconds
                && existing.work_start_ledger == work_start_ledger
                && (existing.status == WithdrawalStatus::Pending
                    || existing.status == WithdrawalStatus::Approved)
            {
                return Ok(());
            }
            return Err(Error::WithdrawalAlreadyExists);
        }

        let available = remaining_unreserved(&env, &stream)?;
        if available <= 0 {
            return Err(Error::AmountExceedsWithdrawable);
        }
        let rate_per_second = stream.rate_per_ledger / LEDGERS_PER_UNIT;
        let tracked_amount = rate_per_second
            .checked_mul(active_duration_seconds as i128)
            .ok_or(Error::Overflow)?;
        let expected_amount = if tracked_amount > available {
            available
        } else {
            tracked_amount
        };
        if amount != expected_amount {
            return Err(Error::PaymentMismatch);
        }

        let requested_at_ledger = env.ledger().sequence();
        let deadline_ledger = requested_at_ledger
            .checked_add(stream.approval_timeout_ledgers)
            .ok_or(Error::Overflow)?;
        let record = WithdrawalRecord {
            stream_id,
            request_id: request_id.clone(),
            amount,
            requested_at_ledger,
            deadline_ledger,
            status: WithdrawalStatus::Pending,
            evidence_hash: Some(evidence_hash.clone()),
            work_start_ledger,
            active_duration_seconds,
        };
        save_withdrawal(&env, &record);
        save_reserved(
            &env,
            stream_id,
            load_reserved(&env, stream_id)
                .checked_add(amount)
                .ok_or(Error::Overflow)?,
        );

        WorkVerified {
            stream_id,
            recipient: stream.recipient,
            request_id,
            amount,
            active_duration_seconds,
            evidence_hash,
            deadline_ledger,
        }
        .publish(&env);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_stream(
        env: Env,
        sender: Address,
        recipient: Address,
        rate_per_second: i128,
        asset: Address,
        total_deposited: i128,
        duration_ledgers: u32,
        checkpoint_count: u32,
        withdrawable_cap_percent: u32,
        approval_timeout_ledgers: u32,
        category: Category,
        title: String,
    ) -> Result<u64, Error> {
        sender.require_auth();
        bump_instance(&env);
        require_initialized(&env)?;

        if sender == recipient {
            return Err(Error::SenderMatchesRecipient);
        }
        if rate_per_second <= 0 {
            return Err(Error::InvalidRate);
        }
        if total_deposited <= 0 {
            return Err(Error::InvalidDeposit);
        }
        if duration_ledgers == 0 {
            return Err(Error::InvalidDuration);
        }
        if title.len() > MAX_TITLE_LEN {
            return Err(Error::TitleTooLong);
        }
        if approval_timeout_ledgers == 0 {
            return Err(Error::InvalidTimeout);
        }

        let rate_per_ledger = rate_per_second
            .checked_mul(LEDGERS_PER_UNIT)
            .ok_or(Error::Overflow)?;
        let required = rate_per_ledger
            .checked_mul(duration_ledgers as i128)
            .ok_or(Error::Overflow)?;
        if total_deposited < required {
            return Err(Error::InsufficientDeposit);
        }

        if !env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::AllowedAsset(asset.clone()))
            .unwrap_or(false)
        {
            return Err(Error::AssetNotAllowed);
        }

        token::Client::new(&env, &asset).transfer(
            &sender,
            env.current_contract_address(),
            &total_deposited,
        );

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextStreamId)
            .unwrap_or(1u64);
        env.storage().instance().set(
            &DataKey::NextStreamId,
            &id.checked_add(1).ok_or(Error::Overflow)?,
        );

        // These three legacy fields remain in StreamRecord so existing clients
        // can decode it, but the npm work-session flow is the only unlock path.
        let _ = checkpoint_count;
        let _ = withdrawable_cap_percent;
        let record = StreamRecord {
            id,
            sender: sender.clone(),
            recipient: recipient.clone(),
            rate_per_ledger,
            asset,
            total_deposited,
            total_withdrawn: 0,
            start_ledger: env.ledger().sequence(),
            duration_ledgers,
            status: StreamStatus::Active,
            category,
            title,
            paused_at_ledger: 0,
            paused_duration_ledgers: 0,
            checkpoint_count: 0,
            checkpoint_span_ledgers: 0,
            withdrawable_cap_percent: 0,
            approval_timeout_ledgers,
        };

        save_stream(&env, &record);
        append_id(&env, DataKey::SenderStreams(sender), id)?;
        append_id(&env, DataKey::RecipientStreams(recipient.clone()), id)?;

        StreamCreated {
            stream_id: id,
            sender: record.sender.clone(),
            recipient,
            asset: record.asset.clone(),
            total_deposited,
        }
        .publish(&env);
        Ok(id)
    }

    /// Legacy direct requests are disabled whenever the npm verifier is configured.
    pub fn request_withdrawal(
        env: Env,
        stream_id: u64,
        recipient: Address,
        request_id: String,
        amount: i128,
    ) -> Result<(), Error> {
        recipient.require_auth();
        bump_instance(&env);
        if env.storage().instance().has(&DataKey::Verifier) {
            return Err(Error::VerificationRequired);
        }

        let stream = load_stream(&env, stream_id)?;
        if recipient != stream.recipient {
            return Err(Error::NotRecipient);
        }
        require_payable_status(&stream)?;
        validate_request_id(&request_id)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if amount > remaining_unreserved(&env, &stream)? {
            return Err(Error::AmountExceedsWithdrawable);
        }

        let key = DataKey::Withdrawal(stream_id, request_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::WithdrawalAlreadyExists);
        }
        let requested_at_ledger = env.ledger().sequence();
        let deadline_ledger = requested_at_ledger
            .checked_add(stream.approval_timeout_ledgers)
            .ok_or(Error::Overflow)?;
        let record = WithdrawalRecord {
            stream_id,
            request_id: request_id.clone(),
            amount,
            requested_at_ledger,
            deadline_ledger,
            status: WithdrawalStatus::Pending,
            evidence_hash: None,
            work_start_ledger: 0,
            active_duration_seconds: 0,
        };
        save_withdrawal(&env, &record);
        save_reserved(
            &env,
            stream_id,
            load_reserved(&env, stream_id)
                .checked_add(amount)
                .ok_or(Error::Overflow)?,
        );
        WithdrawalRequested {
            stream_id,
            recipient,
            request_id,
            amount,
            deadline_ledger,
        }
        .publish(&env);
        Ok(())
    }

    pub fn approve_withdrawal(
        env: Env,
        stream_id: u64,
        sender: Address,
        request_id: String,
    ) -> Result<(), Error> {
        sender.require_auth();
        bump_instance(&env);
        let stream = load_stream(&env, stream_id)?;
        if sender != stream.sender {
            return Err(Error::NotSender);
        }
        let mut record = load_withdrawal(&env, stream_id, &request_id)?;
        match record.status {
            WithdrawalStatus::Pending => record.status = WithdrawalStatus::Approved,
            WithdrawalStatus::Approved => return Ok(()),
            WithdrawalStatus::Disputed => return Err(Error::WithdrawalDisputed),
            WithdrawalStatus::Withdrawn => return Err(Error::WithdrawalAlreadyExists),
        }
        save_withdrawal(&env, &record);
        WithdrawalApproved {
            stream_id,
            sender,
            request_id,
        }
        .publish(&env);
        Ok(())
    }

    pub fn dispute_withdrawal(
        env: Env,
        stream_id: u64,
        sender: Address,
        request_id: String,
    ) -> Result<(), Error> {
        sender.require_auth();
        bump_instance(&env);
        let stream = load_stream(&env, stream_id)?;
        if sender != stream.sender {
            return Err(Error::NotSender);
        }
        let mut record = load_withdrawal(&env, stream_id, &request_id)?;
        match record.status {
            WithdrawalStatus::Pending => record.status = WithdrawalStatus::Disputed,
            WithdrawalStatus::Disputed => return Ok(()),
            WithdrawalStatus::Approved | WithdrawalStatus::Withdrawn => {
                return Err(Error::WithdrawalAlreadyExists)
            }
        }
        save_reserved(
            &env,
            stream_id,
            load_reserved(&env, stream_id)
                .checked_sub(record.amount)
                .ok_or(Error::Overflow)?,
        );
        save_withdrawal(&env, &record);
        WithdrawalDisputed {
            stream_id,
            sender,
            request_id,
        }
        .publish(&env);
        Ok(())
    }

    pub fn withdraw_approved(
        env: Env,
        stream_id: u64,
        recipient: Address,
        request_id: String,
    ) -> Result<i128, Error> {
        recipient.require_auth();
        bump_instance(&env);
        let mut stream = load_stream(&env, stream_id)?;
        if recipient != stream.recipient {
            return Err(Error::NotRecipient);
        }
        require_payable_status(&stream)?;
        let mut record = load_withdrawal(&env, stream_id, &request_id)?;
        let auto_released = match record.status {
            WithdrawalStatus::Approved => false,
            WithdrawalStatus::Pending if env.ledger().sequence() >= record.deadline_ledger => true,
            WithdrawalStatus::Pending => return Err(Error::WithdrawalNotApproved),
            WithdrawalStatus::Disputed => return Err(Error::WithdrawalDisputed),
            WithdrawalStatus::Withdrawn => return Err(Error::NothingToWithdraw),
        };

        let next_total = stream
            .total_withdrawn
            .checked_add(record.amount)
            .ok_or(Error::Overflow)?;
        if next_total > stream.total_deposited {
            return Err(Error::AmountExceedsWithdrawable);
        }
        let next_reserved = load_reserved(&env, stream_id)
            .checked_sub(record.amount)
            .ok_or(Error::Overflow)?;
        let completed = next_total == stream.total_deposited;

        stream.total_withdrawn = next_total;
        if completed {
            stream.status = StreamStatus::Completed;
        }
        record.status = WithdrawalStatus::Withdrawn;
        save_stream(&env, &stream);
        save_reserved(&env, stream_id, next_reserved);
        save_withdrawal(&env, &record);

        token::Client::new(&env, &stream.asset).transfer(
            &env.current_contract_address(),
            &recipient,
            &record.amount,
        );

        let kind = if record.evidence_hash.is_some() {
            AttestationKind::WorkSession
        } else {
            AttestationKind::LegacyReviewed
        };
        let verifier = if kind == AttestationKind::WorkSession {
            env.storage().instance().get(&DataKey::Verifier)
        } else {
            None
        };
        let period_start = if record.work_start_ledger > 0 {
            record.work_start_ledger
        } else {
            record.requested_at_ledger
        };
        let client_confirmed = !auto_released;
        mint_attestation(
            &env,
            &stream,
            kind,
            request_id,
            record.amount,
            period_start,
            env.ledger().sequence(),
            record.active_duration_seconds,
            client_confirmed,
            auto_released,
            verifier,
            record.evidence_hash,
        )?;

        // Reputation consumes only this one completion record, so the score is
        // calculated once per completed stream and never drifts with ledger time.
        if completed {
            mint_attestation(
                &env,
                &stream,
                AttestationKind::StreamCompletion,
                String::from_str(&env, "stream-completion"),
                stream.total_withdrawn,
                stream.start_ledger,
                env.ledger().sequence(),
                0,
                client_confirmed,
                auto_released,
                None,
                None,
            )?;
        }

        StreamWithdrawn {
            stream_id,
            recipient,
            amount: record.amount,
        }
        .publish(&env);
        Ok(record.amount)
    }

    pub fn get_withdrawal(
        env: Env,
        stream_id: u64,
        request_id: String,
    ) -> Result<WithdrawalRecord, Error> {
        load_withdrawal(&env, stream_id, &request_id)
    }

    /// Unreserved escrow still available for future npm work sessions.
    pub fn compute_available(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = load_stream(&env, stream_id)?;
        if stream.status == StreamStatus::Cancelled {
            return Ok(0);
        }
        remaining_unreserved(&env, &stream)
    }

    /// Total value already measured by submitted npm sessions.
    pub fn compute_earned(env: Env, stream_id: u64) -> Result<i128, Error> {
        let stream = load_stream(&env, stream_id)?;
        stream
            .total_withdrawn
            .checked_add(load_reserved(&env, stream_id))
            .ok_or(Error::Overflow)
    }

    pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        bump_instance(&env);
        let mut stream = load_stream(&env, stream_id)?;
        if caller != stream.sender {
            return Err(Error::NotSender);
        }
        if stream.status != StreamStatus::Active {
            return Err(Error::WrongStatus);
        }
        stream.status = StreamStatus::Paused;
        stream.paused_at_ledger = env.ledger().sequence();
        save_stream(&env, &stream);
        StreamPaused {
            stream_id,
            paused_at_ledger: stream.paused_at_ledger,
        }
        .publish(&env);
        Ok(())
    }

    pub fn resume_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        bump_instance(&env);
        let mut stream = load_stream(&env, stream_id)?;
        if caller != stream.sender {
            return Err(Error::NotSender);
        }
        if stream.status != StreamStatus::Paused {
            return Err(Error::WrongStatus);
        }
        let now = env.ledger().sequence();
        stream.paused_duration_ledgers = stream
            .paused_duration_ledgers
            .checked_add(now.saturating_sub(stream.paused_at_ledger))
            .ok_or(Error::Overflow)?;
        stream.paused_at_ledger = 0;
        stream.status = StreamStatus::Active;
        save_stream(&env, &stream);
        StreamResumed {
            stream_id,
            resumed_at_ledger: now,
        }
        .publish(&env);
        Ok(())
    }

    pub fn cancel_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        bump_instance(&env);
        let mut stream = load_stream(&env, stream_id)?;
        if caller != stream.sender {
            return Err(Error::NotSender);
        }
        if stream.status != StreamStatus::Active && stream.status != StreamStatus::Paused {
            return Err(Error::WrongStatus);
        }
        if load_reserved(&env, stream_id) != 0 {
            return Err(Error::OutstandingWithdrawals);
        }

        let refund = stream
            .total_deposited
            .checked_sub(stream.total_withdrawn)
            .ok_or(Error::Overflow)?;
        stream.status = StreamStatus::Cancelled;
        save_stream(&env, &stream);
        if refund > 0 {
            token::Client::new(&env, &stream.asset).transfer(
                &env.current_contract_address(),
                &stream.sender,
                &refund,
            );
        }
        StreamCancelled {
            stream_id,
            paid_to_recipient: 0,
            refunded_to_sender: refund,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_stream(env: Env, stream_id: u64) -> Result<StreamRecord, Error> {
        load_stream(&env, stream_id)
    }

    pub fn get_sender_streams(env: Env, sender: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::SenderStreams(sender))
            .unwrap_or(vec![&env])
    }

    pub fn get_recipient_streams(env: Env, recipient: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::RecipientStreams(recipient))
            .unwrap_or(vec![&env])
    }
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
}

fn require_initialized(env: &Env) -> Result<(), Error> {
    if env.storage().instance().has(&DataKey::AttestationContract) {
        Ok(())
    } else {
        Err(Error::NotInitialized)
    }
}

fn validate_request_id(request_id: &String) -> Result<(), Error> {
    if request_id.is_empty() || request_id.len() > MAX_WITHDRAWAL_REQUEST_ID_LEN {
        Err(Error::InvalidRequestId)
    } else {
        Ok(())
    }
}

fn require_payable_status(stream: &StreamRecord) -> Result<(), Error> {
    if stream.status == StreamStatus::Active || stream.status == StreamStatus::Paused {
        Ok(())
    } else {
        Err(Error::WrongStatus)
    }
}

fn remaining_unreserved(env: &Env, stream: &StreamRecord) -> Result<i128, Error> {
    let remaining = stream
        .total_deposited
        .checked_sub(stream.total_withdrawn)
        .ok_or(Error::Overflow)?
        .checked_sub(load_reserved(env, stream.id))
        .ok_or(Error::Overflow)?;
    Ok(if remaining < 0 { 0 } else { remaining })
}

#[allow(clippy::too_many_arguments)]
fn mint_attestation(
    env: &Env,
    stream: &StreamRecord,
    kind: AttestationKind,
    request_id: String,
    amount_paid: i128,
    period_start: u32,
    period_end: u32,
    active_duration_seconds: u64,
    client_confirmed: bool,
    auto_released: bool,
    verifier: Option<Address>,
    report_hash: Option<BytesN<32>>,
) -> Result<u64, Error> {
    let attestation_contract: Address = env
        .storage()
        .instance()
        .get(&DataKey::AttestationContract)
        .ok_or(Error::NotInitialized)?;
    let args: Vec<soroban_sdk::Val> = vec![
        env,
        env.current_contract_address().into_val(env),
        kind.into_val(env),
        stream.id.into_val(env),
        request_id.into_val(env),
        0u32.into_val(env),
        stream.sender.clone().into_val(env),
        stream.recipient.clone().into_val(env),
        amount_paid.into_val(env),
        stream.asset.clone().into_val(env),
        stream.category.clone().into_val(env),
        stream.title.clone().into_val(env),
        period_start.into_val(env),
        period_end.into_val(env),
        active_duration_seconds.into_val(env),
        client_confirmed.into_val(env),
        auto_released.into_val(env),
        verifier.into_val(env),
        report_hash.into_val(env),
    ];
    Ok(env.invoke_contract(
        &attestation_contract,
        &Symbol::new(env, "mint_attestation"),
        args,
    ))
}

fn save_stream(env: &Env, stream: &StreamRecord) {
    let key = DataKey::Stream(stream.id);
    env.storage().persistent().set(&key, stream);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
}

fn load_stream(env: &Env, stream_id: u64) -> Result<StreamRecord, Error> {
    let key = DataKey::Stream(stream_id);
    let stream = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::StreamNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
    Ok(stream)
}

fn load_reserved(env: &Env, stream_id: u64) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::ReservedWithdrawals(stream_id))
        .unwrap_or(0)
}

fn save_reserved(env: &Env, stream_id: u64, amount: i128) {
    let key = DataKey::ReservedWithdrawals(stream_id);
    env.storage().persistent().set(&key, &amount);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
}

fn load_withdrawal(
    env: &Env,
    stream_id: u64,
    request_id: &String,
) -> Result<WithdrawalRecord, Error> {
    let key = DataKey::Withdrawal(stream_id, request_id.clone());
    let record = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(Error::WithdrawalNotFound)?;
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
    Ok(record)
}

fn save_withdrawal(env: &Env, record: &WithdrawalRecord) {
    let key = DataKey::Withdrawal(record.stream_id, record.request_id.clone());
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
}

fn append_id(env: &Env, key: DataKey, id: u64) -> Result<(), Error> {
    let mut list: Vec<u64> = env.storage().persistent().get(&key).unwrap_or(vec![env]);
    if list.len() >= MAX_HISTORY_LEN {
        return Err(Error::HistoryFull);
    }
    list.push_back(id);
    env.storage().persistent().set(&key, &list);
    env.storage()
        .persistent()
        .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
    Ok(())
}

mod test;
