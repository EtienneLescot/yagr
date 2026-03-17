import qrcode from 'qrcode-terminal';
import { HolonConfigService, type HolonGatewayConfig } from '../config/holon-config-service.js';
import type { Engine } from '../engine/engine.js';
import type { HolonRunOptions } from '../types.js';
import type { GatewayRuntimeHandle, GatewaySurface } from './types.js';
import { createTelegramGatewayRuntime, getTelegramGatewayStatus, type TelegramGatewayStatus } from './telegram.js';

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
  getStatus: (configService: HolonConfigService, enabled: boolean) => Omit<GatewaySurfaceStatus, 'startable'>;
  createRuntime?: (
    engineResolver: () => Promise<Engine>,
    options: HolonRunOptions,
    configService: HolonConfigService,
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
    getStatus: (_configService, enabled) => ({
      id: 'webui',
      label: 'Web UI',
      enabled,
      configured: false,
      implemented: false,
      summary: 'Not implemented yet',
    }),
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

export function getGatewaySupervisorStatus(configService = new HolonConfigService()): GatewaySupervisorStatus {
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

export async function runGatewaySupervisor(
  engineResolver: () => Promise<Engine>,
  options: HolonRunOptions = {},
  configService = new HolonConfigService(),
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

  process.stdout.write(`Holon gateway supervisor active. Surfaces: ${status.startableSurfaces.join(', ')}.\n`);
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