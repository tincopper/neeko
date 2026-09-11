/**
 * Editor Run/Debug runner 门面：动作入口 + 类型。
 */
export type { TestActionContext } from './context';
export { debugTarget, runMain, runTarget, runTestCase } from './launch';
export type { LanguageRunner, RunPreparation } from './registry';
