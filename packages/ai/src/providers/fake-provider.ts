import type { AIProvider, AIRequest, AIResponse } from '../provider.js';

/** Explicit test double: no credentials, SDK, environment variables or network. */
export class FakeProvider implements AIProvider {
  readonly requests: AIRequest[] = [];
  constructor(private readonly respond: (request: AIRequest) => AIResponse | Promise<AIResponse>) {}
  async generate(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    return this.respond(request);
  }
}
