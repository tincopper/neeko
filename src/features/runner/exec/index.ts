/**
 * Editor Run/Debug runner 门面：动作入口 + 类型。
 *
 * 语言实现细节（`languages/<lang>/`）**不经此导出** —— 域外只拿到「动作入口 + 语言无关类型」，
 * 新增语言无需改动此处。
 */
export type { TestActionContext } from './context';
export { debugTarget, runMain, runTarget, runTestCase } from './launch';
export type { LanguageModule, PlanResult, RunPlan } from '../languages/contract';
