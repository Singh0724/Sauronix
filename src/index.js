/**
 * Autonomous AI Enterprise Studio v5.0 Control Plane
 * Public Architecture & Component Exports
 */

export { StudioDatabase, getStudioDb } from './storage/db.js';
export { TaskStateMachine, TASK_STATUS, VALID_TRANSITIONS } from './state/task-state-machine.js';
export { ToolGateway, CAPABILITY_MATRIX, matchesGlobPattern } from './security/tool-gateway.js';
export { WorktreeManager } from './git/worktree-manager.js';
export { EmergencyStopController } from './control/emergency-stop.js';
export { BackupManager } from './storage/backup-manager.js';
export { SpecValidator } from './contracts/validator.js';
export { FlightRecorder } from './flight/flight-recorder.js';
