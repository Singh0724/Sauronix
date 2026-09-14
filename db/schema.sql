-- Autonomous AI Enterprise Studio v5.0 Master SQLite Schema
-- Operational Source of Truth (ACID + WAL Mode)

PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

-- Durability Policy:
-- PRAGMA synchronous = NORMAL during bulk step streaming.
-- PRAGMA synchronous = FULL immediately enforced on critical task state transitions.
PRAGMA synchronous = NORMAL;

-- Master Task Registry
CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    risk_level TEXT CHECK(risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')) NOT NULL DEFAULT 'MEDIUM',
    status TEXT CHECK(status IN (
        'PENDING',
        'RUNNING',
        'PAUSING',
        'PAUSED',
        'CANCELLING',
        'CANCELLED',
        'INTERRUPTED',
        'QUARANTINED',
        'FAILED',
        'READY_FOR_PR',
        'COMPLETED'
    )) NOT NULL DEFAULT 'PENDING',
    active_agent TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 2,
    allowed_files TEXT NOT NULL,      -- JSON Array of glob patterns
    forbidden_files TEXT NOT NULL,    -- JSON Array of glob patterns
    branch_name TEXT,
    worktree_path TEXT,
    spec_sha TEXT,
    deliverable_title TEXT,
    deliverable_report TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- State Transitions (Full Audit Log with Actor Attribution)
CREATE TABLE IF NOT EXISTS task_transitions (
    transition_id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    trigger_reason TEXT NOT NULL,
    actor TEXT NOT NULL,              -- 'SCHEDULER', 'CODER', 'QA', 'CIRCUIT_BREAKER', 'FOUNDER'
    auth_signature TEXT,              -- Cryptographic HMAC/JWT signature for privileged Founder actions
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

-- Lean Flight Recorder: Metadata, Hashes & Artifact URIs (No Bloat)
CREATE TABLE IF NOT EXISTS flight_recorder_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    agent_role TEXT NOT NULL,
    model_provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    temperature REAL NOT NULL,
    seed INTEGER,
    prompt_sha256 TEXT NOT NULL,
    tool_name TEXT,
    tool_input_sha256 TEXT,
    tool_output_sha256 TEXT,
    diff_sha256 TEXT,
    artifact_uri TEXT NOT NULL,       -- Path: .agents/artifacts/{task_id}/{event_id}.json
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(task_id) REFERENCES tasks(task_id) ON DELETE CASCADE
);

-- Resource & Rate-Limit Tracking
CREATE TABLE IF NOT EXISTS quota_metrics (
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    window_start TIMESTAMP NOT NULL,
    request_count INTEGER DEFAULT 0,
    token_count INTEGER DEFAULT 0,
    rate_limited_count INTEGER DEFAULT 0,
    PRIMARY KEY(provider, model, window_start)
);

-- Knowledge Base Promotion Pipeline Table
CREATE TABLE IF NOT EXISTS knowledge_base (
    learning_id TEXT PRIMARY KEY,
    category TEXT CHECK(category IN ('ASYNC_ERROR', 'SCHEMA_MISMATCH', 'STATE_CORRUPTION', 'RATE_LIMIT', 'AUTH_BOUNDARY')) NOT NULL,
    symptom TEXT NOT NULL,
    root_cause TEXT NOT NULL,
    permanent_pattern TEXT NOT NULL,
    anti_pattern TEXT NOT NULL,
    evidence_task_id TEXT NOT NULL,
    occurrence_count INTEGER DEFAULT 1,
    confidence_score REAL DEFAULT 0.70,
    status TEXT CHECK(status IN ('CANDIDATE', 'PROMOTED', 'DEPRECATED')) DEFAULT 'CANDIDATE',
    promoted_by TEXT,
    promoted_at TIMESTAMP,
    FOREIGN KEY(evidence_task_id) REFERENCES tasks(task_id)
);
