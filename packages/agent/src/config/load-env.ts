import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getHolonHomeDir, getHolonLaunchDir } from './holon-home.js';

const launchEnvTest = join(getHolonLaunchDir(), '.env.test');
const launchEnv = join(getHolonLaunchDir(), '.env');
const homeEnv = join(getHolonHomeDir(), '.env');

if (existsSync(launchEnvTest)) {
  dotenvConfig({ path: launchEnvTest, quiet: true });
} else if (existsSync(launchEnv)) {
  dotenvConfig({ path: launchEnv, quiet: true });
} else if (existsSync(homeEnv)) {
  dotenvConfig({ path: homeEnv, quiet: true });
} else {
  dotenvConfig({ quiet: true });
}
