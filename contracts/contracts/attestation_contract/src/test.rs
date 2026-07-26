#![cfg(test)]

extern crate std;

use super::*;
use shared::AttestationKind;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

fn setup() -> (
    Env,
    AttestationContractClient<'static>,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let stream_contract = Address::generate(&env);
    let contract_id = env.register(AttestationContract, (&admin, &stream_contract));
    let client = AttestationContractClient::new(&env, &contract_id);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);
    (env, client, stream_contract, sender, recipient)
}

fn mint_sample(
    env: &Env,
    client: &AttestationContractClient,
    caller: &Address,
    sender: &Address,
    recipient: &Address,
) -> u64 {
    env.mock_all_auths();
    client.mint_attestation(
        caller,
        &AttestationKind::Checkpoint,
        &7,                         // stream_id
        &String::from_str(env, ""), // request_id (empty for checkpoint)
        &0,                         // checkpoint_index
        sender,
        recipient,
        &500_000_000,            // amount_paid
        &Address::generate(env), // asset
        &Category::Freelance,
        &String::from_str(env, "Design sprint"),
        &10,                 // period_start_ledger
        &20,                 // period_end_ledger
        &0,                  // active_duration_seconds
        &true,               // client_confirmed
        &false,              // auto_released
        &None,               // verifier
        &None::<BytesN<32>>, // report_hash
    )
}

#[test]
fn test_mint_success() {
    let (env, client, stream_contract, sender, recipient) = setup();
    let id = mint_sample(&env, &client, &stream_contract, &sender, &recipient);

    let record = client.get_attestation(&id);
    assert_eq!(record.id, id);
    assert_eq!(record.kind, AttestationKind::Checkpoint);
    assert_eq!(record.stream_id, 7);
    assert_eq!(record.checkpoint_index, 0);
    assert_eq!(record.sender, sender);
    assert_eq!(record.recipient, recipient);
    assert_eq!(record.amount_paid, 500_000_000);
    assert_eq!(record.category, Category::Freelance);
    assert_eq!(record.period_start_ledger, 10);
    assert_eq!(record.period_end_ledger, 20);
    assert_eq!(record.active_duration_seconds, 0);
    assert!(record.client_confirmed);
    assert!(!record.auto_released);
    assert_eq!(record.verifier, None);
    assert_eq!(record.report_hash, None);
}

#[test]
fn test_mint_only_by_stream_contract() {
    let (env, client, _stream_contract, sender, recipient) = setup();
    let unauthorized_caller = Address::generate(&env);

    let res = client.try_mint_attestation(
        &unauthorized_caller,
        &AttestationKind::Checkpoint,
        &7,
        &String::from_str(&env, ""),
        &0,
        &sender,
        &recipient,
        &500_000_000,
        &Address::generate(&env),
        &Category::Freelance,
        &String::from_str(&env, "Design sprint"),
        &10,
        &20,
        &0,
        &true,
        &false,
        &Some(Address::generate(&env)),
        &Some(BytesN::from_array(&env, &[8; 32])),
    );
    assert_eq!(res.unwrap_err().unwrap(), Error::Unauthorized);
}

#[test]
fn test_get_attestation_not_found() {
    let (_env, client, _stream_contract, _sender, _recipient) = setup();
    let res = client.try_get_attestation(&999);
    let err = match res {
        Err(Ok(e)) => e,
        _ => panic!("expected Err(Ok(Error))"),
    };
    assert_eq!(err, Error::AttestationNotFound);
}

#[test]
fn test_verify_attestation() {
    let (env, client, stream_contract, sender, recipient) = setup();
    let id = mint_sample(&env, &client, &stream_contract, &sender, &recipient);
    assert!(client.verify_attestation(&id));
    assert!(!client.verify_attestation(&999));
}

#[test]
fn test_invalid_payment_rejected() {
    let (env, client, stream_contract, sender, recipient) = setup();

    let res = client.try_mint_attestation(
        &stream_contract,
        &AttestationKind::Checkpoint,
        &7,
        &String::from_str(&env, ""),
        &0,
        &sender,
        &recipient,
        &0, // Zero payment is invalid
        &Address::generate(&env),
        &Category::Freelance,
        &String::from_str(&env, "Zero pay"),
        &10,
        &20,
        &0,
        &true,
        &false,
        &None,
        &None::<BytesN<32>>,
    );
    assert_eq!(res.unwrap_err().unwrap(), Error::InvalidPayment);
}

#[test]
fn test_invalid_ledger_range_rejected() {
    let (env, client, stream_contract, sender, recipient) = setup();

    let res = client.try_mint_attestation(
        &stream_contract,
        &AttestationKind::Checkpoint,
        &7,
        &String::from_str(&env, ""),
        &0,
        &sender,
        &recipient,
        &500_000_000,
        &Address::generate(&env),
        &Category::Freelance,
        &String::from_str(&env, "Invalid range"),
        &20, // start > end
        &10,
        &0,
        &true,
        &false,
        &None,
        &None::<BytesN<32>>,
    );
    assert_eq!(res.unwrap_err().unwrap(), Error::InvalidLedgerRange);
}

