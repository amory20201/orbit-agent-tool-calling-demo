/* The page uses the local server when available and otherwise remains a safe offline demo. */
const mockDocuments = [
  { title: "Q4 launch notes", type: "Project note", owner: "Jordan Lee", updated: "2 hours ago", text: "Q4 launch messaging, launch timeline, regional owners, and approval checklist." },
  { title: "Campaign creative brief", type: "Brief", owner: "Maya Adams", updated: "Yesterday", text: "Creative goals, audience, required reviews, design direction, and campaign deadlines." },
  { title: "Operations weekly sync", type: "Meeting note", owner: "Avery Chen", updated: "Oct 29", text: "Blockers, team task updates, client follow-ups, and next week priorities." }
];

const state = {
  tasks: [], pendingTask: null, trace: [], connection: "checking",
  sessionId: sessionStorage.getItem("orbit-session-id") || crypto.randomUUID()
};
sessionStorage.setItem("orbit-session-id", state.sessionId);
const conversation = document.querySelector("#conversation");
const input = document.querySelector("#messageInput");
const traceList = document.querySelector("#traceList");
const sendButton = document.querySelector(".send-button");
const tourPopover = document.querySelector("#tourPopover");

const tourSteps = [
  { title: "A safe read-only tool call", text: "I will search the mock workspace now. Watch the chat and Live Trace panels: read-only tools do not need approval.", action: function () { handleMessage("Search for Q4 launch notes"); } },
  { title: "A write action pauses for you", text: "Now Orbit will prepare a task. It selects the tool but does not create anything; it waits for your exact approval.", action: function () { handleMessage("Create a task to review the campaign brief tomorrow"); } },
  { title: "You stay in control", text: "The guided demo stops at the approval gate. Press Approve and create to execute the mock action, or Cancel to leave the workspace unchanged.", action: null }
];
let tourIndex = 0;

