import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TurnCallbacks } from './agent-backend.ts';
import { resolveCodexCommand } from './codex-bin.ts';

// ── GPT-5.5 后端：驱动 codex app-server（JSON-RPC over stdio）实现 token 级流式 ──
// 关键：codex `exec --json` 只按 item 整段推送、给不了流式；而 `codex app-server` 默认
// 就推 item/agentMessage/delta（正文逐字）、item/reasoning/*Delta（思考逐字）——只要不
// 退订这些通知即可拿到。进程需常驻（跨进程 thread/resume 接不上上下文），一段对话一个
// 常驻进程，多轮 turn/start 复用同一 thread。参考实现：github.com/chenhg5/cc-connect。

const INDATA_BASE_URL = process.env.INDATA_BASE_URL || 'https://model.indata.cc/v1';
// 启动握手（spawn→initialize→thread/start）超时：app-server 起来后不回 initialize（多为其自挂的
// MCP 卡在 FTS/DB 初始化），或进程启动中途死亡，都要在此兜底，避免 doStart 永久挂起把整段对话锁死。
const START_TIMEOUT_MS = Number(process.env.SP_CODEX_START_TIMEOUT_MS) || 45000;
// 单个 turn 兜底超时：上游 hang / MCP 工具卡住时释放 route，避免前端永久「思考中」。
// 默认 900s：deep 检索 + Word/PPT/网页生成会进入较长 commandExecution，360s 容易误截断；
// 有心跳兜底「慢但活着」可见，放宽更稳。可用
// SP_CODEX_TURN_TIMEOUT_MS 覆盖（纯问答可调小、重生成可调大）。
const TURN_TIMEOUT_MS = Number(process.env.SP_CODEX_TURN_TIMEOUT_MS) || 900000;
// 空闲看门狗：总超时可能为了重型网页/PPT 生成被调大，但如果 turn 长时间没有任何 stdout/stderr/
// agent delta/工具事件，就应视为 app-server 或上游卡住，及时释放并触发重试。
const IDLE_TIMEOUT_MS = Number(process.env.SP_CODEX_IDLE_TIMEOUT_MS) || 180000;
const KILL_GRACE_MS = Number(process.env.SP_CODEX_KILL_GRACE_MS) || 5000;
const CODEX_REASONING_EFFORT = process.env.SP_CODEX_REASONING_EFFORT || 'medium';
const PROGRESS_IDLE_TIMEOUT_MS = Number(process.env.SP_CODEX_PROGRESS_IDLE_TIMEOUT_MS) || 180000;
const COMMAND_PROGRESS_IDLE_TIMEOUT_MS = Number(process.env.SP_CODEX_COMMAND_PROGRESS_IDLE_TIMEOUT_MS) || 900000;

function toolStatus(name: string): string {
  return /knowledge/.test(name) ? '检索知识库…'
    : /ppt|slide|presentation/i.test(name) ? '生成 PPT 中…'
    : /web|html|design/i.test(name) ? '生成网页中…'
    : /Write|Edit|Bash|shell|command|exec|lark/i.test(name) ? '生成中…'
    : '调用工具…';
}

type TurnState = {
  cb: TurnCallbacks;
  resolve: (r: { gotResult: boolean; err: string }) => void;
  turnId: string;
  started: boolean;   // 收到本 turn 的 turn/started，才允许用 idle 兜底收尾（防跨 turn 竞态）
  gotResult: boolean;
  err: string;
  lastActivityAt: number;
  lastProgressAt: number;
  activeToolType?: string;
  activeToolName?: string;
  activeToolStartedAt?: number;
};

function sec(ms: number): number {
  return Math.round(ms / 1000);
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return;
  try { process.kill(-pid, signal); return; } catch {}
  try { process.kill(pid, signal); } catch {}
}

