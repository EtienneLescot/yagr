import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getTunnelConfig,
  getActiveN8nAuthTunnelState,
  getActiveTunnelState,
} from '../dist/n8n-local/n8n-tunnel.js';

import {
  getTunnelReachabilityDebugSnapshot,
} from '../dist/n8n-local/tunnel-reachability.js';

import { YagrConfigService } from '../dist/config/yagr-config-service.js';

function withTempHome(run) {
  const previousHome = process.env.YAGR_HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'yagr-tunnel-reach-'));
  process.env.YAGR_HOME = tempHome;
  try {
    return run(tempHome);
  } finally {
    if (previousHome === undefined) delete process.env.YAGR_HOME;
    else process.env.YAGR_HOME = previousHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

function withEnvVar(key, value, run) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

// ---------------------------------------------------------------------------
// getTunnelConfig — TUNNEL_DOMAIN resolution
// ---------------------------------------------------------------------------

test('getTunnelConfig returns quick mode when TUNNEL_DOMAIN is unset', () => {
  withEnvVar('TUNNEL_DOMAIN', undefined, () => {
    const config = getTunnelConfig();
    assert.equal(config.mode, 'quick');
    assert.equal(config.hostname, undefined);
    assert.equal(config.tunnelName, undefined);
  });
});

test('getTunnelConfig returns quick mode when TUNNEL_DOMAIN is empty', () => {
  withEnvVar('TUNNEL_DOMAIN', '', () => {
    const config = getTunnelConfig();
    assert.equal(config.mode, 'quick');
  });
});

test('getTunnelConfig derives hostname and tunnelName from TUNNEL_DOMAIN', () => {
  withEnvVar('TUNNEL_DOMAIN', 'example.com', () => {
    const config = getTunnelConfig();
    assert.equal(config.mode, 'custom-domain');
    assert.equal(config.hostname, 'tunnel.example.com');
    assert.equal(config.tunnelName, 'yagr-example-com');
    assert.equal(config.domain, 'tunnel.example.com');
  });
});

test('getTunnelConfig creates per-service subdomains when serviceName is provided', () => {
  withEnvVar('TUNNEL_DOMAIN', 'example.com', () => {
    const config = getTunnelConfig('n8n');
    assert.equal(config.hostname, 'n8n.tunnel.example.com');
    assert.equal(config.tunnelName, 'yagr-example-com-n8n');
  });
});

test('getTunnelConfig creates per-service subdomains for llm service', () => {
  withEnvVar('TUNNEL_DOMAIN', 'example.com', () => {
    const config = getTunnelConfig('llm');
    assert.equal(config.hostname, 'llm.tunnel.example.com');
    assert.equal(config.tunnelName, 'yagr-example-com-llm');
  });
});

test('getTunnelConfig strips whitespace from TUNNEL_DOMAIN', () => {
  withEnvVar('TUNNEL_DOMAIN', '  example.com  ', () => {
    const config = getTunnelConfig();
    assert.equal(config.hostname, 'tunnel.example.com');
  });
});

test('getTunnelConfig replaces non-alphanumeric characters in tunnelName', () => {
  withEnvVar('TUNNEL_DOMAIN', 'my.domain.com', () => {
    const config = getTunnelConfig();
    assert.equal(config.tunnelName, 'yagr-my-domain-com');
  });
});

// ---------------------------------------------------------------------------
// State path — llm-tunnel.json and n8n-auth-tunnel.json
// ---------------------------------------------------------------------------

test('getActiveN8nAuthTunnelState returns null when no state file exists', () => {
  withTempHome((tempHome) => {
    const result = getActiveN8nAuthTunnelState();
    assert.equal(result, null);
  });
});

test('getActiveN8nAuthTunnelState returns null when stored PID is dead', () => {
  withTempHome((tempHome) => {
    const stateFile = path.join(tempHome, 'proxy-runtime', 'n8n-auth-tunnel.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      publicUrl: 'https://n8nauth.trycloudflare.com',
      targetUrl: 'http://127.0.0.1:3791',
      pid: 9_999_999,
      startedAt: new Date().toISOString(),
    }));
    const result = getActiveN8nAuthTunnelState();
    assert.equal(result, null);
  });
});

test('getActiveN8nAuthTunnelState returns state when PID is alive', () => {
  withTempHome((tempHome) => {
    const stateFile = path.join(tempHome, 'proxy-runtime', 'n8n-auth-tunnel.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    const expected = {
      publicUrl: 'https://n8nauth.trycloudflare.com',
      targetUrl: 'http://127.0.0.1:3791',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(stateFile, JSON.stringify(expected));
    const result = getActiveN8nAuthTunnelState();
    assert.notEqual(result, null);
    assert.equal(result?.publicUrl, expected.publicUrl);
    assert.equal(result?.pid, expected.pid);
    assert.equal(result?.publicUrl, expected.publicUrl); // publicUrl field name, not tunnelUrl
  });
});

test('getActiveN8nAuthTunnelState uses publicUrl field name (not tunnelUrl)', () => {
  withTempHome((tempHome) => {
    const stateFile = path.join(tempHome, 'proxy-runtime', 'n8n-auth-tunnel.json');
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
      publicUrl: 'https://auth.trycloudflare.com',
      targetUrl: 'http://127.0.0.1:3791',
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }));
    const result = getActiveN8nAuthTunnelState();
    assert.notEqual(result, null);
    assert.equal(result?.publicUrl, 'https://auth.trycloudflare.com');
    assert.equal(result?.publicUrl, result?.publicUrl);
  });
});

