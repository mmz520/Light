import type { ActionId, DirId } from '@/game/types';

/** 单个动作的元数据（build_atlas.py 产出） */
export interface ActionDef {
  frames: number;
  fps: number;
  loop: boolean;
  /** 触发判定/音效的帧号（0 基） */
  eventFrames?: number[];
}

export interface CharacterDef {
  /** 世界单位下的角色高度，用于换算 Sprite 尺寸 */
  displayHeight: number;
  actions: Partial<Record<ActionId, ActionDef>> & Record<string, ActionDef>;
}

export interface SpriteManifest {
  version: number;
  generatedAt?: string;
  /** 图集单元格尺寸（每帧统一） */
  cell: { w: number; h: number; pivotX: number; pivotY: number };
  characters: Record<string, CharacterDef>;
}

export type SheetIndex = `${string}/${string}/${DirId}`;
