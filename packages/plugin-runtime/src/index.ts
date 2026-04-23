export type YagrPluginKind = 'manager' | 'surface' | 'provider' | 'integration' | 'workflow' | 'tooling';

export interface YagrPluginContext {
  appName: string;
  env: NodeJS.ProcessEnv;
}

export interface YagrPluginCapabilities {
  tools?: string[];
  surfaces?: string[];
  providers?: string[];
  workflows?: string[];
  gateways?: string[];
}

export interface YagrPluginHooks {
  registerTools?(context: YagrPluginContext): void | Promise<void>;
  registerSurfaces?(context: YagrPluginContext): void | Promise<void>;
  registerProviders?(context: YagrPluginContext): void | Promise<void>;
  registerWorkflows?(context: YagrPluginContext): void | Promise<void>;
  setup?(context: YagrPluginContext): void | Promise<void>;
}

export interface YagrPluginManifest {
  name: string;
  version: string;
  kind: YagrPluginKind;
  description: string;
  capabilities?: YagrPluginCapabilities;
}

export interface YagrPlugin {
  manifest: YagrPluginManifest;
  hooks?: YagrPluginHooks;
}

export function defineYagrPlugin(plugin: YagrPlugin): YagrPlugin {
  return plugin;
}

export class YagrPluginRegistry {
  private readonly plugins = new Map<string, YagrPlugin>();

  register(plugin: YagrPlugin): void {
    if (this.plugins.has(plugin.manifest.name)) {
      throw new Error(`Plugin already registered: ${plugin.manifest.name}`);
    }
    this.plugins.set(plugin.manifest.name, plugin);
  }

  list(): YagrPlugin[] {
    return [...this.plugins.values()];
  }

  get(name: string): YagrPlugin | undefined {
    return this.plugins.get(name);
  }

  async initialize(context: YagrPluginContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      await plugin.hooks?.setup?.(context);
      await plugin.hooks?.registerProviders?.(context);
      await plugin.hooks?.registerTools?.(context);
      await plugin.hooks?.registerSurfaces?.(context);
      await plugin.hooks?.registerWorkflows?.(context);
    }
  }
}
