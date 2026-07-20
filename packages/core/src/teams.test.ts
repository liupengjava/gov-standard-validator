import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const dir = mkdtempSync(resolve(tmpdir(), 'sp-teams-'));
process.env.SP_DATA_DIR = dir;
const { mapLarkUser, regionFromPath, dedupExclude, readTeamsForDisplay, TEAMS_FILE, SA_TEAM_LABEL } = await import('./teams.ts');

test('mapLarkUser 提取 openId/name/avatar/join/deptPath', () => {
  const raw = {
    open_id: 'ou_1', name: '张三', employee_no: '007',
    join_time: 1650000000, avatar: { avatar_240: 'https://x/240.jpg', avatar_72: 'https://x/72.jpg' },
    department_path: [{ department_name: { name: '政企部' } }, { department_name: { name: '销售部' }, department_path: { department_path_name: { name: '政企部-销售部-华东大区' } } }],
  };
  const m = mapLarkUser(raw, '销售团队');
  assert.equal(m.openId, 'ou_1');
  assert.equal(m.name, '张三');
  assert.equal(m.team, '销售团队');
  assert.equal(m.joinTime, 1650000000);
  assert.equal(m.deptPath?.includes('销售部'), true);
});

test('regionFromPath 提取 X大区', () => {
  assert.equal(regionFromPath('政企部-销售部-华东大区'), '华东大区');
  assert.equal(regionFromPath('产品部-SA组'), undefined);
});

test('dedupExclude 去重并排除花名', () => {
  const list = [
    { openId: 'a', name: '天烬', team: '销售团队' },
    { openId: 'b', name: '张三', team: '销售团队' },
    { openId: 'b', name: '张三', team: '销售团队' },
    { openId: 'c', name: '苏叶', team: '解决方案团队' },
  ] as any;
  const out = dedupExclude(list, ['天烬']);
  assert.deepEqual(out.map((m: any) => m.openId).sort(), ['b', 'c']);
});

// 「团队评测」页只展示各业务方向（隐藏销售团队）。这个契约依赖 readTeamsForDisplay：
// 把解决方案团队成员按花名改名成业务方向，team 标为「业务方向汇总」，销售成员原样保留。
// 历史上 Next.js 重写曾误用 readTeams（原始数据），导致页面退回到「只有销售」，本测试守住该契约。
test('readTeamsForDisplay 把解决方案团队改成各业务方向、销售原样保留', () => {
  writeFileSync(TEAMS_FILE, JSON.stringify({
    syncedAt: '2026-06-28T00:00:00.000Z',
    members: [
      { openId: 'ou_sa1', name: '临风', team: '解决方案团队' },
      { openId: 'ou_sa2', name: '思政', team: '解决方案团队' },
      { openId: 'ou_sa3', name: '苏叶', team: '解决方案团队' },
      { openId: 'ou_sa4', name: '星遥', team: '解决方案团队' },
      { openId: 'ou_sales1', name: '龙生', team: '销售团队' },
    ],
  }));
  const display = readTeamsForDisplay();
  const directions = display.members.filter((m) => m.team === SA_TEAM_LABEL);
  // 4 个解决方案成员都进入「业务方向汇总」，且各自改名为业务方向
  assert.deepEqual(
    directions.map((m) => m.name).sort(),
    ['公安&运营商内部方向', '金融方向', '私域方向', '运营商政企部方向'].sort(),
  );
  // openId 不变（成员问答/评测仍按人定位）
  assert.equal(directions.find((m) => m.openId === 'ou_sa1')?.name, '金融方向');
  // 销售成员原样保留（名字与 team 都不被改写）
  const sales = display.members.find((m) => m.openId === 'ou_sales1');
  assert.equal(sales?.name, '龙生');
  assert.equal(sales?.team, '销售团队');
});

after(() => rmSync(dir, { recursive: true, force: true }));
