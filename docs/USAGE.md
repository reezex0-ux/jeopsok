# Usage guide

Jeopsok's visible MCP tools depend on `JEOPSOK_PROFILE`.

## Profiles and tool catalogs

### readonly

Exposes four tools: `list_directory`, `stat_path`, `read_file`, `download_file`.

### workspace (default)

Adds `write_file`, `replace_in_file`, `upload_file`, and `remove_path`. Every path must stay inside `JEOPSOK_ALLOWED_ROOTS`; if no roots are supplied, `MCP_DEFAULT_CWD` is used.

### operator

Adds the five command/process tools. `JEOPSOK_ALLOWED_COMMANDS` is mandatory. Example:

```dotenv
JEOPSOK_PROFILE=operator
JEOPSOK_ALLOWED_COMMANDS=git,node
JEOPSOK_ALLOWED_ENV=CI
```

Operator rejects shell control syntax and unapproved environment overrides. The allowlist controls which executable starts; it does not sandbox what an allowed executable can do.

### full

All 13 tools with unrestricted host paths and shell execution. Use only as explicit remote-shell-equivalent access.

## Files

`list_directory` lists permitted directories without recursively following directory symlinks. `stat_path` returns metadata. `read_file` reads bounded UTF-8/base64 chunks. `download_file` returns base64 chunks. Workspace/operator/full also expose `write_file`, `replace_in_file`, `upload_file`, and `remove_path`.

Path enforcement checks both normalized path location and real symlink resolution. A path lexically inside the workspace that resolves through a symlink to an outside directory is rejected.

## Commands and process handles

`exec_command` exists only in operator/full. If a command continues beyond `yieldTimeMs`, Jeopsok returns a process `sessionId`. Use `read_process`, `write_stdin`, `terminate_process`, and `list_processes` for follow-up.

Operator defaults `login=false`, blocks custom `shell`, and allows environment overrides only for names listed in `JEOPSOK_ALLOWED_ENV`.

Full mode permits the original unrestricted shell behavior.

Process handles persist across independent MCP HTTP requests while the Jeopsok service remains alive. They are not MCP sessions.
