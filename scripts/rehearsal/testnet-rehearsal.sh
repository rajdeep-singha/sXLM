#!/usr/bin/env bash
#
# Testnet rehearsal of the mainnet cutover, end to end.
#
#   scripts/rehearsal/testnet-rehearsal.sh <old-wasm-dir> <new-wasm-dir> <evidence.md>
#
#   old-wasm-dir  the five WASMs running on mainnet today, fetched with
#                 `stellar contract fetch --network mainnet` (token, vault,
#                 lending, lp, gov .wasm)
#   new-wasm-dir  the five version-3 WASMs (sxlm_token, sxlm_vault,
#                 sxlm_lending, sxlm_lp_pool, sxlm_governance .wasm)
#
# What it does, on testnet only:
#   1. Deploys the mainnet code with mainnet parameters and seeds it with
#      deposits, a loan, LP liquidity and swaps.
#   2. Converts the admin account to 2-of-3 with `npm run multisig`.
#   3. Upgrades all five contracts through the multisig: one signature is
#      refused, two are accepted. Checks state survived.
#   4. Shows the old admin key alone can no longer act.
#   5. Calls set_governance on vault, token, lending and LP pool, then shows
#      the admin can no longer change a parameter directly.
#   6. Passes, waits out and executes a governance proposal end to end.
#   7. Runs the keeper's calls from a key with no admin rights.
#   8. Timed drill: a signer key is compromised and replaced by the other two.
#
# Every transaction hash is written to the evidence file with an explorer link.
# Nothing here touches mainnet except read-only fetches done beforehand.

set -euo pipefail

OLD=${1:?old wasm dir}
NEW=${2:?new wasm dir}
OUT=${3:?evidence file}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NET=testnet
PASSPHRASE="Test SDF Network ; September 2015"
RPC=https://soroban-testnet.stellar.org
HORIZON=https://horizon-testnet.stellar.org
EXPLORER=https://stellar.expert/explorer/testnet
RUN=${RUN_ID:-$(date -u +%Y%m%d%H%M%S)}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Keep the rehearsal's cooldown, voting period and timelock short enough to
# finish in minutes. Everything else uses the mainnet values.
COOLDOWN=12
VOTING_PERIOD=24
EXEC_DELAY=6

PASS=0
FAIL=0

