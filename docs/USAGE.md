# Usage guide

Jeopsok exposes 13 deliberately focused MCP tools.

## Commands

### `exec_command`

Runs a shell command using the configured default shell, or an explicitly supplied shell. If the command does not finish within `yieldTimeMs`, Jeopsok returns immediately with a process `sessionId`.

Useful arguments:

- `cmd`: command text
- `workdir`: working directory
- `shell`: override shell executable
- `login`: login-shell semantics on POSIX shells
- `env`: environment variable overrides
- `stdin`: initial input
- `timeoutMs`: hard runtime limit (`0` means none)
- `yieldTimeMs`: how long the MCP request waits before returning a handle
- `maxOutputBytes`: bounded output returned in one response

Example:

```text
exec_command(
  cmd="npm test",
  workdir="/srv/project",
  yieldTimeMs=1000
)
```

If the job is still running, use `read_process` rather than repeating the command.

## Process handles

### `read_process`

Poll output and status. Pass the previous `nextSeq` as `afterSeq` to receive only newer output.

### `write_stdin`

Sends input to an existing process. `closeStdin=true` closes the input stream afterward.

### `terminate_process`

Sends `SIGINT`, `SIGTERM`, or `SIGKILL`. `SIGTERM` can escalate after the configured grace period.

### `list_processes`

Lists running and recently completed process handles retained by the service.

Process handles are runtime state, not MCP transport sessions. They work across independent stateless HTTP requests while the same Jeopsok service process remains alive.

## Files

### `list_directory`

Lists a directory, optionally recursively with entry/depth limits.

### `stat_path`

Returns file/directory/symlink metadata.

### `read_file`

Reads a bounded chunk as UTF-8 or base64. Continue from `nextOffset` until `eof=true`.

### `write_file`

Creates, overwrites, or appends UTF-8/base64 content. Parent directories can be created automatically.

### `replace_in_file`

Exact text replacement with ambiguity protection. By default the old text must occur exactly once.

### `upload_file` / `download_file`

Chunked base64 transfer for binary or large files.

### `remove_path`

Permanently deletes a file or directory. There is no trash/recycle-bin layer.

## Operations intentionally not exposed as separate tools

Jeopsok does not expose dedicated MCP tools for `mkdir`, copy, move, chmod, hashing, Git, package management, or build systems. They are ordinary host operations and can be performed through `exec_command`. Keeping them out of the tool catalog reduces schema size and tool-choice ambiguity.

## Example agent tasks

- "Show disk and memory usage."
- "Find why this systemd service is failing."
- "Run the test suite in `/srv/app` and summarize failures."
- "Read `/etc/nginx/nginx.conf`, replace this exact server name, then run `nginx -t`."
- "Start the build, return immediately, and poll until it completes."

Remember that the effective security boundary is the operating-system account running Jeopsok.
