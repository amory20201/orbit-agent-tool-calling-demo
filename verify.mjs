import { once } from "node:events";
import { randomUUID } from "node:crypto";

process.env.PORT = "3417";
const { server } = await import("./server.mjs");

if (!server.listening) await once(server, "listening");

const baseUrl = "http://127.0.0.1:3417";
const sessionId = randomUUID();

async function post(path, body) {
  const response = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("Expected 2xx from " + path + "; received " + response.status + ".");
  return response.json();
}

try {
  const health = await fetch(baseUrl + "/api/health").then(response => response.json());
  if (health.mode !== "demo") throw new Error("Verification expects safe demo mode without an API key.");

  const search = await post("/api/chat", { sessionId, message: "Search for Q4 launch notes" });
  if (!search.results?.length) throw new Error("Search returned no results.");

  const staged = await post("/api/chat", { sessionId, message: "Create a task to review the campaign brief tomorrow" });
  if (!staged.pending?.id) throw new Error("Task was not staged for approval.");

  const beforeApproval = await fetch(baseUrl + "/api/state?sessionId=" + sessionId).then(response => response.json());
  if (beforeApproval.state.tasks.length !== 0) throw new Error("A task was created before approval.");

  const approved = await post("/api/confirm", { sessionId, actionId: staged.pending.id, approved: true });
  if (approved.state.tasks.length !== 1) throw new Error("Approved task was not created.");

  console.log("Verification passed: search worked; task was staged before approval; approved task was created.");
} finally {
  await new Promise(resolve => server.close(resolve));
}
