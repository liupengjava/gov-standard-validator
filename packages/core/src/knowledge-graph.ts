export type GraphNode = { id: string; type: string; label: string; ref?: Record<string, unknown> };
export type GraphEdge = { source: string; target: string; type: string; evidence_id?: string; weight?: number };
export type KnowledgeGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

export type GraphAssetInput = {
  asset_id: string;
  title: string;
  industry?: string | null;
  business_type?: string | null;
  format?: string | null;
};

export type GraphEvidenceInput = {
  evidence_id: string;
  asset_id: string;
  unit_id: string;
  slide_no: number;
  title?: string | null;
  image_path?: string | null;
  numbers_with_units?: Array<{ metric?: string; value?: string; unit?: string; context?: string }>;
  architecture_nodes?: Array<{ name?: string; role?: string; source_text?: string }>;
};

function cleanIdPart(v: string): string {
  return v.replace(/[^A-Za-z0-9_\-一-龥]/g, '_').slice(0, 80);
}

export function buildKnowledgeGraph(input: {
  assets: GraphAssetInput[];
  evidence: GraphEvidenceInput[];
  maxEdges?: number;
}): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const addNode = (node: GraphNode) => {
    if (!node.id || nodes.has(node.id)) return;
    nodes.set(node.id, node);
  };
  const addEdge = (edge: GraphEdge) => {
    if (!edge.source || !edge.target) return;
    edges.push(edge);
  };

  const maxEdges = input.maxEdges ?? 50;
  for (const asset of input.assets) {
    const assetNode = `asset:${asset.asset_id}`;
    addNode({ id: assetNode, type: 'asset', label: asset.title, ref: { asset_id: asset.asset_id, format: asset.format } });

    if (asset.industry) {
      const industryNode = `industry:${cleanIdPart(asset.industry)}`;
      addNode({ id: industryNode, type: 'industry', label: asset.industry });
      addEdge({ source: assetNode, target: industryNode, type: 'BELONGS_TO_INDUSTRY', weight: 1 });
    }
    if (asset.business_type) {
      const businessTypeNode = `business_type:${cleanIdPart(asset.business_type)}`;
      addNode({ id: businessTypeNode, type: 'business_type', label: asset.business_type });
      addEdge({ source: assetNode, target: businessTypeNode, type: 'BELONGS_TO_BUSINESS_TYPE', weight: 1 });
    }
  }

  for (const ev of input.evidence) {
    const evidenceNode = `evidence:${ev.evidence_id}`;
    const assetNode = `asset:${ev.asset_id}`;
    addNode({
      id: evidenceNode,
      type: 'evidence',
      label: `第${ev.slide_no}页${ev.title ? ` · ${ev.title}` : ''}`,
      ref: { evidence_id: ev.evidence_id, unit_id: ev.unit_id, slide_no: ev.slide_no },
    });
    addEdge({ source: assetNode, target: evidenceNode, type: 'HAS_EVIDENCE', evidence_id: ev.evidence_id, weight: 1 });

    if (ev.image_path) {
      const imageNode = `image:${ev.unit_id}`;
      addNode({ id: imageNode, type: 'image', label: `第${ev.slide_no}页图片`, ref: { image_path: ev.image_path } });
      addEdge({ source: evidenceNode, target: imageNode, type: 'HAS_IMAGE', evidence_id: ev.evidence_id, weight: 1 });
    }

    for (const [i, n] of (ev.numbers_with_units || []).slice(0, 5).entries()) {
      const label = [n.metric, n.value, n.unit].filter(Boolean).join(' ') || n.context || `关键数字 ${i + 1}`;
      const metricNode = `metric:${ev.unit_id}:${i}`;
      addNode({ id: metricNode, type: 'metric', label, ref: n as Record<string, unknown> });
      addEdge({ source: evidenceNode, target: metricNode, type: 'HAS_METRIC', evidence_id: ev.evidence_id, weight: 1 });
    }

    for (const [i, a] of (ev.architecture_nodes || []).slice(0, 8).entries()) {
      const label = a.name || a.source_text || `架构节点 ${i + 1}`;
      const archNode = `arch:${ev.unit_id}:${i}`;
      addNode({ id: archNode, type: 'architecture_node', label, ref: a as Record<string, unknown> });
      addEdge({ source: evidenceNode, target: archNode, type: 'HAS_ARCH_NODE', evidence_id: ev.evidence_id, weight: 1 });
    }
  }

  return { nodes: [...nodes.values()], edges: edges.slice(0, maxEdges) };
}
