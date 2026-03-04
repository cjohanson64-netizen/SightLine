export class TatRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TatRuntimeError';
  }
}

export class TatProgramParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TatProgramParseError';
  }
}
