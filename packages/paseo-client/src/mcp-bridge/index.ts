import { CrewdenMcpServer } from "./server.js";
import { CrewdenInternalClient } from "./tools.js";

type CliArgs = {
  agentId: string;
  serverUrl: string;
  authToken: string;
};

function parseArgs(argv: string[]): CliArgs {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key || !key.startsWith("--")) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    values[key.slice(2)] = value;
    i += 1;
  }

  const agentId = values["agent-id"];
  const serverUrl = values["server-url"];
  const authToken = values["auth-token"];

  if (!agentId || !serverUrl || !authToken) {
    throw new Error("Usage: node index.js --agent-id <id> --server-url <url> --auth-token <token>");
  }

  return { agentId, serverUrl, authToken };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const client = new CrewdenInternalClient({
    agentId: args.agentId,
    baseUrl: args.serverUrl,
    authToken: args.authToken,
  });
  const server = new CrewdenMcpServer(client);
  server.start();
}

try {
  main();
} catch (error) {
  console.error("[crewden-mcp] failed to start", error);
  process.exit(1);
}
