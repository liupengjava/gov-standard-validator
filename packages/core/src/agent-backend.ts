import { spawn } from 'node:child_process';
import { ROOT } from './config.ts';
import { AppServerSession } from './codex-appserver.ts';

// ── 多模型 AI 后端抽象层（ADR：见 docs/superpowers/specs/2026-07-05-multi-model-ai-backend-design.md）──
// 两个后端各自把「本机 Agent CLI」的事件流归一化成同一套回调，供 ask-stream 编排复用：
//   · opus → 本机 claude CLI（--model opus，stream-json 逐 token）
//   · gpt  → 本机 codex CLI（codex exec --json，直连 model.indata.cc，按 item 推送）
// 会话/artifact/引用/SSE 的编排在 route.ts，与后端解耦——后端只吐 thinking/answer/tool/toolResult。

export type ModelChoice = 'gpt' | 'opus';

/** 归一化事件回调：两个后端把各自 CLI 事件映射到这里。 */
export interface TurnCallbacks {
  thinking(delta: string): void;
  answer(delta: string): void;
  tool(name: string, status: string): void;
  /** 工具返回文本，供上层解析引用（parseCitations 复用同一套 [E01]《标题》第N页 格式）。 */
  toolResult(toolName: string, text: string): void;
  /** 把「刚流出的正文」整段转移进思考面板。GPT 在工具调用之间的中文过渡语（"我先去检索…"）
   * 属于过程叙述而非结论——工具一启动即知上一段是过渡语，搬进思考区，保持正文只留最终答案。 */
  answerToThinking?(): void;
}

export interface RunTurnOpts {
  runDir: string;
  /** claude：预生成的 uuid（首轮 --session-id、续接 -r）；codex：续接时传入上轮返回的 thread_id。 */
  sessionId: string;
  isFirst: boolean;
  prompt: string;
  /** 已合成的系统提示词（含全局记忆）。claude 走 --append-system-prompt；codex 写入 runDir/AGENTS.md。 */
  systemPrompt: string;
  /** salespilot-knowledge MCP 启动方式，两后端各自转成对应参数。 */
  mcp: { command: string; args: string[] };
  cb: TurnCallbacks;
}

export interface RunTurnResult {
  code: number;
  gotResult: boolean;
  stderr: string;
  /** 实际会话 id：claude 恒等于传入 sessionId；codex 首轮返回其自身生成的 thread_id。 */
  sessionId: string;
}

export interface AgentBackend {
  runTurn(opts: RunTurnOpts): Promise<RunTurnResult>;
}

/** 工具名 → 前端状态文案（两后端共用）。 */
function toolStatus(name: string): string {
  return /knowledge/.test(name) ? '检索知识库…'
    : /ppt|slide|presentation/i.test(name) ? '生成 PPT 中…'
    : /web|html|design/i.test(name) ? '生成网页中…'
    : /Write|Edit|Bash|shell|command|lark/i.test(name) ? '生成中…'
    : '调用工具…';
}

// ────────────────────────────── claude 后端（opus） ──────────────────────────────

const CLAUDE_TURN_TIMEOUT_MS = envMs('SP_CLAUDE_TURN_TIMEOUT_MS', 20 * 60 * 1000);
const CLAUDE_IDLE_TIMEOUT_MS = envMs('SP_CLAUDE_IDLE_TIMEOUT_MS', 5 * 60 * 1000);
const CLAUDE_KILL_GRACE_MS = envMs('SP_CLAUDE_KILL_GRACE_MS', 5000);
const CLAUDE_MAX_STDERR_CHARS = envMs('SP_CLAUDE_MAX_STDERR_CHARS', 8000);

