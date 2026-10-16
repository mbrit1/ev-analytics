# Sourceable lifecycle support for the opt-in disposable local Supabase experiment.
# Loading this file defines functions only. Call the installer before allocating anything.

supabase_stack_experiment_install_cleanup_traps() {
  SUPABASE_STACK_EXPERIMENT_START_ATTEMPTED=0
  SUPABASE_STACK_EXPERIMENT_REQUIRE_EMPTY=0
  SUPABASE_STACK_EXPERIMENT_ID_A=''
  SUPABASE_STACK_EXPERIMENT_ID_B=''
  SUPABASE_STACK_EXPERIMENT_TOOLS=''
  SUPABASE_STACK_EXPERIMENT_RUNTIME=''
  SUPABASE_STACK_EXPERIMENT_HOME=''
  SUPABASE_STACK_EXPERIMENT_CLI=''
  SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS=''
  SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME=''
  SUPABASE_STACK_EXPERIMENT_OWNED_HOME=''
  SUPABASE_STACK_EXPERIMENT_TOOLS_IDENTITY=''
  SUPABASE_STACK_EXPERIMENT_RUNTIME_IDENTITY=''
  SUPABASE_STACK_EXPERIMENT_HOME_IDENTITY=''
  SUPABASE_STACK_EXPERIMENT_TEMP_ROOT=''
  SUPABASE_STACK_EXPERIMENT_OWNED_CONFIG_A=''
  SUPABASE_STACK_EXPERIMENT_OWNED_CONFIG_B=''
  SUPABASE_STACK_EXPERIMENT_CONFIG_A_TEMPLATE=''
  SUPABASE_STACK_EXPERIMENT_CONFIG_B_TEMPLATE=''
  SUPABASE_STACK_EXPERIMENT_CONFIG_CREATE_FAILED=0
  SUPABASE_STACK_EXPERIMENT_CLEANUP_DONE=0

  trap 'supabase_stack_experiment_on_exit "$?"' EXIT
  trap 'supabase_stack_experiment_on_signal INT' INT
  trap 'supabase_stack_experiment_on_signal TERM' TERM
}

supabase_stack_experiment_register_tools_dir() {
  supabase_stack_experiment_register_temp_dir tools "$1"
}

supabase_stack_experiment_register_runtime_dir() {
  supabase_stack_experiment_register_temp_dir runtime "$1"
}

