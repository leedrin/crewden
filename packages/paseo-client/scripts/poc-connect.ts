/**
 * Phase 0 Proof of Concept — Paseo Daemon Client Verification
 *
 * Usage:
 *   PASEO_DAEMON_URL=ws://127.0.0.1:6767 npx tsx scripts/poc-connect.ts
 *
 * Prerequisites:
 *   1. Paseo Daemon running locally (npm run dev in paseo repo)
 *   2. At least one provider available (claude, codex, or opencode)
 *
 * This script:
 *   1. Connects to Paseo Daemon via WebSocket
 *   2. Creates a test agent
 *   3. Sends "Hello, reply with exactly: PASEO_OK"
 *   4. Streams the response
 *   5. Deletes the agent
 *   6. Disconnects
 */

import { PaseoDaemonClient } from "../src/paseo-daemon-client.js";

const DAEMON_URL = process.env.PASEO_DAEMON_URL ?? "ws://127.0.0.1:6767";
const API_KEY = process.env.PASEO_API_KEY ?? "";
const TEST_CWD = process.env.PASEO_TEST_CWD ?? process.cwd();

async function main(): Promise<void> {
  console.log("=== Paseo Daemon Client PoC ===\n");
  console.log(`Daemon URL: ${DAEMON_URL}`);
  console.log(`Test CWD:   ${TEST_CWD}\n`);

  const client = new PaseoDaemonClient({
    daemonUrl: DAEMON_URL,
    apiKey: API_KEY,
    clientId: "crewden-poc",
    reconnect: { enabled: false },
  });

  // Monitor state changes
  client.onStateChange((state) => {
    console.log(`[state] ${state}`);
  });

  // Monitor agent updates
  client.onAgentUpdate((agentId, snapshot) => {
    console.log(`[agent-update] ${agentId}: lifecycle=${snapshot.lifecycle}`);
  });

  // Monitor stream events
  let streamText = "";
  client.onStreamEvent((agentId, event) => {
    if (event.text) {
      streamText += event.text;
      process.stdout.write(event.text);
    }
    if (event.type === "run_finished" || event.type === "result") {
      console.log(`\n[stream] Agent ${agentId} finished`);
    }
    if (event.toolCall) {
      console.log(`\n[stream] Tool call: ${event.toolCall.name}`);
    }
  });

  try {
    // Step 1: Connect
    console.log("--- Step 1: Connecting ---");
    await client.connect();
    console.log("Connected!\n");

    // Step 2: Create agent
    console.log("--- Step 2: Creating agent ---");
    const handle = await client.createAgent({
      provider: "claude",
      cwd: TEST_CWD,
      systemPrompt: "You are a test agent. Reply concisely.",
      initialPrompt: "Hello, reply with exactly: PASEO_OK",
      labels: {
        source: "crewden-poc",
        test: "phase0",
      },
    });
    console.log(`Agent created: ${handle.paseoAgentId}`);
    console.log(`  lifecycle: ${handle.snapshot.lifecycle}`);
    console.log(`  provider:  ${handle.snapshot.provider}\n`);

    // Step 3: Wait for response (stream events arrive via callback)
    console.log("--- Step 3: Streaming response ---");
    await new Promise((resolve) => setTimeout(resolve, 30000));
    console.log(`\nAccumulated response: ${streamText.slice(0, 200)}\n`);

    // Step 4: Cleanup
    console.log("--- Step 4: Deleting agent ---");
    await client.deleteAgent(handle.paseoAgentId);
    console.log("Agent deleted.\n");

    // Step 5: Disconnect
    console.log("--- Step 5: Disconnecting ---");
    await client.disconnect();
    console.log("Disconnected.\n");

    console.log("=== PoC PASSED ===");
  } catch (err) {
    console.error("\n=== PoC FAILED ===");
    console.error(err);
    await client.disconnect().catch(() => {});
    process.exit(1);
  }
}

main();
