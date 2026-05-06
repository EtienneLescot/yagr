import { getActiveMemorySourcePaths } from '../config/yagr-home.js';

export {
  buildPristineDeepAgentConfig,
  createPristineDeepAgentBackend,
} from '@yagr/deepagent-bootstrap';

export function getPristineDeepAgentMemorySources(): string[] {
  return getActiveMemorySourcePaths();
}
