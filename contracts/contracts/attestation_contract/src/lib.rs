#![no_std]

use shared::{
    AttestationKind, AttestationRecord, Category, BUMP_AMOUNT, BUMP_THRESHOLD, MAX_HISTORY_LEN,
    MAX_REQUEST_ID_LEN, MAX_TITLE_LEN,
};
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, vec, Address, BytesN, Env,
    String, Vec,
};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    StreamContract,
    NextAttestationId,
    Attestation(u64),
    RecipientAttestations(Address),
    WorkSessionAttestation(u64, String), // (stream_id, request_id) → u64 attestation_id
    StreamCompletionAttestation(u64),    // stream_id → final attestation_id
    SenderAttestations(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    AttestationNotFound = 4,
    Overflow = 5,
    HistoryFull = 6,
    InvalidPayment = 7,
    InvalidLedgerRange = 8,
    TitleTooLong = 9,
    DuplicateAttestation = 10,
    InvalidWorkSession = 11,
    InvalidRequestId = 12,
}

#[contractevent(topics = ["attestation_minted"])]
pub struct AttestationMinted {
    #[topic]
    pub attestation_id: u64,
    #[topic]
    pub stream_id: u64,
    #[topic]
    pub checkpoint_index: u32,
    pub recipient: Address,
    pub amount_paid: i128,
    pub kind: AttestationKind,
    pub client_confirmed: bool,
    pub auto_released: bool,
}

#[contract]
pub struct AttestationContract;

