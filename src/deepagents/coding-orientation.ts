import { getYagrHomeDir } from '../config/yagr-home.js';

export {
  CODING_ORIENTATION_SYSTEM_PROMPT,
  createCodingOrientationMiddleware,
  createEditFileToolInputNormalizerMiddleware,
  getCodingOrientedDeepAgentMiddleware,
} from '@yagr/deepagent-bootstrap';

export type { CodingOrientationMiddlewareOptions } from '@yagr/deepagent-bootstrap';

export function getRuntimePathAnchorPrompt(): string {
  return `Backend working directory: ${getYagrHomeDir()}`;
}
