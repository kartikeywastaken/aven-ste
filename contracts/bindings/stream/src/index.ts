import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CARKXYH6YKPBY63L3SKJJMC3GZSFG3ROHJLUC5UDZAWMBDIOGKEVFA5W",
  }
} as const

export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"InvalidRate"},
  4: {message:"InvalidDeposit"},
  5: {message:"InvalidDuration"},
  6: {message:"TitleTooLong"},
  7: {message:"InsufficientDeposit"},
  8: {message:"StreamNotFound"},
  9: {message:"NotSender"},
  10: {message:"NotRecipient"},
  11: {message:"WrongStatus"},
  12: {message:"NothingToWithdraw"},
  13: {message:"Overflow"},
  14: {message:"HistoryFull"},
  15: {message:"InvalidCheckpointCount"},
  16: {message:"DurationNotDivisible"},
  17: {message:"InvalidCapPercent"},
  18: {message:"InvalidTimeout"},
  19: {message:"IndexOutOfRange"},
  20: {message:"CheckpointNotSubmitted"},
  21: {message:"CheckpointAlreadyFinalized"},
  22: {message:"InvalidRequestId"},
  23: {message:"InvalidAmount"},
  24: {message:"AmountExceedsWithdrawable"},
  25: {message:"WithdrawalNotFound"},
  26: {message:"WithdrawalAlreadyExists"},
  27: {message:"WithdrawalNotApproved"},
  28: {message:"WithdrawalDisputed"},
  29: {message:"WithdrawalApprovalRequired"},
  30: {message:"NotAdmin"},
  31: {message:"VerifierNotConfigured"},
  32: {message:"VerificationRequired"},
  33: {message:"SenderMatchesRecipient"},
  34: {message:"InvalidActiveDuration"},
  35: {message:"PaymentMismatch"},
  36: {message:"OutstandingWithdrawals"},
  37: {message:"AssetNotAllowed"}
}








export interface WithdrawalRecord {
  active_duration_seconds: u64;
  amount: i128;
  deadline_ledger: u32;
  evidence_hash: Option<Buffer>;
  request_id: string;
  requested_at_ledger: u32;
  status: WithdrawalStatus;
  stream_id: u64;
  work_start_ledger: u32;
}

export type WithdrawalStatus = {tag: "Pending", values: void} | {tag: "Approved", values: void} | {tag: "Disputed", values: void} | {tag: "Withdrawn", values: void};




export type Category = {tag: "Freelance", values: void} | {tag: "Salary", values: void} | {tag: "Bounty", values: void} | {tag: "Grant", values: void} | {tag: "AgentTask", values: void} | {tag: "Subscription", values: void};


export interface StreamRecord {
  approval_timeout_ledgers: u32;
  asset: string;
  category: Category;
  checkpoint_count: u32;
  checkpoint_span_ledgers: u32;
  duration_ledgers: u32;
  id: u64;
  paused_at_ledger: u32;
  paused_duration_ledgers: u32;
  rate_per_ledger: i128;
  recipient: string;
  sender: string;
  start_ledger: u32;
  status: StreamStatus;
  title: string;
  total_deposited: i128;
  total_withdrawn: i128;
  withdrawable_cap_percent: u32;
}

export type StreamStatus = {tag: "Active", values: void} | {tag: "Paused", values: void} | {tag: "Completed", values: void} | {tag: "Cancelled", values: void};

export type AttestationKind = {tag: "Checkpoint", values: void} | {tag: "WorkSession", values: void} | {tag: "LegacyReviewed", values: void} | {tag: "StreamCompletion", values: void};


export interface CheckpointRecord {
  approved: boolean;
  attestation_id: u64;
  auto_approved: boolean;
  due_ledger: u32;
  evidence_hash: Buffer;
  index: u32;
  stream_id: u64;
  submitted: boolean;
}