#[test]
fn test_title_too_long_rejected() {
    let (env, client, stream_contract, sender, recipient) = setup();

    // Create an 81-character title
    let rust_string = std::string::String::from("a").repeat(81);
    let long_title = String::from_str(&env, &rust_string);

    let res = client.try_mint_attestation(
        &stream_contract,
        &AttestationKind::Checkpoint,
        &7,
        &String::from_str(&env, ""),
        &0,
        &sender,
        &recipient,
        &500_000_000,
        &Address::generate(&env),
        &Category::Freelance,
        &long_title,
        &10,
        &20,
        &0,
        &true,
        &false,
        &None,
        &None::<BytesN<32>>,
    );
    assert_eq!(res.unwrap_err().unwrap(), Error::TitleTooLong);
}

#[test]
fn test_get_recipient_attestations() {
    let (env, client, stream_contract, sender, recipient) = setup();
    let id1 = mint_sample(&env, &client, &stream_contract, &sender, &recipient);

    // Mint another one for the same recipient
    let id2 = client.mint_attestation(
        &stream_contract,
        &AttestationKind::Checkpoint,
        &8,
        &String::from_str(&env, ""),
        &1,
        &sender,
        &recipient,
        &100_000_000,
        &Address::generate(&env),
        &Category::Salary,
        &String::from_str(&env, "Second attestation"),
        &30,
        &40,
        &0,
        &true,
        &false,
        &Some(Address::generate(&env)),
        &Some(BytesN::from_array(&env, &[8; 32])),
    );

    let attestations = client.get_recipient_attestations(&recipient);
    assert_eq!(attestations.len(), 2);
    assert_eq!(attestations.get(0).unwrap(), id1);
    assert_eq!(attestations.get(1).unwrap(), id2);
}

#[test]
fn test_empty_indexes_return_empty_lists() {
    let (env, client, _stream_contract, _sender, _recipient) = setup();
    assert_eq!(
        client
            .get_recipient_attestations(&Address::generate(&env))
            .len(),
        0
    );
    assert_eq!(
        client
            .get_sender_attestations(&Address::generate(&env))
            .len(),
        0
    );
}

#[test]
fn test_get_sender_attestations() {
    let (env, client, stream_contract, sender, recipient) = setup();
    let id1 = mint_sample(&env, &client, &stream_contract, &sender, &recipient);

    let id2 = client.mint_attestation(
        &stream_contract,
        &AttestationKind::WorkSession,
        &8,
        &String::from_str(&env, "ws-2"),
        &0,
        &sender,
        &recipient,
        &200_000_000,
        &Address::generate(&env),
        &Category::Freelance,
        &String::from_str(&env, "Work session"),
        &30,
        &40,
        &3600,
        &true,
        &false,
        &Some(Address::generate(&env)),
        &Some(BytesN::from_array(&env, &[8; 32])),
    );

    let attestations = client.get_sender_attestations(&sender);
    assert_eq!(attestations.len(), 2);
    assert_eq!(attestations.get(0).unwrap(), id1);
    assert_eq!(attestations.get(1).unwrap(), id2);
}

#[test]
fn test_duplicate_work_session_attestation_rejected() {
    let (env, client, stream_contract, sender, recipient) = setup();
    let evidence = BytesN::from_array(&env, &[42u8; 32]);

    // First mint should succeed
    let id = client.mint_attestation(
        &stream_contract,
        &AttestationKind::WorkSession,
        &7,
        &String::from_str(&env, "session-1"),
        &0,
        &sender,
        &recipient,
        &500_000_000,
        &Address::generate(&env),
        &Category::Freelance,
        &String::from_str(&env, "Work session 1"),
        &10,
        &20,
        &3600,
        &true,
        &false,
        &Some(Address::generate(&env)),
        &Some(evidence.clone()),
    );
    assert!(id > 0);

    // Second mint with same stream_id + request_id should fail
    let res = client.try_mint_attestation(
        &stream_contract,
        &AttestationKind::WorkSession,
        &7,
        &String::from_str(&env, "session-1"),
        &0,
        &sender,
        &recipient,
        &500_000_000,
        &Address::generate(&env),
        &Category::Freelance,
        &String::from_str(&env, "Work session 1 dup"),
        &10,
        &20,
        &3600,
        &true,
        &false,
        &Some(Address::generate(&env)),
        &Some(evidence),
    );
    assert_eq!(res.unwrap_err().unwrap(), Error::DuplicateAttestation);
}
