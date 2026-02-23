import { TatProgramParseError, TatRuntimeError } from './errors';
import { assertGraphInvariant, type ArtifactGraph, type GenerationInput } from '../models/schema';

export interface TatProgramStep {
  op: string;
  args?: Record<string, unknown>;
}

export interface TatProgram {
  name: string;
  steps: TatProgramStep[];
}

export interface TrellisContext {
  graph: ArtifactGraph;
  inputs: GenerationInput;
  state: Record<string, unknown>;
  logs: string[];
}

export type TatOp = (context: TrellisContext, args: Record<string, unknown>) => void;

export interface TrellisRegistry {
  get(opName: string): TatOp | undefined;
}

function parseProgram(raw: string): TatProgram {
  try {
    const parsed = JSON.parse(raw) as TatProgram;
    if (!parsed || typeof parsed.name !== 'string' || !Array.isArray(parsed.steps)) {
      throw new TatProgramParseError('Invalid program shape.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof TatProgramParseError) {
      throw error;
    }
    throw new TatProgramParseError(`Unable to parse TAT program: ${(error as Error).message}`);
  }
}

function resolveToken(token: string, context: TrellisContext): unknown {
  if (!token.startsWith('$')) {
    return token;
  }

  const path = token.slice(1).split('.');
  let cursor: unknown = context;

  for (const part of path) {
    if (cursor === null || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  return cursor;
}

function resolveArgs(value: unknown, context: TrellisContext): unknown {
  if (typeof value === 'string') {
    return resolveToken(value, context);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveArgs(item, context));
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = resolveArgs(item, context);
    }
    return output;
  }

  return value;
}

export function trellis(
  programSource: string,
  context: TrellisContext,
  registry: TrellisRegistry
): TrellisContext {
  const program = parseProgram(programSource);

  context.logs.push(`Running program: ${program.name}`);
  assertGraphInvariant(context.graph);

  for (const [index, step] of program.steps.entries()) {
    const op = registry.get(step.op);
    if (!op) {
      throw new TatRuntimeError(`Unknown op: ${step.op}`);
    }

    const args = (resolveArgs(step.args ?? {}, context) as Record<string, unknown>) ?? {};
    context.logs.push(`Step ${index + 1}/${program.steps.length}: ${step.op}`);
    op(context, args);
    assertGraphInvariant(context.graph);
  }

  return context;
}
