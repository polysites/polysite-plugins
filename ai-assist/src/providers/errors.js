// An error whose message is safe to show an editor.
export class ProviderError extends Error {
  constructor(message, { status = 502, cause } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.cause = cause;
  }
}