# Local builds are named sxlm_token.wasm; release assets sxlm-token_v0.3.0.wasm.
newwasm() { local f="$NEW/$1.wasm"; [ -f "$f" ] || f=$(ls "$NEW"/${1//_/-}_v*.wasm | head -1); echo "$f"; }
log() { printf '%s\n' "$*" >>"$OUT"; }
say() { printf '\n== %s\n' "$*" >&2; log ""; log "### $*"; log ""; }
ok() { PASS=$((PASS + 1)); log "- [x] $*"; printf '  ok   %s\n' "$*" >&2; }
bad() { FAIL=$((FAIL + 1)); log "- [ ] **FAILED:** $*"; printf '  FAIL %s\n' "$*" >&2; }
check() { # check <description> <actual> <expected>
  if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1: got $2, expected $3"; fi
}
txlink() { printf '[%s…](%s/tx/%s)' "${1:0:12}" "$EXPLORER" "$1"; }
addr() { stellar keys address "$1"; }
inv() { # inv <source> <contract> -- fn args...
  local src=$1 id=$2; shift 2
  stellar contract invoke --quiet --network $NET --source-account "$src" --id "$id" "$@"
}
view() { # view <contract> fn args...  (read-only, no signature)
  local id=$1; shift
  stellar contract invoke --quiet --network $NET --source-account r-${RUN}-deployer --id "$id" --send=no -- "$@"
}
strip() { tr -d '"' ; }

# Why a refused call was refused, for the evidence log.
reason() { # reason <label>
  local f="$WORK/$1.err"
  [ -s "$f" ] && grep -oE "Tx[A-Z][A-Za-z]+|HostError: Error\([A-Za-z]+, [A-Za-z]+\)|simulation failed[^.]*" "$f" | head -1
}

# Build a call with the admin as transaction source, simulate it, sign it with
# the named signers in turn and submit. Prints the hash on success.
multisig_tx() { # multisig_tx <label> <contract> <"signer1 signer2"> -- fn args...
  local label=$1 id=$2 signers=$3; shift 4
  local x="$WORK/$label"
  stellar contract invoke --quiet --network $NET --source-account "$ADMIN" --id "$id" \
    --build-only -- "$@" >"$x.xdr"
  stellar tx simulate --quiet --network $NET --source-account "$ADMIN" <"$x.xdr" >"$x.sim" 2>"$x.err" || return 2
  cp "$x.sim" "$x.signed"
  for s in $signers; do
    stellar tx sign --quiet --network $NET --sign-with-key "$s" <"$x.signed" >"$x.next"
    mv "$x.next" "$x.signed"
  done
  if stellar tx send --quiet --network $NET <"$x.signed" >"$x.out" 2>"$x.err"; then
    stellar tx hash --quiet --network $NET <"$x.signed"
    return 0
  fi
  return 1
}

: >"$OUT"
log "# Testnet rehearsal $RUN"
log ""
log "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ). Network: Stellar testnet. CLI: $(stellar --version | head -1)."
log ""
log "Old code: the five WASMs fetched from mainnet. New code: version 3."
log ""
log "| Contract | Mainnet WASM (old) | Version 3 WASM (new) |"
log "|---|---|---|"
for pair in "token sxlm_token" "vault sxlm_vault" "lending sxlm_lending" "lp sxlm_lp_pool" "gov sxlm_governance"; do
  set -- $pair
  log "| $1 | \`$(shasum -a 256 "$OLD/$1.wasm" | cut -c1-16)…\` | \`$(shasum -a 256 "$(newwasm "$2")" | cut -c1-16)…\` |"
done
log ""
log "Shortened for the rehearsal only: cooldown $COOLDOWN ledgers, voting period $VOTING_PERIOD, timelock $EXEC_DELAY."

say "Accounts"
for k in deployer admin signer-a signer-b signer-c signer-d keeper user1 user2; do
  stellar keys generate "r-${RUN}-$k" --network $NET --fund --overwrite >/dev/null 2>&1
done
ADMIN=$(addr r-${RUN}-admin)
KEEPER=$(addr r-${RUN}-keeper)
U1=$(addr r-${RUN}-user1)
U2=$(addr r-${RUN}-user2)
SA=r-${RUN}-signer-a; SB=r-${RUN}-signer-b; SC=r-${RUN}-signer-c; SD=r-${RUN}-signer-d
log "| Role | Address |"; log "|---|---|"
for k in admin signer-a signer-b signer-c signer-d keeper user1 user2; do log "| $k | \`$(addr r-${RUN}-$k)\` |"; done

say "1. Deploy the mainnet code on testnet"
NATIVE=$(stellar contract id asset --asset native --network $NET)
dep() { stellar contract deploy --quiet --network $NET --source-account r-${RUN}-deployer --wasm "$OLD/$1.wasm"; }
TOKEN=$(dep token); VAULT=$(dep vault); LENDING=$(dep lending); LP=$(dep lp); GOV=$(dep gov)
inv r-${RUN}-admin "$TOKEN" -- initialize --admin "$ADMIN" --minter "$VAULT" --decimals 7 --name "Staked XLM" --symbol sXLM >/dev/null
inv r-${RUN}-admin "$VAULT" -- initialize --admin "$ADMIN" --sxlm_token "$TOKEN" --native_token "$NATIVE" --cooldown_period $COOLDOWN >/dev/null
inv r-${RUN}-admin "$LENDING" -- initialize --admin "$ADMIN" --sxlm_token "$TOKEN" --native_token "$NATIVE" \
  --collateral_factor_bps 7500 --liquidation_threshold_bps 8000 --borrow_rate_bps 500 --vault "$VAULT" >/dev/null
inv r-${RUN}-admin "$LP" -- initialize --admin "$ADMIN" --sxlm_token "$TOKEN" --native_token "$NATIVE" --fee_bps 30 --vault "$VAULT" >/dev/null
inv r-${RUN}-admin "$GOV" -- initialize --admin "$ADMIN" --sxlm_token "$TOKEN" --voting_period_ledgers $VOTING_PERIOD \
  --quorum_bps 1000 --execution_delay_ledgers $EXEC_DELAY >/dev/null
log "| Contract | Testnet id |"; log "|---|---|"
for c in TOKEN VAULT LENDING LP GOV; do log "| $c | [\`${!c}\`]($EXPLORER/contract/${!c}) |"; done
ok "five contracts deployed from the mainnet WASM and initialised with mainnet parameters"

say "Seed state"
inv r-${RUN}-user1 "$VAULT" -- deposit --user "$U1" --xlm_amount 2000000000 >/dev/null
inv r-${RUN}-user2 "$VAULT" -- deposit --user "$U2" --xlm_amount 500000000 >/dev/null
inv r-${RUN}-user2 "$NATIVE" -- transfer --from "$U2" --to "$LENDING" --amount 1000000000 >/dev/null
inv r-${RUN}-user1 "$LENDING" -- deposit_collateral --user "$U1" --sxlm_amount 500000000 >/dev/null
inv r-${RUN}-user1 "$LENDING" -- borrow --user "$U1" --xlm_amount 200000000 >/dev/null
inv r-${RUN}-user2 "$LP" -- add_liquidity --user "$U2" --xlm_amount 200000000 --sxlm_amount 200000000 >/dev/null
inv r-${RUN}-user2 "$LP" -- swap_xlm_to_sxlm --user "$U2" --xlm_amount 10000000 --min_out 0 >/dev/null
ok "deposits, a 20 XLM loan against sXLM, LP liquidity and a swap"

snapshot() {
  echo "rate=$(view "$VAULT" get_exchange_rate | strip)"
  echo "supply=$(view "$TOKEN" total_supply | strip)"
  echo "u1_sxlm=$(view "$TOKEN" balance --id "$U1" | strip)"
  echo "u2_sxlm=$(view "$TOKEN" balance --id "$U2" | strip)"
  echo "collateral=$(view "$LENDING" get_position --user "$U1" | tr -d '"[] ' | cut -d, -f1)"
  echo "reserves=$(view "$LP" get_reserves | tr -d '"[] ')"
  echo "lp_supply=$(view "$LP" total_lp_supply | strip)"
}
# The loan accrues interest between snapshots, so debt is checked separately:
# it may only have grown.
debt() { view "$LENDING" get_position --user "$U1" | tr -d '"[] ' | cut -d, -f2; }
snapshot >"$WORK/before"
DEBT_BEFORE=$(debt)
log '```'; cat "$WORK/before" >>"$OUT"; log '```'

say "2. Convert the admin account to 2-of-3"
cat >"$WORK/plan.json" <<EOF
{ "adminPublicKey": "$ADMIN",
  "signers": [ { "publicKey": "$(addr $SA)", "weight": 1 },
               { "publicKey": "$(addr $SB)", "weight": 1 },
               { "publicKey": "$(addr $SC)", "weight": 1 } ],
  "threshold": 2, "keeperPublicKey": "$KEEPER" }
EOF
msig() {
  (cd "$ROOT/backend" && NODE_ENV=production STELLAR_NETWORK_PASSPHRASE="$PASSPHRASE" \
    STELLAR_RPC_URL=$RPC STELLAR_HORIZON_URL=$HORIZON npx tsx src/multisig/cli.ts "$@" 2>/dev/null)
}
msig check "$WORK/plan.json" >/dev/null && ok "plan passes npm run multisig -- check"
msig build "$WORK/plan.json" | tail -1 >"$WORK/convert.xdr"
stellar tx sign --quiet --network $NET --sign-with-key r-${RUN}-admin <"$WORK/convert.xdr" >"$WORK/convert.signed"
stellar tx send --quiet --network $NET <"$WORK/convert.signed" >/dev/null
H=$(stellar tx hash --quiet --network $NET <"$WORK/convert.signed")
ok "conversion transaction $(txlink "$H")"
if msig verify "$WORK/plan.json" >/dev/null; then ok "npm run multisig -- verify: account matches the plan"; else bad "verify failed"; fi

say "3. Upgrade all five contracts through the multisig"
upload() { stellar contract upload --quiet --network $NET --source-account r-${RUN}-deployer --wasm "$(newwasm "$1")"; }
for pair in "TOKEN sxlm_token" "VAULT sxlm_vault" "LENDING sxlm_lending" "LP sxlm_lp_pool" "GOV sxlm_governance"; do
  set -- $pair
  id=${!1}
  hash=$(upload "$2")
  if multisig_tx "up1-$1" "$id" "$SA" -- upgrade --new_wasm_hash "$hash" >/dev/null 2>&1; then
    bad "$1 upgrade went through with ONE signature"
  else
    ok "$1 upgrade refused with one signature ($(reason "up1-$1"))"
  fi
  if H=$(multisig_tx "up2-$1" "$id" "$SA $SB" -- upgrade --new_wasm_hash "$hash"); then
    ok "$1 upgraded with two signatures $(txlink "$H")"
  else
    bad "$1 upgrade with two signatures: $(cat "$WORK/up2-$1.err" | tail -2)"
  fi
done
for c in TOKEN VAULT LENDING LP GOV; do check "$c version()" "$(view "${!c}" version | strip)" 3; done

snapshot >"$WORK/after"
DEBT_AFTER=$(debt)
if [ "$DEBT_AFTER" -ge "$DEBT_BEFORE" ]; then
  ok "loan debt $DEBT_BEFORE -> $DEBT_AFTER stroops: interest kept accruing across the upgrade"
else
  bad "loan debt fell across the upgrade: $DEBT_BEFORE -> $DEBT_AFTER"
fi
if diff -q "$WORK/before" "$WORK/after" >/dev/null; then
  ok "rate, supply, balances, collateral, reserves and LP supply identical before and after the upgrade"
else
  bad "state changed across the upgrade"; log '```'; diff "$WORK/before" "$WORK/after" >>"$OUT" || true; log '```'
fi
check "vault legacy queue entries" "$(view "$VAULT" legacy_queue_len | strip)" 0
check "LP protocol fee" "$(view "$LP" protocol_fee_bps | strip)" 5

say "4. The old admin key alone can no longer act"
if stellar contract invoke --quiet --network $NET --source-account r-${RUN}-admin --id "$VAULT" -- pause >/dev/null 2>&1; then
  bad "the old admin key paused the vault on its own"
else
  ok "pause signed by the old admin key alone is refused"
fi
if H=$(multisig_tx pause "$VAULT" "$SB $SC" -- pause); then ok "pause by two signers $(txlink "$H")"; else bad "pause by two signers"; fi
if H=$(multisig_tx unpause "$VAULT" "$SA $SC" -- unpause); then ok "unpause by two signers $(txlink "$H")"; else bad "unpause by two signers"; fi

say "5. Hand parameters to governance"
for c in VAULT TOKEN LENDING LP; do
  if H=$(multisig_tx "gov-$c" "${!c}" "$SA $SB" -- set_governance --governance "$GOV"); then
    ok "set_governance on $c $(txlink "$H")"
  else
    bad "set_governance on $c: $(tail -2 "$WORK/gov-$c.err")"
  fi
  check "$c governance()" "$(view "${!c}" governance | strip)" "$GOV"
done
if multisig_tx bypass "$LENDING" "$SA $SB" -- update_borrow_rate --new_rate_bps 900 >/dev/null 2>&1; then
  bad "the admin multisig still changed the borrow rate directly"
else
  ok "update_borrow_rate by the admin multisig is refused once governance is set ($(reason bypass))"
fi
if multisig_tx bypass2 "$LP" "$SA $SB" -- set_protocol_fee_bps --bps 10 >/dev/null 2>&1; then
  bad "the admin multisig still changed the LP protocol fee directly"
else
  ok "set_protocol_fee_bps by the admin multisig is refused once governance is set ($(reason bypass2))"
fi

say "6. A governance proposal, end to end"
PID=$(inv r-${RUN}-user1 "$GOV" -- create_proposal --proposer "$U1" --target "$LENDING" --param_key bor_rate --new_value 700 | strip)
ok "proposal #$PID: lending bor_rate 500 -> 700"
inv r-${RUN}-user1 "$GOV" -- vote --voter "$U1" --proposal_id "$PID" --support true --amount 1000000000 >/dev/null
ok "voted for with 100 sXLM escrowed"
ETA=$(view "$GOV" proposal_eta --id "$PID" | strip)
while :; do
  NOW=$(curl -s -X POST $RPC -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | jq -r .result.sequence)
  [ "$NOW" -ge "$ETA" ] && break
  sleep 5
done
inv r-${RUN}-user2 "$GOV" -- execute_proposal --proposal_id "$PID" >/dev/null
check "lending borrow rate after execution" "$(view "$LENDING" get_borrow_rate | strip)" 700

say "7. Keeper calls from a key with no admin rights"
for c in TOKEN VAULT LENDING LP GOV; do
  if inv r-${RUN}-keeper "${!c}" -- bump_instance >/dev/null 2>&1; then ok "keeper bump_instance on $c"; else bad "keeper bump_instance on $c"; fi
done
inv r-${RUN}-keeper "$LENDING" -- settle_interest >/dev/null 2>&1 && ok "keeper settle_interest" || bad "keeper settle_interest"
inv r-${RUN}-keeper "$LP" -- collect_protocol_fees >/dev/null 2>&1 && ok "keeper collect_protocol_fees" || bad "keeper collect_protocol_fees"

say "8. Timed drill: signer A's key is compromised"
T0=$(date +%s)
cat >"$WORK/rotate.json" <<EOF
{ "adminPublicKey": "$ADMIN",
  "signers": [ { "publicKey": "$(addr $SB)", "weight": 1 },
               { "publicKey": "$(addr $SC)", "weight": 1 },
               { "publicKey": "$(addr $SD)", "weight": 1 } ],
  "threshold": 2, "keeperPublicKey": "$KEEPER" }
EOF
# Two operations: the fee must cover both, or the network answers TxInsufficientFee.
stellar tx new set-options --quiet --network $NET --inclusion-fee 1000 --source-account "$ADMIN" --build-only \
  --signer "$(addr $SA)" --signer-weight 0 >"$WORK/rot1.xdr"
stellar tx op add set-options --quiet --source-account "$ADMIN" --signer "$(addr $SD)" --signer-weight 1 <"$WORK/rot1.xdr" >"$WORK/rot.xdr"
stellar tx sign --quiet --network $NET --sign-with-key $SB <"$WORK/rot.xdr" >"$WORK/rot.b"
stellar tx sign --quiet --network $NET --sign-with-key $SC <"$WORK/rot.b" >"$WORK/rot.bc"
stellar tx send --quiet --network $NET <"$WORK/rot.bc" >/dev/null
H=$(stellar tx hash --quiet --network $NET <"$WORK/rot.bc")
T1=$(date +%s)
ok "signer A removed and signer D added by B and C in $((T1 - T0)) s $(txlink "$H")"
if msig verify "$WORK/rotate.json" >/dev/null; then ok "account matches the rotated plan"; else bad "rotated plan does not match"; fi
if multisig_tx drillA "$VAULT" "$SA $SB" -- pause >/dev/null 2>&1; then
  bad "the removed key still counted towards a signature"
else
  ok "A + B is refused: the compromised key no longer counts ($(reason drillA))"
fi
if H=$(multisig_tx drillD "$VAULT" "$SB $SD" -- pause); then ok "B + D pause the vault $(txlink "$H")"; else bad "B + D could not pause"; fi
multisig_tx drillU "$VAULT" "$SC $SD" -- unpause >/dev/null && ok "C + D unpause it"
log ""
log "Recovery time from decision to verified rotation: **$((T1 - T0)) seconds**."

log ""
log "## Result: $PASS checks passed, $FAIL failed"
printf '\n%s passed, %s failed. Evidence: %s\n' "$PASS" "$FAIL" "$OUT" >&2
[ "$FAIL" -eq 0 ]