export interface AttestationRecord {
  active_duration_seconds: u64;
  amount_paid: i128;
  asset: string;
  auto_released: boolean;
  category: Category;
  checkpoint_index: u32;
  client_confirmed: boolean;
  id: u64;
  kind: AttestationKind;
  minted_at_ledger: u32;
  period_end_ledger: u32;
  period_start_ledger: u32;
  recipient: string;
  report_hash: Option<Buffer>;
  request_id: string;
  sender: string;
  stream_id: u64;
  title: string;
  verifier: Option<string>;
}

export interface Client {
  /**
   * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Legacy init — kept so existing deployed instances can still be called during
   * a migration window, but new deployments use `__constructor`.
   */
  init: ({admin, attestation_contract}: {admin: string, attestation_contract: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Replace the running contract WASM while preserving the contract ID,
   * all storage, all streams, and all withdrawal records.
   * Only the stored admin may call this.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the current stored administrator address.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer administrator rights to a new address.
   * The *stored* admin must authenticate — not a caller-supplied address.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_stream transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_stream: ({stream_id}: {stream_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<StreamRecord>>>

  /**
   * Construct and simulate a verify_work transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reserves payment for one npm-tracked work session.
   * 
   * The verifier cannot choose an arbitrary amount: the contract recomputes
   * `rate_per_second * active_duration_seconds` and caps it at the unreserved
   * escrow remaining. Ledger time and checkpoints do not unlock funds.
   */
  verify_work: ({stream_id, request_id, amount, evidence_hash, active_duration_seconds, work_start_ledger}: {stream_id: u64, request_id: string, amount: i128, evidence_hash: Buffer, active_duration_seconds: u64, work_start_ledger: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the current verifier address, if configured.
   */
  get_verifier: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a pause_stream transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pause_stream: ({stream_id, caller}: {stream_id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_verifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_verifier: ({admin, verifier}: {admin: string, verifier: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_stream transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_stream: ({stream_id, caller}: {stream_id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_stream transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_stream: ({sender, recipient, rate_per_second, asset, total_deposited, duration_ledgers, checkpoint_count, withdrawable_cap_percent, approval_timeout_ledgers, category, title}: {sender: string, recipient: string, rate_per_second: i128, asset: string, total_deposited: i128, duration_ledgers: u32, checkpoint_count: u32, withdrawable_cap_percent: u32, approval_timeout_ledgers: u32, category: Category, title: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a resume_stream transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resume_stream: ({stream_id, caller}: {stream_id: u64, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a compute_earned transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Total value already measured by submitted npm sessions.
   */
  compute_earned: ({stream_id}: {stream_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a get_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_withdrawal: ({stream_id, request_id}: {stream_id: u64, request_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<WithdrawalRecord>>>

  /**
   * Construct and simulate a is_allowed_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return whether an asset is currently approved for new streams.
   */
  is_allowed_asset: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a add_allowed_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Approve an asset for use in new streams. Only the stored admin may call this.
   */
  add_allowed_asset: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a compute_available transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Unreserved escrow still available for future npm work sessions.
   */
  compute_available: ({stream_id}: {stream_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a withdraw_approved transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  withdraw_approved: ({stream_id, recipient, request_id}: {stream_id: u64, recipient: string, request_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a approve_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  approve_withdrawal: ({stream_id, sender, request_id}: {stream_id: u64, sender: string, request_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a dispute_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  dispute_withdrawal: ({stream_id, sender, request_id}: {stream_id: u64, sender: string, request_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_sender_streams transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_sender_streams: ({sender}: {sender: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u64>>>

  /**
   * Construct and simulate a request_withdrawal transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Legacy direct requests are disabled whenever the npm verifier is configured.
   */
  request_withdrawal: ({stream_id, recipient, request_id, amount}: {stream_id: u64, recipient: string, request_id: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_allowed_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Remove an asset from the allowlist. Existing streams using it are unaffected.
   */
  remove_allowed_asset: ({asset}: {asset: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_recipient_streams transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_recipient_streams: ({recipient}: {recipient: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<u64>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, attestation_contract}: {admin: string, attestation_contract: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, attestation_contract}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAJQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAALSW52YWxpZFJhdGUAAAAAAwAAAAAAAAAOSW52YWxpZERlcG9zaXQAAAAAAAQAAAAAAAAAD0ludmFsaWREdXJhdGlvbgAAAAAFAAAAAAAAAAxUaXRsZVRvb0xvbmcAAAAGAAAAAAAAABNJbnN1ZmZpY2llbnREZXBvc2l0AAAAAAcAAAAAAAAADlN0cmVhbU5vdEZvdW5kAAAAAAAIAAAAAAAAAAlOb3RTZW5kZXIAAAAAAAAJAAAAAAAAAAxOb3RSZWNpcGllbnQAAAAKAAAAAAAAAAtXcm9uZ1N0YXR1cwAAAAALAAAAAAAAABFOb3RoaW5nVG9XaXRoZHJhdwAAAAAAAAwAAAAAAAAACE92ZXJmbG93AAAADQAAAAAAAAALSGlzdG9yeUZ1bGwAAAAADgAAAAAAAAAWSW52YWxpZENoZWNrcG9pbnRDb3VudAAAAAAADwAAAAAAAAAURHVyYXRpb25Ob3REaXZpc2libGUAAAAQAAAAAAAAABFJbnZhbGlkQ2FwUGVyY2VudAAAAAAAABEAAAAAAAAADkludmFsaWRUaW1lb3V0AAAAAAASAAAAAAAAAA9JbmRleE91dE9mUmFuZ2UAAAAAEwAAAAAAAAAWQ2hlY2twb2ludE5vdFN1Ym1pdHRlZAAAAAAAFAAAAAAAAAAaQ2hlY2twb2ludEFscmVhZHlGaW5hbGl6ZWQAAAAAABUAAAAAAAAAEEludmFsaWRSZXF1ZXN0SWQAAAAWAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAAFwAAAAAAAAAZQW1vdW50RXhjZWVkc1dpdGhkcmF3YWJsZQAAAAAAABgAAAAAAAAAEldpdGhkcmF3YWxOb3RGb3VuZAAAAAAAGQAAAAAAAAAXV2l0aGRyYXdhbEFscmVhZHlFeGlzdHMAAAAAGgAAAAAAAAAVV2l0aGRyYXdhbE5vdEFwcHJvdmVkAAAAAAAAGwAAAAAAAAASV2l0aGRyYXdhbERpc3B1dGVkAAAAAAAcAAAAAAAAABpXaXRoZHJhd2FsQXBwcm92YWxSZXF1aXJlZAAAAAAAHQAAAAAAAAAITm90QWRtaW4AAAAeAAAAAAAAABVWZXJpZmllck5vdENvbmZpZ3VyZWQAAAAAAAAfAAAAAAAAABRWZXJpZmljYXRpb25SZXF1aXJlZAAAACAAAAAAAAAAFlNlbmRlck1hdGNoZXNSZWNpcGllbnQAAAAAACEAAAAAAAAAFUludmFsaWRBY3RpdmVEdXJhdGlvbgAAAAAAACIAAAAAAAAAD1BheW1lbnRNaXNtYXRjaAAAAAAjAAAAAAAAABZPdXRzdGFuZGluZ1dpdGhkcmF3YWxzAAAAAAAkAAAAAAAAAA9Bc3NldE5vdEFsbG93ZWQAAAAAJQ==",
        "AAAABQAAAAAAAAAAAAAADFN0cmVhbVBhdXNlZAAAAAEAAAANc3RyZWFtX3BhdXNlZAAAAAAAAAIAAAAAAAAACXN0cmVhbV9pZAAAAAAAAAYAAAABAAAAAAAAABBwYXVzZWRfYXRfbGVkZ2VyAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADFdvcmtWZXJpZmllZAAAAAEAAAANd29ya192ZXJpZmllZAAAAAAAAAcAAAAAAAAACXN0cmVhbV9pZAAAAAAAAAYAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAQAAAAAAAAAKcmVxdWVzdF9pZAAAAAAAEAAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAAF2FjdGl2ZV9kdXJhdGlvbl9zZWNvbmRzAAAAAAYAAAAAAAAAAAAAAA1ldmlkZW5jZV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAAAAAA9kZWFkbGluZV9sZWRnZXIAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAADVN0cmVhbUNyZWF0ZWQAAAAAAAABAAAADnN0cmVhbV9jcmVhdGVkAAAAAAAFAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAGAAAAAQAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAQAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAAAAAAD3RvdGFsX2RlcG9zaXRlZAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADVN0cmVhbVJlc3VtZWQAAAAAAAABAAAADnN0cmVhbV9yZXN1bWVkAAAAAAACAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAGAAAAAQAAAAAAAAARcmVzdW1lZF9hdF9sZWRnZXIAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD1N0cmVhbUNhbmNlbGxlZAAAAAABAAAAEHN0cmVhbV9jYW5jZWxsZWQAAAADAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAGAAAAAQAAAAAAAAARcGFpZF90b19yZWNpcGllbnQAAAAAAAALAAAAAAAAAAAAAAAScmVmdW5kZWRfdG9fc2VuZGVyAAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAD1N0cmVhbVdpdGhkcmF3bgAAAAABAAAAEHN0cmVhbV93aXRoZHJhd24AAAADAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAGAAAAAQAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAEAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC",
        "AAAAAQAAAAAAAAAAAAAAEFdpdGhkcmF3YWxSZWNvcmQAAAAJAAAAAAAAABdhY3RpdmVfZHVyYXRpb25fc2Vjb25kcwAAAAAGAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAD2RlYWRsaW5lX2xlZGdlcgAAAAAEAAAAAAAAAA1ldmlkZW5jZV9oYXNoAAAAAAAD6AAAA+4AAAAgAAAAAAAAAApyZXF1ZXN0X2lkAAAAAAAQAAAAAAAAABNyZXF1ZXN0ZWRfYXRfbGVkZ2VyAAAAAAQAAAAAAAAABnN0YXR1cwAAAAAH0AAAABBXaXRoZHJhd2FsU3RhdHVzAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAGAAAAAAAAABF3b3JrX3N0YXJ0X2xlZGdlcgAAAAAAAAQ=",
        "AAAAAgAAAAAAAAAAAAAAEFdpdGhkcmF3YWxTdGF0dXMAAAAEAAAAAAAAAAAAAAAHUGVuZGluZwAAAAAAAAAAAAAAAAhBcHByb3ZlZAAAAAAAAAAAAAAACERpc3B1dGVkAAAAAAAAAAAAAAAJV2l0aGRyYXduAAAA",
        "AAAABQAAAAAAAAAAAAAAEldpdGhkcmF3YWxBcHByb3ZlZAAAAAAAAQAAABN3aXRoZHJhd2FsX2FwcHJvdmVkAAAAAAMAAAAAAAAACXN0cmVhbV9pZAAAAAAAAAYAAAABAAAAAAAAAAZzZW5kZXIAAAAAABMAAAABAAAAAAAAAApyZXF1ZXN0X2lkAAAAAAAQAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEldpdGhkcmF3YWxEaXNwdXRlZAAAAAAAAQAAABN3aXRoZHJhd2FsX2Rpc3B1dGVkAAAAAAMAAAAAAAAACXN0cmVhbV9pZAAAAAAAAAYAAAABAAAAAAAAAAZzZW5kZXIAAAAAABMAAAABAAAAAAAAAApyZXF1ZXN0X2lkAAAAAAAQAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAE1dpdGhkcmF3YWxSZXF1ZXN0ZWQAAAAAAQAAABR3aXRoZHJhd2FsX3JlcXVlc3RlZAAAAAUAAAAAAAAACXN0cmVhbV9pZAAAAAAAAAYAAAABAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAQAAAAAAAAAKcmVxdWVzdF9pZAAAAAAAEAAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAAD2RlYWRsaW5lX2xlZGdlcgAAAAAEAAAAAAAAAAI=",
        "AAAAAAAAAItMZWdhY3kgaW5pdCDigJQga2VwdCBzbyBleGlzdGluZyBkZXBsb3llZCBpbnN0YW5jZXMgY2FuIHN0aWxsIGJlIGNhbGxlZCBkdXJpbmcKYSBtaWdyYXRpb24gd2luZG93LCBidXQgbmV3IGRlcGxveW1lbnRzIHVzZSBgX19jb25zdHJ1Y3RvcmAuAAAAAARpbml0AAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAABRhdHRlc3RhdGlvbl9jb250cmFjdAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAJ5SZXBsYWNlIHRoZSBydW5uaW5nIGNvbnRyYWN0IFdBU00gd2hpbGUgcHJlc2VydmluZyB0aGUgY29udHJhY3QgSUQsCmFsbCBzdG9yYWdlLCBhbGwgc3RyZWFtcywgYW5kIGFsbCB3aXRoZHJhd2FsIHJlY29yZHMuCk9ubHkgdGhlIHN0b3JlZCBhZG1pbiBtYXkgY2FsbCB0aGlzLgAAAAAAB3VwZ3JhZGUAAAAAAQAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAADBSZXR1cm4gdGhlIGN1cnJlbnQgc3RvcmVkIGFkbWluaXN0cmF0b3IgYWRkcmVzcy4AAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAPpAAAAEwAAAAM=",
        "AAAAAAAAAHdUcmFuc2ZlciBhZG1pbmlzdHJhdG9yIHJpZ2h0cyB0byBhIG5ldyBhZGRyZXNzLgpUaGUgKnN0b3JlZCogYWRtaW4gbXVzdCBhdXRoZW50aWNhdGUg4oCUIG5vdCBhIGNhbGxlci1zdXBwbGllZCBhZGRyZXNzLgAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAKZ2V0X3N0cmVhbQAAAAAAAQAAAAAAAAAJc3RyZWFtX2lkAAAAAAAABgAAAAEAAAPpAAAH0AAAAAxTdHJlYW1SZWNvcmQAAAAD",
        "AAAAAAAAAQhSZXNlcnZlcyBwYXltZW50IGZvciBvbmUgbnBtLXRyYWNrZWQgd29yayBzZXNzaW9uLgoKVGhlIHZlcmlmaWVyIGNhbm5vdCBjaG9vc2UgYW4gYXJiaXRyYXJ5IGFtb3VudDogdGhlIGNvbnRyYWN0IHJlY29tcHV0ZXMKYHJhdGVfcGVyX3NlY29uZCAqIGFjdGl2ZV9kdXJhdGlvbl9zZWNvbmRzYCBhbmQgY2FwcyBpdCBhdCB0aGUgdW5yZXNlcnZlZAplc2Nyb3cgcmVtYWluaW5nLiBMZWRnZXIgdGltZSBhbmQgY2hlY2twb2ludHMgZG8gbm90IHVubG9jayBmdW5kcy4AAAALdmVyaWZ5X3dvcmsAAAAABgAAAAAAAAAJc3RyZWFtX2lkAAAAAAAABgAAAAAAAAAKcmVxdWVzdF9pZAAAAAAAEAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAA1ldmlkZW5jZV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAF2FjdGl2ZV9kdXJhdGlvbl9zZWNvbmRzAAAAAAYAAAAAAAAAEXdvcmtfc3RhcnRfbGVkZ2VyAAAAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADNSZXR1cm4gdGhlIGN1cnJlbnQgdmVyaWZpZXIgYWRkcmVzcywgaWYgY29uZmlndXJlZC4AAAAADGdldF92ZXJpZmllcgAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAAAAAAAMcGF1c2Vfc3RyZWFtAAAAAgAAAAAAAAAJc3RyZWFtX2lkAAAAAAAABgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMc2V0X3ZlcmlmaWVyAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAh2ZXJpZmllcgAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAUYXR0ZXN0YXRpb25fY29udHJhY3QAAAATAAAAAA==",
        "AAAAAAAAAAAAAAANY2FuY2VsX3N0cmVhbQAAAAAAAAIAAAAAAAAACXN0cmVhbV9pZAAAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANY3JlYXRlX3N0cmVhbQAAAAAAAAsAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAPcmF0ZV9wZXJfc2Vjb25kAAAAAAsAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAPdG90YWxfZGVwb3NpdGVkAAAAAAsAAAAAAAAAEGR1cmF0aW9uX2xlZGdlcnMAAAAEAAAAAAAAABBjaGVja3BvaW50X2NvdW50AAAABAAAAAAAAAAYd2l0aGRyYXdhYmxlX2NhcF9wZXJjZW50AAAABAAAAAAAAAAYYXBwcm92YWxfdGltZW91dF9sZWRnZXJzAAAABAAAAAAAAAAIY2F0ZWdvcnkAAAfQAAAACENhdGVnb3J5AAAAAAAAAAV0aXRsZQAAAAAAABAAAAABAAAD6QAAAAYAAAAD",
        "AAAAAAAAAAAAAAANcmVzdW1lX3N0cmVhbQAAAAAAAAIAAAAAAAAACXN0cmVhbV9pZAAAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAADdUb3RhbCB2YWx1ZSBhbHJlYWR5IG1lYXN1cmVkIGJ5IHN1Ym1pdHRlZCBucG0gc2Vzc2lvbnMuAAAAAA5jb21wdXRlX2Vhcm5lZAAAAAAAAQAAAAAAAAAJc3RyZWFtX2lkAAAAAAAABgAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAAOZ2V0X3dpdGhkcmF3YWwAAAAAAAIAAAAAAAAACXN0cmVhbV9pZAAAAAAAAAYAAAAAAAAACnJlcXVlc3RfaWQAAAAAABAAAAABAAAD6QAAB9AAAAAQV2l0aGRyYXdhbFJlY29yZAAAAAM=",
        "AAAAAAAAAD5SZXR1cm4gd2hldGhlciBhbiBhc3NldCBpcyBjdXJyZW50bHkgYXBwcm92ZWQgZm9yIG5ldyBzdHJlYW1zLgAAAAAAEGlzX2FsbG93ZWRfYXNzZXQAAAABAAAAAAAAAAVhc3NldAAAAAAAABMAAAABAAAAAQ==",
        "AAAAAAAAAE1BcHByb3ZlIGFuIGFzc2V0IGZvciB1c2UgaW4gbmV3IHN0cmVhbXMuIE9ubHkgdGhlIHN0b3JlZCBhZG1pbiBtYXkgY2FsbCB0aGlzLgAAAAAAABFhZGRfYWxsb3dlZF9hc3NldAAAAAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAD9VbnJlc2VydmVkIGVzY3JvdyBzdGlsbCBhdmFpbGFibGUgZm9yIGZ1dHVyZSBucG0gd29yayBzZXNzaW9ucy4AAAAAEWNvbXB1dGVfYXZhaWxhYmxlAAAAAAAAAQAAAAAAAAAJc3RyZWFtX2lkAAAAAAAABgAAAAEAAAPpAAAACwAAAAM=",
        "AAAAAAAAAAAAAAARd2l0aGRyYXdfYXBwcm92ZWQAAAAAAAADAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAGAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAApyZXF1ZXN0X2lkAAAAAAAQAAAAAQAAA+kAAAALAAAAAw==",
        "AAAAAAAAAAAAAAASYXBwcm92ZV93aXRoZHJhd2FsAAAAAAADAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAGAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAACnJlcXVlc3RfaWQAAAAAABAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAASZGlzcHV0ZV93aXRoZHJhd2FsAAAAAAADAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAGAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAACnJlcXVlc3RfaWQAAAAAABAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAASZ2V0X3NlbmRlcl9zdHJlYW1zAAAAAAABAAAAAAAAAAZzZW5kZXIAAAAAABMAAAABAAAD6gAAAAY=",
        "AAAAAAAAAExMZWdhY3kgZGlyZWN0IHJlcXVlc3RzIGFyZSBkaXNhYmxlZCB3aGVuZXZlciB0aGUgbnBtIHZlcmlmaWVyIGlzIGNvbmZpZ3VyZWQuAAAAEnJlcXVlc3Rfd2l0aGRyYXdhbAAAAAAABAAAAAAAAAAJc3RyZWFtX2lkAAAAAAAABgAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAKcmVxdWVzdF9pZAAAAAAAEAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAE1SZW1vdmUgYW4gYXNzZXQgZnJvbSB0aGUgYWxsb3dsaXN0LiBFeGlzdGluZyBzdHJlYW1zIHVzaW5nIGl0IGFyZSB1bmFmZmVjdGVkLgAAAAAAABRyZW1vdmVfYWxsb3dlZF9hc3NldAAAAAEAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAVZ2V0X3JlY2lwaWVudF9zdHJlYW1zAAAAAAAAAQAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAEAAAPqAAAABg==",
        "AAAAAgAAAAAAAAAAAAAACENhdGVnb3J5AAAABgAAAAAAAAAAAAAACUZyZWVsYW5jZQAAAAAAAAAAAAAAAAAABlNhbGFyeQAAAAAAAAAAAAAAAAAGQm91bnR5AAAAAAAAAAAAAAAAAAVHcmFudAAAAAAAAAAAAAAAAAAACUFnZW50VGFzawAAAAAAAAAAAAAAAAAADFN1YnNjcmlwdGlvbg==",
        "AAAAAQAAAAAAAAAAAAAADFN0cmVhbVJlY29yZAAAABIAAAAAAAAAGGFwcHJvdmFsX3RpbWVvdXRfbGVkZ2VycwAAAAQAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAAIY2F0ZWdvcnkAAAfQAAAACENhdGVnb3J5AAAAAAAAABBjaGVja3BvaW50X2NvdW50AAAABAAAAAAAAAAXY2hlY2twb2ludF9zcGFuX2xlZGdlcnMAAAAABAAAAAAAAAAQZHVyYXRpb25fbGVkZ2VycwAAAAQAAAAAAAAAAmlkAAAAAAAGAAAAAAAAABBwYXVzZWRfYXRfbGVkZ2VyAAAABAAAAAAAAAAXcGF1c2VkX2R1cmF0aW9uX2xlZGdlcnMAAAAABAAAAAAAAAAPcmF0ZV9wZXJfbGVkZ2VyAAAAAAsAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAMc3RhcnRfbGVkZ2VyAAAABAAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADFN0cmVhbVN0YXR1cwAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAA90b3RhbF9kZXBvc2l0ZWQAAAAACwAAAAAAAAAPdG90YWxfd2l0aGRyYXduAAAAAAsAAAAAAAAAGHdpdGhkcmF3YWJsZV9jYXBfcGVyY2VudAAAAAQ=",
        "AAAAAgAAAAAAAAAAAAAADFN0cmVhbVN0YXR1cwAAAAQAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAABlBhdXNlZAAAAAAAAAAAAAAAAAAJQ29tcGxldGVkAAAAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAA",
        "AAAAAgAAAAAAAAAAAAAAD0F0dGVzdGF0aW9uS2luZAAAAAAEAAAAAAAAAAAAAAAKQ2hlY2twb2ludAAAAAAAAAAAAAAAAAALV29ya1Nlc3Npb24AAAAAAAAAAAAAAAAOTGVnYWN5UmV2aWV3ZWQAAAAAAAAAAAAAAAAAEFN0cmVhbUNvbXBsZXRpb24=",
        "AAAAAQAAAAAAAAAAAAAAEENoZWNrcG9pbnRSZWNvcmQAAAAIAAAAAAAAAAhhcHByb3ZlZAAAAAEAAAAAAAAADmF0dGVzdGF0aW9uX2lkAAAAAAAGAAAAAAAAAA1hdXRvX2FwcHJvdmVkAAAAAAAAAQAAAAAAAAAKZHVlX2xlZGdlcgAAAAAABAAAAAAAAAANZXZpZGVuY2VfaGFzaAAAAAAAA+4AAAAgAAAAAAAAAAVpbmRleAAAAAAAAAQAAAAAAAAACXN0cmVhbV9pZAAAAAAAAAYAAAAAAAAACXN1Ym1pdHRlZAAAAAAAAAE=",
        "AAAAAQAAAAAAAAAAAAAAEUF0dGVzdGF0aW9uUmVjb3JkAAAAAAAAEwAAAAAAAAAXYWN0aXZlX2R1cmF0aW9uX3NlY29uZHMAAAAABgAAAAAAAAALYW1vdW50X3BhaWQAAAAACwAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAA1hdXRvX3JlbGVhc2VkAAAAAAAAAQAAAAAAAAAIY2F0ZWdvcnkAAAfQAAAACENhdGVnb3J5AAAAAAAAABBjaGVja3BvaW50X2luZGV4AAAABAAAAAAAAAAQY2xpZW50X2NvbmZpcm1lZAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAAAAAARraW5kAAAH0AAAAA9BdHRlc3RhdGlvbktpbmQAAAAAAAAAABBtaW50ZWRfYXRfbGVkZ2VyAAAABAAAAAAAAAARcGVyaW9kX2VuZF9sZWRnZXIAAAAAAAAEAAAAAAAAABNwZXJpb2Rfc3RhcnRfbGVkZ2VyAAAAAAQAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAAAAAAAC3JlcG9ydF9oYXNoAAAAA+gAAAPuAAAAIAAAAAAAAAAKcmVxdWVzdF9pZAAAAAAAEAAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAlzdHJlYW1faWQAAAAAAAAGAAAAAAAAAAV0aXRsZQAAAAAAABAAAAAAAAAACHZlcmlmaWVyAAAD6AAAABM=" ]),
      options
    )
  }
  public readonly fromJSON = {
    init: this.txFromJSON<Result<void>>,
        upgrade: this.txFromJSON<Result<void>>,
        get_admin: this.txFromJSON<Result<string>>,
        set_admin: this.txFromJSON<Result<void>>,
        get_stream: this.txFromJSON<Result<StreamRecord>>,
        verify_work: this.txFromJSON<Result<void>>,
        get_verifier: this.txFromJSON<Option<string>>,
        pause_stream: this.txFromJSON<Result<void>>,
        set_verifier: this.txFromJSON<Result<void>>,
        cancel_stream: this.txFromJSON<Result<void>>,
        create_stream: this.txFromJSON<Result<u64>>,
        resume_stream: this.txFromJSON<Result<void>>,
        compute_earned: this.txFromJSON<Result<i128>>,
        get_withdrawal: this.txFromJSON<Result<WithdrawalRecord>>,
        is_allowed_asset: this.txFromJSON<boolean>,
        add_allowed_asset: this.txFromJSON<Result<void>>,
        compute_available: this.txFromJSON<Result<i128>>,
        withdraw_approved: this.txFromJSON<Result<i128>>,
        approve_withdrawal: this.txFromJSON<Result<void>>,
        dispute_withdrawal: this.txFromJSON<Result<void>>,
        get_sender_streams: this.txFromJSON<Array<u64>>,
        request_withdrawal: this.txFromJSON<Result<void>>,
        remove_allowed_asset: this.txFromJSON<Result<void>>,
        get_recipient_streams: this.txFromJSON<Array<u64>>
  }
}