function escapeHtml(value) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
  return String(value).replace(/[&<>'"]/g, function (char) { return map[char]; });
}

function paragraph(text) { return "<p>" + escapeHtml(text) + "</p>"; }

function addMessage(role, html, isError) {
  const article = document.createElement("article");
  article.className = "message " + role + "-message" + (isError ? " error-message" : "");
  const name = role === "user" ? "MAYA" : "ORBIT";
  const avatar = role === "user" ? "MA" : "✦";
  const avatarClass = role === "user" ? "user-avatar" : "assistant-avatar";
  article.innerHTML = '<div class="message-avatar ' + avatarClass + '">' + avatar + '</div><div class="message-body"><span class="message-label">' + name + "</span>" + html + "</div>";
  conversation.append(article);
  conversation.scrollTop = conversation.scrollHeight;
}

function confirmationMarkup(task) {
  return '<div class="confirmation-card" data-confirmation><div class="confirmation-header"><span>✓</span> Ready to create this task</div><p>This will add a task to the Acme workspace. Please review and approve.</p><div class="task-preview"><strong>' + escapeHtml(task.title) + "</strong><span>" + escapeHtml(task.due) + " · Exact action ID: " + escapeHtml(task.id.slice(0, 8)) + '</span></div><div class="confirm-actions"><button class="cancel-button" data-action="cancel">Cancel</button><button class="approve-button" data-action="approve">Approve &amp; create</button></div></div>';
}

function resultMarkup(results) {
  return '<div class="results-card">' + results.map(function (doc) {
    return '<div class="search-result"><strong>' + escapeHtml(doc.title) + "</strong><span>" + escapeHtml(doc.type) + " · " + escapeHtml(doc.owner) + " · " + escapeHtml(doc.updated) + "</span></div>";
  }).join("") + "</div>";
}

function renderTrace() {
  if (!state.trace.length) {
    traceList.innerHTML = '<li class="trace-empty"><span>⌁</span><p>Your agent’s reasoning and tool calls will appear here.</p></li>';
    return;
  }
  traceList.innerHTML = state.trace.slice(-5).map(function (item) {
    const okay = item.status === "success";
    return '<li><span class="trace-icon ' + (okay ? "success" : "") + '">' + (okay ? "✓" : "⌘") + '</span><div class="trace-copy"><strong>' + escapeHtml(item.label) + "</strong><span>" + escapeHtml(item.detail) + "</span></div></li>";
  }).join("");
}

function localTrace(label, detail, status) {
  state.trace.push({ id: crypto.randomUUID(), label: label, detail: detail, status: status || "call" });
  state.trace = state.trace.slice(-30);
  renderTrace();
}

function refreshMemory() {
  document.querySelector("#taskCount").textContent = state.tasks.length;
  document.querySelector("#memoryTaskCount").textContent = state.tasks.length;
  document.querySelector("#pendingState").textContent = state.pendingTask ? "Task draft" : "None";
}

function renderTasks() {
  const list = document.querySelector("#taskList");
  if (!state.tasks.length) {
    list.innerHTML = '<div class="empty-tasks"><span>✓</span><p>Nothing here yet. Ask Orbit to create your first task.</p></div>';
    return;
  }
  list.innerHTML = state.tasks.map(function (task) {
    return '<article class="task-item" data-id="' + escapeHtml(task.id) + '"><button class="task-check ' + (task.completed ? "done" : "") + '" aria-label="Toggle task"></button><div class="task-copy"><strong>' + escapeHtml(task.title) + "</strong><span>Created by Orbit · " + escapeHtml(task.source || "approval received") + "</span></div><time>" + escapeHtml(task.due) + "</time></article>";
  }).join("");
}

function applyServerState(serverState) {
  if (!serverState) return;
  if (serverState.sessionId && serverState.sessionId !== state.sessionId) {
    state.sessionId = serverState.sessionId;
    sessionStorage.setItem("orbit-session-id", state.sessionId);
  }
  state.tasks = Array.isArray(serverState.tasks) ? serverState.tasks : [];
  state.pendingTask = serverState.pending || null;
  state.trace = Array.isArray(serverState.trace) ? serverState.trace : [];
  renderTasks();
  refreshMemory();
  renderTrace();
}

function setConnection(mode) {
  state.connection = mode;
  const badge = document.querySelector(".secure-badge");
  badge.innerHTML = mode === "live" ? "<i></i> Live AI mode" : mode === "demo" ? "<i></i> Safe demo mode" : "<i></i> Offline demo";
}

function setBusy(isBusy) {
  sendButton.disabled = isBusy;
  sendButton.textContent = isBusy ? "…" : "↑";
  input.disabled = isBusy;
}

async function api(path, body) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok || !data.ok) throw new Error(data.error || "The agent server could not complete that request.");
  return data;
}

async function connectToServer() {
  try {
    const health = await fetch("/api/health", { cache: "no-store" });
    const info = await health.json();
    if (!health.ok || !info.ok) throw new Error("Server health check failed");
    setConnection(info.mode);
    const response = await fetch("/api/state?sessionId=" + encodeURIComponent(state.sessionId), { cache: "no-store" });
    const data = await response.json();
    if (data.ok) {
      applyServerState(data.state);
      if (state.pendingTask) addMessage("assistant", paragraph("A task is still waiting for your decision.") + confirmationMarkup(state.pendingTask));
    }
  } catch {
    setConnection("offline");
  }
}

function getDueDate(text) {
  if (/tomorrow/i.test(text)) return "Due tomorrow";
  if (/today/i.test(text)) return "Due today";
  return "No due date";
}

function taskTitleFrom(text) {
  const title = text.replace(/^(please\s+)?(create|add|make|remind me to)\s+(a\s+)?(new\s+)?task\s*(to|for|:)?\s*/i, "").replace(/\b(today|tomorrow|this week|next week)\b/gi, "").replace(/\s+/g, " ").trim();
  return (title || "Untitled task").replace(/^[a-z]/, function (char) { return char.toUpperCase(); });
}