#[contractimpl]
impl AttestationContract {
    pub fn __constructor(env: Env, admin: Address, stream_contract: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StreamContract, &stream_contract);
        env.storage()
            .instance()
            .set(&DataKey::NextAttestationId, &1u64);
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
    }

    /// Legacy init kept for migration compatibility. New deployments use `__constructor`.
    pub fn init(env: Env, admin: Address, stream_contract: Address) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::StreamContract, &stream_contract);
        env.storage()
            .instance()
            .set(&DataKey::NextAttestationId, &1u64);
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Return the current stored administrator address.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    /// Transfer administrator rights. The *stored* admin must sign.
    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
        Ok(())
    }

    /// Replace contract WASM while preserving the contract ID and all storage.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn mint_attestation(
        env: Env,
        caller: Address,
        kind: AttestationKind,
        stream_id: u64,
        request_id: String,
        checkpoint_index: u32,
        sender: Address,
        recipient: Address,
        amount_paid: i128,
        asset: Address,
        category: Category,
        title: String,
        period_start_ledger: u32,
        period_end_ledger: u32,
        active_duration_seconds: u64,
        client_confirmed: bool,
        auto_released: bool,
        verifier: Option<Address>,
        report_hash: Option<BytesN<32>>,
    ) -> Result<u64, Error> {
        caller.require_auth();

        let registered_stream_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::StreamContract)
            .ok_or(Error::NotInitialized)?;
        if caller != registered_stream_contract {
            return Err(Error::Unauthorized);
        }
        if amount_paid <= 0 {
            return Err(Error::InvalidPayment);
        }
        if period_start_ledger > period_end_ledger {
            return Err(Error::InvalidLedgerRange);
        }
        if title.len() > MAX_TITLE_LEN {
            return Err(Error::TitleTooLong);
        }

        // Session records must prove they came through the configured verifier flow.
        if kind == AttestationKind::WorkSession
            && (request_id.is_empty()
                || active_duration_seconds == 0
                || verifier.is_none()
                || report_hash.is_none())
        {
            return Err(Error::InvalidWorkSession);
        }

        // Duplicate prevention for WorkSession and LegacyReviewed kinds.
        if kind == AttestationKind::WorkSession || kind == AttestationKind::LegacyReviewed {
            if request_id.is_empty() || request_id.len() > MAX_REQUEST_ID_LEN {
                return Err(Error::InvalidRequestId);
            }
            let dup_key = DataKey::WorkSessionAttestation(stream_id, request_id.clone());
            if env.storage().persistent().has(&dup_key) {
                return Err(Error::DuplicateAttestation);
            }
        }
        if kind == AttestationKind::StreamCompletion
            && env
                .storage()
                .persistent()
                .has(&DataKey::StreamCompletionAttestation(stream_id))
        {
            return Err(Error::DuplicateAttestation);
        }

        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextAttestationId)
            .unwrap_or(1u64);
        let next_id = id.checked_add(1).ok_or(Error::Overflow)?;
        env.storage()
            .instance()
            .set(&DataKey::NextAttestationId, &next_id);

        let record = AttestationRecord {
            id,
            kind: kind.clone(),
            stream_id,
            request_id: request_id.clone(),
            checkpoint_index,
            sender: sender.clone(),
            recipient: recipient.clone(),
            amount_paid,
            asset,
            category,
            title,
            period_start_ledger,
            period_end_ledger,
            active_duration_seconds,
            minted_at_ledger: env.ledger().sequence(),
            client_confirmed,
            auto_released,
            verifier,
            report_hash,
        };

        let key = DataKey::Attestation(id);
        env.storage().persistent().set(&key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);

        // Store duplicate-prevention key for WorkSession / LegacyReviewed
        if kind == AttestationKind::WorkSession || kind == AttestationKind::LegacyReviewed {
            let dup_key = DataKey::WorkSessionAttestation(stream_id, request_id);
            env.storage().persistent().set(&dup_key, &id);
            env.storage()
                .persistent()
                .extend_ttl(&dup_key, BUMP_THRESHOLD, BUMP_AMOUNT);
        }
        if kind == AttestationKind::StreamCompletion {
            let completion_key = DataKey::StreamCompletionAttestation(stream_id);
            env.storage().persistent().set(&completion_key, &id);
            env.storage()
                .persistent()
                .extend_ttl(&completion_key, BUMP_THRESHOLD, BUMP_AMOUNT);
        }

        // Append to recipient attestation index
        let recipient_key = DataKey::RecipientAttestations(recipient.clone());
        let mut recipient_list: Vec<u64> = env
            .storage()
            .persistent()
            .get(&recipient_key)
            .unwrap_or(vec![&env]);
        if recipient_list.len() >= MAX_HISTORY_LEN {
            return Err(Error::HistoryFull);
        }
        recipient_list.push_back(id);
        env.storage()
            .persistent()
            .set(&recipient_key, &recipient_list);
        env.storage()
            .persistent()
            .extend_ttl(&recipient_key, BUMP_THRESHOLD, BUMP_AMOUNT);

        // Append to sender attestation index
        let sender_key = DataKey::SenderAttestations(sender);
        let mut sender_list: Vec<u64> = env
            .storage()
            .persistent()
            .get(&sender_key)
            .unwrap_or(vec![&env]);
        if sender_list.len() >= MAX_HISTORY_LEN {
            return Err(Error::HistoryFull);
        }
        sender_list.push_back(id);
        env.storage().persistent().set(&sender_key, &sender_list);
        env.storage()
            .persistent()
            .extend_ttl(&sender_key, BUMP_THRESHOLD, BUMP_AMOUNT);

        AttestationMinted {
            attestation_id: id,
            stream_id,
            checkpoint_index,
            recipient: record.recipient.clone(),
            amount_paid,
            kind: record.kind,
            client_confirmed,
            auto_released,
        }
        .publish(&env);

        Ok(id)
    }

    pub fn get_attestation(env: Env, attestation_id: u64) -> Result<AttestationRecord, Error> {
        let key = DataKey::Attestation(attestation_id);
        let record: AttestationRecord = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::AttestationNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
        Ok(record)
    }

    pub fn get_recipient_attestations(env: Env, recipient: Address) -> Vec<u64> {
        let key = DataKey::RecipientAttestations(recipient);
        match env.storage().persistent().get(&key) {
            Some(ids) => {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
                ids
            }
            None => vec![&env],
        }
    }

    pub fn get_sender_attestations(env: Env, sender: Address) -> Vec<u64> {
        let key = DataKey::SenderAttestations(sender);
        match env.storage().persistent().get(&key) {
            Some(ids) => {
                env.storage()
                    .persistent()
                    .extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
                ids
            }
            None => vec![&env],
        }
    }

    pub fn verify_attestation(env: Env, attestation_id: u64) -> bool {
        let key = DataKey::Attestation(attestation_id);
        match env
            .storage()
            .persistent()
            .get::<DataKey, AttestationRecord>(&key)
        {
            Some(record) => record.amount_paid > 0,
            None => false,
        }
    }
}

mod test;
