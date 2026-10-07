/** Only explicitly safe errors may be sent to an MCP client. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
