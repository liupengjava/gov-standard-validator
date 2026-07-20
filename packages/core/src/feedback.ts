import { randomUUID } from 'node:crypto';
import { db } from './db.ts';

// 使用反馈（PRD-0023）：全员可提交，管理员流转状态并手动飞书通知提出人。

export const FEEDBACK_TYPES = ['issue', 'feature', 'suggestion'] as const;
export const FEEDBACK_STATUSES = ['open', 'in_progress', 'done', 'wont_do'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackItem = {
  id: string;
  submitter_name: string;
  submitter_open_id: string | null;
  type: FeedbackType;
  title: string;
  content: string;
  images: string[];
  status: FeedbackStatus;
  admin_note: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
};

export const FEEDBACK_MAX_IMAGES = 3;

function rowToItem(r: any): FeedbackItem {
  let images: string[] = [];
  try { images = JSON.parse(r.images || '[]'); } catch { /* 脏数据按无图处理 */ }
  return { ...r, images };
}

export function createFeedback(input: {
  submitterName: string;
  submitterOpenId?: string | null;
  type: string;
  title: string;
  content: string;
  images?: string[];
}): string {
  const title = (input.title || '').trim();
  const content = (input.content || '').trim();
  if (!(FEEDBACK_TYPES as readonly string[]).includes(input.type)) throw new Error('反馈类型不合法');
  if (!title) throw new Error('标题不能为空');
  if (title.length > 50) throw new Error('标题不能超过 50 字');
  if (!content) throw new Error('详细描述不能为空');
  if (!input.submitterName) throw new Error('缺少提交人');
  const images = (input.images || []).slice(0, FEEDBACK_MAX_IMAGES);
  const id = randomUUID();
  db().prepare(
    `INSERT INTO feedback (id, submitter_name, submitter_open_id, type, title, content, images) VALUES (?,?,?,?,?,?,?)`
  ).run(id, input.submitterName, input.submitterOpenId ?? null, input.type, title, content, JSON.stringify(images));
  return id;
}

// status 额外支持 'active'（待解决+解决中，列表默认视图）。
export function listFeedback(filter: { submitterName?: string; status?: string; type?: string } = {}): FeedbackItem[] {
  const where: string[] = [];
  const values: any[] = [];
  if (filter.submitterName) { where.push('submitter_name=?'); values.push(filter.submitterName); }
  if (filter.status === 'active') { where.push(`status IN ('open','in_progress')`); }
  else if (filter.status && (FEEDBACK_STATUSES as readonly string[]).includes(filter.status)) { where.push('status=?'); values.push(filter.status); }
  if (filter.type && (FEEDBACK_TYPES as readonly string[]).includes(filter.type)) { where.push('type=?'); values.push(filter.type); }
  const sql = `SELECT * FROM feedback ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC`;
  const rows = db().prepare(sql).all(...values) as unknown as any[];
  return rows.map(rowToItem);
}

export function getFeedback(id: string): FeedbackItem | null {
  const row = db().prepare(`SELECT * FROM feedback WHERE id=?`).get(id) as any;
  return row ? rowToItem(row) : null;
}

export function updateFeedback(id: string, patch: { status?: string; adminNote?: string }): void {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.status !== undefined) {
    if (!(FEEDBACK_STATUSES as readonly string[]).includes(patch.status)) throw new Error('状态不合法');
    fields.push('status=?'); values.push(patch.status);
  }
  if (patch.adminNote !== undefined) { fields.push('admin_note=?'); values.push(patch.adminNote.trim() || null); }
  if (!fields.length) return;
  fields.push(`updated_at=datetime('now')`);
  values.push(id);
  db().prepare(`UPDATE feedback SET ${fields.join(', ')} WHERE id=?`).run(...values);
}

export function markFeedbackNotified(id: string): string {
  db().prepare(`UPDATE feedback SET notified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(id);
  return (db().prepare(`SELECT notified_at FROM feedback WHERE id=?`).get(id) as any)?.notified_at || '';
}

// 管理员计数条：全量四态计数，不受列表筛选影响。
export function feedbackStatusCounts(): Record<FeedbackStatus, number> {
  const rows = db().prepare(`SELECT status, COUNT(*) n FROM feedback GROUP BY status`).all() as unknown as { status: string; n: number }[];
  const counts: Record<FeedbackStatus, number> = { open: 0, in_progress: 0, done: 0, wont_do: 0 };
  for (const r of rows) if (r.status in counts) counts[r.status as FeedbackStatus] = r.n;
  return counts;
}
