# Enterprise Knowledge Base & Anti-Pattern Store (LEARNINGS.md)
*Promoted, High-Confidence Architectural Patterns & Post-Mortem Learnings*

> **Governance:** Entries here are strictly promoted via the 6-stage validation pipeline:
> `Incident -> Hypothesis -> Evidence -> Validated Pattern -> Candidate Learning -> Human Promotion`

---

## Promoted Senior Engineering Invariants

### [LRN-001] Native SQLite WAL Concurrency & Durability Policy
- **Incident Category:** `STATE_CORRUPTION`
- **Context:** Node.js native `DatabaseSync` in concurrent environment.
- **Symptom:** Database locks or dirty uncommitted transitions on unexpected process aborts.
- **Permanent Senior Pattern:**
  - Enforce `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;` on startup.
  - Critical state transitions (`RUNNING`, `QUARANTINED`, `COMPLETED`) must enforce `PRAGMA synchronous = FULL;` before releasing the transaction lock.
  - Telemetry and bulk event streams use `PRAGMA synchronous = NORMAL;`.
- **Anti-Pattern:** Never run concurrent write connections without a mutual exclusion lease, and never use detached writes outside explicit transactions.

### [LRN-002] Non-Destructive Forensic Freeze Emergency Stops
- **Incident Category:** `AUTH_BOUNDARY`
- **Context:** Manual intervention during active task debugging.
- **Symptom:** Running `git reset --hard` or deleting branches destroys vital forensic evidence and diagnostic code discovered by the agent.
- **Permanent Senior Pattern:**
  - Emergency stop must capture uncommitted diffs to `.agents/artifacts/{taskId}/frozen.patch`.
  - Store incident metadata with reason, actor, and captured buffers to `incident.json`.
  - Transition state machine to `INTERRUPTED` and preserve the Git branch for forensic analysis.
- **Anti-Pattern:** Never execute `git reset --hard` or discard unstaged changes during an incident.

### [LRN-003] Untrusted Content Structural Envelope Framing
- **Incident Category:** `AUTH_BOUNDARY`
- **Context:** Ingesting external documentation, pull request comments, or web scrapes.
- **Symptom:** Prompt injection attempting to divert agent instructions or exfiltrate credentials.
- **Permanent Senior Pattern:**
  - Untrusted data is never granted authority regardless of its textual content.
  - Wrap all external inputs in `<untrusted_external_content>` envelopes.
  - Models never possess direct shell or raw OS access; all actions pass through the Policy-Controlled Tool Gateway.
- **Anti-Pattern:** Never rely on regex or phrase matching (e.g. searching for "ignore previous instructions") as a security boundary.
