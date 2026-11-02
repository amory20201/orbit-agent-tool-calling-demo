# 60-second demo runbook

Use this sequence for a concise screen recording of the prototype.

| Time | On screen | Narration |
| --- | --- | --- |
| 0:00–0:08 | Open the page and point out **Safe mode** and **Human in the loop**. | “Orbit is a tool-using operations agent. It can read workspace data and prepare actions, with confirmation for anything that writes.” |
| 0:08–0:20 | Click **Search Q4 launch notes**. | “For a read-only request, Orbit selects `search_mock_data`, runs it, and displays the results. The live trace exposes each step.” |
| 0:20–0:37 | Click **Create a task**. | “For `create_task`, Orbit does not write immediately. It pauses with the exact task payload and asks a person to review it.” |
| 0:37–0:48 | Click **Approve & create**. | “Only explicit approval invokes the write tool. The created task appears below and remains available in session memory.” |
| 0:48–0:57 | Click **Show my tasks**, then show the trace. | “The agent can continue a multi-step interaction because it retains task state for this session.” |
| 0:57–1:00 | Point to the safety callout. | “In production, authorization, schema validation, audit logging, and confirmation binding belong on the server.” |

## Recording checklist

- Begin with a fresh page so the empty task list is visible.
- Use the built-in example prompts; each is designed to show one interaction state cleanly.
- Keep the right-side trace panel visible while demonstrating tool calls.
- Do not record real user or workspace data; this prototype uses only mock records.
