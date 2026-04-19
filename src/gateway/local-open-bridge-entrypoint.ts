import { ensureLocalN8nAuthBridgeRunningInProcess } from './local-open-bridge.js';

async function main(): Promise<void> {
  await ensureLocalN8nAuthBridgeRunningInProcess();
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
