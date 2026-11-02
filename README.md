# Orbit Agent

> A safe tool-calling AI assistant that searches mock workspace data, remembers session context, and requires explicit human approval before creating tasks.

![Status](https://img.shields.io/badge/status-demo%20ready-4169e1)
![Node](https://img.shields.io/badge/node-20%2B-339933)
![Safety](https://img.shields.io/badge/writes-human%20approved-1fa971)

## What it demonstrates

- **Tool/function calling** — the agent can select search_mock_data, list_tasks, or create_task.
- **Multi-step state** — task and pending-approval state live in a server-side session.
- **Human-in-the-loop safety** — write requests are staged, shown to the user, and only executed after approval of the exact action ID.
- **Error handling** — malformed requests, invalid arguments, stale approvals, and service failures are contained without changing task data.
- **Visible tool trace** — the UI exposes the tool lifecycle: selected → approval required → called → result.

## Run locally

### Demo mode — no API key needed

Open index.html directly in a browser. The app uses safe deterministic mock logic so the full search and approval workflow can be demonstrated offline.

### Live AI mode

1. Copy .env.example to .env.
2. Set OPENAI_API_KEY to your own key.
3. Optionally set OPENAI_MODEL to an available Responses API model.
4. Start the app:

~~~bash
node server.mjs
~~~

5. Open http://localhost:3000.

The API key stays on the server; it is never exposed to the browser.

## Demo walkthrough

1. Choose **Search Q4 launch notes** to run a read-only tool call.
2. Choose **Create a task** to prepare a sensitive write action.
3. Review the exact title, due date, and action ID.
4. Click **Approve & create** to create the task, or **Cancel** to leave state unchanged.
5. Choose **Show my tasks** to demonstrate session memory.

Click **Run guided demo** in the app for a built-in three-step presentation. For a downloadable recording, open DEMO_VIDEO.html and select **Generate & preview video**.

## Verification

Run the included integration check:

~~~bash
node verify.mjs
~~~

It verifies that:

1. Search returns mock records.
2. A task is staged but does not exist before approval.
3. A task exists only after the matching approval action is submitted.

## Project structure

| File | Purpose |
| --- | --- |
| index.html, styles.css, app.js | Browser UI, guided demo, task list, and tool trace |
| server.mjs | Session memory, validation, OpenAI tool loop, confirmation boundary, and API routes |
| TOOL_SCHEMA.md | Strict function schemas and execution flow |
| SAFETY_NOTES.md | Production safety considerations |
| DEMO.md | Presenter runbook |
| DEMO_VIDEO.html | Browser-native WebM demo generator |
| verify.mjs | End-to-end safe-demo verification |

## Publishing

This repository works as a static GitHub Pages demo because the frontend automatically falls back to offline demo mode when no server is present.

For live AI mode, deploy server.mjs to a Node-compatible host and set OPENAI_API_KEY in that host’s private environment variables. Do not publish .env.

## Safety model

The model can propose a tool call. It cannot directly create a task.

~~~text
User request
  → model proposes create_task
  → server validates the strict payload
  → server stages a unique pending action
  → user reviews and approves that exact action ID
  → server creates the task and records an audit event
~~~

See SAFETY_NOTES.md for production guidance and TOOL_SCHEMA.md for the exact tool contracts.

## License

This is an educational prototype. Add a license that matches your intended use before sharing or reusing it outside a class or portfolio project.
