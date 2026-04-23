import qrcode from 'qrcode-terminal';
import { YagrConfigService } from '../config/yagr-config-service.js';
import { createTelegramGatewayRuntime, getTelegramGatewayStatus } from './telegram.js';
import { createWebUiGatewayRuntime } from './webui.js';
import { getWebUiGatewayStatus } from './webui-config.js';
function summarizeTelegramStatus(status) {
    if (!status.configured || !status.botUsername) {
        return 'Not configured';
    }
    const linkedCount = status.linkedChats.length;
    const chatSummary = linkedCount === 1 ? '1 linked chat' : `${linkedCount} linked chats`;
    return `@${status.botUsername}, ${chatSummary}`;
}
function summarizeWebUiStatus(status) {
    if (!status.configured) {
        return 'Not configured';
    }
    return status.url;
}
const GATEWAY_DESCRIPTORS = [
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
        createRuntime: async (options, configService) => createTelegramGatewayRuntime(options, configService),
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
        createRuntime: async (options, configService) => createWebUiGatewayRuntime(options, configService),
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
export function buildGatewaySupervisorStatus(surfaces) {
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
export function getGatewaySupervisorStatus(configService = new YagrConfigService()) {
    const enabledSurfaces = configService.getEnabledGatewaySurfaces();
    return buildGatewaySupervisorStatus(GATEWAY_DESCRIPTORS.map((descriptor) => descriptor.getStatus(configService, enabledSurfaces.includes(descriptor.id))));
}
export async function stopGatewayRuntimes(runtimes) {
    await Promise.allSettled(runtimes.map(async (runtime) => {
        await runtime.gateway.stop();
    }));
}
/**
 * Start the given gateway surfaces and return a `stop()` function for cleanup.
 * Unlike `runGatewaySurfaces`, this does NOT block waiting for SIGINT — callers
 * are responsible for calling `stop()` when they are done (e.g. after TUI exits).
 */
export async function startGatewaySurfacesInBackground(surfaces, options = {}, configService = new YagrConfigService()) {
    const requestedSurfaces = Array.from(new Set(surfaces));
    if (requestedSurfaces.length === 0) {
        return async () => { };
    }
    const runtimes = [];
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
            const runtime = await descriptor.createRuntime(options, configService);
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
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`Warning: Failed to start ${descriptor.label} gateway: ${message}\n`);
        }
    }
    return async () => {
        await Promise.allSettled(runtimes.map(async (r) => r.gateway.stop()));
    };
}
export async function runGatewaySurfaces(surfaces, options = {}, configService = new YagrConfigService()) {
    const requestedSurfaces = Array.from(new Set(surfaces));
    if (requestedSurfaces.length === 0) {
        throw new Error('No gateway surfaces were selected.');
    }
    const runtimes = [];
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
            const runtime = await descriptor.createRuntime(options, configService);
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
    }
    catch (error) {
        await stopGatewayRuntimes(runtimes);
        throw error;
    }
    process.stdout.write(`Yagr gateway active. Surfaces: ${requestedSurfaces.join(', ')}.\n`);
    await new Promise((resolve) => {
        const stop = async () => {
            await stopGatewayRuntimes(runtimes);
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
function buildRunningBanner(configService, startableSurfaces, pid) {
    const RULE = '─'.repeat(54);
    const lines = ['', RULE, '  Yagr is running.' + (pid ? `  (PID ${pid})` : ''), ''];
    const tgStatus = getTelegramGatewayStatus(configService);
    if (tgStatus.configured && tgStatus.botUsername && startableSurfaces.includes('telegram')) {
        lines.push(`  · Telegram:   open @${tgStatus.botUsername} in Telegram`);
    }
    if (startableSurfaces.includes('webui')) {
        const webUiStatus = getWebUiGatewayStatus(configService);
        lines.push(`  · Web UI:     ${webUiStatus.url}`);
    }
    else {
        lines.push('  · Web UI:     yagr webui  (starts a local web session)');
    }
    lines.push('  · Terminal:   yagr tui');
    lines.push('');
    lines.push('  To stop: yagr stop');
    lines.push(RULE);
    lines.push('');
    return lines.join('\n');
}
export function getGatewayRunningBanner(configService = new YagrConfigService(), pid) {
    const status = getGatewaySupervisorStatus(configService);
    return buildRunningBanner(configService, status.startableSurfaces, pid);
}
export async function runGatewaySupervisor(options = {}, configService = new YagrConfigService()) {
    const status = getGatewaySupervisorStatus(configService);
    if (status.startableSurfaces.length === 0) {
        const message = status.warnings[0] ?? 'No enabled and configured gateway surfaces are available.';
        throw new Error(message);
    }
    const runtimes = [];
    try {
        for (const descriptor of GATEWAY_DESCRIPTORS) {
            if (!status.startableSurfaces.includes(descriptor.id) || !descriptor.createRuntime) {
                continue;
            }
            const runtime = await descriptor.createRuntime(options, configService);
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
    }
    catch (error) {
        await stopGatewayRuntimes(runtimes);
        throw error;
    }
    process.stdout.write(`Yagr gateway supervisor active. Surfaces: ${status.startableSurfaces.join(', ')}.\n`);
    if (status.warnings.length > 0) {
        for (const warning of status.warnings) {
            process.stdout.write(`Warning: ${warning}\n`);
        }
    }
    process.stdout.write(buildRunningBanner(configService, status.startableSurfaces, undefined));
    await new Promise((resolve) => {
        const stop = async () => {
            await stopGatewayRuntimes(runtimes);
            // Clean up PID file if it points to this process
            try {
                const { readGatewayPid, clearGatewayPid } = await import('../config/gateway-daemon.js');
                if (readGatewayPid() === process.pid) {
                    clearGatewayPid();
                }
            }
            catch { /* ignore */ }
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
//# sourceMappingURL=manager.js.map