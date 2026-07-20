import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type CodexCommand = {
  command: string;
  args: string[];
};

export function resolveCodexCommand(args: string[], env: NodeJS.ProcessEnv = process.env): CodexCommand {
  if (env.SP_CODEX_BIN) {
    return { command: env.SP_CODEX_BIN, args };
  }
  try {
    const bin = require.resolve('@openai/codex/bin/codex.js');
    return { command: process.execPath, args: [bin, ...args] };
  } catch {
    return { command: 'codex', args };
  }
}
