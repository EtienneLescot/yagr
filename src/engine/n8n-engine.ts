import {
  KnowledgeSearch,
  NodeSchemaProvider,
  WorkflowValidator,
  type UnifiedSearchResult,
} from '@n8n-as-code/skills';
import type { N8nWorkflow } from '@n8n-as-code/transformer';
import { N8nApiClient, type IWorkflow, type IN8nCredentials } from 'n8nac';
import type {
  CredentialRequirement,
  DeployedWorkflow,
  GeneratedWorkflow,
  N8nEngineConfig,
  NodeSummary,
  TemplateSummary,
  WorkflowSpec,
  WorkflowValidationResult,
} from '../types.js';
import type { Engine } from './engine.js';

export class N8nEngine implements Engine {
  public readonly name = 'n8n' as const;

  private readonly config: N8nEngineConfig;
  private readonly nodeProvider: NodeSchemaProvider;
  private readonly knowledgeSearch: KnowledgeSearch;
  private readonly workflowValidator: WorkflowValidator;
  private readonly apiClient: N8nApiClient;

  constructor(config: N8nEngineConfig) {
    this.config = config;
    this.nodeProvider = new NodeSchemaProvider();
    this.knowledgeSearch = new KnowledgeSearch();
    this.workflowValidator = new WorkflowValidator();

    const credentials: IN8nCredentials = {
      host: config.host,
      apiKey: config.apiKey,
    };

    this.apiClient = new N8nApiClient(credentials);
  }

  async searchNodes(query: string): Promise<NodeSummary[]> {
    return this.nodeProvider.searchNodes(query).map((node) => ({
      name: node.name,
      type: node.type,
      displayName: node.displayName,
      description: node.description,
    }));
  }

  async nodeInfo(type: string): Promise<unknown> {
    const schema = this.nodeProvider.getNodeSchema(type);
    if (!schema) {
      throw new Error(`Node schema not found for type: ${type}`);
    }

    return schema;
  }

  async searchTemplates(query: string): Promise<TemplateSummary[]> {
    const result: UnifiedSearchResult = this.knowledgeSearch.searchAll(query, {
      type: 'documentation',
      category: 'advanced-ai',
      limit: 10,
    });

    return result.results.map((item) => ({
      id: item.id,
      title: item.title || item.name || item.displayName || item.id,
      excerpt: item.excerpt,
      category: item.category,
      url: item.url,
    }));
  }

  async generateWorkflow(spec: WorkflowSpec): Promise<GeneratedWorkflow> {
    const nodes = spec.nodes.map((node, index) => ({
      id: `${index + 1}`,
      name: node.name,
      type: node.type,
      typeVersion: node.typeVersion ?? 1,
      position: node.position ?? ([index * 240, index * 120] as [number, number]),
      parameters: node.parameters,
      credentials: this.normalizeCredentials(node.credentials),
    }));

    const connections = this.normalizeConnections(spec.connections);

    const definition: N8nWorkflow = {
      name: spec.name,
      nodes,
      connections,
      active: spec.active ?? false,
      settings: {},
      versionId: '',
      id: '',
      pinData: {},
      tags: [],
    };

    return {
      engine: 'n8n',
      name: spec.name,
      sourceType: 'n8n-json',
      definition,
      credentialRequirements: this.extractCredentialRequirements(spec),
    };
  }

  private normalizeConnections(specConnections: WorkflowSpec['connections']): Record<string, any> {
    if (Array.isArray(specConnections)) {
      return this.convertEdgeListToN8nConnections(specConnections);
    }

    const values = Object.values(specConnections);
    const isGroupedEdgeList = values.every(
      (value) => Array.isArray(value),
    );

    if (isGroupedEdgeList) {
      const flattened = Object.values(specConnections as Record<string, WorkflowSpec['connections'] extends Array<infer T> ? T[] : never>)
        .flat() as Array<{ from: string; to: string; type?: string; index?: number }>;
      return this.convertEdgeListToN8nConnections(flattened);
    }

    return specConnections as Record<string, any>;
  }

