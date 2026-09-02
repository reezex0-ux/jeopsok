# Protocol model

## Modern path: MCP 2026-07-28

Jeopsok is built on the MCP TypeScript SDK v2 and supports the `2026-07-28` protocol revision.

The modern protocol removes the old `initialize` handshake/session lifecycle. A negotiating client can use `server/discover`, and normal requests carry the protocol/client metadata needed for that request.

For HTTP serving, Jeopsok uses the SDK's per-request handler model:

```text
request -> fresh MCP server instance -> response -> instance discarded
```

Shared workload services, such as the process manager, live outside that per-request MCP server instance.

That is why this works:

```text
request A: exec_command -> process sessionId
request B: read_process(sessionId) -> same process state
```

The MCP transport remains stateless; the process handle is explicit application state.

## 2025-era compatibility

The HTTP entry keeps the SDK's `legacy: "stateless"` fallback. Older clients can still perform their `initialize` flow, but Jeopsok does not create or require an `Mcp-Session-Id` and does not use sticky routing for tool calls.

## HTTP vs stdio

The public recommendation is Streamable HTTP because the per-request model cleanly matches stateless MCP serving and normal service supervision/load balancing.

The optional stdio entry is included for local MCP clients. SDK v2 can negotiate modern `2026-07-28` over stdio as well, but the underlying stdio pipe still has a connection lifetime, so it does not provide the same process-isolation characteristics as independent HTTP requests.

## References

- MCP: https://modelcontextprotocol.io/
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk

## Permission profiles and discovery

Jeopsok registers tools per server instance according to `JEOPSOK_PROFILE`, so `tools/list` only advertises capabilities available under the active policy. This applies equally to modern 2026-07-28 traffic and the stateless 2025-era fallback.
