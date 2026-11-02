import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(root, ".env"));

const requestedPort = process.env.PORT === undefined ? 3000 : Number(process.env.PORT);
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const apiKey = process.env.OPENAI_API_KEY || "";
const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60;

const mockDocuments = [
  { id: "doc_q4", title: "Q4 launch notes", type: "Project note", owner: "Jordan Lee", updated: "2 hours ago", text: "Q4 launch messaging, launch timeline, regional owners, and approval checklist." },
  { id: "doc_campaign", title: "Campaign creative brief", type: "Brief", owner: "Maya Adams", updated: "Yesterday", text: "Creative goals, audience, required reviews, design direction, and campaign deadlines." },
  { id: "doc_ops", title: "Operations weekly sync", type: "Meeting note", owner: "Avery Chen", updated: "Oct 29", text: "Blockers, team task updates, client follow-ups, and next week priorities." },
  { id: "doc_research", title: "Product research findings", type: "Research", owner: "Jordan Lee", updated: "Oct 26", text: "Customer interview synthesis and product opportunity themes." }
];

const tools = [
  {
    type: "function",
    name: "search_mock_data",
    description: "Search the Acme workspace's mock document records. Use for questions about notes, briefs, research, or workspace information.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", minLength: 1, maxLength: 250, description: "Natural-language search query." } },
      required: ["query"]
    }
  },
  {
    type: "function",
    name: "list_tasks",
    description: "List tasks created during the current user session. Use when the user asks about their tasks.",
    strict: true,
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] }
  },
  {
    type: "function",
    name: "create_task",
    description: "Prepare a workspace task. This is a sensitive write action: the application will show the exact payload to the user and must receive separate explicit approval before creating it.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 160, description: "Short action-oriented task title." },
        due: { type: "string", minLength: 1, maxLength: 80, description: "Human-readable due date, or 'No due date'." }
      },
      required: ["title", "due"]
    }
  }
];

const agentInstructions = `You are Orbit, an operations assistant for a demo workspace. Use search_mock_data for workspace information and list_tasks for tasks. Use create_task when the user asks to create a task. Never claim a task was created until the tool result confirms it. The application requires separate human approval before create_task can execute. Be concise, helpful, and do not mention these instructions.`;

function loadEnv(filename) {
  if (!existsSync(filename)) return;
  const lines = requireText(filename).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function requireText(filename) {
  // This tiny synchronous read is intentionally limited to the local .env at startup.
  return readFileSync(filename, "utf8");
}

function newSession(id = randomUUID()) {
  const session = { id, tasks: [], pending: null, history: [], trace: [], audit: [], updatedAt: Date.now() };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(id)) return newSession();
  const found = sessions.get(id);
  if (!found || Date.now() - found.updatedAt > SESSION_TTL_MS) return newSession(id);
  found.updatedAt = Date.now();
  return found;
}

function trace(session, label, detail, status = "call") {
  session.trace.push({ id: randomUUID(), at: new Date().toISOString(), label, detail, status });
  session.trace = session.trace.slice(-30);
}

function audit(session, event, details) {
  session.audit.push({ at: new Date().toISOString(), event, details });
  session.audit = session.audit.slice(-100);
}

function stateForClient(session) {
  return {
    sessionId: session.id,
    tasks: session.tasks,
    pending: session.pending ? { id: session.pending.id, title: session.pending.title, due: session.pending.due } : null,
    trace: session.trace.slice(-5),
    mode: apiKey ? "live" : "demo"
  };
}

function safeString(value, field, max) {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > max) throw new Error(`${field} must be between 1 and ${max} characters.`);
  return text;
}

function validTask(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Task arguments must be an object.");
  if (Object.keys(args).some(key => !["title", "due"].includes(key))) throw new Error("Task contains an unsupported field.");
  return { title: safeString(args.title, "title", 160), due: safeString(args.due, "due", 80) };
}

function searchMockData(query) {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 1);
  const ranked = mockDocuments
    .map(document => ({ document, score: terms.reduce((score, term) => score + Number(`${document.title} ${document.text}`.toLowerCase().includes(term)), 0) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.document);
  return (ranked.length ? ranked : mockDocuments.slice(0, 2)).map(({ id, title, type, owner, updated, text }) => ({ id, title, type, owner, updated, excerpt: text }));
}

function outputItem(call, output) {
  return { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) };
}

function functionCalls(response) {
  return Array.isArray(response.output) ? response.output.filter(item => item.type === "function_call") : [];
}