  private convertEdgeListToN8nConnections(
    connections: Array<{ from: string; to: string; type?: string; index?: number }>,
  ): Record<string, any> {
    return connections.reduce<Record<string, any>>((acc, connection) => {
      const connectionType = connection.type ?? 'main';
      if (!acc[connection.from]) {
        acc[connection.from] = {};
      }

      if (!acc[connection.from][connectionType]) {
        acc[connection.from][connectionType] = [[]];
      }

      acc[connection.from][connectionType][0].push({
        node: connection.to,
        type: connectionType,
        index: connection.index ?? 0,
      });

      return acc;
    }, {});
  }

  async validate(workflow: GeneratedWorkflow): Promise<WorkflowValidationResult> {
    if (workflow.sourceType !== 'n8n-json') {
      throw new Error('N8nEngine can only validate n8n-json workflows');
    }

    const result = await this.workflowValidator.validateWorkflow(workflow.definition);
    return {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
    };
  }

  async deploy(workflow: GeneratedWorkflow): Promise<DeployedWorkflow> {
    if (workflow.sourceType !== 'n8n-json') {
      throw new Error('N8nEngine can only deploy n8n-json workflows');
    }

    const definition = workflow.definition as N8nWorkflow;
    const created = await this.apiClient.createWorkflow(definition as Partial<IWorkflow>);

    if (definition.active) {
      await this.apiClient.activateWorkflow(created.id, true);
    }

    return {
      id: created.id,
      engine: 'n8n',
      name: created.name,
      active: Boolean(definition.active),
      workflowUrl: `${this.config.host.replace(/\/$/, '')}/workflow/${created.id}`,
      credentialRequirements: workflow.credentialRequirements,
    };
  }

  async listWorkflows(): Promise<DeployedWorkflow[]> {
    const workflows = await this.apiClient.getAllWorkflows(this.config.projectId);
    return workflows.map((workflow) => ({
      id: workflow.id,
      engine: 'n8n',
      name: workflow.name,
      active: workflow.active,
      workflowUrl: `${this.config.host.replace(/\/$/, '')}/workflow/${workflow.id}`,
      credentialRequirements: [],
    }));
  }

  async activateWorkflow(id: string): Promise<void> {
    const ok = await this.apiClient.activateWorkflow(id, true);
    if (!ok) {
      throw new Error(`Failed to activate workflow ${id}`);
    }
  }

  async deactivateWorkflow(id: string): Promise<void> {
    const ok = await this.apiClient.activateWorkflow(id, false);
    if (!ok) {
      throw new Error(`Failed to deactivate workflow ${id}`);
    }
  }

  async deleteWorkflow(id: string): Promise<void> {
    const ok = await this.apiClient.deleteWorkflow(id);
    if (!ok) {
      throw new Error(`Failed to delete workflow ${id}`);
    }
  }

  private extractCredentialRequirements(spec: WorkflowSpec): CredentialRequirement[] {
    const requirements: CredentialRequirement[] = [];

    for (const node of spec.nodes) {
      const credentials = node.credentials || {};
      for (const [credentialType, credentialRef] of Object.entries(credentials)) {
        requirements.push({
          nodeName: node.name,
          credentialType,
          displayName: credentialRef.name || credentialType,
          required: true,
          status: credentialRef.id || credentialRef.name ? 'linked' : 'missing',
        });
      }
    }

    return requirements;
  }

  private normalizeCredentials(
    credentials?: WorkflowSpec['nodes'][number]['credentials'],
  ): Record<string, { id: string; name: string }> | undefined {
    if (!credentials) {
      return undefined;
    }

    const normalized = Object.entries(credentials).reduce<Record<string, { id: string; name: string }>>(
      (acc, [credentialType, credentialRef]) => {
        if (credentialRef.id && credentialRef.name) {
          acc[credentialType] = {
            id: credentialRef.id,
            name: credentialRef.name,
          };
        }

        return acc;
      },
      {},
    );

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }
}
