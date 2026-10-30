/**
 * TexturePicker —— 从 metadata.json 的图片列表里选图（网格布局 + 预览图）
 */
import { MetadataImage } from './types';
import { assetUrl } from './Viewport3D';

interface Props {
  open: boolean;
  title: string;
  images: MetadataImage[];
  onPick: (path: string) => void;
  onClose: () => void;
}

export function TexturePicker({ open, title, images, onPick, onClose }: Props) {
  if (!open) return null;
  // 按 group 分组展示（保持传入顺序）
  const groups: { name: string; items: MetadataImage[] }[] = [];
  for (const img of images) {
    const g = img.group ?? '其他';
    let bucket = groups.find(x => x.name === g);
    if (!bucket) { bucket = { name: g, items: [] }; groups.push(bucket); }
    bucket.items.push(img);
  }
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxHeight: '72vh', background: '#232328', border: '1px solid #444',
          borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,.6)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', padding: '10px 14px',
          borderBottom: '1px solid #333', fontWeight: 600,
        }}>
          <span style={{ flex: 1 }}>{title}</span>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: '#999',
            fontSize: 18, cursor: 'pointer', lineHeight: 1,
          }}>×</button>
        </div>
        <div style={{ padding: 12, overflow: 'auto' }}>
          {groups.map(grp => (
            <div key={grp.name} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#8a8a92', padding: '2px 2px 8px', fontWeight: 600 }}>
                {grp.name}
                <span style={{ opacity: .5, marginLeft: 6 }}>({grp.items.length})</span>
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10,
              }}>
                {grp.items.map(img => (
                  <div
                    key={img.id}
                    onClick={() => onPick(img.path)}
                    style={{
                      cursor: 'pointer', border: '1px solid #3a3a40', borderRadius: 6,
                      background: '#1b1b1f', padding: 6, textAlign: 'center',
                    }}
                    title={img.path}
                  >
                    <div style={{
                      height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      backgroundImage:
                        'linear-gradient(45deg,#2a2a30 25%,transparent 25%,transparent 75%,#2a2a30 75%),' +
                        'linear-gradient(45deg,#2a2a30 25%,transparent 25%,transparent 75%,#2a2a30 75%)',
                      backgroundSize: '12px 12px', backgroundPosition: '0 0, 6px 6px', borderRadius: 4,
                      overflow: 'hidden', marginBottom: 4,
                    }}>
                      <img
                        src={assetUrl(img.path)}
                        alt={img.label}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        draggable={false}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: '#bbb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {img.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {images.length === 0 && (
            <div style={{ opacity: .5, padding: 20, textAlign: 'center' }}>
              metadata.json 里没有可用图片
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
