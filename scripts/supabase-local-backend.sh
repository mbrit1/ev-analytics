#!/bin/bash
# Opt-in lifecycle called by supabase-local-backend.mjs after immutable preflight.
set -eu
umask 077
source "$BACKEND_ROOT/scripts/supabase-stack-experiment-cleanup.sh"
supabase_stack_experiment_install_cleanup_traps

TASK_TMP_ROOT="$(cd -P "${TMPDIR:-/private/tmp}" && pwd -P)"
TOOLS="$(mktemp -d "$TASK_TMP_ROOT/ev-backend-source.XXXXXX")"
SUPABASE_STACK_EXPERIMENT_TOOLS="$TOOLS"
supabase_stack_experiment_register_tools_dir "$TOOLS"
node --input-type=module -e 'import(process.env.BACKEND_RUNNER).then(m => m.stageInput(process.argv[1])).catch(() => { console.error("Unable to stage immutable schema input."); process.exitCode=1 })' "$TOOLS"

# Keep even version and help calls inside a dedicated CLI home.
RUNTIME="$(mktemp -d "$TASK_TMP_ROOT/ev-backend-bootstrap.XXXXXX")"
SUPABASE_STACK_EXPERIMENT_RUNTIME="$RUNTIME"
supabase_stack_experiment_register_runtime_dir "$RUNTIME"
mkdir -m 700 "$RUNTIME/supabase-home"
supabase_stack_experiment_register_home "$RUNTIME/supabase-home"
export SUPABASE_HOME="$RUNTIME/supabase-home"
export SUPABASE_EXPERIMENTAL_STACK=1

if [[ -n "${SUPABASE_LOCAL_CLI_ARCHIVE:-}" ]]; then
  cp "$SUPABASE_LOCAL_CLI_ARCHIVE" "$TOOLS/supabase.tar.gz"
else
  if ! curl -fL --connect-timeout 20 --max-time 180 \
    https://github.com/supabase/cli/releases/download/v2.120.0/supabase_darwin_arm64.tar.gz \
    -o "$TOOLS/supabase.tar.gz" >"$TOOLS/download.log" 2>&1; then
    echo 'Pinned CLI archive download failed.' >&2
    exit 1
  fi
fi
if ! printf '%s  %s\n' 3b8546cc61aeabab6fd1f68edc7f664ebdfa96bdd6a9b18d8d612708f430ae28 "$TOOLS/supabase.tar.gz" \
  | shasum -a 256 -c - >"$TOOLS/checksum.log" 2>&1; then
  echo 'Pinned CLI archive checksum mismatch.' >&2
  exit 1
fi
# Only the checksum-verified executable is extracted, never target-revision code.
tar -xzf "$TOOLS/supabase.tar.gz" -C "$TOOLS" supabase
CLI="$TOOLS/supabase"
SUPABASE_STACK_EXPERIMENT_CLI="$CLI"
if [[ "$("$CLI" --version 2>"$TOOLS/version.stderr")" != 2.120.0 ]]; then
  echo 'Pinned CLI version mismatch.' >&2
  exit 1
fi

