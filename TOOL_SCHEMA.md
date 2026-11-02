# Tool schema documentation

Orbit registers these strict JSON-schema function tools with the OpenAI Responses API. The model may request a call, but the Node server owns validation, authorization, execution, and the final response loop.

## search_mock_data

Read-only search over the demo workspace. It executes after server-side validation and needs no confirmation.

~~~json
{
  "type": "function",
  "name": "search_mock_data",
  "strict": true,
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "query": { "type": "string", "minLength": 1, "maxLength": 250 }
    },
    "required": ["query"]
  }
}
~~~

The result contains only mock-record metadata and short excerpts.

## list_tasks

Read-only list of tasks in the current server-side session.

~~~json
{
  "type": "function",
  "name": "list_tasks",
  "strict": true,
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {},
    "required": []
  }
}
~~~

## create_task

Sensitive write action. A function call does not create a task. Instead, the server validates the payload, creates an immutable pending action with a random ID, and returns an approval card. The task is created only when the browser confirms that same ID.

~~~json
{
  "type": "function",
  "name": "create_task",
  "strict": true,
  "parameters": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "title": { "type": "string", "minLength": 1, "maxLength": 160 },
      "due": { "type": "string", "minLength": 1, "maxLength": 80 }
    },
    "required": ["title", "due"]
  }
}
~~~

## Server control flow

1. The browser sends a message to the server with its random session ID.
2. The server sends the message and schemas to the Responses API.
3. Every returned function call is parsed and strictly validated.
4. Read tools execute and their function_call_output items are returned to the model.
5. A create_task request becomes a pending action, not a write.
6. The confirmation route rejects stale or mismatched action IDs.
7. Only an approved matching request creates the task and records an audit event.