/** 一段对话对应一个常驻 codex app-server 进程；串行跑 turn，逐字流式映射到回调。 */
export class AppServerSession {
  private ch: ChildProcess | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: any) => void; timer?: ReturnType<typeof setTimeout> }>();
  private turn: TurnState | null = null;
  private stderr = '';
  private starting: Promise<void> | null = null;
  threadId = '';
  lastUsedAt = 0;

  constructor(
    private opts: {
      runDir: string;
      systemPrompt: string;
      mcp: { command: string; args: string[] };
      apiKey: string;
    },
  ) {}

  get alive(): boolean {
    return !!this.ch && this.ch.exitCode === null && !this.ch.killed;
  }

  private send(o: any) { try { this.ch?.stdin?.write(JSON.stringify(o) + '\n'); } catch {} }
  /** 发一个 JSON-RPC 请求；timeoutMs>0 时到点 reject（防止响应永不到达把上层挂死）。 */
  private request(method: string, params: any, timeoutMs = 0): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: { resolve: (r: any) => void; reject: (e: any) => void; timer?: ReturnType<typeof setTimeout> } = { resolve, reject };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          if (this.pending.delete(id)) reject(new Error(`${method} 超时(${Math.round(timeoutMs / 1000)}s)：` + (this.stderr.slice(-200) || '无 stderr')));
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  /** 进程死亡时把所有在途请求一并 reject，解开正等着响应的 doStart/turn，避免永久挂起。 */
  private failAllPending(err: string) {
    for (const [, p] of this.pending) { if (p.timer) clearTimeout(p.timer); try { p.reject(new Error(err)); } catch {} }
    this.pending.clear();
  }
  private notify(method: string, params: any) { this.send({ jsonrpc: '2.0', method, params }); }

  /** 启动进程 + initialize + thread/start；幂等（并发只启动一次）。 */
  ensureStarted(): Promise<void> {
    if (this.alive && this.threadId) return Promise.resolve();
    if (this.starting) return this.starting;
    // 启动失败（超时/进程死亡）：清缓存 + 杀掉可能半死的进程，让进程池下轮重建，不缓存坏 promise。
    this.starting = this.doStart().catch((e) => { this.starting = null; this.close(); throw e; });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    // 系统提示词：app-server 无直接入口，写入 runDir/AGENTS.md，codex 从 cwd 自动读取。
    // 追加 GPT 专属强化：思考摘要中文 + 快慢路径分流（避免普通问答被拖进 deep + 多工具循环）。
    const gptExtra = [
      '',
      '【GPT 专属强化】',
      '1. 你的内部思考/推理摘要(reasoning summary)也必须用简体中文书写，禁止英文思考。',
      '2. 普通业务问答优先 ask_knowledge（brief/standard，include_images=false）快速回答；',
      '   不要默认 get_fact_pack(deep)，也不要对同一问题反复 search_knowledge/get_unit。',
      '3. 只有用户明确要求详细/完整/所有/拜访准备/方案材料/带图/PPT/网页/Word 时，',
      '   优先使用 get_material_pack，一次取得章节结构、压缩证据、引用和图片候选。',
      '4. 需要补多份资产或多页证据时，必须用 read_evidence_batch 一次批量读取，禁止连续循环 read_asset/get_unit。',
      '5. 材料生成任务知识工具预算最多 4 次；拿到 get_material_pack 后直接写作/生成文件，不要继续反复检索。',
      '6. 答案要可直接使用：直接结论 → 关键要点 → 来源页码；证据不足就说明缺口。',
    ].join('\n');
    try { writeFileSync(resolve(this.opts.runDir, 'AGENTS.md'), this.opts.systemPrompt + '\n' + gptExtra); } catch {}

    const args = [
      'app-server',
      '-c', `model="gpt-5.5"`,
      '-c', `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
      '-c', `model_reasoning_summary="auto"`,
      '-c', `model_provider="indata"`,
      '-c', `model_providers.indata.name="Indata"`,
      '-c', `model_providers.indata.base_url="${INDATA_BASE_URL}"`,
      '-c', `model_providers.indata.wire_api="responses"`,
      '-c', `model_providers.indata.env_key="INDATA_API_KEY"`,
      '-c', `model_providers.indata.requires_openai_auth=false`,
      '-c', `disable_response_storage=true`,
      '-c', `mcp_servers.salespilot-knowledge.command="${this.opts.mcp.command}"`,
      '-c', `mcp_servers.salespilot-knowledge.args=${JSON.stringify(this.opts.mcp.args)}`,
    ];
    const cmd = resolveCodexCommand(args);
    const ch = spawn(cmd.command, cmd.args, {
      cwd: this.opts.runDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, INDATA_API_KEY: this.opts.apiKey },
      detached: true,
    });
    this.ch = ch;
    ch.stderr?.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); this.touchTurn(); });
    ch.stdout?.on('data', (d) => this.onData(String(d)));
    // 进程退出/spawn 失败：结束在途 turn，并 reject 所有在途请求（否则等着 initialize 响应的
    // doStart 会永久挂起）；清 starting 缓存，让下轮 ensureStarted 重建。
    const onDead = (err: string) => {
      this.starting = null;
      this.turn?.resolve({ gotResult: false, err });
      this.turn = null;
      this.failAllPending(err);
    };
    ch.on('close', (code) => onDead(this.stderr || `app-server 进程退出(code=${code})`));
    ch.on('error', (e) => onDead('app-server 启动失败：' + String(e)));

    await this.request('initialize', {
      clientInfo: { name: 'salespilot', title: 'SalesPilot', version: '0.1.0' },
      capabilities: { experimentalApi: true }, // 不填 optOutNotificationMethods = 不退订 delta，拿逐字流
    }, START_TIMEOUT_MS);
    this.notify('initialized', {});
    // yolo：approval=never + sandbox=danger-full-access（用户要求全程最大权限不沙箱）
    const resp = await this.request('thread/start', {
      persistExtendedHistory: false,
      model: 'gpt-5.5',
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    }, START_TIMEOUT_MS);
    this.threadId = resp?.thread?.id || '';
    if (!this.threadId) throw new Error('app-server thread/start 未返回 threadId');
  }

  private onData(chunk: string) {
    this.touchTurn();
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && m.method === undefined) {
        const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); if (p.timer) clearTimeout(p.timer); p.resolve(m.result); }
      } else if (m.id !== undefined && m.method) {
        this.handleServerRequest(m); // 审批类请求 → 一律自动允许
      } else if (m.method) {
        this.handleNotification(m.method, m.params || {});
      }
    }
  }

  /** 服务端审批请求：max 权限下一律 accept，避免挂起。 */
  private handleServerRequest(m: any) {
    let result: any;
    if (m.method === 'item/permissions/requestApproval') result = { permissions: m.params?.permissions || {}, scope: 'turn' };
    else if (m.method === 'item/tool/requestUserInput') result = { answers: {} };
    else if (m.method === 'item/tool/call') result = { success: false, contentItems: [{ type: 'inputText', text: 'tool not available' }] };
    else result = { decision: 'accept' };
    this.send({ jsonrpc: '2.0', id: m.id, result });
  }

  private finishTurn(gotResult: boolean, err: string) {
    const t = this.turn;
    if (!t) return;
    this.turn = null;
    t.resolve({ gotResult: gotResult || t.gotResult, err: err || t.err });
  }

  private touchTurn(progress = false) {
    if (this.turn) {
      this.turn.lastActivityAt = Date.now();
      if (progress) this.turn.lastProgressAt = Date.now();
    }
  }

  private startActiveTool(type: string, name: string) {
    if (!this.turn) return;
    this.turn.activeToolType = type;
    this.turn.activeToolName = name;
    this.turn.activeToolStartedAt = Date.now();
  }

  private completeActiveTool(type: string) {
    if (!this.turn) return;
    if (!this.turn.activeToolType || this.turn.activeToolType === type) {
      this.turn.activeToolType = undefined;
      this.turn.activeToolName = undefined;
      this.turn.activeToolStartedAt = undefined;
    }
    this.touchTurn(true);
  }

  private handleNotification(method: string, params: any) {
    const t = this.turn;
    if (t) t.lastActivityAt = Date.now();
    switch (method) {
      case 'turn/started':
        if (t) t.started = true;
        break;
      case 'item/agentMessage/delta':
        if (t) t.cb.answer(String(params.delta ?? params.text ?? ''));
        this.touchTurn(true);
        break;
      // reasoning summary 由上游模型内部生成、恒为英文且提示词管不住——直接丢弃。
      // 中文思考过程改用工具调用间的 agentMessage 过渡语（见 onItemStarted 的 answerToThinking）。
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        break;
      case 'item/started': this.onItemStarted(params.item); break;
      case 'item/completed': this.onItemCompleted(params.item); break;
      case 'turn/completed':
        if (t) { t.gotResult = true; this.finishTurn(true, ''); }
        break;
      case 'thread/status/changed':
        // 本 codex 版不发 turn/completed，用 thread 转 idle 作为 turn 正常结束信号（视为成功）。
        // 仅在本 turn 已 started 时才认，避免上一 turn 的 idle 误收本 turn。
        if (t && t.started && params?.status?.type === 'idle') this.finishTurn(true, '');
        break;
      case 'error':
        if (t && String(params?.message || '').trim()) { t.err = String(params.message); this.finishTurn(false, t.err); }
        break;
    }
  }

  private onItemStarted(item: any) {
    if (!this.turn || !item?.type) return;
    const isTool = item.type === 'mcpToolCall' || item.type === 'commandExecution' || item.type === 'webSearch';
    // 工具启动 = 刚才那段 agentMessage 是过渡语（"我先去检索…"）而非结论 → 搬进思考面板
    if (isTool) this.turn.cb.answerToThinking?.();
    if (item.type === 'mcpToolCall') {
      const name = String(item.tool || item.server || 'tool');
      this.startActiveTool(item.type, name);
      this.touchTurn(true);
      this.turn.cb.tool(name, toolStatus(String(item.tool || '')));
    } else if (item.type === 'commandExecution') {
      this.startActiveTool(item.type, 'command');
      this.touchTurn(true);
      this.turn.cb.tool('command', toolStatus('command'));
    } else if (item.type === 'webSearch') {
      this.startActiveTool(item.type, 'web');
      this.touchTurn(true);
      this.turn.cb.tool('web', '联网检索…');
    }
  }

  private onItemCompleted(item: any) {
    if (!this.turn || !item?.type) return;
    if (item.type === 'agentMessage') {
      this.touchTurn(true);
      this.turn.cb.answer('\n\n'); // 段间分隔；若为末段，多余空行由渲染端 trim 吸收
    } else if (item.type === 'mcpToolCall') {
      const parts = Array.isArray(item.result?.content) ? item.result.content : [];
      const text = parts.map((p: any) => p.text || '').join('') || (typeof item.result === 'string' ? item.result : '');
      if (text) { this.touchTurn(true); this.turn.cb.toolResult(String(item.tool || ''), text); }
      this.completeActiveTool(item.type);
    } else if (item.type === 'commandExecution' || item.type === 'webSearch') {
      this.completeActiveTool(item.type);
    }
  }

  /** 跑一个 turn；串行（上一 turn 未结束会等待）。imagePath 可选（贴图）。 */
  async runTurn(prompt: string, cb: TurnCallbacks, imagePath?: string): Promise<{ gotResult: boolean; err: string }> {
    await this.ensureStarted();
    this.lastUsedAt = Date.now();
    const input: any[] = [{ type: 'text', text: prompt, text_elements: [] }];
    if (imagePath) input.push({ type: 'localImage', path: imagePath });

    return new Promise(async (resolve) => {
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;
      const done = (r: { gotResult: boolean; err: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (idleTimer) clearInterval(idleTimer);
        if (killTimer) clearTimeout(killTimer);
        resolve(r);
      };
      const abortTurn = (err: string) => {
        const t = this.turn;
        this.turn = null;
        try { cb.thinking(`\n${err}，我会终止当前 GPT/Codex 进程并交给上层重试策略处理。`); } catch {}
        killProcessGroup(this.ch?.pid, 'SIGTERM');
        killTimer = setTimeout(() => killProcessGroup(this.ch?.pid, 'SIGKILL'), KILL_GRACE_MS);
        done({ gotResult: t?.gotResult || false, err: t?.err || err });
      };
      // 兜底超时：turn 迟迟不收尾（上游 hang）时释放，避免 route 卡死。
      const timer = setTimeout(() => abortTurn(`GPT 生成超时（${sec(TURN_TIMEOUT_MS)}s）`), TURN_TIMEOUT_MS);
      const idleCheckMs = IDLE_TIMEOUT_MS > 0 ? Math.max(1000, Math.min(30000, Math.floor(IDLE_TIMEOUT_MS / 3))) : 0;
      const idleTimer = idleCheckMs > 0
        ? setInterval(() => {
            const t = this.turn;
            if (!t) return;
            if (t.activeToolType === 'commandExecution') {
              const activeMs = Date.now() - (t.activeToolStartedAt || t.lastProgressAt);
              if (COMMAND_PROGRESS_IDLE_TIMEOUT_MS > 0 && activeMs >= COMMAND_PROGRESS_IDLE_TIMEOUT_MS) {
                abortTurn(`GPT 命令执行超时，疑似卡住（${sec(activeMs)}s 工具 command 未完成）`);
              }
              return;
            }
            const idleMs = Date.now() - t.lastActivityAt;
            if (idleMs >= IDLE_TIMEOUT_MS) abortTurn(`GPT 长时间无输出，疑似卡住（${sec(idleMs)}s 无事件）`);
            const progressIdleMs = Date.now() - t.lastProgressAt;
            if (PROGRESS_IDLE_TIMEOUT_MS > 0 && progressIdleMs >= PROGRESS_IDLE_TIMEOUT_MS) abortTurn(`GPT 长时间无有效进展，疑似卡住（${sec(progressIdleMs)}s 无正文/工具/文件进展）`);
          }, idleCheckMs)
        : null;
      this.turn = { cb, resolve: done, turnId: '', started: false, gotResult: false, err: '', lastActivityAt: Date.now(), lastProgressAt: Date.now() };
      try {
        const resp = await this.request('turn/start', {
          threadId: this.threadId, input, model: 'gpt-5.5', effort: CODEX_REASONING_EFFORT, approvalPolicy: 'never',
        }, START_TIMEOUT_MS);
        if (this.turn) this.turn.turnId = resp?.turn?.id || '';
        if (!resp?.turn?.id) this.finishTurn(false, 'turn/start 未返回 turnId：' + (this.stderr.slice(-200) || ''));
      } catch (e) {
        this.finishTurn(false, String(e));
      }
    });
  }

  close() {
    killProcessGroup(this.ch?.pid, 'SIGKILL');
    this.ch = null;
    this.threadId = '';
  }
}
