/**
 * runtime-core 导出口
 *
 * 纯逻辑运行时（零 DOM / React / three 依赖）——编辑器播放模式与导出的游戏宿主共用。
 * 依赖方向约定：runtime → editor/model（纯数据模块）允许；runtime → UI/three 禁止。
 */
export * from './sceneRuntime';
export * from './scripts';
