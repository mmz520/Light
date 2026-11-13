/**
 * 内置代码编辑器（CodeMirror 6 封装）
 *
 * 选 CodeMirror 而不是 Monaco 的原因：
 *   · 纯 JS、不用 Web Worker —— 桌面端走 file:// 加载，worker 容易踩坑
 *   · 体积小（~350KB），打包进 Electron 与浏览器都无额外资源
 *   · 语法高亮直接用 lezer 的 TS 语法；补全/文档由 apiModel 注入
 *
 * 外观沿用编辑器主题色，行高字号与原来的 textarea 版保持一致。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from 'react';
import { EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { tags as hlt } from '@lezer/highlight';
import { scriptApiCompletions, scriptHover } from './scriptCompletion';
import { T } from '../ui/theme';

export interface CodeEditorHandle {
  /** 在光标处插入一段代码（右栏速查点击用） */
  insert(text: string): void;
  focus(): void;
  view(): EditorView | null;
}

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** ts = 组件脚本；js = 旧式钩子脚本 */
  mode: 'ts' | 'js';
  /** 语法错误（带字符位置，用来画波浪线）；没有位置时只显示工具条红字 */
  diagnostics?: Diagnostic[];
  /** Ctrl/Cmd+S */
  onSave?: () => void;
  style?: CSSProperties;
}

const theme = EditorView.theme(
  {
    '&': { color: T.text, backgroundColor: T.bg1, height: '100%', fontSize: '11.5px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'Consolas, "Courier New", monospace',
      lineHeight: '1.52',
      overflow: 'auto',
    },
    '.cm-content': { padding: '8px 0 40px', caretColor: T.accent },
    '.cm-line': { padding: '0 12px 0 8px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: T.accent, borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'rgba(201,135,58,.22)',
    },
    '.cm-gutters': {
      backgroundColor: T.bg0,
      color: T.dimmer,
      border: 'none',
      borderRight: `1px solid ${T.lineSoft}`,
      fontSize: '10.5px',
      minWidth: '34px',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 6px' },
    '.cm-activeLineGutter': { backgroundColor: T.bg2, color: T.dim },
    '.cm-activeLine': { backgroundColor: 'rgba(201,135,58,.055)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(201,135,58,.20)',
      outline: `1px solid ${T.accentSoft}`,
    },
    '.cm-nonmatchingBracket': { color: T.danger },
    '.cm-placeholder': { color: T.dimmer },
    '.cm-tooltip': {
      backgroundColor: T.bg2,
      border: `1px solid ${T.line}`,
      borderRadius: 5,
      color: T.text,
      boxShadow: '0 10px 26px rgba(0,0,0,.5)',
      overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete > ul': {
      fontFamily: 'Consolas, monospace',
      fontSize: '11.5px',
      maxHeight: '17em',
      backgroundColor: T.bg2,
    },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px', lineHeight: '1.45' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: T.sel, color: T.text },
    '.cm-completionLabel': { color: T.text },
    '.cm-completionMatchedText': { color: T.accent, textDecoration: 'none', fontWeight: 600 },
    '.cm-completionDetail': { color: T.dimmer, fontStyle: 'normal', marginLeft: 8, fontSize: '10px' },
    '.cm-completionIcon': { opacity: 0.7, paddingRight: 6, fontSize: '10px' },
    '.cm-completionInfo': {
      padding: '6px 9px',
      fontSize: '11px',
      maxWidth: 340,
      lineHeight: 1.6,
      backgroundColor: T.bg2,
      border: `1px solid ${T.line}`,
      borderRadius: 5,
    },
    '.cm-diagnostic': { padding: '3px 6px 3px 8px', fontFamily: 'Consolas, monospace', fontSize: '11px' },
    '.cm-diagnostic-error': { borderLeft: `3px solid ${T.danger}` },
    '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: `1px dashed ${T.danger}` },
    '.cm-panel.cm-search': { backgroundColor: T.bg2, color: T.text },
    '.cm-panels': { backgroundColor: T.bg2 },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [hlt.comment, hlt.lineComment, hlt.blockComment], color: '#6f6656', fontStyle: 'italic' },
  { tag: [hlt.keyword, hlt.modifier, hlt.controlKeyword, hlt.definitionKeyword], color: '#c493d0' },
  { tag: [hlt.string, hlt.special(hlt.string), hlt.docString], color: '#9ec27a' },
  { tag: [hlt.number, hlt.bool, hlt.null, hlt.integer, hlt.float], color: '#d9a05b' },
  { tag: [hlt.annotation, hlt.meta], color: T.accent, fontWeight: '600' },
  { tag: [hlt.typeName, hlt.className, hlt.namespace], color: '#e3c26f' },
  { tag: [hlt.propertyName], color: '#e2d5bf' },
  { tag: [hlt.function(hlt.variableName), hlt.function(hlt.propertyName), hlt.labelName], color: '#8fbcd8' },
  { tag: [hlt.definition(hlt.variableName), hlt.variableName], color: T.text },
  { tag: [hlt.operator, hlt.punctuation, hlt.bracket], color: '#b6a48c' },
  { tag: hlt.regexp, color: '#c98f6a' },
  { tag: hlt.escape, color: '#d9a05b' },
  { tag: hlt.invalid, color: T.danger },
]);

export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(props, ref) {
  const { value, onChange, mode, diagnostics, onSave, style } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // 回调放 ref：避免每次 render 重建编辑器
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const valueRef = useRef(value);
  valueRef.current = value;

  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    },
    focus() {
      viewRef.current?.focus();
    },
    view() {
      return viewRef.current;
    },
  }), []);

  // 建 / 重建编辑器（只在语言变化时重建）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const language = mode === 'ts' ? javascript({ typescript: true }) : javascript();
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          lintGutter(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          highlightSpecialChars(),
          drawSelection(),
          dropCursor(),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          EditorState.allowMultipleSelections.of(true),
          placeholderExt('在这里写脚本…… 输入 this. 或 @ 试试补全（Ctrl+Space 手动唤出，Ctrl+S 保存）'),
          autocompletion({ activateOnTyping: true, maxRenderedOptions: 60, icons: true, selectOnOpen: true, closeOnBlur: true }),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          language,
          // 和 lang-javascript 一样挂在语言对象上：TS / JS 两个方言共用同一个 data facet
          javascriptLanguage.data.of({ autocomplete: scriptApiCompletions({ hook: mode === 'js' }) }),
          scriptHover({ hook: mode === 'js' }),
          theme,
          syntaxHighlighting(highlight),
          EditorView.contentAttributes.of({ 'data-script-code': 'true', spellcheck: 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 外部改值（还原 / 切换脚本）时同步进编辑器
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === value) return;
    view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  // 语法错误 → 行内波浪线 + 左侧标记
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setDiagnostics(view.state, diagnostics ?? []));
  }, [diagnostics]);

  return <div ref={hostRef} data-code-editor style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', background: T.bg1, ...style }} />;
});
