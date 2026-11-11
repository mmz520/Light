/**
 * 工程数据版本迁移链
 *
 * 老工程 metadata.json 缺字段 / 旧结构，加载时按 version 逐级升到 PROJECT_VERSION。
 * 规则：
 *   - 每个版本一条迁移，run() 直接改写宽松类型 meta（不做完整校验，坏字段交给 loadProject 的兜底）；
 *   - 迁移必须幂等（重复执行结果一致），因为同版本号可能被手改；
 *   - 新增结构变更时：PROJECT_VERSION +1，在 MIGRATIONS 末尾追加一条，不动旧条目。
 */
import { PROJECT_VERSION, type ProjectMetaFile } from './types';

/** 磁盘上的宽松形状：老文件可能缺任意字段 */
export type LooseMeta = Partial<ProjectMetaFile> & { version?: number };

export interface Migration {
  /** 迁移完成后的版本号 */
  to: number;
  note: string;
  run: (meta: LooseMeta) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    to: 2,
    note: '状态机条件统一为「变量比较」结构；角色补 controllerIds 数组',
    run: (meta) => {
      // 1) 老条件（flag / input / group）→ var 条件；具体转换在 statemachine.ts 的 migrateConditions 里（幂等）
      //    这里只负责触发，转换函数由 store 调用（它持有完整资产数组）。
      // 2) 角色的 controllerIds 一定是数组
      for (const node of meta.scene ?? []) {
        const ch = node?.character as Record<string, unknown> | undefined;
        if (ch && !Array.isArray(ch.controllerIds)) ch.controllerIds = [];
      }
    },
  },
];

export interface MigrateResult {
  meta: LooseMeta;
  /** 迁移前的版本（0 = 没有 version 字段的远古文件） */
  from: number;
  /** 实际执行的迁移版本列表 */
  applied: number[];
}

/** 把磁盘元文件升到当前版本。不抛错：未知未来版本也放行（loadProject 有兜底），只标记。 */
export function migrateMetaFile(input: unknown): MigrateResult {
  const meta = (input ?? {}) as LooseMeta;
  const from = typeof meta.version === 'number' ? meta.version : 0;
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.to <= from) continue;
    try {
      m.run(meta);
      applied.push(m.to);
    } catch (err) {
      // 单条迁移失败不阻塞加载：记录并继续，工程按当前内容打开
      console.warn('[project] 迁移到 v' + m.to + ' 失败：', err);
    }
  }
  meta.version = Math.max(meta.version ?? 0, PROJECT_VERSION);
  return { meta, from, applied };
}