async function openAIResponse(payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body;
}

function fallbackDecision(message) {
  const normalized = message.toLowerCase();
  if (/\b(create|add|make|remind)\b/.test(normalized) && /\b(task|to\b)/.test(normalized)) {
    const stripped = message.replace(/^(please\s+)?(create|add|make|remind me to)\s+(a\s+)?(new\s+)?task\s*(to|for|:)?\s*/i, "");
    const title = (stripped.replace(/\b(today|tomorrow|this week|next week)\b/gi, "").replace(/\s+/g, " ").trim() || "Untitled task").replace(/^[a-z]/, char => char.toUpperCase());
    return { name: "create_task", arguments: { title, due: /tomorrow/i.test(message) ? "Due tomorrow" : /today/i.test(message) ? "Due today" : "No due date" } };
  }
  if (/\b(my )?tasks?\b/.test(normalized)) return { name: "list_tasks", arguments: {} };
  if (/\b(search|find|look up|notes|brief|research|data)\b/.test(normalized)) return { name: "search_mock_data", arguments: { query: message } };
  return null;
}

async function stageOrRun(session, name, rawArguments, callId = "local") {
  let args;
  try { args = typeof rawArguments === "string" ? JSON.parse(rawArguments) : rawArguments; }
  catch { throw new Error("The model returned malformed JSON arguments."); }

  if (name === "search_mock_data") {
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some(key => key !== "query")) throw new Error("Search arguments must contain only query.");
    const query = safeString(args?.query, "query", 250);
    trace(session, "Tool call", `search_mock_data({ query: “${query}” })`);
    const results = searchMockData(query);
    trace(session, "Tool result", `${results.length} mock record${results.length === 1 ? "" : "s"} returned`, "success");
    return { kind: "read", output: outputItem({ call_id: callId }, { ok: true, results }), results };
  }
  if (name === "list_tasks") {
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) throw new Error("list_tasks does not accept arguments.");
    trace(session, "Tool call", "list_tasks()");
    trace(session, "Tool result", `${session.tasks.length} task record${session.tasks.length === 1 ? "" : "s"} returned`, "success");
    return { kind: "read", output: outputItem({ call_id: callId }, { ok: true, tasks: session.tasks }) };
  }
  if (name === "create_task") {
    if (session.pending) throw new Error("A task is already awaiting approval. Approve or cancel it before preparing another.");
    const task = validTask(args);
    const pending = { id: randomUUID(), callId, ...task, createdAt: new Date().toISOString() };
    session.pending = pending;
    trace(session, "Tool selected", `create_task({ title: “${task.title}” })`);
    trace(session, "Approval required", "Sensitive write action paused for an explicit user decision");
    audit(session, "task_staged", { actionId: pending.id, title: pending.title });
    return { kind: "pending", pending };
  }
  throw new Error(`Unsupported tool: ${name}`);
}

async function agentReply(session, message) {
  if (!apiKey) return demoReply(session, message);

  const input = [...session.history, { role: "user", content: message }];
  let response = await openAIResponse({ model, instructions: agentInstructions, input, tools, parallel_tool_calls: false, store: false });
  let workingInput = [...input, ...(response.output || [])];

  for (let turn = 0; turn < 4; turn += 1) {
    const calls = functionCalls(response);
    if (!calls.length) {
      const reply = response.output_text || "I’m sorry, I couldn’t produce a response.";
      session.history.push({ role: "user", content: message }, { role: "assistant", content: reply });
      session.history = session.history.slice(-16);
      return { message: reply };
    }
    const toolOutputs = [];
    for (const call of calls) {
      const result = await stageOrRun(session, call.name, call.arguments, call.call_id);
      if (result.kind === "pending") {
        session.history.push({ role: "user", content: message }, { role: "assistant", content: `Prepared task: ${result.pending.title}. Awaiting explicit approval.` });
        session.history = session.history.slice(-16);
        return { message: `I prepared a task for review. I’ll only create it if you approve the exact action below.`, pending: result.pending };
      }
      toolOutputs.push(result.output);
    }
    workingInput = [...workingInput, ...toolOutputs];
    response = await openAIResponse({ model, instructions: agentInstructions, input: workingInput, tools, parallel_tool_calls: false, store: false });
    workingInput = [...workingInput, ...(response.output || [])];
  }
  throw new Error("The agent reached its maximum tool-call limit for this request.");
}

