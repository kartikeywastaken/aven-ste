#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, Address, BytesN, Env, String,
    Vec,
};

#[contracttype]
#[derive(Clone)]
enum MockKey {
    Attestation(u64),
    Recipient(Address),
    Next,
}

#[contract]
pub struct MockAttestation;

#[contractimpl]
impl MockAttestation {
    pub fn add(
        env: Env,
        recipient: Address,
        amount_paid: i128,
        category: Category,
        kind: AttestationKind,
        client_confirmed: bool,
    ) -> u64 {
        let id: u64 = env.storage().instance().get(&MockKey::Next).unwrap_or(1);
        env.storage().instance().set(&MockKey::Next, &(id + 1));
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&MockKey::Recipient(recipient.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        ids.push_back(id);
        env.storage()
            .persistent()
            .set(&MockKey::Recipient(recipient.clone()), &ids);
        env.storage().persistent().set(
            &MockKey::Attestation(id),
            &AttestationRecord {
                id,
                kind,
                stream_id: id,
                request_id: String::from_str(&env, "record"),
                checkpoint_index: 0,
                sender: Address::generate(&env),
                recipient,
                amount_paid,
                asset: Address::generate(&env),
                category,
                title: String::from_str(&env, "Work"),
                period_start_ledger: 1,
                period_end_ledger: 2,
                active_duration_seconds: 0,
                minted_at_ledger: 2,
                client_confirmed,
                auto_released: !client_confirmed,
                verifier: None,
                report_hash: None::<BytesN<32>>,
            },
        );
        id
    }

    pub fn get_attestation(env: Env, attestation_id: u64) -> AttestationRecord {
        env.storage()
            .persistent()
            .get(&MockKey::Attestation(attestation_id))
            .unwrap()
    }

    pub fn get_recipient_attestations(env: Env, recipient: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&MockKey::Recipient(recipient))
            .unwrap_or_else(|| Vec::new(&env))
    }
}

fn setup(
    env: &Env,
) -> (
    ReputationContractClient<'_>,
    MockAttestationClient<'_>,
    Address,
) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let attestation_id = env.register(MockAttestation, ());
    let reputation_id = env.register(ReputationContract, (&admin, &attestation_id));
    let client = ReputationContractClient::new(env, &reputation_id);
    (
        client,
        MockAttestationClient::new(env, &attestation_id),
        admin,
    )
}

#[test]
fn score_is_zero_until_stream_completion() {
    let env = Env::default();
    let recipient = Address::generate(&env);
    let (client, mock, _) = setup(&env);
    mock.add(
        &recipient,
        &100_000_000,
        &Category::Freelance,
        &AttestationKind::WorkSession,
        &true,
    );
    assert_eq!(client.compute_score(&recipient), 0);
}

#[test]
fn score_is_calculated_once_from_completion_record() {
    let env = Env::default();
    let recipient = Address::generate(&env);
    let (client, mock, _) = setup(&env);
    mock.add(
        &recipient,
        &100_000_000,
        &Category::Freelance,
        &AttestationKind::WorkSession,
        &true,
    );
    mock.add(
        &recipient,
        &1_000_000_000,
        &Category::Grant,
        &AttestationKind::StreamCompletion,
        &true,
    );
    // base 10 + payment bonus 10, grant multiplier 130% = 26
    assert_eq!(client.compute_score(&recipient), 26);
    assert_eq!(client.get_score_breakdown(&recipient).grant, 26);
}

#[test]
fn score_does_not_depend_on_current_ledger() {
    use soroban_sdk::testutils::Ledger;
    let env = Env::default();
    let recipient = Address::generate(&env);
    let (client, mock, _) = setup(&env);
    mock.add(
        &recipient,
        &100_000_000,
        &Category::Freelance,
        &AttestationKind::StreamCompletion,
        &true,
    );
    let before = client.compute_score(&recipient);
    env.ledger().set_sequence_number(1_000_000);
    assert_eq!(client.compute_score(&recipient), before);
}

#[test]
fn negative_claim_threshold_is_rejected() {
    let env = Env::default();
    let recipient = Address::generate(&env);
    let (client, _, _) = setup(&env);
    assert!(!client.verify_claim(&recipient, &-1));
}

#[test]
fn get_admin_returns_stored_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, admin) = setup(&env);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn set_admin_rotates_access() {
    let env = Env::default();
    env.mock_all_auths();
    let new_admin = Address::generate(&env);
    let (client, _, _) = setup(&env);
    client.set_admin(&new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn init_rejects_reinitialization() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, mock_client, admin) = setup(&env);
    // re-init must fail (AlreadyInitialized)
    let err = client.try_init(&admin, &mock_client.address);
    assert_eq!(err.unwrap_err().unwrap(), Error::AlreadyInitialized);
}
