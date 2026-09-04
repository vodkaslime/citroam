import { createRequire } from "node:module";

// This file is bundled as a Tauri resource outside the Harness workspace.
// Resolve the built Harness package from the sidecar's cwd/NODE_PATH instead
// of relying on ESM's package lookup relative to this resource directory.
const require = createRequire(`${process.cwd()}/package.json`);
const { defineTool } = await import(require.resolve("@deepseek-ai/dsh-tools"));

/**
 * The only model-facing capability citroam exposes to DeepSeek Harness.
 * It is intentionally a pure proposal tool: the desktop app validates the
 * returned intent and applies it through the local Workspace reducer.
 */
export const name = "citroam-workspace-tool";
export const inject = ["tools"];

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "citroam_apply",
    description: "Propose one structured Citroam workspace intent. This tool never edits files or makes network requests.",
    parameters: {
      intent: {
        type: "string",
        required: true,
        description: "A JSON-encoded AgentIntent. Do not include markdown or prose.",
      },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(args) {
      return args.intent;
    },
  }));
}
