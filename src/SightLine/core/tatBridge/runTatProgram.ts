import { tokenize } from '@tat/lexer/tokenize';
import { parse } from '@tat/parser/parse';
import {
  executeProgram,
  type ExecuteProgramResult,
  type RuntimeState
} from '@tat/runtime/executeProgram';
import { validateProgram, type ValidationIssue } from '@tat/runtime/validateProgram';

export interface RunTatProgramInput {
  program: string;
  initialState?: Partial<RuntimeState>;
}

export interface RunTatProgramResult {
  execution: ExecuteProgramResult;
  validation: ValidationIssue[];
}

export function runTatProgram(input: RunTatProgramInput): RunTatProgramResult {
  const tokens = tokenize(input.program);
  const ast = parse(tokens);
  const validation = validateProgram(ast);
  const errors = validation.filter((issue) => issue.severity === 'error');

  if (errors.length > 0) {
    const message = errors
      .map((issue) =>
        issue.span?.line && issue.span?.column
          ? `${issue.message} at ${issue.span.line}:${issue.span.column}`
          : issue.message
      )
      .join('\n');
    throw new Error(`TAT validation failed:\n${message}`);
  }

  return {
    execution: executeProgram(ast, { initialState: input.initialState }),
    validation
  };
}
