export type HolonToolEvent =
  | {
      type: 'status';
      toolName: string;
      message: string;
    }
  | {
      type: 'command-start';
      toolName: string;
      command: string;
      cwd?: string;
      message?: string;
    }
  | {
      type: 'command-output';
      toolName: string;
      stream: 'stdout' | 'stderr';
      chunk: string;
    }
  | {
      type: 'command-end';
      toolName: string;
      exitCode: number;
      timedOut?: boolean;
      message?: string;
    }
  | {
      type: 'result';
      toolName: string;
      message: string;
    };

export interface ToolExecutionObserver {
  onToolEvent?: (event: HolonToolEvent) => void | Promise<void>;
}

export function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function emitToolEvent(
  observer: ToolExecutionObserver | undefined,
  event: HolonToolEvent,
): Promise<void> {
  await observer?.onToolEvent?.(event);
}