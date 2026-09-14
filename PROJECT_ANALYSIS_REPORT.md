# 📋 Project Analysis Report — Autonomous AI Enterprise Studio v5.0

**Date:** September 14, 2026
**Analyst:** Buffy (Freebuff AI Agent)
**Scope:** UI/UX, Task Flow Architecture, Bug Audit, Improvement Roadmap
**Files Reviewed:** `public/cctv.html`, `src/server/cctv-server.js`, `src/coordination/team-lead.js`, `src/coordination/employee-pool.js`, `db/schema.sql`, `package.json`

---

## 1. Executive Summary

The project is an **AI "company" control plane**: a founder submits a task → the Team Lead
(Dr. Elena Rostova) analyzes it, possibly asks clarification questions, refines it into a
task contract, assigns it to a specialist employee (Backend / Frontend / QA / Research),
the employee "works" through lifecycle stages, QA verifies, and a deliverable report is
produced — all visualized through a real-time "CCTV" mission control dashboard.

**Overall verdict:** The core concept and backend architecture (SQLite WAL audit trails,
task state machine, event broadcaster, worktree isolation, emergency stop) are genuinely
strong. However, the **UI and the visible task flow are the weakest parts** — exactly as
you suspected. The main issues:

1. 🔴 **The task flow is broken at the clarification step** — the UI references a modal
   (`openClarificationModal`) that does not exist, so clarification requests can never be
   answered from the UI.
2. 🔴 **Single-task pipeline:** only one task truly executes at a time; the "company"
   cannot run parallel employee workstations even though the UI implies it.
3. 🟠 **Fake/templated deliverables** — when no Gemini API key is set, reports are
   hard-coded templates (even a baked-in "best free AI image tools" essay), which breaks
   the "100% real telemetry" promise.
4. 🟠 **No task timeline view** — the founder cannot see the analysis → clarification →
   assignment → work → QA → report journey as a visual pipeline.
5. 🟡 **Hard-coded founder name** ("Saurabh"), 60s forced cooldown, no dark mode, no
   filtering/search on tasks, no mobile support.

---

## 2. What Already Works Well ✅

| Area | Detail |
|---|---|
| **Security** | Bearer auth + CSRF on all POSTs, constant-time token compare, token injection via server-rendered meta tags (not hard-coded in HTML), 1MB payload cap |
| **Persistence** | SQLite WAL schema with tasks, full transition audit (`task_transitions`), flight recorder, quota metrics, knowledge base, backup manager |
| **Resilience** | Emergency stop with forensic worktree freeze, pause/resume, bootstrap-recovery of PENDING/RUNNING tasks on server restart |
| **Real-time UX** | SSE event stream (`/api/cctv/stream`) auto-pushes logs & decisions; 8s polling fallback; markdown report rendering with copy button |
| **Team model** | 4 specialist personas + Team Lead with role inference from task text (`_inferRoleFromGoal`) |
| **Employee intercom** | `/ask` endpoint generates natural-language status reports per employee |
| **Design system** | Clean, consistent tokens (Inter + JetBrains Mono, slate palette, slim scrollbars) — good base to build on |

---

## 3. Main Issue #1 — UI Problems (Detailed)

### 3.1 Critical: Broken Clarification Modal 🔴
`public/cctv.html` line ~2192 calls `openClarificationModal('${clarifyTask.taskId}')`,
but **this function is never defined anywhere in the file**. When the Team Lead detects
an ambiguous prompt (e.g. containing "either", "maybe", "not sure"), the task is set to
`AWAITING_CLARIFICATION` and shows in "Needs Your Attention" — but clicking **Clarify**
throws `ReferenceError` and the founder can never answer. The task is stuck forever.
Additionally, there is **no API endpoint** to call
`teamLead.resolveFounderClarification()` (it exists in `team-lead.js` but is unreachable).

**Fix:** Add `POST /api/studio/task/:id/clarify` endpoint + define `openClarificationModal()`
with the question and answer options returned by the Team Lead.

### 3.2 No Visual Pipeline / Timeline 🟠
The dashboard shows *the current state* (one hero task card) but never the *journey*.
Your desired flow — **Analyze → Ask (if doubt) → Rewrite Task → Assign → Work → Test →
Report** — has no visual representation. The QA stepper exists but only inside the
details modal, and it is fake (mapped purely from status, not real stage data).

