import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getYagrHomeDir, getYagrLaunchDir } from './yagr-home.js';

const launchEnvTest = join(getYagrLaunchDir(), '.env.test');
const launchEnv = join(getYagrLaunchDir(), '.env');
const homeEnv = join(getYagrHomeDir(), '.env');

if (existsSync(launchEnvTest)) {
  dotenvConfig({ path: launchEnvTest, quiet: true });
} else if (existsSync(launchEnv)) {
  dotenvConfig({ path: launchEnv, quiet: true });
} else if (existsSync(homeEnv)) {
  dotenvConfig({ path: homeEnv, quiet: true });
} else {
  dotenvConfig({ quiet: true });
}
