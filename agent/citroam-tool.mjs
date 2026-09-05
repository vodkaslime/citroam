import { existsSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

// This file is bundled as a Tauri resource outside the Harness workspace.
// Node does not search a pnpm workspace's hidden node_modules directory from
// this resource, and a desktop launch does not reliably inherit NODE_PATH.
// Rebuild Node's global lookup paths from the sidecar root before resolving the
// Harness package. The Rust bridge sets CITROAM_HARNESS_ROOT and also changes
// cwd, while the cwd fallback keeps this resource directly runnable in tests.
const harnessRoot = process.env.CITROAM_HARNESS_ROOT || process.cwd();
const workspaceNodeModules = join(harnessRoot, "node_modules/.pnpm/node_modules");
const regularNodeModules = join(harnessRoot, "node_modules");
const inheritedNodePaths = (process.env.NODE_PATH || "")
  .split(delimiter)
  .map((value) => value.trim())
  .filter(Boolean);
const nodePaths = [workspaceNodeModules, regularNodeModules, ...inheritedNodePaths]
  .filter((value, index, values) => values.indexOf(value) === index)
  .filter((value) => existsSync(value));
if (nodePaths.length > 0) {
  process.env.NODE_PATH = nodePaths.join(delimiter);
  // NODE_PATH is read during Node startup; refresh the CJS lookup list after
  // supplying the path for a process launched by Tauri/Finder.
  Module._initPaths();
}

const require = createRequire(join(harnessRoot, "package.json"));
const { defineTool } = await import(pathToFileURL(require.resolve("@deepseek-ai/dsh-tools")).href);

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
