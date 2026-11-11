/** 通用小弹窗：单行输入 / 提示 / 确认 */
import { useState, type ReactNode } from 'react';
import { T, FONT, btnStyle, inputStyle } from './theme';

function Shell({ title, children, onClose, width = 440 }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,5,4,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 900,
        fontFamily: FONT,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width,
          maxWidth: '92vw',
          background: T.bg1,
          border: `1px solid ${T.line}`,
          borderRadius: 7,
          boxShadow: '0 24px 60px rgba(0,0,0,.7)',
          padding: 18,
          color: T.text,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export function PromptDialog({
  title,
  label,
  defaultValue,
  onCancel,
  onSubmit,
}: {
  title: string;
  label?: string;
  defaultValue: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Shell title={title} onClose={onCancel}>
      {label && <div style={{ fontSize: 11.5, color: T.dim, marginBottom: 5 }}>{label}</div>}
      <input
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) onSubmit(value.trim());
          if (e.key === 'Escape') onCancel();
        }}
        style={{ ...inputStyle, marginBottom: 16 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={btnStyle}>
          取消
        </button>
        <button
          onClick={() => value.trim() && onSubmit(value.trim())}
          style={{ ...btnStyle, background: T.accent, color: '#1a1410', border: 'none', fontWeight: 700 }}
        >
          确定
        </button>
      </div>
    </Shell>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmText = '确定',
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Shell title={title} onClose={onCancel}>
      <div style={{ fontSize: 12.5, color: T.dim, lineHeight: 1.7, marginBottom: 16 }}>{message}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={btnStyle}>
          取消
        </button>
        <button
          onClick={onConfirm}
          style={{
            ...btnStyle,
            background: danger ? T.danger : T.accent,
            color: '#141010',
            border: 'none',
            fontWeight: 700,
          }}
        >
          {confirmText}
        </button>
      </div>
    </Shell>
  );
}

export function InfoDialog({ title, children, onClose, width }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  return (
    <Shell title={title} onClose={onClose} width={width}>
      <div style={{ fontSize: 12.5, color: T.dim, lineHeight: 1.9, marginBottom: 16 }}>{children}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={btnStyle}>
          知道了
        </button>
      </div>
    </Shell>
  );
}

/** 结构说明用的等宽块 */
export function Code({ children }: { children: ReactNode }) {
  return (
    <pre
      style={{
        background: T.bg0,
        border: `1px solid ${T.lineSoft}`,
        borderRadius: 4,
        padding: '10px 12px',
        fontSize: 11.5,
        lineHeight: 1.7,
        color: T.text,
        overflow: 'auto',
        fontFamily: "'Cascadia Mono', Consolas, monospace",
        margin: '8px 0',
      }}
    >
      {children}
    </pre>
  );
}
