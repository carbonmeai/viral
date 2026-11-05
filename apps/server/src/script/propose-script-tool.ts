import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import { z } from "zod"

export const PROPOSE_SCRIPT_TOOL = "mcp__viral__propose_script"

// In-process MCP server exposing the one tool the script agent uses to hand back
// its result. Input is validated again with the Script schema by the caller.
export const makeProposeScriptServer = (onSubmit: (input: unknown) => void) =>
  createSdkMcpServer({
    name: "viral",
    tools: [
      tool(
        "propose_script",
        "Submit the finished short script for human review.",
        { hook: z.string(), lines: z.array(z.string()) },
        async (args) => {
          onSubmit(args)
          return { content: [{ type: "text", text: "Script submitted for review." }] }
        }
      )
    ]
  })
