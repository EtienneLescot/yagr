import { LocalShellBackend } from 'deepagents';
import { getActiveMemorySourcePaths } from '../config/yagr-home.js';
export function getPristineDeepAgentMemorySources() {
    return getActiveMemorySourcePaths();
}
export function createPristineDeepAgentBackend(rootDir = process.cwd()) {
    return new LocalShellBackend({
        rootDir,
        inheritEnv: true,
    });
}
export function buildPristineDeepAgentConfig({ model, checkpointer, rootDir = process.cwd(), }) {
    return {
        model,
        checkpointer,
        memory: getPristineDeepAgentMemorySources(),
        backend: createPristineDeepAgentBackend(rootDir),
    };
}
//# sourceMappingURL=pristine.js.map