run_round() (
  set -eu
  local source_tools="$1"
  local round="$2"
  supabase_stack_experiment_install_cleanup_traps
  TOOLS="$(mktemp -d "$TASK_TMP_ROOT/ev-backend-round-tools.XXXXXX")"
  SUPABASE_STACK_EXPERIMENT_TOOLS="$TOOLS"
  supabase_stack_experiment_register_tools_dir "$TOOLS"
  RUNTIME="$(mktemp -d "$TASK_TMP_ROOT/ev-backend-round-runtime.XXXXXX")"
  SUPABASE_STACK_EXPERIMENT_RUNTIME="$RUNTIME"
  supabase_stack_experiment_register_runtime_dir "$RUNTIME"
  mkdir -m 700 "$RUNTIME/supabase-home"
  supabase_stack_experiment_register_home "$RUNTIME/supabase-home"
  export SUPABASE_HOME="$RUNTIME/supabase-home"
  CLI="$TOOLS/supabase"
  cp "$source_tools/supabase" "$CLI"
  cp "$source_tools/schema.sql" "$source_tools/provenance.json" "$TOOLS/"
  SUPABASE_STACK_EXPERIMENT_CLI="$CLI"
  A="$RUNTIME/backend-a"
  B="$RUNTIME/backend-b"
  mkdir -p "$A/supabase" "$B/supabase"
  CONFIG_TEMPLATE="$BACKEND_ROOT/experiments/supabase-local-stack/config.toml"
  supabase_stack_experiment_create_config a "$A/supabase/config.toml" "$CONFIG_TEMPLATE"
  supabase_stack_experiment_create_config b "$B/supabase/config.toml" "$CONFIG_TEMPLATE"

  SUPABASE_STACK_EXPERIMENT_REQUIRE_EMPTY=1
  SUPABASE_STACK_EXPERIMENT_START_ATTEMPTED=1
  for slot in a b; do
    if [[ "$slot" == a ]]; then work="$A"; else work="$B"; fi
    if ! supabase_stack_experiment_run_cli start --workdir "$work" stack start --runtime native --eager --output-format json \
      >"$TOOLS/start-$slot.json" 2>"$TOOLS/start-$slot.stderr"; then
      echo "Round $round stack $slot start failed; cleanup will attempt isolated recovery." >&2
      exit 1
    fi
    supabase_stack_experiment_run_cli status --workdir "$work" stack status --output-format json >"$TOOLS/status-$slot.json" 2>"$TOOLS/status-$slot.stderr"
    id="$(node --input-type=module -e 'import(process.env.BACKEND_RUNNER).then(m => m.stackId(process.argv[1])).catch(() => { console.error("Stack identity validation failed."); process.exitCode=1 })' "$TOOLS/status-$slot.json")"
    if [[ "$slot" == a ]]; then SUPABASE_STACK_EXPERIMENT_ID_A="$id"; else SUPABASE_STACK_EXPERIMENT_ID_B="$id"; fi
  done

  if ! node --input-type=module -e 'import(process.env.BACKEND_RUNNER).then(m => m.importSchemas(process.argv.slice(1,3), process.argv[3], process.argv[4])).catch(() => { console.error("Selected schema import failed for baseline-crud-v1."); process.exitCode=1 })' \
    "$TOOLS/status-a.json" "$TOOLS/status-b.json" "$TOOLS/schema.sql" "$TOOLS/provenance.json" \
    >"$TOOLS/import.log" 2>&1; then
    echo "Round $round selected schema import failed for baseline-crud-v1." >&2
    exit 1
  fi
  # Preserve the actual harness status so the EXIT trap receives it on failure.
  if node --input-type=module -e 'import(process.env.BACKEND_RUNNER).then(m => m.recordRound(process.argv[1], process.argv.slice(2))).catch(() => { console.error("Baseline CRUD verification failed."); process.exitCode=1 })' \
    "$TOOLS" "$TOOLS/status-a.json" "$TOOLS/status-b.json" >"$TOOLS/evidence.json" 2>"$TOOLS/harness.log"; then
    echo 'Baseline CRUD verification passed.'
  else
    harness_status=$?
    # This file contains only selected provenance and module-created safe diagnostics.
    cat "$TOOLS/evidence.json" 2>/dev/null || :
    echo 'baseline-crud-v1 verification failed; see the safe stage evidence above.' >&2
    exit "$harness_status"
  fi
  cat "$TOOLS/evidence.json"
  # Print destruction success only after every owned stack and directory is gone.
  supabase_stack_experiment_cleanup
  echo "Round $round create/verify/destroy passed."
)

for round in 1 2; do
  run_round "$TOOLS" "$round"
done
supabase_stack_experiment_cleanup
echo 'Local backend validation passed: two complete baseline-crud-v1 rounds.'
