export interface GraphNode {
    id: string;
    label: string;
    type: string;
    col: number;
    row: number;
}
export interface GraphEdge {
    from: string;
    to: string;
    isLoop?: boolean;
}
export declare function normalizeWorkflowMapLine(line: string): string;
export declare function parseWorkflowMap(diagram: string): {
    nodes: GraphNode[];
    edges: GraphEdge[];
} | null;
export declare function normalizeRenderableWorkflowDiagram(diagram: string | undefined): string | undefined;
//# sourceMappingURL=workflow-diagram.d.ts.map