function findDocuments(query) {
  const terms = query.toLowerCase().replace(/\b(search|find|look up|for|the|notes|document|docs)\b/g, " ").split(/\s+/).filter(function (term) { return term.length > 1; });
  const scored = mockDocuments.map(function (doc) {
    return { doc: doc, score: terms.reduce(function (sum, term) { return sum + Number((doc.title + " " + doc.text).toLowerCase().includes(term)); }, 0) };
  }).filter(function (item) { return item.score > 0; }).sort(function (a, b) { return b.score - a.score; });
  return scored.length ? scored.map(function (item) { return item.doc; }) : mockDocuments.slice(0, 2);
}

function localDecision(text) {
  const normalized = text.trim().toLowerCase();
  if (/\b(create|add|make|remind)\b/.test(normalized) && /\b(task|to\b)/.test(normalized)) return { name: "create_task", args: { title: taskTitleFrom(text), due: getDueDate(text) } };
  if (/\b(my )?tasks?\b/.test(normalized)) return { name: "list_tasks", args: {} };
  if (/\b(search|find|look up|notes|brief|research|data)\b/.test(normalized)) return { name: "search_mock_data", args: { query: text } };
  return { name: "unsupported", args: {} };
}

function handleOfflineMessage(text) {
  const action = localDecision(text);
  if (action.name === "search_mock_data") {
    localTrace("Tool call", "search_mock_data read-only request");
    const results = findDocuments(action.args.query);
    localTrace("Tool result", results.length + " mock records returned", "success");
    addMessage("assistant", paragraph("I found " + results.length + " relevant results.") + resultMarkup(results));
    return;
  }
  if (action.name === "list_tasks") {
    localTrace("Tool call", "list_tasks()");
    localTrace("Tool result", state.tasks.length + " task records returned", "success");
    addMessage("assistant", paragraph(state.tasks.length ? "You have " + state.tasks.length + " tasks in this session." : "You do not have any tasks created in this session yet."));
    return;
  }
  if (action.name === "create_task") {
    if (state.pendingTask) {
      localTrace("Write action paused", "Existing task draft must be approved or cancelled first");
      addMessage("assistant", paragraph("You already have a task waiting for approval. Please approve or cancel that draft first."), true);
      return;
    }
    state.pendingTask = { id: crypto.randomUUID(), title: action.args.title, due: action.args.due };
    localTrace("Tool selected", "create_task prepared but not executed");
    localTrace("Approval required", "Sensitive write action paused for an explicit user decision");
    refreshMemory();
    addMessage("assistant", paragraph("I prepared a task for review. I will only create it if you approve the exact action below.") + confirmationMarkup(state.pendingTask));
    return;
  }
  localTrace("No tool selected", "Request did not match an available tool");
  addMessage("assistant", paragraph("I can search the mock workspace, show session tasks, or prepare a new task for your approval."), true);
}

async function handleServerMessage(text) {
  const data = await api("/api/chat", { sessionId: state.sessionId, message: text });
  applyServerState(data.state);
  const extra = data.results ? resultMarkup(data.results) : "";
  const confirmation = data.pending ? confirmationMarkup(data.pending) : "";
  addMessage("assistant", paragraph(data.message) + extra + confirmation);
}

async function handleMessage(text) {
  const value = text.trim();
  if (!value) return;
  addMessage("user", paragraph(value));
  if (state.connection === "live" || state.connection === "demo") {
    setBusy(true);
    try { await handleServerMessage(value); }
    catch (error) { addMessage("assistant", paragraph(error.message + " Nothing was changed; you can try again."), true); }
    finally { setBusy(false); }
    return;
  }
  try { handleOfflineMessage(value); }
  catch { addMessage("assistant", paragraph("I could not complete that tool request, but nothing was changed. Please try again."), true); }
}

