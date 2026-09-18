# Usage guide

Jeopsok's visible MCP tool catalog depends on `JEOPSOK_PROFILE`.

## Profiles

### readonly

Exposes `list_directory`, `stat_path`, `read_file`, and `download_file`.

### workspace (default)

Adds `write_file`, `replace_in_file`, `upload_file`, and `remove_path`. Every path must remain inside `JEOPSOK_ALLOWED_ROOTS`; if no roots are supplied, `MCP_DEFAULT_CWD` is used.

### operator

Adds the five command/process tools. `JEOPSOK_ALLOWED_COMMANDS` is mandatory.

```dotenv
JEOPSOK_PROFILE=operator
JEOPSOK_ALLOWED_COMMANDS=git,node
JEOPSOK_ALLOWED_ENV=CI
```

Operator mode rejects shell control syntax and unapproved environment overrides. The allowlist controls which executable starts; it does not sandbox what an allowed executable can do.

### full

Exposes unrestricted filesystem and command/process tools. When `MCP_CODEACT_ENABLED=true`, it also exposes four persistent Python tools. Full mode is remote-shell-equivalent authority.

## Process handles

If `exec_command` continues beyond `yieldTimeMs`, Jeopsok returns a process `sessionId`. Use `read_process`, `write_stdin`, `terminate_process`, and `list_processes` for follow-up. These handles survive independent MCP requests while the Jeopsok service remains running.

## CodeAct

CodeAct is available only in `full`.

- `python_session_create`: starts a persistent Python worker.
- `python_action`: executes Python while preserving variables.
- `python_inspect`: reads variables through a restricted expression evaluator.
- `python_session_close`: terminates the worker.

The worker exposes:

```python
host.files
host.process
host.system
```

Example:

```python
rows = host.files.list(".", recursive=True, pattern="*.json", max_entries=500)
len(rows)
```

A later `python_inspect` can inspect `len(rows)` or `rows[:5]` without resending the data.

`runMode=auto` resolves to interactive. Client labels and request metadata never remove budgets. Only server-owned `MCP_RUN_MODE=unattended` may create unattended sessions.

Checkpoints contain session metadata and counters, not a serialization of live Python variables. Restarting the worker loses in-memory Python state.

## Authentication

Static bearer authentication works with clients that can send an Authorization header. External OAuth mode verifies signed JWT access tokens from a dedicated Authorization Server / IdP. Jeopsok publishes RFC 9728 protected-resource metadata but does not run DCR, authorization, token, refresh, or revocation endpoints. OAuth-only deployments should normally leave `MCP_AUTH_TOKEN` empty.

See [Deployment](DEPLOYMENT.md) for configuration examples.

## Filesystem notes

Path enforcement in non-full profiles checks normalized paths and resolved symlink targets. A path that appears to be inside an allowed root but resolves through a symlink outside it is rejected.
