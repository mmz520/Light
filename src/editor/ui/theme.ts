/** 编辑器配色（暗黑哥特 + 旧黄铜，与游戏美术同调） */
import type { CSSProperties } from 'react';

export const T = {
  bg0: '#13100d',
  bg1: '#1a1613',
  bg2: '#211c17',
  bg3: '#2a231d',
  bg4: '#342c24',
  line: '#3b322a',
  lineSoft: '#2e271f',
  text: '#eae1d3',
  dim: '#9a8b78',
  dimmer: '#6d6153',
  accent: '#c9873a',
  accentSoft: '#8a5f2b',
  ok: '#7fa86b',
  danger: '#c4553f',
  sel: '#3a2f22',
} as const;

export const FONT = `system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif`;

export const panelStyle: CSSProperties = {
  background: T.bg1,
  color: T.text,
  fontFamily: FONT,
  fontSize: 12.5,
};

export const btnStyle: CSSProperties = {
  background: T.bg3,
  color: T.text,
  border: `1px solid ${T.line}`,
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: FONT,
};

export const inputStyle: CSSProperties = {
  background: T.bg0,
  color: T.text,
  border: `1px solid ${T.line}`,
  borderRadius: 3,
  padding: '3px 6px',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: FONT,
};

export const sectionTitle: CSSProperties = {
  fontSize: 11,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: T.dimmer,
  padding: '8px 10px 4px',
};