// ---------------------------------------------------------------------------
// getTunnelReachabilityDebugSnapshot — YAGR_TUNNEL_REACHABILITY_MODE resolution
// ---------------------------------------------------------------------------

test('getTunnelReachabilityDebugSnapshot defaults to on-demand mode', () => {
  withEnvVar('YAGR_TUNNEL_REACHABILITY_MODE', undefined, () => {
    withTempHome(() => {
      const snapshot = getTunnelReachabilityDebugSnapshot();
      assert.equal(snapshot.reachabilityMode, 'on-demand');
      assert.equal(snapshot.forceAllFacades, false);
    });
  });
});

test('getTunnelReachabilityDebugSnapshot reads YAGR_TUNNEL_REACHABILITY_MODE env var', () => {
  withEnvVar('YAGR_TUNNEL_REACHABILITY_MODE', 'force-all-facades', () => {
    withTempHome(() => {
      const snapshot = getTunnelReachabilityDebugSnapshot();
      assert.equal(snapshot.reachabilityMode, 'force-all-facades');
      assert.equal(snapshot.forceAllFacades, true);
    });
  });
});

test('getTunnelReachabilityDebugSnapshot on-demand mode sets forceAllFacades to false', () => {
  withEnvVar('YAGR_TUNNEL_REACHABILITY_MODE', 'on-demand', () => {
    withTempHome(() => {
      const snapshot = getTunnelReachabilityDebugSnapshot();
      assert.equal(snapshot.reachabilityMode, 'on-demand');
      assert.equal(snapshot.forceAllFacades, false);
    });
  });
});

test('getTunnelReachabilityDebugSnapshot ignores invalid env var values', () => {
  withEnvVar('YAGR_TUNNEL_REACHABILITY_MODE', 'invalid-value', () => {
    withTempHome(() => {
      const snapshot = getTunnelReachabilityDebugSnapshot();
      assert.equal(snapshot.reachabilityMode, 'on-demand');
      assert.equal(snapshot.forceAllFacades, false);
    });
  });
});

test('getTunnelReachabilityDebugSnapshot ignores config value when env var is set', () => {
  withEnvVar('YAGR_TUNNEL_REACHABILITY_MODE', 'force-all-facades', () => {
    withTempHome((tempHome) => {
      const configService = new YagrConfigService();
      configService.updateLocalConfig((cfg) => ({
        ...cfg,
        tunnels: { reachabilityMode: 'on-demand' },
      }));
      const snapshot = getTunnelReachabilityDebugSnapshot(configService);
      assert.equal(snapshot.reachabilityMode, 'force-all-facades');
    });
  });
});

test('getTunnelReachabilityDebugSnapshot falls back to config when env var is not set', () => {
  withEnvVar('YAGR_TUNNEL_REACHABILITY_MODE', undefined, () => {
    withTempHome((tempHome) => {
      const configService = new YagrConfigService();
      configService.updateLocalConfig((cfg) => ({
        ...cfg,
        tunnels: { reachabilityMode: 'force-all-facades' },
      }));
      const snapshot = getTunnelReachabilityDebugSnapshot(configService);
      assert.equal(snapshot.reachabilityMode, 'force-all-facades');
      assert.equal(snapshot.forceAllFacades, true);
    });
  });
});

test('getTunnelReachabilityDebugSnapshot trims whitespace from env var', () => {
  withEnvVar('YAGR_TUNNEL_REACHABILITY_MODE', '  force-all-facades  ', () => {
    withTempHome(() => {
      const snapshot = getTunnelReachabilityDebugSnapshot();
      assert.equal(snapshot.reachabilityMode, 'force-all-facades');
    });
  });
});

// ---------------------------------------------------------------------------
// YagrConfigService — llmTunnelUrl field, no tunnelUrl legacy
// ---------------------------------------------------------------------------

test('YagrConfigService saves and retrieves llmTunnelUrl field', () => {
  withTempHome(() => {
    const service = new YagrConfigService();
    service.updateLocalConfig((cfg) => ({
      ...cfg,
      llmProxy: {
        enabled: true,
        mode: 'tunnel',
        credentialBaseUrl: 'https://llm-tunnel.example.com/v1',
        llmTunnelUrl: 'https://llm-tunnel.example.com',
      },
    }));
    const saved = service.getLocalConfig();
    assert.equal(saved.llmProxy?.llmTunnelUrl, 'https://llm-tunnel.example.com');
    assert.equal(saved.llmProxy?.mode, 'tunnel');
    assert.equal(saved.llmProxy?.enabled, true);
  });
});

test('YagrConfigService does not have tunnelUrl field in YagrLlmProxyConfig type', () => {
  withTempHome(() => {
    const service = new YagrConfigService();
    service.updateLocalConfig((cfg) => ({
      ...cfg,
      llmProxy: {
        enabled: true,
        mode: 'tunnel',
        credentialBaseUrl: 'https://my-tunnel.example.com/v1',
        llmTunnelUrl: 'https://my-tunnel.example.com',
      },
    }));
    const saved = service.getLocalConfig();
    assert.equal('tunnelUrl' in saved.llmProxy, false);
    assert.equal('llmTunnelUrl' in saved.llmProxy, true);
  });
});
