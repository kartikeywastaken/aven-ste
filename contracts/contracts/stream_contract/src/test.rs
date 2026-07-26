#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, String,
};

#[contract]
struct MockAttestationContract;

#[contractimpl]
impl MockAttestationContract {
    #[allow(clippy::too_many_arguments)]
    pub fn mint_attestation(
        _env: Env,
        caller: Address,
        _kind: AttestationKind,
        stream_id: u64,
        _request_id: String,
        _checkpoint_index: u32,
        _sender: Address,
        _recipient: Address,
        amount_paid: i128,
        _asset: Address,
        _category: Category,
        _title: String,
        _period_start_ledger: u32,
        _period_end_ledger: u32,
        _active_duration_seconds: u64,
        _client_confirmed: bool,
        _auto_released: bool,
        _verifier: Option<Address>,
        _report_hash: Option<BytesN<32>>,
    ) -> u64 {
        caller.require_auth();
        if amount_paid <= 0 {
            panic!("invalid payment");
        }
        stream_id
    }
}

fn create_asset(env: &Env, sender: &Address, amount: i128) -> Address {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let asset = env.register_stellar_asset_contract_v2(admin);
    let asset_id = asset.address();
    StellarAssetClient::new(env, &asset_id).mint(sender, &amount);
    asset_id
}

fn setup(env: &Env) -> (StreamContractClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let verifier = Address::generate(env);
    let attestation = env.register(MockAttestationContract, ());
    let contract_id = env.register(StreamContract, (&admin, &attestation));
    let client = StreamContractClient::new(env, &contract_id);
    client.set_verifier(&admin, &verifier);
    (client, admin, verifier, attestation)
}

#[allow(clippy::too_many_arguments)]
fn create_stream(
    env: &Env,
    client: &StreamContractClient,
    sender: &Address,
    recipient: &Address,
    asset: &Address,
    rate_per_second: i128,
    deposit: i128,
    duration_ledgers: u32,
) -> u64 {
    // ensure the asset is allowed
    client.add_allowed_asset(asset);
    client.create_stream(
        sender,
        recipient,
        &rate_per_second,
        asset,
        &deposit,
        &duration_ledgers,
        &4,
        &60,
        &50,
        &Category::Freelance,
        &String::from_str(env, "Design sprint"),
    )
}

fn verify(
    env: &Env,
    client: &StreamContractClient,
    id: u64,
    request: &str,
    amount: i128,
    seconds: u64,
) {
    client.verify_work(
        &id,
        &String::from_str(env, request),
        &amount,
        &BytesN::from_array(env, &[7; 32]),
        &seconds,
        &0,
    );
}

#[test]
fn stream_creation_rejects_self_payment_and_keeps_legacy_fields_inert() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = create_asset(&env, &sender, 100_000);
    let (client, _, _, _) = setup(&env);

    let same_wallet = client.try_create_stream(
        &sender,
        &sender,
        &10,
        &asset,
        &20_000,
        &400,
        &4,
        &60,
        &50,
        &Category::Freelance,
        &String::from_str(&env, "Invalid"),
    );
    assert_eq!(
        same_wallet.unwrap_err().unwrap(),
        Error::SenderMatchesRecipient
    );

    let id = create_stream(&env, &client, &sender, &recipient, &asset, 10, 20_000, 400);
    let stream = client.get_stream(&id);
    assert_eq!(stream.rate_per_ledger, 50);
    assert_eq!(stream.checkpoint_count, 0);
    assert_eq!(stream.checkpoint_span_ledgers, 0);
    assert_eq!(stream.withdrawable_cap_percent, 0);
    assert_eq!(client.compute_available(&id), 20_000);
}

