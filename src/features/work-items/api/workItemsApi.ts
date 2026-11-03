/**
 * Local 工作项的 IPC 薄封装（唯一入口）。
 *
 * 每个函数对应一条 Rust 命令，除此之外什么都做：不做校验、不补默认值、
 * 不改错误形状。校验与默认值都在 `work_items/manager.rs` —— 在这里重写一份
 * 就等于给同一条规则造出第二个判据。
 */
import { invoke } from '@tauri-apps/api/core';

import type {
  CreateWorkItemParams,
  RecordWorkItemRunParams,
  StagePlan,
  UpdateWorkItemParams,
  WorkItem,
  WorkItemRun,
} from '../types';

/** 阶段轨定义（后端的 `StagePlan::default()`）。 */
export function getStagePlan(): Promise<StagePlan> {
  return invoke<StagePlan>('work_item_stage_plan');
}

export function listWorkItems(projectId: string): Promise<WorkItem[]> {
  return invoke<WorkItem[]>('work_item_list', { projectId });
}

export function createWorkItem(params: CreateWorkItemParams): Promise<WorkItem> {
  return invoke<WorkItem>('work_item_create', {
    projectId: params.projectId,
    title: params.title,
    body: params.body,
    stage: params.stage,
    priority: params.priority,
    labels: params.labels,
    assignee: params.assignee,
  });
}

export function updateWorkItem(params: UpdateWorkItemParams): Promise<WorkItem> {
  return invoke<WorkItem>('work_item_update', {
    id: params.id,
    title: params.title,
    body: params.body,
    priority: params.priority,
    labels: params.labels,
    assignee: params.assignee,
  });
}

/** 流转到 `to`；后端拒绝非法流转（含跨阶段），错误文案带可选项。 */
export function transitionWorkItem(id: string, to: string): Promise<WorkItem> {
  return invoke<WorkItem>('work_item_transition', { id, to });
}

export function deleteWorkItem(id: string): Promise<void> {
  return invoke<void>('work_item_delete', { id });
}

/** 执行记录（按 `createdAt` 倒序）。 */
export function listWorkItemRuns(workItemId: string): Promise<WorkItemRun[]> {
  return invoke<WorkItemRun[]>('work_item_run_list', { workItemId });
}

/**
 * 记一条执行记录（`run-single` 写完终端后调）。
 *
 * 线上键是扁平 camelCase；**执行状态那个参数叫 `runState`**（Rust 侧别名 `run_state`），
 * 因为 `state` 已经被 `tauri::State<AppStateWrapper>` 占用。
 *
 * 后端只接受 `mode = 'single'` + `refKind = 'session'`（`team` / `flow` 还没有写入方），
 * 其余组合一律 `InvalidInput` —— 所以这里不做前置判断，拒绕的理由由后端一句话说完。
 */
export function recordWorkItemRun(params: RecordWorkItemRunParams): Promise<WorkItemRun> {
  return invoke<WorkItemRun>('work_item_run_record', {
    workItemId: params.workItemId,
    mode: params.mode,
    refKind: params.refKind,
    refId: params.refId,
    refSub: params.refSub,
    runState: params.runState,
    label: params.label,
  });
}