supabase_stack_experiment_register_temp_dir() {
  local kind="$1"
  local candidate="$2"
  local root resolved identity

  if [[ -z "$SUPABASE_STACK_EXPERIMENT_TEMP_ROOT" ]]; then
    root="${TMPDIR:-/private/tmp}"
    if [[ ! -d "$root" ]]; then
      supabase_stack_experiment_diagnostic 'temporary root is unavailable'
      return 1
    fi
    SUPABASE_STACK_EXPERIMENT_TEMP_ROOT="$(cd -P "$root" 2>/dev/null && pwd -P)" || {
      supabase_stack_experiment_diagnostic 'temporary root cannot be resolved'
      return 1
    }
  fi

  if [[ "$kind" != tools && "$kind" != runtime ]]; then
    supabase_stack_experiment_diagnostic 'unknown temporary directory ownership kind'
    return 1
  fi
  if [[ -z "$candidate" || ! -d "$candidate" || -L "$candidate" ]]; then
    supabase_stack_experiment_diagnostic 'temporary directory is missing or unsafe'
    return 1
  fi
  resolved="$(cd -P "$candidate" 2>/dev/null && pwd -P)" || {
    supabase_stack_experiment_diagnostic 'temporary directory cannot be resolved'
    return 1
  }
  if [[ "$resolved" != "$SUPABASE_STACK_EXPERIMENT_TEMP_ROOT"/* ]]; then
    supabase_stack_experiment_diagnostic 'temporary directory is outside the recorded temporary root'
    return 1
  fi
  identity="$(stat -f '%d:%i' "$resolved" 2>/dev/null)" || {
    supabase_stack_experiment_diagnostic 'temporary directory identity cannot be recorded'
    return 1
  }

  if [[ "$kind" == tools ]]; then
    if [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS" ]]; then
      supabase_stack_experiment_diagnostic 'tools directory ownership was already registered'
      return 1
    fi
    SUPABASE_STACK_EXPERIMENT_TOOLS="$resolved"
    SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS="$resolved"
    SUPABASE_STACK_EXPERIMENT_TOOLS_IDENTITY="$identity"
  else
    if [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME" ]]; then
      supabase_stack_experiment_diagnostic 'runtime directory ownership was already registered'
      return 1
    fi
    SUPABASE_STACK_EXPERIMENT_RUNTIME="$resolved"
    SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME="$resolved"
    SUPABASE_STACK_EXPERIMENT_RUNTIME_IDENTITY="$identity"
  fi
}

supabase_stack_experiment_register_home() {
  local candidate="$1"
  local resolved identity expected

  if [[ -z "$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME" || -z "$candidate" || ! -d "$candidate" || -L "$candidate" ]]; then
    supabase_stack_experiment_diagnostic 'dedicated Supabase home is missing or unsafe'
    return 1
  fi
  expected="$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME/supabase-home"
  resolved="$(cd -P "$candidate" 2>/dev/null && pwd -P)" || {
    supabase_stack_experiment_diagnostic 'dedicated Supabase home cannot be resolved'
    return 1
  }
  if [[ "$resolved" != "$expected" || -n "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" ]]; then
    supabase_stack_experiment_diagnostic 'dedicated Supabase home is outside its owned runtime directory'
    return 1
  fi
  identity="$(stat -f '%d:%i' "$resolved" 2>/dev/null)" || {
    supabase_stack_experiment_diagnostic 'dedicated Supabase home identity cannot be recorded'
    return 1
  }
  SUPABASE_STACK_EXPERIMENT_HOME="$resolved"
  SUPABASE_STACK_EXPERIMENT_OWNED_HOME="$resolved"
  SUPABASE_STACK_EXPERIMENT_HOME_IDENTITY="$identity"
}

supabase_stack_experiment_create_config() {
  local slot="$1"
  local path="$2"
  local template="$3"
  local owned_template=''
  local preserve_noclobber=0
  local write_status=0

  case "$slot" in
    a) [[ -z "$SUPABASE_STACK_EXPERIMENT_OWNED_CONFIG_A" ]] || return 1 ;;
    b) [[ -z "$SUPABASE_STACK_EXPERIMENT_OWNED_CONFIG_B" ]] || return 1 ;;
    *)
      supabase_stack_experiment_diagnostic 'unknown config ownership slot'
      return 1
      ;;
  esac
  if ! supabase_stack_experiment_validate_owned_dir tools; then
    return 1
  fi
  if [[ -z "$path" || -e "$path" || -L "$path" || ! -f "$template" || -L "$template" ]]; then
    supabase_stack_experiment_diagnostic 'refusing to replace an existing or unsafe generated config path'
    return 1
  fi
  owned_template="$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/config-template-$slot.toml"
  if [[ -e "$owned_template" || -L "$owned_template" ]] || ! ( set -C; cat "$template" >"$owned_template" ); then
    supabase_stack_experiment_diagnostic 'private generated-config template could not be saved'
    return 1
  fi
  case "$-" in
    *C*) preserve_noclobber=1 ;;
    *) set -C ;;
  esac
  if ! exec 3>"$path"; then
    [[ "$preserve_noclobber" == 1 ]] || set +C
    supabase_stack_experiment_diagnostic 'generated config could not be created exclusively'
    return 1
  fi
  [[ "$preserve_noclobber" == 1 ]] || set +C
  case "$slot" in
    a)
      SUPABASE_STACK_EXPERIMENT_OWNED_CONFIG_A="$path"
      SUPABASE_STACK_EXPERIMENT_CONFIG_A_TEMPLATE="$owned_template"
      ;;
    b)
      SUPABASE_STACK_EXPERIMENT_OWNED_CONFIG_B="$path"
      SUPABASE_STACK_EXPERIMENT_CONFIG_B_TEMPLATE="$owned_template"
      ;;
  esac
  if cat "$template" >&3; then
    write_status=0
  else
    write_status=$?
  fi
  exec 3>&-
  if [[ "$write_status" != 0 ]]; then
    SUPABASE_STACK_EXPERIMENT_CONFIG_CREATE_FAILED=1
    supabase_stack_experiment_diagnostic 'generated config write failed; private recovery files retained'
    return "$write_status"
  fi
}

supabase_stack_experiment_on_signal() {
  local signal="$1"
  local status=1
  if [[ "$signal" == INT ]]; then
    status=130
  elif [[ "$signal" == TERM ]]; then
    status=143
  fi
  trap - INT TERM
  exit "$status"
}

supabase_stack_experiment_on_exit() {
  local original_status="${1:-0}"
  local cleanup_status=0
  trap - EXIT INT TERM
  set +e
  supabase_stack_experiment_cleanup
  cleanup_status=$?
  if [[ "$original_status" -ne 0 ]]; then
    exit "$original_status"
  fi
  if [[ "$cleanup_status" -ne 0 ]]; then
    exit "$cleanup_status"
  fi
  exit 0
}

supabase_stack_experiment_run_cli() {
  local operation="$1"
  shift
  # Keep the module path out of argv[1], which its public entrypoint guard checks.
  node --input-type=module -e 'import(process.argv[3]).then(m => m.runCliCommand(process.argv[1], process.argv[2], process.argv.slice(4)).then(status => { process.exitCode = status })).catch(() => { console.error("Supabase CLI command wrapper failed."); process.exitCode = 1 })' \
    "$operation" "$SUPABASE_STACK_EXPERIMENT_CLI" \
    "$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/supabase-local-backend.mjs" "$@"
}

supabase_stack_experiment_cleanup() {
  local cleanup_failed=0
  local need_recovery=0
  local list_path=''
  local recovered_path=''
  local id=''
  local candidate=''
  local seen=' '
  local -a ids
  local ids_count=1
  ids[0]=''

  if [[ "$SUPABASE_STACK_EXPERIMENT_CLEANUP_DONE" == 1 ]]; then
    return 0
  fi
  SUPABASE_STACK_EXPERIMENT_CLEANUP_DONE=1

  if [[ "$SUPABASE_STACK_EXPERIMENT_START_ATTEMPTED" == 1 && ( -z "$SUPABASE_STACK_EXPERIMENT_ID_A" || -z "$SUPABASE_STACK_EXPERIMENT_ID_B" ) ]]; then
    need_recovery=1
  fi
  if [[ "$need_recovery" == 1 ]]; then
    if [[ -z "$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS" || -z "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" || -z "$SUPABASE_STACK_EXPERIMENT_CLI" ]]; then
      supabase_stack_experiment_diagnostic 'cannot recover stack IDs without registered private run resources'
      cleanup_failed=1
    else
      list_path="$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/owned-stacks.json"
      recovered_path="$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/recovered-stack-ids.txt"
      if ! supabase_stack_experiment_validate_owned_dir tools; then
        cleanup_failed=1
      elif ! supabase_stack_experiment_validate_home; then
        cleanup_failed=1
      elif ! SUPABASE_HOME="$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" SUPABASE_EXPERIMENTAL_STACK=1 supabase_stack_experiment_run_cli list stack list --output-format json >"$list_path" 2>>"$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/cleanup.stderr"; then
        supabase_stack_experiment_diagnostic 'isolated stack list failed; private recovery files retained'
        cleanup_failed=1
      elif ! node - "$list_path" "$recovered_path" 2>>"$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/cleanup.stderr" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs')
const [input, output] = process.argv.slice(2)
let document
try {
  document = JSON.parse(readFileSync(input, 'utf8'))
} catch {
  process.exit(2)
}
const entries = Array.isArray(document)
  ? document
  : document && Array.isArray(document.stacks)
    ? document.stacks
    : null
if (!entries) process.exit(2)
const ids = []
const seen = new Set()
for (const entry of entries) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(entry.id)) process.exit(2)
  if (!seen.has(entry.id)) {
    seen.add(entry.id)
    ids.push(entry.id)
  }
}
writeFileSync(output, `${ids.join('\n')}\n`, { mode: 0o600 })
NODE
      then
        supabase_stack_experiment_diagnostic 'isolated stack list JSON was not a recognized complete ID list; private recovery files retained'
        cleanup_failed=1
      else
        while IFS= read -r id; do
          if [[ -n "$id" ]]; then
            ids[$ids_count]="$id"
            ids_count=$((ids_count + 1))
            seen="$seen$id "
          fi
        done <"$recovered_path"
      fi
    fi
  fi

  for candidate in "$SUPABASE_STACK_EXPERIMENT_ID_A" "$SUPABASE_STACK_EXPERIMENT_ID_B"; do
    if [[ -n "$candidate" ]]; then
      case "$seen" in
        *" $candidate "*) ;;
        *) ids[$ids_count]="$candidate"; ids_count=$((ids_count + 1)); seen="$seen$candidate ";;
      esac
    fi
  done

  for id in "${ids[@]}"; do
    [[ -n "$id" ]] || continue
    if [[ -z "$SUPABASE_STACK_EXPERIMENT_CLI" || -z "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" ]]; then
      supabase_stack_experiment_diagnostic 'cannot clean a stack without its registered isolated CLI home'
      cleanup_failed=1
      continue
    fi
    if ! supabase_stack_experiment_validate_home; then
      cleanup_failed=1
      continue
    fi
    if ! supabase_stack_experiment_validate_owned_dir tools; then
      cleanup_failed=1
      supabase_stack_experiment_diagnostic 'tools ownership changed; skipping CLI lifecycle calls and retaining recovery files'
      continue
    fi
    if ! SUPABASE_HOME="$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" SUPABASE_EXPERIMENTAL_STACK=1 supabase_stack_experiment_run_cli stop stack stop --stack-id "$id" >>"$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/cleanup.stderr" 2>&1; then
      supabase_stack_experiment_diagnostic 'stack stop failed; private recovery files retained'
      cleanup_failed=1
    fi
    if ! supabase_stack_experiment_validate_owned_dir tools; then
      cleanup_failed=1
      supabase_stack_experiment_diagnostic 'tools ownership changed; skipping CLI lifecycle calls and retaining recovery files'
      continue
    fi
    if ! SUPABASE_HOME="$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" SUPABASE_EXPERIMENTAL_STACK=1 supabase_stack_experiment_run_cli destroy stack destroy --stack-id "$id" --yes >>"$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/cleanup.stderr" 2>&1; then
      supabase_stack_experiment_diagnostic 'stack destroy failed; private recovery files retained'
      cleanup_failed=1
    fi
  done

  if [[ "$SUPABASE_STACK_EXPERIMENT_REQUIRE_EMPTY" == 1 && "$SUPABASE_STACK_EXPERIMENT_START_ATTEMPTED" == 1 && "$cleanup_failed" == 0 ]]; then
    if ! supabase_stack_experiment_validate_home || ! supabase_stack_experiment_validate_owned_dir tools; then
      cleanup_failed=1
    elif ! SUPABASE_HOME="$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" SUPABASE_EXPERIMENTAL_STACK=1 supabase_stack_experiment_run_cli list stack list --output-format json >"$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/final-stacks.json" 2>>"$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/cleanup.stderr"; then
      cleanup_failed=1
    elif ! node -e 'const fs=require("node:fs"); try { const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const stacks=Array.isArray(value)?value:value?.stacks; if(!Array.isArray(stacks)||stacks.length!==0) process.exit(1) } catch { process.exit(1) }' "$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS/final-stacks.json"; then
      cleanup_failed=1
    fi
    if [[ "$cleanup_failed" != 0 ]]; then
      supabase_stack_experiment_diagnostic 'final isolated stack list was not empty or could not be verified; private recovery files retained'
    fi
  fi

  if [[ "$cleanup_failed" != 0 ]]; then
    supabase_stack_experiment_print_recovery_paths
    return 1
  fi

  if [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS" ]] && ! supabase_stack_experiment_validate_owned_dir tools; then
    cleanup_failed=1
  fi
  if [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME" ]] && ! supabase_stack_experiment_validate_owned_dir runtime; then
    cleanup_failed=1
  fi
  if [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" ]] && ! supabase_stack_experiment_validate_home; then
    cleanup_failed=1
  fi
  if [[ "$cleanup_failed" != 0 ]]; then
    supabase_stack_experiment_diagnostic 'owned temporary path changed; private recovery files retained'
    supabase_stack_experiment_print_recovery_paths
    return 1
  fi

  supabase_stack_experiment_remove_unchanged_config a || cleanup_failed=1
  supabase_stack_experiment_remove_unchanged_config b || cleanup_failed=1
  if [[ "$SUPABASE_STACK_EXPERIMENT_CONFIG_CREATE_FAILED" == 1 ]]; then
    cleanup_failed=1
  fi
  if [[ "$cleanup_failed" != 0 ]]; then
    supabase_stack_experiment_diagnostic 'generated config cleanup failed; private recovery files retained'
    supabase_stack_experiment_print_recovery_paths
    return 1
  fi

  if [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS" ]]; then
    rm -rf "$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS" || cleanup_failed=1
  fi
  if [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME" ]]; then
    rm -rf "$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME" || cleanup_failed=1
  fi
  if [[ "$cleanup_failed" != 0 ]]; then
    supabase_stack_experiment_diagnostic 'temporary directory removal failed; retain remaining private recovery files'
    supabase_stack_experiment_print_recovery_paths
    return 1
  fi
  return 0
}

supabase_stack_experiment_print_recovery_paths() {
  [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" ]] && printf 'Retained SUPABASE_HOME: %s\n' "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" >&2
  [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS" ]] && printf 'Retained private tools/recovery directory: %s\n' "$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS" >&2
  [[ -n "$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME" ]] && printf 'Retained private runtime directory: %s\n' "$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME" >&2
}

supabase_stack_experiment_remove_unchanged_config() {
  local slot="$1"
  local path=''
  local template=''
  if [[ "$slot" == a ]]; then
    path="$SUPABASE_STACK_EXPERIMENT_OWNED_CONFIG_A"
    template="$SUPABASE_STACK_EXPERIMENT_CONFIG_A_TEMPLATE"
  else
    path="$SUPABASE_STACK_EXPERIMENT_OWNED_CONFIG_B"
    template="$SUPABASE_STACK_EXPERIMENT_CONFIG_B_TEMPLATE"
  fi
  if [[ -n "$path" && -f "$path" && ! -L "$path" && -f "$template" ]] && cmp -s "$path" "$template"; then
    rm -f "$path" || {
      supabase_stack_experiment_diagnostic 'generated config could not be removed'
      return 1
    }
  fi
}

supabase_stack_experiment_validate_owned_dir() {
  local kind="$1"
  local path=''
  local identity=''
  local resolved=''
  case "$kind" in
    tools)
      path="$SUPABASE_STACK_EXPERIMENT_OWNED_TOOLS"
      identity="$SUPABASE_STACK_EXPERIMENT_TOOLS_IDENTITY"
      ;;
    runtime)
      path="$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME"
      identity="$SUPABASE_STACK_EXPERIMENT_RUNTIME_IDENTITY"
      ;;
    *) return 1 ;;
  esac
  if [[ -z "$path" || -z "$identity" || ! -d "$path" || -L "$path" ]]; then
    supabase_stack_experiment_diagnostic 'owned temporary directory is missing or unsafe'
    return 1
  fi
  resolved="$(cd -P "$path" 2>/dev/null && pwd -P)" || return 1
  if [[ "$resolved" != "$path" || "$resolved" != "$SUPABASE_STACK_EXPERIMENT_TEMP_ROOT"/* ]]; then
    supabase_stack_experiment_diagnostic 'owned temporary directory is outside its recorded root'
    return 1
  fi
  if [[ "$(stat -f '%d:%i' "$path" 2>/dev/null)" != "$identity" ]]; then
    supabase_stack_experiment_diagnostic 'owned temporary directory identity changed'
    return 1
  fi
}

supabase_stack_experiment_validate_home() {
  local resolved=''
  if ! supabase_stack_experiment_validate_owned_dir runtime; then
    return 1
  fi
  if [[ -z "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" || -z "$SUPABASE_STACK_EXPERIMENT_HOME_IDENTITY" || ! -d "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" || -L "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" ]]; then
    supabase_stack_experiment_diagnostic 'dedicated Supabase home is missing or unsafe'
    return 1
  fi
  resolved="$(cd -P "$SUPABASE_STACK_EXPERIMENT_OWNED_HOME" 2>/dev/null && pwd -P)" || return 1
  if [[ "$resolved" != "$SUPABASE_STACK_EXPERIMENT_OWNED_RUNTIME/supabase-home" || "$(stat -f '%d:%i' "$resolved" 2>/dev/null)" != "$SUPABASE_STACK_EXPERIMENT_HOME_IDENTITY" ]]; then
    supabase_stack_experiment_diagnostic 'dedicated Supabase home identity changed'
    return 1
  fi
}

supabase_stack_experiment_diagnostic() {
  printf 'Supabase experiment cleanup: %s\n' "$1" >&2
}