**Fix:** Add a horizontal pipeline stepper on the hero task card with live stage data
(the server already sends `stage` and `progress` — use them, don't recompute).

### 3.3 Hero Task Card: Single-Task Bias 🟠
`renderHeroTask()` picks one active task and one "cabin worker". If 2 tasks are queued,
the founder has no list view of in-flight tasks; there is no way to click a specific
queued task and inspect it. The "Tasks" nav just scrolls to the same hero card.

**Fix:** Render a task list (queue table) with status chips, and make the hero card show
the *selected* task. Add per-task actions (view report, emergency stop, follow-up).

### 3.4 Fake Data Leaking Into "Real" UI 🟠
- `_synthesizeDeliverable()` contains **hard-coded essays** (free AI image tools, Claude
  vs DeepSeek benchmarks) that get served as "verified deliverable reports" when
  `GEMINI_API_KEY` is absent.
- The QA "11-stage verification" log line is emitted even though no actual tests run.
- `commitSha: 'sha-' + Math.random()` in completion records — fabricated data.

**Fix:** Wire the lifecycle stages to *real* actions: run `npm test` in the worktree for
QA, capture real `git rev-parse HEAD`, and if no AI key is configured, label reports
honestly as "Simulated Deliverable (no AI provider configured)".

### 3.5 UI/UX Friction Points 🟡
- **Hard-coded greeting** `Good morning, Saurabh 👋` — should read role from config or
  be editable.
- **60-second forced cooldown** blocks the New Task button with a countdown — feels
  punitive; the "Team Lead is actively managing" alert is an `alert()` dialog.
- **`alert()`/`confirm()` everywhere** — task errors, emergency stop, empty
  notifications all use native dialogs. Should be toasts / styled dialogs.
- **Search is fake** — `handleSearch()` only fades team rows; it never searches tasks
  and never resets opacity when cleared.
- **No dark mode** despite `JetBrains Mono`/console aesthetic that suits it.
- **Report modal loses state** — reopening via "View All" re-fetches; no report history
  browser (past deliverables are in SQLite but unreachable from UI).
- **Accessibility** — interactive `<div>` rows (team members, tasks) lack
  `role="button"`, `tabindex`, and keyboard handlers; SSE failures show no banner.

### 3.6 Responsiveness 🟡
The layout is a fixed 220px sidebar + 2-column grid with `height: 100vh; overflow:
hidden`. On a laptop or split-screen it becomes unusable; there are no media queries.

---

## 4. Main Issue #2 — Task Flow Problems (Detailed)

### 4.1 Desired vs Actual Flow

| Step | Desired (your ask) | Actual today | Verdict |
|---|---|---|---|
| 1. Founder gives task | Submit via modal | ✅ `POST /api/studio/delegate` → enqueue | Works |
| 2. Team Lead **analyzes** | Refine into contract | ✅ `analyzeAndRefineTask()` | Works (regex only — see 4.2) |
| 3. Team Lead **asks if doubt** | Clarification question + options | ⚠️ Detected via regex, question stored… but **UI modal broken + no API** | **Broken** |
| 4. **Rewrite task** with answers | Founder decision merges into spec | ⚠️ `resolveFounderClarification()` exists but unreachable | **Broken (UI-level)** |
| 5. **Assign to required employee** | Role-matched assignment | ✅ `_inferRoleFromGoal()` + `getAvailableEmployee(role)` | Works, but… |
| 6. Employee starts work | Real execution | ⚠️ Timers + templated text; no real code changes | **Simulated** |
| 7. **Do tests** | Real QA run | ❌ No test execution; QA stage is a `setTimeout` | **Simulated** |
| 8. **Submit report** | Real deliverable | ⚠️ Gemini (if key) else baked templates | Partial |
| 9. Dynamic company feel | Parallel workstations, live timeline | ❌ One task at a time, sequential 12s stages | Missing |

### 4.2 Analysis & Assignment Are Naive
`_inferRoleFromGoal()` and ambiguity detection are single regexes. "UI" in a task
sends it to the marketer (frontend), but e.g. "test the UI" hits the QA regex first —
ordering quirks produce wrong assignments. Risk level is just "does the prompt contain
'auth'". A real analysis pass (even via the existing Gemini hook, or a scoring function)
would materially improve routing quality.

### 4.3 Two Competing Lifecycles
`TeamLead.processQueue()` assigns via `ASSIGNED`, and the CCTV server separately runs
`_runAutonomousTaskLifecycle()` with its own 5 stages and DB writes. The employee status
transition (WORKING → DONE → FREE) is handled differently in `reviewAndSubmitTask()`
(returns to FREE) vs the server lifecycle (stays DONE). This split-brain is why the
state machine in `src/state/task-state-machine.js` exists but isn't used by the live path.

**Fix:** Make the server lifecycle delegate to `TaskStateMachine` for every transition,
so DB, UI, and audit log agree.

### 4.4 Queue Not Persisted
The team-lead task queue is **in-memory only**. A server restart loses QUEUED /
AWAITING_CLARIFICATION items (only RUNNING/PENDING DB tasks get re-bootstrapped).
Schema has no `queue_items` table.

### 4.5 No Employee Parallelism
`processQueue()` assigns a task to any free employee, but `dispatchAutonomousExecution`
uses `setImmediate` + one shared lifecycle; multiple tasks *can* interleave, yet the UI
and "cabin" only ever surface one, and `queueItem._executing` guards make sequential
processing the norm. A real company shows N employees working on N tasks simultaneously
with per-employee workstations.

---

## 5. Prioritized Suggestions & Roadmap

### 🔴 P0 — Fix the broken flow (1–2 days)
1. **Clarification loop end-to-end:**
   - Add `POST /api/studio/task/:id/clarify` calling `resolveFounderClarification()`.
   - Implement `openClarificationModal(taskId)` showing `clarification.question` and
     clickable `options` (radio list) + free-text "Other" → then re-dispatch.
2. **Persist the queue:** add `queue_items` table (status, clarification JSON, assigned
   employee) so restarts don't lose work; extend `_bootstrapPendingTasks()` to it.
3. **Unify lifecycle with `TaskStateMachine`** — every status change writes a
   `task_transitions` row with actor attribution (schema already supports it).

### 🟠 P1 — Make the company feel real (3–5 days)
4. **Live pipeline stepper UI** on the hero card:
   `ANALYZED → CLARIFYING → ASSIGNED → WORKING → TESTING → REVIEW → REPORT READY`
   driven by real `queueItem.stage`/`progress` + SSE events.
5. **Task list view:** replace single hero with a filterable table
   (All / Active / Blocked / Awaiting Clarification / Completed); click → details.
6. **Real QA stage:** execute `npm test` (or `node --test`) inside the task worktree,
   parse pass/fail, attach output to the report; fail the task honestly if tests fail.
7. **Real commit SHAs** from the worktree (`git rev-parse HEAD`); remove `Math.random()`.
8. **Honest deliverables:** if no `GEMINI_API_KEY`, mark reports
   "Simulated — configure AI provider" instead of serving canned essays. Move canned
   content out of `cctv-server.js` into a content module.
9. **Parallel workstations:** allow the cabin to show *all* busy employees (grid of
   mini-cards, each with progress bar + ask/pause buttons).

### 🟡 P2 — UI polish & company feel (ongoing)
10. **Replace all `alert()`/`confirm()`** with a toast system + styled confirm dialog
    (esp. emergency stop — make it type-to-confirm "STOP").
11. **Dark mode toggle** (persist in localStorage; you already use CSS variables).
12. **Editable founder profile** (name/greeting) stored in DB instead of hard-coded.
13. **Smart cooldown:** drop the blanket 60s; instead disable only while
    `activeTasksCount >= employees.length` (queue-full is a real reason, arbitrary
    waiting is not).
14. **Search everywhere:** tasks + employees + reports; reset styles on clear.
15. **Report center:** history browser over `tasks.deliverable_report` with export
    (Markdown/PDF via print stylesheet).
16. **Responsive layout:** collapse sidebar to icons <1100px, single column <800px.
17. **A11y:** keyboard focus + ARIA roles on rows/dialogs, live region for SSE outages.
18. **Suggestion engine:** a "Team Lead suggests next steps" card — e.g. from completed
    task, suggest "add tests", "write docs", "open PR" as one-click follow-ups (you
    already track history; this is cheap and feels like a real manager).

### 🟢 P3 — Bigger bets
19. Real code execution per employee via the existing `WorktreeManager` + coder modules
    (`src/coder/`) so worktrees actually receive diffs.
20. Webhook/notification on task completion (email/Slack) for a hands-off company.
21. Multi-model routing per role (backend→code model, research→search-grounded model).

---

## 6. Top 5 Quick Wins (Do These First)

| # | Change | Effort | Impact |
|---|---|---|---|
| 1 | Implement clarification modal + API endpoint | ~2h | Unblocks the entire "ask questions" flow |
| 2 | Pipeline stepper on hero card using existing `stage`/`progress` | ~2h | Instant "real company" feel |
| 3 | Toast system replacing `alert()` | ~1h | Professional feel |
| 4 | Real `git rev-parse` SHA + honest "Simulated report" labels | ~1h | Restores trust in reports |
| 5 | Task list with status filters | ~3h | From "one cabin" to a real dashboard |

---

## 7. Architecture Diagram (Current Flow)

```
Founder (cctv.html)
   │  POST /api/studio/delegate {prompt}
   ▼
CctvServer ──► TeamLead.enqueueTask() ──► taskQueue (in-memory ⚠)
   │                                            │
   │                                    processQueue()
   │                                    ├─ analyzeAndRefineTask()  (regex ambiguity check)
   │                                    ├─ needsClarification? ──► AWAITING_CLARIFICATION
   │                                    │        └── ❌ no API/UI to resolve → stuck
   │                                    └─ _inferRoleFromGoal() ──► EmployeePool.assignTask()
   ▼
dispatchAutonomousExecution()  (12s timer stages)
   ├─ Step1 RUNNING        → DB update + SSE
   ├─ Step2 "Synthesize"   → Gemini if key, else canned template ⚠
   ├─ Step3 "QA"           → timer only, no tests ❌
   ├─ Step4 READY_FOR_PR   → timer only
   └─ Step5 COMPLETED      → DB deliverable + history + SSE
   ▼
UI: hero cabin card, activity feed, report modal (markdown)
```

---

*End of report — generated after full read-through of the CCTV dashboard, HTTP server,
team-lead coordination layer, employee pool, and SQLite schema.*