function envMs(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function sec(ms: number): number {
  return Math.round(ms / 1000);
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return;
  try { process.kill(-pid, signal); return; } catch {}
  try { process.kill(pid, signal); } catch {}
}

const claudeBackend: AgentBackend = {
  runTurn(opts: RunTurnOpts): Promise<RunTurnResult> {
    return new Promise((resolveP) => {
      const mcpConfig = JSON.stringify({
        mcpServers: { 'salespilot-knowledge': { command: opts.mcp.command, args: opts.mcp.args } },
      });
      const args = [
        '-p', opts.prompt,
        '--output-format', 'stream-json',
        '--include-partial-messages',
        '--verbose',
        '--model', 'opus',
        '--permission-mode', 'bypassPermissions',
        '--add-dir', ROOT,
        '--mcp-config', mcpConfig,
        '--strict-mcp-config', // 只用上面内联的 knowledge MCP，不吃项目里任何 .mcp.json（避免同名双加载）
        '--append-system-prompt', opts.systemPrompt,
      ];
      args.push(opts.isFirst ? '--session-id' : '-r', opts.sessionId);

      // detached=true 让 claude 成为独立进程组组长；超时/空闲看门狗触发时可连同 MCP 子进程一起清理。
      const ch = spawn('claude', args, { cwd: opts.runDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      let buf = '', gotResult = false, err = '', lastTool = '', abortReason = '', settled = false;
      let lastActivityAt = Date.now();
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const touch = () => { lastActivityAt = Date.now(); };
      const appendErr = (s: string) => {
        err = (err + s).slice(-CLAUDE_MAX_STDERR_CHARS);
      };
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        if (turnTimer) clearTimeout(turnTimer);
        if (idleTimer) clearInterval(idleTimer);
        if (killTimer) clearTimeout(killTimer);
        resolveP({ code, gotResult, stderr: err, sessionId: opts.sessionId });
      };
      const abort = (reason: string) => {
        if (settled || abortReason) return;
        abortReason = reason;
        appendErr((err ? '\n' : '') + reason);
        opts.cb.thinking(`\n${reason}，我会终止当前 Opus 进程并交给上层重试策略处理。`);
        killProcessGroup(ch.pid, 'SIGTERM');
        killTimer = setTimeout(() => killProcessGroup(ch.pid, 'SIGKILL'), CLAUDE_KILL_GRACE_MS);
      };

      const turnTimer = CLAUDE_TURN_TIMEOUT_MS > 0
        ? setTimeout(() => abort(`Opus 生成超时（${sec(CLAUDE_TURN_TIMEOUT_MS)}s）`), CLAUDE_TURN_TIMEOUT_MS)
        : null;
      const idleCheckMs = CLAUDE_IDLE_TIMEOUT_MS > 0 ? Math.max(1000, Math.min(30000, Math.floor(CLAUDE_IDLE_TIMEOUT_MS / 3))) : 0;
      const idleTimer = idleCheckMs > 0
        ? setInterval(() => {
            const idleMs = Date.now() - lastActivityAt;
            if (idleMs >= CLAUDE_IDLE_TIMEOUT_MS) abort(`Opus 长时间无输出，疑似卡住（${sec(idleMs)}s 无 stdout/stderr 事件）`);
          }, idleCheckMs)
        : null;

      ch.stderr.on('data', (d) => { touch(); appendErr(String(d)); });
      ch.stdout.on('data', (d) => {
        touch();
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          let e: any;
          try { e = JSON.parse(line); } catch { continue; }
          touch();
          if (e.type === 'stream_event' && e.event?.type === 'content_block_delta') {
            const dl = e.event.delta;
            if (dl.type === 'thinking_delta' && dl.thinking) opts.cb.thinking(dl.thinking);
            else if (dl.type === 'text_delta' && dl.text) opts.cb.answer(dl.text);
          } else if (e.type === 'assistant' && Array.isArray(e?.message?.content)) {
            for (const b of e.message.content) {
              if (b.type === 'tool_use') {
                const n = String(b.name || '');
                lastTool = n;
                opts.cb.tool(n, toolStatus(n));
              }
            }
          } else if (e.type === 'user' && Array.isArray(e?.message?.content)) {
            for (const b of e.message.content) {
              if (b.type === 'tool_result') {
                const t = Array.isArray(b.content)
                  ? b.content.map((x: any) => x.text || '').join('')
                  : String(b.content || '');
                opts.cb.toolResult(lastTool, t);
              }
            }
          }
          if (e.type === 'result') gotResult = true;
        }
      });
      ch.on('error', (er) => { appendErr(String(er)); finish(-1); });
      ch.on('close', (code) => finish(abortReason ? -1 : (code ?? -1)));
    });
  },
};

// ────────── GPT-5.5 后端：codex app-server 常驻进程 + JSON-RPC，token 级流式 ──────────
// 一段对话（runDir）一个常驻进程，多轮复用同一 thread（跨进程 resume 接不上上下文）。
// 进程池挂 globalThis 存活 dev 热替换；空闲超时回收。详见 ./codex-appserver.ts。

const G = globalThis as any;
const POOL: Map<string, AppServerSession> = G.__SP_APPSERVER_POOL__ || (G.__SP_APPSERVER_POOL__ = new Map());
const IDLE_MS = 30 * 60 * 1000;

/** 该 runDir 是否还有活着的 codex 常驻会话。非首轮却不存活（进程重启/空闲回收）＝
 *  上下文已丢，上层据此决定注入历史回灌（PRD-0024 R2）。 */
export function hasLiveGptSession(runDir: string): boolean {
  const s = POOL.get(runDir);
  return !!(s && s.alive);
}

function reapIdle() {
  const now = Date.now();
  for (const [k, s] of POOL) {
    if (!s.alive || (s.lastUsedAt && now - s.lastUsedAt > IDLE_MS)) { s.close(); POOL.delete(k); }
  }
}

const gptBackend: AgentBackend = {
  async runTurn(opts: RunTurnOpts): Promise<RunTurnResult> {
    const key = process.env.INDATA_API_KEY || '';
    if (!key) {
      return { code: -1, gotResult: false, stderr: '缺少 INDATA_API_KEY（GPT-5.5 后端上游 key），请配置 apps/web/.env.local', sessionId: opts.sessionId };
    }
    reapIdle();
    // 首轮 or 进程已死：新建常驻会话；否则复用同 runDir 的进程接着多轮。
    let sess = POOL.get(opts.runDir);
    if (opts.isFirst || !sess || !sess.alive) {
      if (sess) sess.close();
      sess = new AppServerSession({ runDir: opts.runDir, systemPrompt: opts.systemPrompt, mcp: opts.mcp, apiKey: key });
      POOL.set(opts.runDir, sess);
    }
    try {
      const r = await sess.runTurn(opts.prompt, opts.cb, (opts as any).imagePath);
      return { code: r.gotResult ? 0 : -1, gotResult: r.gotResult, stderr: r.err, sessionId: sess.threadId || opts.sessionId };
    } catch (e) {
      return { code: -1, gotResult: false, stderr: String(e), sessionId: sess.threadId || opts.sessionId };
    }
  },
};

export function getBackend(model: ModelChoice): AgentBackend {
  return model === 'gpt' ? gptBackend : claudeBackend;
}
