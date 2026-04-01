function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function splitN8nacArgv(input: string): string[] | null {
  const args: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaping = false;

  for (const character of input) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === '\\' && quote !== '\'') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '"' || character === '\'') {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (escaping) {
    current += '\\';
  }

  if (quote) {
    return null;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function legacyActionToArgv(args: Record<string, unknown>): string[] | null {
  const action = asString(args.action);
  if (!action || action === 'command') {
    return null;
  }

  switch (action) {
    case 'setup_check':
      return ['setup-check'];
    case 'init_auth': {
      const host = asString(args.n8nHost);
      const apiKey = asString(args.n8nApiKey);
      return host && apiKey ? ['init-auth', '--host', host, '--api-key', apiKey] : ['init-auth'];
    }
    case 'init_project': {
      const argv = ['init-project'];
      const syncFolder = asString(args.syncFolder);
      const projectId = asString(args.projectId);
      const projectName = asString(args.projectName);
      const projectIndex = typeof args.projectIndex === 'number' ? String(args.projectIndex) : undefined;
      if (syncFolder) argv.push('--sync-folder', syncFolder);
      if (projectId) argv.push('--project-id', projectId);
      else if (projectName) argv.push('--project-name', projectName);
      else if (projectIndex) argv.push('--project-index', projectIndex);
      return argv;
    }
    case 'list': {
      const scope = asString(args.listScope);
      return scope ? ['list', `--${scope}`] : ['list'];
    }
    case 'pull': {
      const workflowId = asString(args.workflowId);
      return workflowId ? ['pull', workflowId] : ['pull'];
    }
    case 'push': {
      const filename = asString(args.filename);
      return filename ? ['push', filename, '--verify'] : ['push'];
    }
    case 'verify': {
      const workflowId = asString(args.workflowId);
      return workflowId ? ['verify', workflowId] : ['verify'];
    }
    case 'workflow_activate': {
      const workflowId = asString(args.workflowId);
      return workflowId ? ['workflow', 'activate', workflowId] : ['workflow', 'activate'];
    }
    case 'workflow_deactivate': {
      const workflowId = asString(args.workflowId);
      return workflowId ? ['workflow', 'deactivate', workflowId] : ['workflow', 'deactivate'];
    }
    case 'workflow_credential_required': {
      const workflowId = asString(args.workflowId);
      return workflowId ? ['workflow', 'credential-required', workflowId] : ['workflow', 'credential-required'];
    }
    case 'credential_schema': {
      const credentialType = asString(args.credentialType);
      return credentialType ? ['credential', 'schema', credentialType] : ['credential', 'schema'];
    }
    case 'credential_list':
      return ['credential', 'list'];
    case 'credential_get': {
      const credentialId = asString(args.credentialId);
      return credentialId ? ['credential', 'get', credentialId] : ['credential', 'get'];
    }
    case 'credential_create': {
      const credentialType = asString(args.credentialType);
      const credentialName = asString(args.credentialName);
      const argv = ['credential', 'create'];
      if (credentialType) argv.push('--type', credentialType);
      if (credentialName) argv.push('--name', credentialName);
      return argv;
    }
    case 'credential_delete': {
      const credentialId = asString(args.credentialId);
      return credentialId ? ['credential', 'delete', credentialId] : ['credential', 'delete'];
    }
    case 'execution_list':
      return ['execution', 'list'];
    case 'execution_get': {
      const executionId = asString(args.executionId);
      return executionId ? ['execution', 'get', executionId] : ['execution', 'get'];
    }
    case 'test': {
      const workflowId = asString(args.workflowId);
      return workflowId ? ['test', workflowId] : ['test'];
    }
    case 'test_plan':
    case 'test-plan': {
      const workflowId = asString(args.workflowId);
      return workflowId ? ['test-plan', workflowId] : ['test-plan'];
    }
    case 'skills': {
      if (Array.isArray(args.skillsArgv)) {
        return ['skills', ...args.skillsArgv.filter((value): value is string => typeof value === 'string')];
      }
      const skillsArgs = asString(args.skillsArgs);
      const split = skillsArgs ? splitN8nacArgv(skillsArgs) : null;
      return split ? ['skills', ...split] : ['skills'];
    }
    case 'validate': {
      const validateFile = asString(args.validateFile);
      return validateFile ? ['skills', 'validate', validateFile] : ['skills', 'validate'];
    }
    case 'update_ai':
      return ['update-ai'];
    case 'resolve': {
      const workflowId = asString(args.workflowId);
      const resolveMode = asString(args.resolveMode);
      const argv = ['resolve'];
      if (workflowId) argv.push(workflowId);
      if (resolveMode) argv.push('--mode', resolveMode);
      return argv;
    }
    default:
      return null;
  }
}

export function extractN8nacArgv(value: unknown): string[] | null {
  const args = asRecord(value);
  if (!args) {
    return null;
  }

  if (Array.isArray(args.commandArgv)) {
    const argv = args.commandArgv.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    if (argv.length > 0) {
      return argv;
    }
  }

  const commandArgs = asString(args.commandArgs);
  if (commandArgs) {
    return splitN8nacArgv(commandArgs);
  }

  return legacyActionToArgv(args);
}

export function extractN8nacOperation(value: unknown): string | undefined {
  const args = asRecord(value);
  const directAction = asString(args?.action);
  if (directAction === 'llm_provider_options' || directAction === 'yagr_proxy_warning_check' || directAction === 'yagr_proxy_warning_accept') {
    return directAction;
  }

  const argv = extractN8nacArgv(value);
  if (!argv || argv.length === 0) {
    return undefined;
  }

  const [head, second] = argv;
  if (head === 'workflow' && second === 'activate') return 'workflow_activate';
  if (head === 'workflow' && second === 'deactivate') return 'workflow_deactivate';
  if (head === 'workflow' && second === 'credential-required') return 'workflow_credential_required';
  if (head === 'credential' && second === 'schema') return 'credential_schema';
  if (head === 'credential' && second === 'list') return 'credential_list';
  if (head === 'credential' && second === 'get') return 'credential_get';
  if (head === 'credential' && second === 'create') return 'credential_create';
  if (head === 'credential' && second === 'delete') return 'credential_delete';
  if (head === 'execution' && second === 'list') return 'execution_list';
  if (head === 'execution' && second === 'get') return 'execution_get';
  if (head === 'skills' && second === 'validate') return 'validate';
  if (head === 'skills') return 'skills';
  if (head === 'test-plan') return 'test_plan';
  if (head === 'init-auth') return 'init_auth';
  if (head === 'init-project') return 'init_project';
  if (head === 'update-ai') return 'update_ai';
  if (head === 'setup-check') return 'setup_check';
  if (head === 'list') return 'list';
  if (head === 'pull') return 'pull';
  if (head === 'push') return 'push';
  if (head === 'verify') return 'verify';
  if (head === 'test') return 'test';
  if (head === 'resolve') return 'resolve';
  return head;
}

export function extractN8nacTargetMeta(value: unknown): {
  filename?: string;
  validateFile?: string;
  workflowId?: string;
} {
  const argv = extractN8nacArgv(value);
  if (!argv || argv.length === 0) {
    return {};
  }

  const operation = extractN8nacOperation(value);
  switch (operation) {
    case 'push':
      return { filename: argv[1] };
    case 'validate':
      return { validateFile: argv[2] };
    case 'pull':
    case 'verify':
    case 'test':
    case 'test_plan':
      return { workflowId: argv[1] };
    case 'workflow_activate':
    case 'workflow_deactivate':
    case 'workflow_credential_required':
      return { workflowId: argv[2] };
    case 'resolve':
      return { workflowId: argv[1] };
    default:
      return {};
  }
}