#[test]
fn ledger_time_does_not_increase_available_or_measured_value() {
    let env = Env::default();
    env.ledger().set_sequence_number(100);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = create_asset(&env, &sender, 100_000);
    let (client, _, _, _) = setup(&env);
    let id = create_stream(&env, &client, &sender, &recipient, &asset, 10, 20_000, 400);

    assert_eq!(client.compute_available(&id), 20_000);
    assert_eq!(client.compute_earned(&id), 0);
    env.ledger().set_sequence_number(50_000);
    assert_eq!(client.compute_available(&id), 20_000);
    assert_eq!(client.compute_earned(&id), 0);
}

#[test]
fn verifier_can_only_reserve_active_seconds_times_rate() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = create_asset(&env, &sender, 100_000);
    let (client, _, _, _) = setup(&env);
    let id = create_stream(&env, &client, &sender, &recipient, &asset, 10, 20_000, 400);
    let request = String::from_str(&env, "session-mismatch");
    let evidence = BytesN::from_array(&env, &[7; 32]);

    let mismatch = client.try_verify_work(&id, &request, &121, &evidence, &12, &0);
    assert_eq!(mismatch.unwrap_err().unwrap(), Error::PaymentMismatch);
    let zero_time = client.try_verify_work(&id, &request, &1, &evidence, &0, &0);
    assert_eq!(
        zero_time.unwrap_err().unwrap(),
        Error::InvalidActiveDuration
    );

    verify(&env, &client, id, "session-valid", 120, 12);
    assert_eq!(client.compute_earned(&id), 120);
    assert_eq!(client.compute_available(&id), 19_880);
}

#[test]
fn approved_session_releases_exact_reserved_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = create_asset(&env, &sender, 100_000);
    let token = TokenClient::new(&env, &asset);
    let (client, _, _, _) = setup(&env);
    let id = create_stream(&env, &client, &sender, &recipient, &asset, 10, 20_000, 400);
    let request = String::from_str(&env, "session-release");

    verify(&env, &client, id, "session-release", 1_000, 100);
    assert_eq!(
        client
            .try_withdraw_approved(&id, &recipient, &request)
            .unwrap_err()
            .unwrap(),
        Error::WithdrawalNotApproved
    );
    client.approve_withdrawal(&id, &sender, &request);
    assert_eq!(client.withdraw_approved(&id, &recipient, &request), 1_000);
    assert_eq!(token.balance(&recipient), 1_000);
    assert_eq!(client.compute_earned(&id), 1_000);
    assert_eq!(client.compute_available(&id), 19_000);
}

#[test]
fn dispute_frees_capacity_and_pending_claim_blocks_cancel() {
    let env = Env::default();
    env.mock_all_auths();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = create_asset(&env, &sender, 100_000);
    let token = TokenClient::new(&env, &asset);
    let (client, _, _, _) = setup(&env);
    let id = create_stream(&env, &client, &sender, &recipient, &asset, 10, 20_000, 400);
    let request = String::from_str(&env, "session-dispute");

    verify(&env, &client, id, "session-dispute", 500, 50);
    assert_eq!(
        client.try_cancel_stream(&id, &sender).unwrap_err().unwrap(),
        Error::OutstandingWithdrawals
    );
    client.dispute_withdrawal(&id, &sender, &request);
    assert_eq!(client.compute_available(&id), 20_000);
    client.cancel_stream(&id, &sender);
    assert_eq!(token.balance(&sender), 100_000);
    assert_eq!(token.balance(&recipient), 0);
}

#[test]
fn full_escrow_release_completes_stream() {
    let env = Env::default();
    env.mock_all_auths();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = create_asset(&env, &sender, 100_000);
    let (client, _, _, _) = setup(&env);
    let id = create_stream(&env, &client, &sender, &recipient, &asset, 10, 20_000, 400);
    let request = String::from_str(&env, "session-complete");

    verify(&env, &client, id, "session-complete", 20_000, 2_000);
    client.approve_withdrawal(&id, &sender, &request);
    client.withdraw_approved(&id, &recipient, &request);

    assert_eq!(client.get_stream(&id).status, StreamStatus::Completed);
    assert_eq!(client.compute_available(&id), 0);
    assert_eq!(client.compute_earned(&id), 20_000);
}

