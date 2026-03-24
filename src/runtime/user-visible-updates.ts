import type { YagrPhaseEvent, YagrRunPhase, YagrStateEvent, YagrToolEvent } from '../types.js';
import { getUserFacingToolStatus } from '../tools/observer.js';

export interface YagrUserVisibleUpdate {
  tone: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
  phase?: YagrRunPhase;
  dedupeKey: string;
}

function phaseTitle(phase: YagrRunPhase): string {
  switch (phase) {
    case 'inspect':
      return 'Inspect';
    case 'plan':
      return 'Plan';
    case 'edit':
      return 'Edit';
    case 'validate':
      return 'Validate';
    case 'sync':
      return 'Sync';
    case 'verify':
      return 'Verify';
    case 'summarize':
      return 'Summarize';
    default:
      return 'Progress';
  }
}

export function mapPhaseEventToUserVisibleUpdate(event: YagrPhaseEvent): YagrUserVisibleUpdate | undefined {
  if (event.status !== 'started') {
    return undefined;
  }

  return {
    tone: 'info',
    title: phaseTitle(event.phase),
    detail: event.message,
    phase: event.phase,
    dedupeKey: `phase:${event.phase}:${event.status}:${event.message}`,
  };
}

export function mapStateEventToUserVisibleUpdate(event: YagrStateEvent): YagrUserVisibleUpdate | undefined {
  switch (event.state) {
    case 'waiting_for_permission':
      return {
        tone: 'info',
        title: 'Needs permission',
        detail: event.message,
        phase: event.phase,
        dedupeKey: `state:${event.state}:${event.message}`,
      };
    case 'waiting_for_input':
      return {
        tone: 'info',
        title: 'Needs input',
        detail: event.message,
        phase: event.phase,
        dedupeKey: `state:${event.state}:${event.message}`,
      };
    case 'resumable':
      return {
        tone: 'info',
        title: 'Ready to resume',
        detail: event.message,
        phase: event.phase,
        dedupeKey: `state:${event.state}:${event.message}`,
      };
    case 'failed_terminal':
      return {
        tone: 'error',
        title: 'Run failed',
        detail: event.message,
        phase: event.phase,
        dedupeKey: `state:${event.state}:${event.message}`,
      };
    default:
      return undefined;
  }
}

export function mapToolEventToUserVisibleUpdate(event: YagrToolEvent): YagrUserVisibleUpdate | undefined {
  const userFacingStatus = getUserFacingToolStatus(event);
  if (userFacingStatus) {
    const message = event.type === 'status' ? event.message : userFacingStatus.detail;
    return {
      tone: 'info',
      title: userFacingStatus.title,
      detail: userFacingStatus.detail,
      dedupeKey: `tool:${event.toolName}:${message}`,
    };
  }

  if (event.type === 'command-end' && event.exitCode !== 0) {
    return {
      tone: 'info',
      title: 'Correcting commands',
      detail: event.message,
      dedupeKey: `tool:${event.toolName}:command-end:${event.exitCode}:${event.message ?? ''}`,
    };
  }

  return undefined;
}
