import { createN8nEngineFromWorkspace } from './dist/config/load-n8n-engine-config.js';
import { YagrAgent } from './dist/agent.js';
import { getYagrPaths } from './dist/config/yagr-home.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Patch Node.js fetch to log the request body and response
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const urlStr = String(url);
  const isGoogle = urlStr.includes('generativelanguage') || urlStr.includes('googleapis');
  if (isGoogle) {
    process.stderr.write('=== GOOGLE REQUEST ===\n');
    process.stderr.write('URL: ' + urlStr.replace(/key=[^&]+/, 'key=REDACTED') + '\n');
    if (init?.body) {
      try {
        const body = JSON.parse(init.body);
        const toolCount = body.tools?.[0]?.function_declarations?.length ?? (body.tools ? Array.from(Object.keys(body.tools)).length : 0);
        const msgCount = body.messages?.length ?? body.contents?.length ?? 0;
        process.stderr.write('Tools count: ' + toolCount + '\n');
        process.stderr.write('Messages count: ' + msgCount + '\n');
        process.stderr.write('System instruction length: ' + JSON.stringify(body.system_instruction || body.system || '').length + '\n');
        // Check if any assistant message has extra_content (thought_signature injected)
        const msgs = body.messages || [];
        for (const msg of msgs) {
          if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
            for (const tc of msg.tool_calls) {
              if (tc.extra_content?.google?.thought_signature) {
                process.stderr.write('thought_signature INJECTED for tool_call id=' + tc.id + '\n');
              } else {
                process.stderr.write('MISSING thought_signature for tool_call id=' + tc.id + '\n');
              }
            }
          }
        }
      } catch(e) {
        process.stderr.write('Body parse error: ' + e.message + '\n');
        process.stderr.write('Body (first 1000): ' + String(init.body).slice(0, 1000) + '\n');
      }
    }
  }
  const response = await originalFetch(url, init);
  if (isGoogle) {
    process.stderr.write('=== GOOGLE RESPONSE ===\n');
    process.stderr.write('Status: ' + response.status + ' ' + response.statusText + '\n');
    if (!response.ok) {
      const cloned = response.clone();
      const text = await cloned.text();
      process.stderr.write('Error body: ' + text.slice(0, 3000) + '\n');
    }
  }
  return response;
};

const sourcePaths = getYagrPaths();
const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'google-test-'));

function copyIfExists(src, dst) {
  if (src && fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}
function copyDirIfExists(src, dst) {
  if (src && fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(src, dst, { recursive: true });
  }
}

copyIfExists(sourcePaths.yagrConfigPath, path.join(tempHome, 'yagr-config.json'));
copyIfExists(sourcePaths.yagrCredentialsPath, path.join(tempHome, 'credentials.json'));
copyIfExists(sourcePaths.n8nCredentialsPath, path.join(tempHome, 'n8n-credentials.json'));
copyIfExists(sourcePaths.homeInstructionsPath, path.join(tempHome, 'AGENTS.md'));
copyDirIfExists(sourcePaths.n8nWorkspaceDir, path.join(tempHome, 'n8n-workspace'));

const previousEnvs = {};
function setEnv(k, v) { previousEnvs[k] = process.env[k]; process.env[k] = v; }
setEnv('YAGR_HOME', tempHome);
setEnv('YAGR_LAUNCH_CWD', process.cwd());
setEnv('YAGR_ALLOW_N8N_ENV', '1');

try {
  process.stdout.write('Isolated home: ' + tempHome + '\n');
  process.stdout.write('Creating engine...\n');
  const engine = await createN8nEngineFromWorkspace();
  process.stdout.write('Engine name: ' + engine.name + '\n');

  const agent = new YagrAgent(engine);
  process.stdout.write('Running agent...\n');

  const result = await agent.run('List existing workflows', {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    maxSteps: 3,
  });

  process.stdout.write('Result text: ' + (result.text?.slice(0, 500) ?? '') + '\n');
  process.stdout.write('SUCCESS\n');
} catch (err) {
  process.stdout.write('Error: ' + err.message + '\n');
  process.stdout.write('Stack: ' + (err.stack?.split('\n').slice(0, 5).join('\n') ?? '') + '\n');
} finally {
  for (const [k, v] of Object.entries(previousEnvs)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tempHome, { recursive: true, force: true });
}
