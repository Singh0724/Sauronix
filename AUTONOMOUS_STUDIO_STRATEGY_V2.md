# Autonomous AI Team & Business Architecture: Master Strategy (v2.0)
*Hardened Autonomous Multi-Agent Development Studio & Productized AI Agency*

> **Author:** Saurabh Singh & Antigravity AI  
> **Date:** September 13, 2026 (v2.0 Hardened Release)  
> **System Architecture Board:** Git-Backed Blackboard (`.agents/TASKS.json`)  
> **Reference Architecture:** Privacy-First, Zero-Telemetry Principles ([NoTrack AI](https://notrack.ai/))  
> **Core Objective:** Build a 100% free, project-agnostic autonomous multi-agent development studio capable of deterministic overnight unattended execution, reinforced by strict schema validation, closed-loop QA retries, parallelized growth drafting, and packaged into a high-margin productized automation agency for SMBs.

---

## 1. Architectural Audit & v2.0 Upgrades

Following rigorous architectural critique, v2.0 resolves the 5 foundational points of failure in multi-agent systems:

| Vulnerability in v1.0 | Root Cause | v2.0 Hardened Architecture Solution |
| :--- | :--- | :--- |
| **1. "Researcher $\to$ Coder" Ambiguity** | Context drift between informal research notes and implementation. | **Technical Spec Contract & Spec Validator:** Researcher outputs a formal RFC/Spec. A validation gate ensures zero ambiguities before a single line of code is written. |
| **2. Non-Deterministic Drift** | LLMs interpret natural language prompts inconsistently. | **Strict Structured JSON I/O Schemas:** Enforced structured output (JSON Schema / JSON Mode) for all agent-to-agent data exchanges. No loose prose in handoffs. |
| **3. Vague QA Strategy** | Unclear testing scope with no feedback mechanism. | **Deterministic QA Execution Engine & Closed-Loop Rework:** QA agent runs real test suites (`npm test`, Playwright), outputs structured test assertions, and auto-reroutes failures back to Coder with logs (circuit breaker capped at 2 retries). |
| **4. Growth Writer Bottleneck** | Linear serial pipeline delayed docs and SEO. | **Parallel Growth & Documentation Pipeline:** Growth Writer triggers immediately upon Spec validation, drafting docs and SEO in parallel with code authoring. |
| **5. Human Late-Stage Fatigue** | Reviewing unlinted, hallucinated, or broken PRs burns founder time. | **Automated Pre-PR Code Review Gate (Role 6):** Independent AST linter, security checker, and spec-conformance verifier filters garbage *before* alerting human supervisor. |
| **6. Broken Project Board Link** | 404 GitHub Projects URL breaks operational continuity. | **Repository-Hosted Git Blackboard:** Shifted to git-tracked `.agents/TASKS.json` and a auto-syncing `TASKS.md` dashboard. |

---

## 2. Hardened Multi-Agent Team Pipeline (6 Roles + Supervisor)

The autonomous studio replaces free-form conversational swarms with a **Deterministic Staged Pipeline with Parallel Branching and Closed-Loop Rework**:

```mermaid
flowchart TD
    subgraph Human["Supervision Layer"]
        H[Human Founder / Supervisor]
    end

    subgraph Planning["Phase 1: Planning & Contract Definition"]
        R1[Role 1: Sprint Manager<br/><i>Gemini Flash</i>]
        R2[Role 2: System Researcher<br/><i>Gemini Flash + Context7 / Web</i>]
        SV[Gate: Spec Validator<br/><i>Schema & Ambiguity Check</i>]
    end

    subgraph Execution["Phase 2: Parallel Authoring (Fork)"]
        R3[Role 3: Senior Coder<br/><i>Claude 3.5 Sonnet / Groq DeepSeek</i>]
        R5[Role 5: Growth & Docs Writer<br/><i>Gemini Flash / Groq Llama 3.3</i>]
    end

    subgraph Verification["Phase 3: Automated Verification & Review"]
        R4[Role 4: QA & Test Runner<br/><i>Node Test Runner / Playwright</i>]
        CR[Role 6: Pre-PR Code Reviewer<br/><i>AST Lint, Spec Conformance, Security</i>]
    end

    subgraph Delivery["Phase 4: Release"]
        PR[Isolated Git Branch PR<br/><i>agent/task-XXX</i>]
    end

    %% Flow connections
    H -->|Defines High-Level Goals| R1
    R1 -->|Generates Structured Task| R2
    R2 -->|Drafts Technical Spec| SV
    
    SV -->|Fails Validation: Ambiguous| R2
    SV -->|Approved Spec Contract| R3
    SV -->|Approved Spec Contract (Parallel)| R5

    R3 -->|Commits to branch & yields diff| R4
    R4 -->|Test Suite Fails (Max 2 Retries)| R3
    R4 -->|All Tests Green: Generates Test Report| CR

    R5 -->|Drafts Release Notes & API Docs| CR
    CR -->|Fails Code/Security Standard| R3
    CR -->|Passed: Bundles Code + Docs + QA Report| PR
    PR -->|Final 1-Click Human Approval| H
```

---

## 3. Team Roles & Structured Inter-Agent Contracts

To eliminate hallucination and context degradation, **every role operates on strict input/output JSON schemas**.

### Role 1: Sprint Manager
- **Engine:** Gemini 2.5 Flash / Fast Model
- **Input:** High-level project goal or backlog item.
- **Output Contract:**
```json
{
  "task_id": "TASK-104",
  "title": "Enforce Google OAuth State Nonce to Mitigate CSRF",
  "priority": "P0_CRITICAL",
  "affected_services": ["auth/google.js", "middleware/session.js"],
  "target_branch": "agent/task-104-oauth-nonce",
  "definition_of_done": [
    "Generate cryptographic nonce in session pre-redirect",
    "Validate callback state parameter against session nonce",
    "Reject mismatch with 403 Forbidden"
  ]
}
```

---

### Role 2: System Researcher & Spec Author
- **Engine:** Gemini 2.5 Flash + Web Search / `context7` MCP
- **Responsibility:** Deep-dive into technical documentation, evaluate edge cases, and author a zero-ambiguity **Technical Spec**.
- **Output:** Saves specification file to `.agents/specs/TASK-104.json`.

---

### Gate: Spec Validator (The Circuit Breaker)
- **Engine:** Deterministic JSON Schema validator + LLM sanity check.
- **Responsibility:** Verifies that the spec includes exact file paths, function signatures, error code definitions, and explicit negative test cases. If any ambiguity is detected, rejects back to Researcher before Coder is spawned.

---

### Role 3: Senior Coder
- **Engine:** Claude 3.5 Sonnet / Groq DeepSeek-R1 / Gemini Pro
- **Input:** **ONLY** the validated `.agents/specs/TASK-XXX.json` and existing target source files. No conversational chat clutter.
- **Rules:**
  - Minimal surgical diffs only.
  - Zero deletion of untargeted CSS or business logic.
  - Generates isolated branch commits (`agent/task-XXX`).
- **Output Contract:**
```json
{
  "task_id": "TASK-104",
  "status": "ready_for_qa",
  "branch": "agent/task-104-oauth-nonce",
  "modified_files": [
    {
      "path": "auth/google.js",
      "diff_summary": "Added crypto.randomBytes(16) state generation and session storage"
    }
  ],
  "local_verification_command": "npm test tests/auth.test.js"
}
```

---

### Role 4: QA & Automated Test Runner
- **Engine:** Local Node.js Test Harness / Playwright Headless + Gemini Flash Judge
- **Execution Protocol:**
  1. Checks out `agent/task-XXX`.
  2. Runs targeted unit tests and end-to-end Playwright tests.
  3. Validates boundary cases outlined in the Technical Spec.
- **Output Contract (`.agents/reports/QA-TASK-XXX.json`):**
```json
{
  "task_id": "TASK-104",
  "test_suite_status": "FAILED",
  "total_assertions": 14,
  "passed": 13,
  "failed": 1,
  "failure_details": {
    "test_file": "tests/auth.test.js",
    "assertion": "should reject callback if session nonce is missing",
    "error_message": "Expected 403 Forbidden, received 500 Internal Server Error",
    "stack_trace": "TypeError: Cannot read properties of undefined (reading 'oauth_state') at auth/google.js:42:18"
  },
  "retry_count": 1,
  "action": "ROUTE_BACK_TO_CODER"
}
```
> **Self-Correction Circuit Breaker:** If `retry_count >= 2`, QA immediately flips task state to `BLOCKED_ESCALATE_HUMAN` and posts an alert to `TASKS.json` to prevent infinite looping and token exhaustion.

---

### Role 5: Growth & Documentation Specialist (Parallel Track)
- **Engine:** Gemini 2.5 Flash / Groq Llama 3.3 70B
- **Trigger:** Runs in **parallel** with Role 3 as soon as Spec Validator passes.
- **Input:** Reads `.agents/specs/TASK-XXX.json` and `.agents/LEARNINGS.md`.
- **Output:**
  - Updates user-facing documentation (`docs/api.md` or customer guides).
  - Drafts GitHub release notes and changelog entries in `CHANGELOG.md`.
  - Generates SEO-optimized technical blog drafts or social release announcements.

---

### Role 6: Automated Pre-PR Code Reviewer
- **Engine:** ESLint + AST Parser + Gemini Flash Security Reviewer
- **Checklist:**
  - [x] Syntax & static analysis clean (zero lint warnings).
  - [x] Conformance check: Did code fulfill all Acceptance Criteria in `spec`?
  - [x] Security scan: No leaked keys, no raw SQL/NoSQL injection, no unescaped outputs.
  - [x] Diff hygiene: No accidental line deletion or whitespace noise.
- **Action:** If passed, packages the Pull Request against `main` for 1-click human merge.

---

## 4. Git-Backed Persistent Blackboard Architecture

The `.agents/` repository directory acts as the immutable shared state machine, completely replacing ephemeral chat histories and external 3rd-party project trackers:

```
<project-root>/
├── .agents/
│   ├── AGENTS.md             <-- Team Constitution, coding standards, framework rules
│   ├── TASKS.json            <-- Master JSON state machine of all tasks & sprint backlogs
│   ├── TASKS.md              <-- Human-readable dashboard generated from TASKS.json
│   ├── DECISIONS.md          <-- Immutable Architectural Decision Records (ADRs)
│   ├── LEARNINGS.md          <-- Cumulative knowledge base of past bugs & fixes
│   ├── CHANGELOG.md          <-- Running record of all automated deployments
│   ├── specs/                <-- RFC-style machine-readable technical specs
│   │   └── TASK-104.json
│   └── reports/              <-- Machine-readable QA & Code Review test receipts
│       └── QA-TASK-104.json
```

### Schema: `TASKS.json` (The Core Blackboard Engine)

```json
{
  "schema_version": "2.0",
  "project": "CareerOS",
  "active_sprint": "Hardening & Security v2",
  "circuit_breaker": {
    "max_retries_per_task": 2,
    "max_tasks_per_night": 5
  },
  "tasks": [
    {
      "id": "TASK-104",
      "title": "Enforce Google OAuth State Nonce to Mitigate CSRF",
      "priority": "P0_CRITICAL",
      "status": "ready_for_review",
      "assigned_to": "human_supervisor",
      "branch": "agent/task-104-oauth-nonce",
      "spec_file": ".agents/specs/TASK-104.json",
      "qa_report_file": ".agents/reports/QA-TASK-104.json",
      "retry_count": 0,
      "pr_url": "https://github.com/Singh0724/job-alert-automation/pull/12"
    }
  ]
}
```

---

## 5. The "Close Laptop & Sleep" Execution Engine

Executing overnight unattended sprints without burning tokens or breaking production requires complete sandboxing.

### Execution Workflow

```
[2:00 AM IST Schedule Trigger]
             │
             ▼
   GitHub Actions Runner
             │
   ┌─────────┴──────────────────────────────────────────┐
   │ 1. Read `.agents/TASKS.json`                        │
   │ 2. Filter tasks: status == "backlog", order by P0  │
   │ 3. Pick top Task (Sequential processing: 1 by 1)    │
   └─────────┬──────────────────────────────────────────┘
             │
             ▼
   Run Spec Validator
             │
     Passed? ├─ No ──▶ Mark BLOCKED & record log in TASKS.json
             │
            Yes
             ▼
   Execute Coder & Growth Agents in Parallel
             │
             ▼
   Execute QA Runner (`npm test` + Playwright)
             │
     Passed? ├─ No (retry < 2) ──▶ Re-feed failure log to Coder
             │  No (retry == 2) ─▶ Mark BLOCKED_ESCALATE & abort task
            Yes
             ▼
   Run Pre-PR Code Reviewer
             │
             ▼
   Auto-create PR with QA Receipt + Docs attached
             │
             ▼
   Update TASKS.json (status: `ready_for_human_review`)
             │
             ▼
   [Repeat for Next Task, Max 5 Tasks or 50 Mins]
             │
             ▼
   [Send Telegram / Discord Summary to Founder Phone]
```

### GitHub Actions Workflow Specification (`.github/workflows/agent-nightly.yml`)

```yaml
name: Overnight Autonomous Multi-Agent Runner

on:
  schedule:
    - cron: '30 20 * * *' # 2:00 AM IST daily (20:30 UTC)
  workflow_dispatch:        # Manual trigger

permissions:
  contents: write
  pull-requests: write

jobs:
  run-autonomous-sprint:
    runs-on: ubuntu-latest
    timeout-minutes: 50 # Strict ceiling to protect 2,000 free mins/month

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js Runtime
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Project Dependencies
        run: npm ci

      - name: Run Overnight Autonomous Orchestrator
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: |
          node .agents/orchestrator.js --mode=unattended --max-tasks=5
```

---

## 6. The Productized Agency Architecture (₹35K–₹1L/Month)

The exact same orchestration infrastructure is packaged and sold to small and medium businesses (SMBs) in India (coaching institutes, dental/medical clinics, retail wholesalers, direct-to-consumer brands).

### Philosophy: NoTrack AI Privacy-First Baseline
In alignment with privacy-first standards ([NoTrack AI](https://notrack.ai/)), small business automations must adhere to:
1. **Zero Unnecessary Cloud Data Leaks:** Sensitive customer leads and medical/educational inquiries are never used for LLM training.
2. **Local / Tenant Isolation:** Each client’s data remains strictly in their own Google Workspace / Google Sheet or private database.
3. **Deterministic Workflows First, LLM Reasoning Second:** Use rule-based webhooks for transactional operations (payments, lead routing) and LLM reasoning solely for conversational understanding and message drafting.

### Packaged Service Offerings

```
┌───────────────────────────────────────────────────────────────────────────┐
│                           SMB PRODUCTIZED TIERS                           │
├───────────────────────────────┬───────────────────────────┬───────────────┤
│ Tier 1: WhatsApp Inbound Concierge│ Tier 2: Revenue Operations│ Tier 3: Studio│
│ ₹5,000 / month                │ ₹12,000 / month           │ ₹30,000 / mo  │
├───────────────────────────────┼───────────────────────────┼───────────────┤
│ • 24/7 WhatsApp response bot  │ • Tier 1 features included│ • Tier 1 & 2  │
│ • Intent parsing (Gemini Flash)│ • Razorpay payment pings │ • Automated   │
│ • Real-time Google Sheet sync │ • Overdue invoice reminders│  social copy │
│ • Instant owner mobile alerts │ • Daily 8 PM sales digest │ • Custom CRM  │
│ • 99.9% uptime on ₹400/mo VPS │ • Automated refund routing│  workflows    │
└───────────────────────────────┴───────────────────────────┴───────────────┘
```

---

## 7. Hardened Implementation Roadmap

```
PHASE 0: Security Hardening & Secret Sanitation (CareerOS & Repos)
├── Purge any tracked secrets from git history
├── Ensure .env is untracked across all repositories
└── Implement Google OAuth callback nonce & state verification

PHASE 1: Hardened Blackboard & Persistent State Engine
├── Initialize `.agents/` structure (TASKS.json, AGENTS.md, DECISIONS.md)
├── Write JSON schema definitions for Spec, Coder Output, and QA Reports
├── Populate active sprint tasks into `.agents/TASKS.json`
└── Add auto-generating Markdown renderer for human-readable `TASKS.md`

PHASE 2: Spec Validator & Deterministic Prompts
├── Author strict system prompt templates with JSON-mode enforcement
├── Build `.agents/validator.js` to ensure zero-ambiguity specs
└── Wire parallel handoff trigger for Role 5 (Growth Writer)

PHASE 3: Closed-Loop QA & Code Review Gate
├── Configure Playwright & Node test runner reporting adapter
├── Implement closed-loop error feedback mechanism (Max 2 retries)
└── Build automated Role 6 Pre-PR lint & security gate

PHASE 4: Overnight Runner & Alerting
├── Finalize `.agents/orchestrator.js` unattended batch runner
├── Deploy `.github/workflows/agent-nightly.yml` with secrets
└── Connect Telegram notification webhook for morning executive summary

PHASE 5: SMB Agency Delivery Engine
├── Package reusable n8n + WhatsApp Cloud API + Sheets workflow template
├── Publish 1-page agency service prospectus for Indian SMBs
└── Onboard first 2 paid beta clients to cover all operating overhead
```
