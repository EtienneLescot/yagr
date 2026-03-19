import qrcode from 'qrcode-terminal';
import { YagrConfigService, type YagrGatewayConfig } from '../config/yagr-config-service.js';
import type { Engine } from '../engine/engine.js';
import type { YagrRunOptions } from '../types.js';
import type { GatewayRuntimeHandle, GatewaySurface } from './types.js';
import { createTelegramGatewayRuntime, getTelegramGatewayStatus, type TelegramGatewayStatus } from './telegram.js';
import { createWebUiGatewayRuntime, getWebUiGatewayStatus, type WebUiGatewayStatus } from './webui.js';

export interface GatewaySurfaceStatus {
  id: GatewaySurface;
  label: string;
  enabled: boolean;
  configured: boolean;
  implemented: boolean;
  startable: boolean;
  summary: string;
  details?: Record<string, unknown>;
}

export interface GatewaySupervisorStatus {
  enabledSurfaces: GatewaySurface[];
  startableSurfaces: GatewaySurface[];
  surfaces: GatewaySurfaceStatus[];
  warnings: string[];
}

interface GatewayDescriptor {
  id: GatewaySurface;
  label: string;
  getStatus: (configService: YagrConfigService, enabled: boolean) => Omit<GatewaySurfaceStatus, 'startable'>;
  createRuntime?: (
    engineResolver: () => Promise<Engine>,
    options: YagrRunOptions,
    configService: YagrConfigService,
  ) => Promise<GatewayRuntimeHandle> | GatewayRuntimeHandle;
}

function summarizeTelegramStatus(status: TelegramGatewayStatus): string {
  if (!status.configured || !status.botUsername) {
    return 'Not configured';
  }

  const linkedCount = status.linkedChats.length;
  const chatSummary = linkedCount === 1 ? '1 linked chat' : `${linkedCount} linked chats`;
  return `@${status.botUsername}, ${chatSummary}`;
}

function summarizeWebUiStatus(status: WebUiGatewayStatus): string {
  if (!status.configured) {
    return 'Not configured';
  }

  return status.url;
}

const GATEWAY_DESCRIPTORS: GatewayDescriptor[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    getStatus: (configService, enabled) => {
      const status = getTelegramGatewayStatus(configService);
      return {
        id: 'telegram',
        label: 'Telegram',
        enabled,
        configured: status.configured,
        implemented: true,
        summary: summarizeTelegramStatus(status),
        details: {
          botUsername: status.botUsername,
          linkedChats: status.linkedChats,
          deepLink: status.deepLink,
        },
      };
    },
    createRuntime: async (engineResolver, options, configService) => createTelegramGatewayRuntime(engineResolver, options, configService),
  },
  {
    id: 'webui',
    label: 'Web UI',
    getStatus: (configService, enabled) => {
      const status = getWebUiGatewayStatus(configService);
      return {
      id: 'webui',
      label: 'Web UI',
      enabled,
      configured: status.configured,
      implemented: true,
      summary: summarizeWebUiStatus(status),
      details: {
        url: status.url,
        host: status.host,
        port: status.port,
      },
    };
    },
    createRuntime: async (engineResolver, options, configService) => createWebUiGatewayRuntime(engineResolver, options, configService),
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    getStatus: (_configService, enabled) => ({
      id: 'whatsapp',
      label: 'WhatsApp',
      enabled,
      configured: false,
      implemented: false,
      summary: 'Not implemented yet',
    }),
  },
];

export function buildGatewaySupervisorStatus(
  surfaces: Array<Omit<GatewaySurfaceStatus, 'startable'>>,
): GatewaySupervisorStatus {
  const normalizedSurfaces = surfaces.map((surface) => ({
    ...surface,
    startable: surface.enabled && surface.configured && surface.implemented,
  }));

  const warnings = normalizedSurfaces.flatMap((surface) => {
    if (!surface.enabled) {
      return [];
    }

    if (!surface.implemented) {
      return [`${surface.label} is enabled but not implemented yet.`];
    }

    if (!surface.configured) {
      return [`${surface.label} is enabled but not configured.`];
    }

    return [];
  });

  return {
    enabledSurfaces: normalizedSurfaces.filter((surface) => surface.enabled).map((surface) => surface.id),
    startableSurfaces: normalizedSurfaces.filter((surface) => surface.startable).map((surface) => surface.id),
    surfaces: normalizedSurfaces,
    warnings,
  };
}

export function getGatewaySupervisorStatus(configService = new YagrConfigService()): GatewaySupervisorStatus {
  const enabledSurfaces = configService.getEnabledGatewaySurfaces();
  return buildGatewaySupervisorStatus(
    GATEWAY_DESCRIPTORS.map((descriptor) => descriptor.getStatus(configService, enabledSurfaces.includes(descriptor.id))),
  );
}

async function stopRuntimeHandles(runtimes: GatewayRuntimeHandle[]): Promise<void> {
  await Promise.allSettled(runtimes.map(async (runtime) => {
    await runtime.gateway.stop();
  }));
}

/**
 * Start the given gateway surfaces and return a `stop()` function for cleanup.
 * Unlike `runGatewaySurfaces`, this does NOT block waiting for SIGINT — callers
 * are responsible for calling `stop()` when they are done (e.g. after TUI exits).
 */
