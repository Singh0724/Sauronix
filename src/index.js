/**
 * Autonomous AI Enterprise Studio v5.0 Control Plane
 * Public Architecture & Component Exports
 */

// Phase 0 & 1: Foundation & State Engine
export { StudioDatabase, getStudioDb } from './storage/db.js';
export { TaskStateMachine, TASK_STATUS, VALID_TRANSITIONS } from './state/task-state-machine.js';
export { ToolGateway, CAPABILITY_MATRIX, matchesGlobPattern } from './security/tool-gateway.js';
export { WorktreeManager } from './git/worktree-manager.js';
export { EmergencyStopController } from './control/emergency-stop.js';
export { BackupManager } from './storage/backup-manager.js';
export { SpecValidator } from './contracts/validator.js';
export { FlightRecorder } from './flight/flight-recorder.js';

// Phase 2: Single-Agent Constrained Loop & Verification
export { DiffEngine } from './coder/diff-engine.js';
export { SurgicalCoder } from './coder/surgical-coder.js';
export { DiffRiskScorer } from './qa/diff-risk-scorer.js';
export { MutationTester } from './qa/mutation-tester.js';
export { LayeredQARunner } from './qa/qa-runner.js';
export { SingleAgentPipeline } from './orchestrator/single-agent-loop.js';

// Phase 3: Mission Control & CCTV Telemetry
export { EventBroadcaster } from './server/event-broadcaster.js';
export { CctvServer, DEFAULT_AUTH_TOKEN, DEFAULT_CSRF_TOKEN } from './server/cctv-server.js';

// Phase 4: Failure-Class Remediation & Knowledge Promotion
export { FailureRouter, FAILURE_CLASSES, FAILURE_STRATEGIES } from './remediation/failure-router.js';
export { KnowledgePromoter, VALID_CATEGORIES, KNOWLEDGE_STATUS } from './knowledge/knowledge-promoter.js';

// Phase 5: Controlled Parallelism & Dynamic Risk Engine
export { DynamicRiskEngine, RISK_TIERS, GOVERNANCE_POLICIES } from './risk/risk-engine.js';
export { ParallelScheduler } from './scheduler/parallel-scheduler.js';
export { PrGenerator } from './git/pr-generator.js';

// Phase 6: Resilient Hybrid Overnight Execution & Central Policy
export { AdaptiveQuotaManager, DEFAULT_PROVIDER_QUOTAS } from './quota/quota-manager.js';
export { HybridExecutionRouter, ENVIRONMENTS, PROVIDER_ROTATIONS } from './execution/hybrid-router.js';
export { CentralPolicyEngine, WHITELISTED_COMMAND_BINARIES, DEFAULT_BUDGET_POLICY } from './policy/policy-engine.js';
