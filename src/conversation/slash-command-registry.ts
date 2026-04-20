import type { SlashCommandMeta, SlashCommandName, SlashSurface } from './slash-command-types.js';

const COMMANDS: SlashCommandMeta[] = [
  {
    name: 'help',
    description: 'List available commands with their description',
    usage: '/help',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'sessions',
    description: 'List all conversation sessions for the current scope',
    usage: '/sessions',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: ['session', 'list_sessions'],
  },
  {
    name: 'resume',
    description: 'Resume a specific conversation session',
    usage: '/resume <session_id>',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'delete',
    description: 'Delete a conversation session',
    usage: '/delete <session_id>',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: ['del', 'rm'],
  },
  {
    name: 'new',
    description: 'Start a new conversation session',
    usage: '/new',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'reset',
    description: 'Reset the current conversation (alias of /new)',
    usage: '/reset',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'checkpoints',
    description: 'List all checkpoints for the current session',
    usage: '/checkpoints',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'save',
    description: 'Save a checkpoint of the current session',
    usage: '/save',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: ['checkpoint_save'],
  },
  {
    name: 'restore',
    description: 'Restore a checkpoint of the current session',
    usage: '/restore <checkpoint_id>',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'checkpoint_delete',
    description: 'Delete a specific checkpoint',
    usage: '/checkpoint_delete <checkpoint_id>',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: ['checkpoint_delete'],
  },
  {
    name: 'pending',
    description: 'Show pending required actions',
    usage: '/pending',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'approve',
    description: 'Grant pending permissions',
    usage: '/approve',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'compact',
    description: 'Trigger conversation compaction',
    usage: '/compact',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'open',
    description: 'Open the most recent workflow URL',
    usage: '/open',
    surfaces: ['tui'],
    aliases: [],
  },
  {
    name: 'toggle_thinking',
    description: 'Toggle display of agent thinking',
    usage: '/toggle_thinking',
    surfaces: ['tui'],
    aliases: ['toggle-thinking', 'toggle-agent-thinking'],
  },
  {
    name: 'toggle_cli',
    description: 'Toggle display of command executions',
    usage: '/toggle_cli',
    surfaces: ['tui'],
    aliases: ['toggle-cli', 'toggle-command-executions'],
  },
  {
    name: 'stop',
    description: 'Stop the current run',
    usage: '/stop',
    surfaces: ['tui', 'webui', 'telegram'],
    aliases: [],
  },
  {
    name: 'exit',
    description: 'Exit the terminal interface',
    usage: '/exit',
    surfaces: ['tui'],
    aliases: ['quit'],
  },
];

const COMMAND_BY_NAME = new Map<SlashCommandName, SlashCommandMeta>(
  COMMANDS.map((c) => [c.name, c]),
);

const NAME_BY_ALIAS = new Map<string, SlashCommandName>(
  COMMANDS.flatMap((c) => c.aliases.map((a) => [a, c.name])),
);

export function getCommandMeta(name: SlashCommandName): SlashCommandMeta | undefined {
  return COMMAND_BY_NAME.get(name);
}

export function resolveCommand(input: string): SlashCommandName | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return undefined;
  }
  const withoutSlash = trimmed.slice(1);
  const parts = withoutSlash.split(/\s+/);
  const rawName = parts[0]!.toLowerCase();

  if (NAME_BY_ALIAS.has(rawName)) {
    return NAME_BY_ALIAS.get(rawName);
  }

  for (const [name, meta] of COMMAND_BY_NAME) {
    if (name === rawName) {
      return name;
    }
    if (meta.aliases.includes(rawName)) {
      return name;
    }
  }

  return undefined;
}

export function getCommandsForSurface(surface: SlashSurface): SlashCommandMeta[] {
  return COMMANDS.filter((c) => c.surfaces.includes(surface));
}

export function getAllCommands(): SlashCommandMeta[] {
  return [...COMMANDS];
}
