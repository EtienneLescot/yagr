export function normalizeWorkflowMapLine(line) {
    return line
        .replace(/^\s*\/\*+\s?/, '')
        .replace(/^\s*\*\/?\s?/, '')
        .replace(/^\s*\/\/?\s?/, '')
        .replace(/\s*\*\/\s*$/, '')
        .trimEnd();
}
export function parseWorkflowMap(diagram) {
    const lines = diagram.split('\n').map(normalizeWorkflowMapLine);
    const nodeIndex = new Map();
    let inNodeIndex = false;
    for (const line of lines) {
        if (line.trim().startsWith('NODE INDEX')) {
            inNodeIndex = true;
            continue;
        }
        if (line.trim().startsWith('ROUTING MAP')) {
            inNodeIndex = false;
            continue;
        }
        if (/^[\s\-_=─]+$/.test(line.trim()) || line.trim().startsWith('Property name'))
            continue;
        if (!inNodeIndex)
            continue;
        const match = line.match(/^\s*(\S+)\s{2,}(\S+)/);
        if (match)
            nodeIndex.set(match[1], match[2]);
    }
    const edges = [];
    const parentStack = [];
    let inRouting = false;
    const orderedNames = [];
    for (const line of lines) {
        if (line.trim().startsWith('ROUTING MAP')) {
            inRouting = true;
            continue;
        }
        if (line.trim().startsWith('<workflow-map>') || line.trim().startsWith('</workflow-map>'))
            continue;
        if (line.trim().startsWith('AI CONNECTIONS'))
            break;
        if (!inRouting)
            continue;
        if (/^[\s\-_=─]+$/.test(line.trim()) || !line.trim())
            continue;
        const isLoop = line.includes('(↩ loop)');
        const arrowMatch = line.match(/^(\s*)\.out\(\d+\)\s+(?:→|->)\s*(\S+)/) ?? line.match(/^(\s*)(?:→|->)\s*(\S+)/);
        if (arrowMatch) {
            const depth = Math.floor(arrowMatch[1].length / 2);
            const name = arrowMatch[2];
            if (!isLoop)
                orderedNames.push(name);
            if (depth <= parentStack.length && parentStack.length > 0) {
                parentStack.length = depth;
            }
            if (parentStack.length > 0) {
                edges.push({ from: parentStack[parentStack.length - 1], to: name, isLoop });
            }
            if (!isLoop)
                parentStack.push(name);
        }
        else {
            const rootMatch = line.match(/^\s*(\S+)\s*$/);
            if (rootMatch) {
                parentStack.length = 0;
                parentStack.push(rootMatch[1]);
                orderedNames.push(rootMatch[1]);
            }
        }
    }
    if (orderedNames.length === 0) {
        orderedNames.push(...nodeIndex.keys());
    }
    if (orderedNames.length === 0)
        return null;
    const layerMap = new Map();
    for (const name of orderedNames) {
        if (!layerMap.has(name))
            layerMap.set(name, 0);
    }
    const forwardEdges = edges.filter((e) => !e.isLoop);
    let changed = true;
    let iters = 0;
    const maxIters = orderedNames.length * orderedNames.length + 1;
    while (changed && iters++ < maxIters) {
        changed = false;
        for (const e of forwardEdges) {
            const s = layerMap.get(e.from) ?? 0;
            const t = layerMap.get(e.to) ?? 0;
            if (t <= s) {
                layerMap.set(e.to, s + 1);
                changed = true;
            }
        }
    }
    const columns = new Map();
    for (const name of orderedNames) {
        const col = layerMap.get(name) ?? 0;
        if (!columns.has(col))
            columns.set(col, []);
        if (!columns.get(col)?.includes(name))
            columns.get(col)?.push(name);
    }
    const nodes = [];
    for (const [col, names] of columns) {
        names.forEach((name, row) => {
            nodes.push({ id: name, label: name, type: nodeIndex.get(name) ?? '', col, row });
        });
    }
    return { nodes, edges };
}
export function normalizeRenderableWorkflowDiagram(diagram) {
    const normalized = String(diagram ?? '').trim();
    if (!normalized) {
        return undefined;
    }
    const graph = parseWorkflowMap(normalized);
    if (!graph || graph.nodes.length === 0) {
        return undefined;
    }
    return normalized;
}
//# sourceMappingURL=workflow-diagram.js.map