async function confirmPending(approved) {
  if (!state.pendingTask) return;
  if (state.connection === "live" || state.connection === "demo") {
    setBusy(true);
    try {
      const data = await api("/api/confirm", { sessionId: state.sessionId, actionId: state.pendingTask.id, approved: approved });
      document.querySelectorAll("[data-confirmation]").forEach(function (card) { card.remove(); });
      applyServerState(data.state);
      addMessage("assistant", paragraph(data.message));
    } catch (error) {
      addMessage("assistant", paragraph(error.message + " Nothing was changed; please refresh the task state."), true);
    } finally { setBusy(false); }
    return;
  }
  const task = state.pendingTask;
  state.pendingTask = null;
  document.querySelectorAll("[data-confirmation]").forEach(function (card) { card.remove(); });
  if (!approved) {
    localTrace("Action cancelled", "No workspace changes were made", "success");
    refreshMemory();
    addMessage("assistant", paragraph("No problem — I did not create anything."));
    return;
  }
  state.tasks.unshift({ id: task.id, title: task.title, due: task.due, completed: false, source: "human-approved agent action" });
  localTrace("Tool call", "create_task executed after explicit approval");
  localTrace("Task created", "id: " + task.id.slice(0, 8), "success");
  renderTasks();
  refreshMemory();
  addMessage("assistant", paragraph("Done — I created “" + task.title + "”. You can find it in Your tasks below."));
}

function renderTour(step) {
  const item = tourSteps[step];
  document.querySelector("#tourStep").textContent = "GUIDED DEMO · " + (step + 1) + " OF " + tourSteps.length;
  document.querySelector("#tourTitle").textContent = item.title;
  document.querySelector("#tourText").textContent = item.text;
  document.querySelector("#tourNext").innerHTML = step === tourSteps.length - 1 ? "Close demo" : "Next step <span>→</span>";
}

function startTour() {
  if (state.pendingTask) {
    addMessage("assistant", paragraph("Please approve or cancel the task already awaiting review before starting the guided demo."), true);
    return;
  }
  tourIndex = 0;
  renderTour(tourIndex);
  tourPopover.hidden = false;
  tourSteps[tourIndex].action();
}

function advanceTour() {
  if (tourIndex === tourSteps.length - 1) { tourPopover.hidden = true; return; }
  tourIndex += 1;
  renderTour(tourIndex);
  if (tourSteps[tourIndex].action) tourSteps[tourIndex].action();
}

document.querySelector("#composer").addEventListener("submit", function (event) {
  event.preventDefault();
  handleMessage(input.value);
  input.value = "";
  input.style.height = "auto";
});
input.addEventListener("input", function () { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 100) + "px"; });
document.querySelectorAll("[data-prompt]").forEach(function (button) { button.addEventListener("click", function () { handleMessage(button.dataset.prompt); }); });
document.querySelector("#runTour").addEventListener("click", startTour);
document.querySelector("#tourNext").addEventListener("click", advanceTour);
document.querySelector("#closeTour").addEventListener("click", function () { tourPopover.hidden = true; });
conversation.addEventListener("click", function (event) {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "approve") confirmPending(true);
  if (action === "cancel") confirmPending(false);
});
document.querySelector("#taskList").addEventListener("click", function (event) {
  const item = event.target.closest(".task-item");
  if (!item || !event.target.closest(".task-check")) return;
  const task = state.tasks.find(function (entry) { return entry.id === item.dataset.id; });
  if (task) { task.completed = !task.completed; renderTasks(); }
});
document.querySelector("#clearTasks").addEventListener("click", function () {
  const before = state.tasks.length;
  state.tasks = state.tasks.filter(function (task) { return !task.completed; });
  if (before !== state.tasks.length) { renderTasks(); refreshMemory(); }
});

connectToServer();
