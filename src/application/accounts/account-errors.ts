export class AccountCommandError extends Error {
  constructor(
    public readonly code: string,
    public readonly messageKey: string,
  ) {
    super(messageKey);
    this.name = "AccountCommandError";
  }
}
