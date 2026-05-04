import type { RuntimeId } from "@crewden/shared";

export function mapRuntimeToProvider(runtime: RuntimeId): string {
  switch (runtime) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "opencode":
      return "opencode";
    case "pi":
      return "pi";
    case "gemini":
      throw new Error(
        "Gemini runtime is not supported in Paseo mode. Use local daemon mode instead.",
      );
  }
}

export function supportsRuntime(runtime: RuntimeId): boolean {
  return runtime === "claude" || runtime === "codex" || runtime === "opencode" || runtime === "pi";
}
