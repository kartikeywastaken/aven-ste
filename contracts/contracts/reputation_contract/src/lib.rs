#![no_std]

use shared::{
    AttestationKind, AttestationRecord, Category, BUMP_AMOUNT, BUMP_THRESHOLD, MAX_HISTORY_READ,
};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, vec, Address, BytesN, Env, IntoVal,
    Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    AttestationContract,
}

#[contracttype]
#[derive(Clone)]
pub struct ScoreBreakdown {
    pub total: i128,
    pub freelance: i128,
    pub salary: i128,
    pub bounty: i128,
    pub grant: i128,
    pub agent_task: i128,
    pub subscription: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

const SCORE_CAP: i128 = 10_000;

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    pub fn __constructor(env: Env, admin: Address, attestation_contract: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AttestationContract, &attestation_contract);
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
    }

    /// Legacy init kept for migration compatibility. Now requires admin auth.
    pub fn init(env: Env, admin: Address, attestation_contract: Address) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::AttestationContract) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AttestationContract, &attestation_contract);
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

    pub fn compute_score(env: Env, recipient: Address) -> Result<i128, Error> {
        Ok(Self::get_score_breakdown(env, recipient)?.total)
    }

    pub fn get_score_breakdown(env: Env, recipient: Address) -> Result<ScoreBreakdown, Error> {
        let attestation_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::AttestationContract)
            .ok_or(Error::NotInitialized)?;
        let ids: Vec<u64> = env.invoke_contract(
            &attestation_contract,
            &Symbol::new(&env, "get_recipient_attestations"),
            vec![&env, recipient.into_val(&env)],
        );

        let mut breakdown = empty_breakdown();
        let read_count = if ids.len() > MAX_HISTORY_READ {
            MAX_HISTORY_READ
        } else {
            ids.len()
        };

        let mut i: u32 = 0;
        while i < read_count {
            let id = ids.get(i).unwrap();
            let record: AttestationRecord = env.invoke_contract(
                &attestation_contract,
                &Symbol::new(&env, "get_attestation"),
                vec![&env, id.into_val(&env)],
            );
            if record.kind == AttestationKind::StreamCompletion {
                let points = score_one(&record);
                breakdown.total = breakdown.total.saturating_add(points);
                match record.category {
                    Category::Freelance => {
                        breakdown.freelance = breakdown.freelance.saturating_add(points)
                    }
                    Category::Salary => breakdown.salary = breakdown.salary.saturating_add(points),
                    Category::Bounty => breakdown.bounty = breakdown.bounty.saturating_add(points),
                    Category::Grant => breakdown.grant = breakdown.grant.saturating_add(points),
                    Category::AgentTask => {
                        breakdown.agent_task = breakdown.agent_task.saturating_add(points)
                    }
                    Category::Subscription => {
                        breakdown.subscription = breakdown.subscription.saturating_add(points)
                    }
                }
            }
            i += 1;
        }

        if breakdown.total > SCORE_CAP {
            breakdown.total = SCORE_CAP;
        }
        Ok(breakdown)
    }

    pub fn verify_claim(env: Env, recipient: Address, minimum_score: i128) -> Result<bool, Error> {
        if minimum_score < 0 {
            return Ok(false);
        }
        Ok(Self::compute_score(env, recipient)? >= minimum_score)
    }
}

fn empty_breakdown() -> ScoreBreakdown {
    ScoreBreakdown {
        total: 0,
        freelance: 0,
        salary: 0,
        bounty: 0,
        grant: 0,
        agent_task: 0,
        subscription: 0,
    }
}

/// Score inputs are immutable attestation fields. There is no current-ledger
/// multiplier, so a completed project's score is stable after it is minted.
fn score_one(record: &AttestationRecord) -> i128 {
    let base: i128 = 10;
    let payment_bonus = (record.amount_paid / 10_000_000 / 10).clamp(0, 100);
    let raw = base + payment_bonus;
    let category_pct: i128 = match record.category {
        Category::Grant => 130,
        Category::Bounty => 120,
        Category::Freelance => 110,
        _ => 100,
    };
    let confirmed_pct: i128 = if record.client_confirmed { 100 } else { 50 };
    raw.saturating_mul(category_pct)
        .saturating_mul(confirmed_pct)
        / 10_000
}

mod test;
