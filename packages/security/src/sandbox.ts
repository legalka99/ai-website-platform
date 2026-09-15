export interface SandboxLimits { cpuMs: number; memoryMb: number; timeoutMs: number; maxProcesses: number }
export interface SandboxRequest { projectId: string; code: string; limits: SandboxLimits }
export interface SandboxRunner { run(request: SandboxRequest): Promise<{ executed: false; reason: string } | { executed: true; output: string }> }
export const SANDBOX_REQUIREMENTS = Object.freeze({ isolatedFilesystem: true, secrets: false, internalNetwork: false, network: false, requireResourceLimits: true });
/** Fail closed until an independently isolated runtime exists. Never eval/exec/spawn model output. */
export class DisabledSandboxRunner implements SandboxRunner {
  async run(_request: SandboxRequest): Promise<{ executed: false; reason: string }> { return { executed: false, reason: 'EXECUTION_DISABLED' }; }
}