export async function startGatewaySurfacesInBackground(
  surfaces: GatewaySurface[],
  engineResolver: () => Promise<Engine>,
  options: YagrRunOptions = {},
  configService = new YagrConfigService(),
): Promise<() => Promise<void>> {
  const requestedSurfaces = Array.from(new Set(surfaces));
  if (requestedSurfaces.length === 0) {
    return async () => {};
  }

  const runtimes: GatewayRuntimeHandle[] = [];

  for (const surface of requestedSurfaces) {
    const descriptor = GATEWAY_DESCRIPTORS.find((entry) => entry.id === surface);
    if (!descriptor?.createRuntime) {
      continue;
    }

    const status = descriptor.getStatus(configService, true);
    if (!status.implemented || !status.configured) {
      process.stderr.write(`Warning: ${descriptor.label} gateway is not fully configured — skipping.\n`);
      continue;
    }

    try {
      const runtime = await descriptor.createRuntime(engineResolver, options, configService);
      await runtime.gateway.start();
      runtimes.push(runtime);

      for (const line of runtime.startupMessages) {
        process.stdout.write(`${line}\n`);
      }

      if (runtime.onboardingLink) {
        process.stdout.write(`Onboarding link: ${runtime.onboardingLink}\n`);
        qrcode.generate(runtime.onboardingLink, { small: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Warning: Failed to start ${descriptor.label} gateway: ${message}\n`);
    }
  }

  return async () => {
    await Promise.allSettled(runtimes.map(async (r) => r.gateway.stop()));
  };
}

export async function runGatewaySurfaces(
  surfaces: GatewaySurface[],
  engineResolver: () => Promise<Engine>,
  options: YagrRunOptions = {},
  configService = new YagrConfigService(),
): Promise<void> {
  const requestedSurfaces = Array.from(new Set(surfaces));
  if (requestedSurfaces.length === 0) {
    throw new Error('No gateway surfaces were selected.');
  }

  const runtimes: GatewayRuntimeHandle[] = [];

  try {
    for (const surface of requestedSurfaces) {
      const descriptor = GATEWAY_DESCRIPTORS.find((entry) => entry.id === surface);
      if (!descriptor || !descriptor.createRuntime) {
        throw new Error(`${surface} is not implemented yet.`);
      }

      const status = descriptor.getStatus(configService, true);
      if (!status.implemented) {
        throw new Error(`${descriptor.label} is not implemented yet.`);
      }

      if (!status.configured) {
        throw new Error(`${descriptor.label} is not configured.`);
      }

      const runtime = await descriptor.createRuntime(engineResolver, options, configService);
      await runtime.gateway.start();
      runtimes.push(runtime);

      for (const line of runtime.startupMessages) {
        process.stdout.write(`${line}\n`);
      }

      if (runtime.onboardingLink) {
        process.stdout.write(`Onboarding link: ${runtime.onboardingLink}\n`);
        qrcode.generate(runtime.onboardingLink, { small: true });
      }
    }
  } catch (error) {
    await stopRuntimeHandles(runtimes);
    throw error;
  }

  process.stdout.write(`Yagr gateway active. Surfaces: ${requestedSurfaces.join(', ')}.\n`);

  await new Promise<void>((resolve) => {
    const stop = async () => {
      await stopRuntimeHandles(runtimes);
      resolve();
    };

    process.once('SIGINT', () => {
      void stop();
    });
    process.once('SIGTERM', () => {
      void stop();
    });
  });
}

export async function runGatewaySupervisor(
  engineResolver: () => Promise<Engine>,
  options: YagrRunOptions = {},
  configService = new YagrConfigService(),
): Promise<void> {
  const status = getGatewaySupervisorStatus(configService);

  if (status.startableSurfaces.length === 0) {
    const message = status.warnings[0] ?? 'No enabled and configured gateway surfaces are available.';
    throw new Error(message);
  }

  const runtimes: GatewayRuntimeHandle[] = [];

  try {
    for (const descriptor of GATEWAY_DESCRIPTORS) {
      if (!status.startableSurfaces.includes(descriptor.id) || !descriptor.createRuntime) {
        continue;
      }

      const runtime = await descriptor.createRuntime(engineResolver, options, configService);
      await runtime.gateway.start();
      runtimes.push(runtime);

      for (const line of runtime.startupMessages) {
        process.stdout.write(`${line}\n`);
      }

      if (runtime.onboardingLink) {
        process.stdout.write(`Onboarding link: ${runtime.onboardingLink}\n`);
        qrcode.generate(runtime.onboardingLink, { small: true });
      }
    }
  } catch (error) {
    await stopRuntimeHandles(runtimes);
    throw error;
  }

  process.stdout.write(`Yagr gateway supervisor active. Surfaces: ${status.startableSurfaces.join(', ')}.\n`);
  if (status.warnings.length > 0) {
    for (const warning of status.warnings) {
      process.stdout.write(`Warning: ${warning}\n`);
    }
  }

  await new Promise<void>((resolve) => {
    const stop = async () => {
      await stopRuntimeHandles(runtimes);
      resolve();
    };

    process.once('SIGINT', () => {
      void stop();
    });
    process.once('SIGTERM', () => {
      void stop();
    });
  });
}