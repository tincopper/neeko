/**
 * 槽位 tab 宿主（P1）：把停靠到 dock 槽位的 tab 渲染出来。
 *
 * 对外只暴露宿主组件 —— `useDockedPane` 是宿主内部读取面，跨 feature 不共享
 * （需要同一事实的消费方走 `shared/store/editorTabSelectors`）。
 */
export { default as DockTabHost } from './components/DockTabHost';
export type { DockTabHostProps } from './components/DockTabHost';
