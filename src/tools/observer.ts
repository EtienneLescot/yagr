import type { YagrToolEvent } from '../types.js';

export interface UserFacingToolStatus {
  title: string;
  detail: string;
}

export interface ToolExecutionObserver {
  onToolEvent?: (event: YagrToolEvent) => void | Promise<void>;
}

export function getUserFacingToolStatus(event: YagrToolEvent): UserFacingToolStatus | undefined {
  if (event.type !== 'status') {
    return undefined;
  }

  if (event.toolName === 'reportProgress') {
    return {
      title: 'Progress',
      detail: event.message,
    };
  }

  if (event.toolName === 'requestRequiredAction') {
    return {
      title: 'Needs attention',
      detail: event.message,
    };
  }

  return undefined;
}

export function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function emitToolEvent(
  observer: ToolExecutionObserver | undefined,
  event: YagrToolEvent,
): Promise<void> {
  await observer?.onToolEvent?.(event);
}
