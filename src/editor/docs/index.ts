/**
 * 脚本 API 文档索引
 *
 * 文档是普通 Markdown 文件（同目录），构建时以 `?raw` 内联进 bundle，
 * 打包后的桌面端 / 浏览器端都能读，不依赖磁盘路径。
 *
 * 新增或修改任何脚本 API（装饰器 / 生命周期 / this 成员 / Event / 内置脚本）时，
 * 必须同步更新这里对应的 md —— 这是硬性约定，见 .workbuddy/memory/MEMORY.md。
 */
import quickStart from './quick-start.md?raw';
import lifecycle from './lifecycle.md?raw';
import editor from './editor.md?raw';
import decorators from './decorators.md?raw';
import fields from './fields.md?raw';
import node from './node.md?raw';
import three from './three.md?raw';
import camera from './camera.md?raw';
import events from './events.md?raw';
import runtime from './runtime.md?raw';
import presets from './presets.md?raw';
import hookScripts from './hook-scripts.md?raw';
import faq from './faq.md?raw';

export interface DocPage {
  id: string;
  title: string;
  /** 左侧目录里的分组名 */
  group: string;
  /** 一句话说明（列表里的小灰字 + 搜索用） */
  summary: string;
  body: string;
}

export interface DocGroup {
  id: string;
  title: string;
  pages: DocPage[];
}

const G1 = '入门';
const G2 = '属性面板';
const G3 = '运行时 API';
const G4 = '参考';

export const DOC_GROUPS: DocGroup[] = [
  {
    id: 'start',
    title: G1,
    pages: [
      { id: 'quick-start', title: '快速开始', group: G1, summary: '一个脚本的完整流程 + 最小可运行示例', body: quickStart },
      { id: 'editor', title: '代码编辑器', group: G1, summary: '语法高亮 / 补全 / 悬浮说明 / 自动保存', body: editor },
      { id: 'lifecycle', title: '组件与生命周期', group: G1, summary: '六个钩子何时调用、编辑态与播放态的区别', body: lifecycle },
    ],
  },
  {
    id: 'panel',
    title: G2,
    pages: [
      { id: 'decorators', title: '显示控制注解', group: G2, summary: '分组 / 标签 / 说明 / 排序 / 隐藏', body: decorators },
      { id: 'fields', title: '控件注解', group: G2, summary: '数值 / 开关 / 文本 / 颜色 / 枚举 / 资源 / JSON', body: fields },
    ],
  },
  {
    id: 'runtime',
    title: G3,
    pages: [
      { id: 'node', title: '节点与工程数据', group: G3, summary: 'this.node、this.project 与三个写入口', body: node },
      { id: 'three', title: 'three.js 场景', group: G3, summary: 'this.scene / this.three / this.object3d', body: three },
      { id: 'camera', title: '摄像机', group: G3, summary: 'this.camera：角度、距离与缓动跟随', body: camera },
      { id: 'events', title: '事件总线', group: G3, summary: 'Event.emit / on / off 与 onEvent', body: events },
      { id: 'runtime', title: '播放态与每帧逻辑', group: G3, summary: 'dt、计时、日志、性能与播放流程', body: runtime },
    ],
  },
  {
    id: 'ref',
    title: G4,
    pages: [
      { id: 'presets', title: '内置组件脚本', group: G4, summary: '变换 / 角色 / 小地图 / 地图元素 / 地皮', body: presets },
      { id: 'hook-scripts', title: '钩子脚本（旧式）', group: G4, summary: 'quickjs 沙箱脚本的 self / Light API', body: hookScripts },
      { id: 'faq', title: '常见问题', group: G4, summary: '没生效 / 没保存 / 收不到事件 / 改坏了', body: faq },
    ],
  },
];

export const DOC_PAGES: DocPage[] = DOC_GROUPS.flatMap((g) => g.pages);

export const DEFAULT_DOC_ID = 'quick-start';

export function findDoc(id: string | null | undefined): DocPage {
  return DOC_PAGES.find((p) => p.id === id) ?? DOC_PAGES[0];
}
