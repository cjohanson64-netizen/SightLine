import type { ArtifactGraph, AssayMetric } from '../models/schema';
import { graftLeaf } from './graft';

export interface AssayArgs {
  parentId?: string;
  metric: AssayMetric;
}

export function assayMetric(graph: ArtifactGraph, args: AssayArgs): void {
  graftLeaf(graph, {
    parentId: args.parentId,
    id: `metric-${args.metric.name}`,
    label: `Metric: ${args.metric.name}`,
    data: {
      name: args.metric.name,
      value: args.metric.value
    },
    edgeKind: 'assay'
  });
}
