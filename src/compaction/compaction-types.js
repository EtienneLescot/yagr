export const DEFAULT_COMPACTION_CONFIG = {
    historyLimit: 50,
};
export function buildCompactionContextBlock(state, limit = 3) {
    if (state.compactionHistory.length === 0) {
        return '';
    }
    const recent = state.compactionHistory.slice(0, limit);
    const lines = recent.map((c) => {
        const date = new Date().toISOString().slice(0, 10);
        const msgCount = `${c.messagesCompacted} msgs → ${c.preservedRecentMessages} preserved`;
        const source = c.source === 'llm' ? 'LLM summary' : 'fallback';
        return `[${date}] ${source}: ${c.summary.slice(0, 80)}${c.summary.length > 80 ? '…' : ''} (${msgCount})`;
    });
    return `Recent context compactions (${state.compactionHistory.length} total): ${lines.join(' | ')}`;
}
//# sourceMappingURL=compaction-types.js.map