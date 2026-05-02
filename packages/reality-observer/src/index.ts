import type { ImpactEvent, ImpactEventInput, ImpactLedger } from '@yagr/impact-ledger';
import type { RuntimeOperationEvent } from '@yagr/runtime-events';

export interface RuntimeImpactContext {
  sessionId: string;
  turnId?: string;
  taskId?: string;
}

export function impactFromRuntimeOperation(
  context: RuntimeImpactContext,
  event: RuntimeOperationEvent,
): ImpactEventInput | null {
  if (event.status === 'running') {
    return null;
  }

  switch (event.category) {
    case 'file-write': {
      const files = extractPathCandidates(event);
      return {
        ...baseImpact(context, event),
        actor: 'tool',
        category: classifyFileChange(event),
        impact: classifyFileImpact(event),
        persistence: 'durable',
        reversible: 'unknown',
        summary: files?.length ? `File change: ${files.join(', ')}` : event.label,
        relatedFiles: files,
      };
    }
    case 'shell': {
      const command = commandText(event);
      return {
        ...baseImpact(context, event),
        actor: 'tool',
        category: classifyShellCategory(event),
        impact: classifyShellImpact(event),
        persistence: classifyShellPersistence(event),
        reversible: 'unknown',
        summary: command ? `Shell command: ${command}` : event.label,
        relatedCommands: command ? [command] : undefined,
      };
    }
    case 'web':
      return {
        ...baseImpact(context, event),
        actor: 'tool',
        category: 'external_call',
        impact: 'medium',
        persistence: 'unknown',
        reversible: 'unknown',
        summary: event.summary ? `External call: ${event.summary}` : event.label,
      };
    default:
      return null;
  }
}

export function recordRuntimeOperationImpact(
  ledger: ImpactLedger,
  context: RuntimeImpactContext,
  event: RuntimeOperationEvent,
): ImpactEvent | null {
  const impact = impactFromRuntimeOperation(context, event);
  return impact ? ledger.append(impact) : null;
}

function baseImpact(context: RuntimeImpactContext, event: RuntimeOperationEvent): Pick<ImpactEventInput, 'sessionId' | 'turnId' | 'taskId' | 'operationId' | 'timestamp' | 'evidence'> {
  return {
    ...context,
    operationId: event.operationId,
    timestamp: new Date(event.endedAt ?? event.startedAt).toISOString(),
    evidence: event,
  };
}

function classifyFileChange(event: RuntimeOperationEvent): ImpactEventInput['category'] {
  const files = extractPathCandidates(event) ?? [];
  return files.some(isAutomationPath) ? 'automation_updated' : 'file_change';
}

function classifyFileImpact(event: RuntimeOperationEvent): ImpactEventInput['impact'] {
  const files = extractPathCandidates(event) ?? [];
  if (files.some(isCredentialPath)) {
    return 'high';
  }
  if (files.some(isAutomationPath) || files.some(isDependencyManifest)) {
    return 'medium';
  }
  return 'low';
}

function classifyShellCategory(event: RuntimeOperationEvent): ImpactEventInput['category'] {
  const command = commandText(event);
  if (/\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade)\b/.test(command)) {
    return 'dependency_change';
  }
  if (/\b(docker|pm2|systemctl|service)\s+.*\b(start|run|up)\b|\bnohup\b|&\s*$/.test(command)) {
    return 'process_started';
  }
  if (/\b(docker|pm2|systemctl|service)\s+.*\b(stop|down|kill)\b|\bkill\b/.test(command)) {
    return 'process_stopped';
  }
  return 'shell_command';
}

function classifyShellImpact(event: RuntimeOperationEvent): ImpactEventInput['impact'] {
  const category = classifyShellCategory(event);
  if (category === 'dependency_change' || category === 'process_started' || category === 'process_stopped') {
    return 'high';
  }
  return event.status === 'error' ? 'medium' : 'low';
}

function classifyShellPersistence(event: RuntimeOperationEvent): ImpactEventInput['persistence'] {
  const category = classifyShellCategory(event);
  return category === 'dependency_change' || category === 'process_started' ? 'durable' : 'ephemeral';
}

function commandText(event: RuntimeOperationEvent): string {
  const outputText = `${event.summary ?? ''} ${event.body ?? ''}`.trim();
  return (event.inputSummary ?? (outputText || event.label)).trim();
}

function extractPathCandidates(event: RuntimeOperationEvent): string[] | undefined {
  const outputText = `${event.summary ?? ''} ${event.body ?? ''}`.trim();
  const text = `${event.inputSummary ?? ''} ${outputText || event.label}`;
  const matches = text.match(/(?:^|\s)([./~]?[\w@.-][\w@./-]*\.[\w.-]+)(?=\s|$|[,;:])/g) ?? [];
  const paths = [...new Set(matches.map((match) => match.trim()))];
  return paths.length > 0 ? paths : undefined;
}

function isAutomationPath(filePath: string): boolean {
  return /(^|\/)\.github\/workflows\/|(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|crontab|pm2\..*|.*\.service)$/.test(filePath);
}

function isCredentialPath(filePath: string): boolean {
  return /(^|\/)(\.env|\.env\..*|credentials\.json|secrets?\.|.*\.pem|.*\.key)$/.test(filePath);
}

function isDependencyManifest(filePath: string): boolean {
  return /(^|\/)(package-lock\.json|package\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|requirements\.txt|pyproject\.toml|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum)$/.test(filePath);
}