#[test]
fn configured_verifier_blocks_legacy_requests() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = create_asset(&env, &sender, 100_000);
    let (client, _, _, _) = setup(&env);
    let id = create_stream(&env, &client, &sender, &recipient, &asset, 10, 20_000, 400);
    let result =
        client.try_request_withdrawal(&id, &recipient, &String::from_str(&env, "legacy"), &1);
    assert_eq!(result.unwrap_err().unwrap(), Error::VerificationRequired);
}

#[test]
fn get_admin_returns_stored_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attestation = env.register(MockAttestationContract, ());
    let contract_id = env.register(StreamContract, (&admin, &attestation));
    let client = StreamContractClient::new(&env, &contract_id);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn set_admin_rotates_access() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let attestation = env.register(MockAttestationContract, ());
    let contract_id = env.register(StreamContract, (&admin, &attestation));
    let client = StreamContractClient::new(&env, &contract_id);
    client.set_admin(&new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn asset_allowlist_blocks_unlisted_asset() {
    let env = Env::default();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = create_asset(&env, &sender, 100_000);
    let (client, _, _, _) = setup(&env);

    // Not yet allowlisted — must be rejected
    let err = client.try_create_stream(
        &sender,
        &recipient,
        &10,
        &asset,
        &20_000,
        &400,
        &4,
        &60,
        &50,
        &Category::Freelance,
        &String::from_str(&env, "Test"),
    );
    assert_eq!(err.unwrap_err().unwrap(), Error::AssetNotAllowed);

    // After allowlisting — must succeed
    client.add_allowed_asset(&asset);
    let id = client.create_stream(
        &sender,
        &recipient,
        &10,
        &asset,
        &20_000,
        &400,
        &4,
        &60,
        &50,
        &Category::Freelance,
        &String::from_str(&env, "Test"),
    );
    assert!(id > 0);
}

#[test]
fn removed_asset_blocks_new_streams_but_existing_survives() {
    let env = Env::default();
    env.mock_all_auths();
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let asset = create_asset(&env, &sender, 100_000);
    let (client, _, _, _) = setup(&env);

    client.add_allowed_asset(&asset);
    let id = create_stream(&env, &client, &sender, &recipient, &asset, 10, 20_000, 400);
    assert!(client.get_stream(&id).total_deposited > 0);

    // Remove from allowlist
    client.remove_allowed_asset(&asset);
    assert!(!client.is_allowed_asset(&asset));

    // Existing stream data still accessible
    let stream = client.get_stream(&id);
    assert_eq!(stream.total_deposited, 20_000);

    // New stream must be blocked
    let err = client.try_create_stream(
        &sender,
        &recipient,
        &10,
        &asset,
        &20_000,
        &400,
        &4,
        &60,
        &50,
        &Category::Freelance,
        &String::from_str(&env, "New"),
    );
    assert_eq!(err.unwrap_err().unwrap(), Error::AssetNotAllowed);
}

#[test]
fn init_rejects_reinitialization() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attestation = env.register(MockAttestationContract, ());
    // Register with __constructor (already initialises)
    let contract_id = env.register(StreamContract, (&admin, &attestation));
    let client = StreamContractClient::new(&env, &contract_id);
    // Calling legacy init a second time must fail
    let err = client.try_init(&admin, &attestation);
    assert_eq!(err.unwrap_err().unwrap(), Error::AlreadyInitialized);
}

#[test]
fn get_verifier_returns_none_before_set() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attestation = env.register(MockAttestationContract, ());
    let contract_id = env.register(StreamContract, (&admin, &attestation));
    let client = StreamContractClient::new(&env, &contract_id);
    assert_eq!(client.get_verifier(), None);
    let verifier = Address::generate(&env);
    client.set_verifier(&admin, &verifier);
    assert_eq!(client.get_verifier(), Some(verifier));
}
