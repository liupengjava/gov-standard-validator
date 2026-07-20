import { db } from './db.ts';
import { runLarkJson, LARK_ENV } from './feishu.ts';
import type { FeedbackItem, FeedbackStatus } from './feedback.ts';

// 反馈处理结果的飞书卡片推送（PRD-0023）。
// 登录应用（cli_aab7e0bce538dbc0）与 lark-cli 运维应用（cli_a941fd0dc7795bb3）的
// open_id 不互通，session 里的 openId 不能直接用来发消息——统一按花名经 lark-cli
// 通讯录解析出运维应用侧 open_id，结果缓存在 lark_user_cache 表。

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: '待解决',
  in_progress: '解决中',
  done: '已完成',
  wont_do: '暂不处理',
};

const PUBLIC_URL = () => process.env.SP_PUBLIC_URL || 'http://spagent.indata.cc:5173/sp';
const LARK_OPTS = { maxBuffer: 4 * 1024 * 1024, timeout: 30000, env: LARK_ENV };

export async function resolveLarkOpenId(name: string): Promise<string> {
  if (!name || name === 'dev-local') throw new Error(`提交人「${name || '（空）'}」不是有效花名，无法推送`);
  const cached = db().prepare(`SELECT open_id FROM lark_user_cache WHERE name=?`).get(name) as any;
  if (cached?.open_id) return cached.open_id;

  const r = await runLarkJson(['contact', '+search-user', '--query', name, '--as', 'user', '--json'], LARK_OPTS);
  if (!r?.ok) throw new Error(`通讯录查询失败：${r?.error?.message || '未知错误'}`);
  const users = (r?.data?.users || []).filter(
    (u: any) => u.localized_name === name && !u.is_cross_tenant
  );
  if (users.length === 0) throw new Error(`通讯录未找到花名「${name}」，请人工联系提出人`);
  if (users.length > 1) throw new Error(`通讯录中「${name}」有 ${users.length} 个同名用户，无法自动确定收件人`);

  const openId = users[0].open_id as string;
  db().prepare(`INSERT OR REPLACE INTO lark_user_cache (name, open_id, updated_at) VALUES (?,?,datetime('now'))`).run(name, openId);
  return openId;
}

function buildCard(fb: FeedbackItem): string {
  const fields = (pairs: [string, string][]) => ({
    tag: 'div',
    fields: pairs.map(([k, v]) => ({
      is_short: false,
      text: { tag: 'lark_md', content: `**${k}**　${v}` },
    })),
  });
  const rows: [string, string][] = [
    ['反馈标题', fb.title],
    ['当前状态', STATUS_LABELS[fb.status] || fb.status],
  ];
  if (fb.admin_note) rows.push(['处理说明', fb.admin_note]);
  rows.push(['提交时间', fb.created_at]);
  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: { template: 'blue', title: { tag: 'plain_text', content: '📬 你的反馈有新进展' } },
    elements: [
      fields(rows),
      { tag: 'hr' },
      {
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '前往 SalesPilot 查看' },
          url: PUBLIC_URL(),
          type: 'default',
        }],
      },
    ],
  });
}

/** 给反馈提出人单发卡片。优先以应用机器人身份发（收到的是"SalesPilot 机器人"），
 *  机器人不可用（未开消息权限/不在可用范围）时回退用户身份发。 */
export async function sendFeedbackCard(fb: FeedbackItem): Promise<void> {
  const openId = await resolveLarkOpenId(fb.submitter_name);
  const card = buildCard(fb);
  const send = (as: 'bot' | 'user') => runLarkJson(
    ['im', '+messages-send', '--user-id', openId, '--msg-type', 'interactive', '--content', card, '--as', as, '--json'],
    LARK_OPTS
  );
  let r = await send('bot');
  if (!r?.ok) {
    const botErr = r?.error?.message || '未知错误';
    r = await send('user');
    if (!r?.ok) throw new Error(`飞书发送失败（机器人：${botErr}；用户身份：${r?.error?.message || '未知错误'}）`);
  }
}