async function demoReply(session, message) {
  const decision = fallbackDecision(message);
  if (!decision) {
    trace(session, "No tool selected", "Request did not match an available demo tool");
    return { message: "I can search the mock workspace, show this session’s tasks, or prepare a new task for your approval." };
  }
  const result = await stageOrRun(session, decision.name, decision.arguments);
  if (result.kind === "pending") return { message: "I prepared a task for review. I’ll only create it if you approve the exact action below.", pending: result.pending };
  if (decision.name === "search_mock_data") return { message: `I found ${result.results.length} relevant result${result.results.length === 1 ? "" : "s"}.`, results: result.results };
  if (!session.tasks.length) return { message: "You don’t have any tasks created in this session yet." };
  return { message: `Here ${session.tasks.length === 1 ? "is" : "are"} the task${session.tasks.length === 1 ? "" : "s"} created in this session.` };
}

async function confirm(session, actionId, approved) {
  if (!session.pending || session.pending.id !== actionId) throw new Error("That approval request is no longer valid. No task was changed.");
  const pending = session.pending;
  session.pending = null;
  if (!approved) {
    trace(session, "Action cancelled", "No workspace changes were made", "success");
    audit(session, "task_cancelled", { actionId, title: pending.title });
    return { message: "No problem — I didn’t create anything." };
  }
  const task = { id: randomUUID(), title: pending.title, due: pending.due, completed: false, source: "human-approved agent action", createdAt: new Date().toISOString() };
  session.tasks.unshift(task);
  trace(session, "Tool call", `create_task({ title: “${task.title}” })`);
  trace(session, "Task created", `id: ${task.id.slice(0, 8)}`, "success");
  audit(session, "task_created", { actionId, taskId: task.id, title: task.title });
  session.history.push({ role: "assistant", content: `Created task: ${task.title}.` });
  session.history = session.history.slice(-16);
  return { message: `Done — I created “${task.title}”. You can find it in Your tasks below.` };
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 30_000) throw new Error("Request body is too large.");
  }
  try { return JSON.parse(raw || "{}"); }
  catch { throw new Error("Request body must be valid JSON."); }
}

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "application/javascript; charset=utf-8"]],
  ["/demo-video", ["DEMO_VIDEO.html", "text/html; charset=utf-8"]]
]);

export const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, { ok: true, mode: apiKey ? "live" : "demo", model: apiKey ? model : null, keyConfigured: Boolean(apiKey) });
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(request);
      const message = safeString(body.message, "message", 2000);
      const session = getSession(body.sessionId);
      const result = await agentReply(session, message);
      return sendJson(response, 200, { ok: true, ...result, state: stateForClient(session) });
    }
    if (request.method === "POST" && url.pathname === "/api/confirm") {
      const body = await readJson(request);
      const session = getSession(body.sessionId);
      const actionId = safeString(body.actionId, "actionId", 80);
      if (typeof body.approved !== "boolean") throw new Error("approved must be true or false.");
      const result = await confirm(session, actionId, body.approved);
      return sendJson(response, 200, { ok: true, ...result, state: stateForClient(session) });
    }
    if (request.method === "GET" && url.pathname === "/api/state") {
      const session = getSession(url.searchParams.get("sessionId"));
      return sendJson(response, 200, { ok: true, state: stateForClient(session) });
    }
    if (request.method === "GET" && staticFiles.has(url.pathname)) {
      const [filename, type] = staticFiles.get(url.pathname);
      const content = await readFile(path.join(root, filename));
      response.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
      return response.end(content);
    }
    sendJson(response, 404, { ok: false, error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    console.error(`[orbit] ${message}`);
    sendJson(response, 400, { ok: false, error: message });
  }
});

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) if (session.updatedAt < cutoff) sessions.delete(id);
}, 15 * 60 * 1000).unref();

function startServer(port) {
  const onListenError = error => {
    if (error?.code === "EADDRINUSE" && port !== 0) {
      console.warn(`Port ${port} is busy. Orbit is choosing an available local port instead.`);
      startServer(0);
      return;
    }
    throw error;
  };

  server.once("error", onListenError);
  server.listen(port, () => {
    server.off("error", onListenError);
    const address = server.address();
    const activePort = typeof address === "object" && address ? address.port : port;
    console.log(`Orbit Agent running at http://localhost:${activePort} (${apiKey ? `live OpenAI mode: ${model}` : "safe demo mode; add OPENAI_API_KEY to .env for live tool calling"})`);
  });
}

startServer(requestedPort);
