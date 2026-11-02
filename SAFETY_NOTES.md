# Safety notes

## What the application demonstrates

- Sensitive actions are staged, not executed immediately.
- The approval card shows the exact task title and due-date summary before any write.
- Cancelling removes the pending action without modifying task state.
- Only one write action may be pending at a time; a new request cannot replace the task awaiting review.
- Tool failures are caught at the orchestration boundary and reported without ending the conversation.
- The server uses a separate, random action ID for every pending task. Approval must present that exact ID.
- Session memory is server-side, per random session ID, and expires after one hour of inactivity.
- The API key remains in .env on the server and is never sent to the browser.

## Production requirements

1. **Authenticate and authorize on the server.** Do not rely on the model or browser to enforce access control.
2. **Validate tool arguments with strict schemas.** Reject unknown fields, oversized payloads, and malformed values.
3. **Bind approval to an immutable action ID.** Do not accept a generic “yes” to authorize a new or changed action.
4. **Use least-privilege service credentials.** Separate read and write scopes and rotate secrets.
5. **Audit every tool invocation.** Record actor, tool, validated parameters (redacted where needed), authorization decision, result, and timestamp.
6. **Treat tool outputs as untrusted data.** Escape rendered output and avoid feeding raw retrieved text into high-privilege prompts.
7. **Add rate limits, retries, and idempotency keys** around write operations to prevent duplicate or runaway actions.
8. **Protect privacy.** Minimize retained chat data, disclose retention, and redact sensitive records from logs.

## Trust boundary

The language model can propose an action. The application server must decide whether that action is permitted, whether the parameters are valid, and whether user confirmation has been bound to the exact request.
