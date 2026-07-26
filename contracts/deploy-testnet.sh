#!/usr/bin/env bash
# deploy-testnet.sh — Aven Testnet deterministic deployment
# Run from: aven-ste/contracts/

set -euo pipefail

NETWORK=testnet
DEPLOYER_IDENTITY=aven-deployer-testnet
ADMIN_IDENTITY=aven-admin-testnet
APP_ENV_FILE="${APP_ENV_FILE:-../.env.local}"

# Salts (hex, 62 hex chars padded to 32 bytes)
STREAM_SALT="6176656e5f73747265616d5f76325f746573746e65745f73616c7400000000"
ATTESTATION_SALT="6176656e5f61747465737461745f76325f746573746e65745f73616c740000"
REPUTATION_SALT="6176656e5f72657075745f76325f746573746e65745f73616c740000000000"

echo "=== Aven Testnet Deployment ==="
echo "Network: $NETWORK"

for ID in $DEPLOYER_IDENTITY $ADMIN_IDENTITY; do
  if ! stellar keys address "$ID" &>/dev/null; then
    echo "Generating identity: $ID"
    stellar keys generate "$ID" --network $NETWORK
  fi
  echo "Funding $ID via Friendbot..."
  stellar keys fund "$ID" --network $NETWORK 2>/dev/null || true
done

DEPLOYER_PUB=$(stellar keys address $DEPLOYER_IDENTITY)
ADMIN_PUB=$(stellar keys address $ADMIN_IDENTITY)
if [ -n "${AVEN_VERIFIER_SECRET:-}" ]; then
  VERIFIER_PUB=$(node -e \
    'const { Keypair } = require("@stellar/stellar-sdk"); process.stdout.write(Keypair.fromSecret(process.env.AVEN_VERIFIER_SECRET.trim()).publicKey())')
elif [ -f "$APP_ENV_FILE" ]; then
  VERIFIER_PUB=$(node -r dotenv/config -e \
    'const { Keypair } = require("@stellar/stellar-sdk"); const secret = process.env.AVEN_VERIFIER_SECRET?.trim(); if (!secret) process.exit(2); process.stdout.write(Keypair.fromSecret(secret).publicKey())' \
    "dotenv_config_path=$APP_ENV_FILE")
else
  echo "ERROR: Set AVEN_VERIFIER_SECRET or provide APP_ENV_FILE with the app verifier secret."
  exit 1
fi

echo "Deployer: $DEPLOYER_PUB"
echo "Admin:    $ADMIN_PUB"
echo "Verifier: $VERIFIER_PUB"

echo "=== Precomputing contract IDs ==="
PREDICTED_STREAM=$(stellar contract id wasm \
  --salt "$STREAM_SALT" --source $DEPLOYER_IDENTITY --network $NETWORK)
PREDICTED_ATTESTATION=$(stellar contract id wasm \
  --salt "$ATTESTATION_SALT" --source $DEPLOYER_IDENTITY --network $NETWORK)
PREDICTED_REPUTATION=$(stellar contract id wasm \
  --salt "$REPUTATION_SALT" --source $DEPLOYER_IDENTITY --network $NETWORK)

echo "Predicted Stream:      $PREDICTED_STREAM"
echo "Predicted Attestation: $PREDICTED_ATTESTATION"
echo "Predicted Reputation:  $PREDICTED_REPUTATION"

echo "=== Deploying Stream Contract ==="
ACTUAL_STREAM=$(stellar contract deploy \
  --wasm ../target/wasm32v1-none/release/stream_contract.wasm \
  --salt "$STREAM_SALT" --source $DEPLOYER_IDENTITY --network $NETWORK \
  -- --admin "$ADMIN_PUB" --attestation_contract "$PREDICTED_ATTESTATION")

echo "=== Deploying Attestation Contract ==="
ACTUAL_ATTESTATION=$(stellar contract deploy \
  --wasm ../target/wasm32v1-none/release/attestation_contract.wasm \
  --salt "$ATTESTATION_SALT" --source $DEPLOYER_IDENTITY --network $NETWORK \
  -- --admin "$ADMIN_PUB" --stream_contract "$PREDICTED_STREAM")

echo "=== Deploying Reputation Contract ==="
ACTUAL_REPUTATION=$(stellar contract deploy \
  --wasm ../target/wasm32v1-none/release/reputation_contract.wasm \
  --salt "$REPUTATION_SALT" --source $DEPLOYER_IDENTITY --network $NETWORK \
  -- --admin "$ADMIN_PUB" --attestation_contract "$PREDICTED_ATTESTATION")

echo "=== Verification ==="
[ "$PREDICTED_STREAM" = "$ACTUAL_STREAM" ] || { echo "ERROR: Stream ID mismatch!"; exit 1; }
[ "$PREDICTED_ATTESTATION" = "$ACTUAL_ATTESTATION" ] || { echo "ERROR: Attestation ID mismatch!"; exit 1; }
[ "$PREDICTED_REPUTATION" = "$ACTUAL_REPUTATION" ] || { echo "ERROR: Reputation ID mismatch!"; exit 1; }
echo "All IDs match"

echo "=== Configuring contracts ==="
stellar contract invoke --id "$ACTUAL_STREAM" --source $ADMIN_IDENTITY --network $NETWORK \
  -- set_verifier --admin "$ADMIN_PUB" --verifier "$VERIFIER_PUB"
echo "Verifier set"

XLM_SAC=$(stellar contract id asset --asset native --network $NETWORK)
stellar contract invoke --id "$ACTUAL_STREAM" --source $ADMIN_IDENTITY --network $NETWORK \
  -- add_allowed_asset --asset "$XLM_SAC"
echo "XLM allowlisted: $XLM_SAC"

USDC_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
USDC_SAC=$(stellar contract id asset --asset "USDC:$USDC_ISSUER" --network $NETWORK 2>/dev/null || echo "")
if [ -n "$USDC_SAC" ]; then
  stellar contract invoke --id "$ACTUAL_STREAM" --source $ADMIN_IDENTITY --network $NETWORK \
    -- add_allowed_asset --asset "$USDC_SAC"
  echo "USDC allowlisted: $USDC_SAC"
fi

echo "=== .env.local values ==="
cat <<EOF
NEXT_PUBLIC_STREAM_CONTRACT_ID=$ACTUAL_STREAM
NEXT_PUBLIC_ATTESTATION_CONTRACT_ID=$ACTUAL_ATTESTATION
NEXT_PUBLIC_REPUTATION_CONTRACT_ID=$ACTUAL_REPUTATION
NEXT_PUBLIC_XLM_ASSET_ID=$XLM_SAC
NEXT_PUBLIC_USDC_ASSET_ID=${USDC_SAC:-}
NEXT_PUBLIC_USDC_ISSUER=$USDC_ISSUER
DEPLOYER_PUBLIC=$DEPLOYER_PUB
ADMIN_PUBLIC=$ADMIN_PUB
VERIFIER_PUBLIC=$VERIFIER_PUB
EOF
