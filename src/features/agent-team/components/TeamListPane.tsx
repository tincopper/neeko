import React from 'react';
import { useDefaultLayout } from 'react-resizable-panels';

import { ISLAND_SPLIT_GROUP_CLASS } from '@/layout/islands';
import type { TeamList, TeamRef, TeamSession } from '@/shared/types/team';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/ui/Resizable';

import TeamLaunchPanel from './TeamLaunchPanel';
import TeamListSection from './TeamListSection';

/**
 * 列表页：**队长入口 | 已有团队** 的上下可拖分栏。
 *
 * # 为什么是一个可拖的分栏，而不是一个能滚到底的容器
 *
 * 队长入口那一块在窄 dock 列里很高（候选清单 + 团队配置 + 团队根 + 主按钮 + 拒绝理由），
 * 而「已有团队」是用户**回头找旧队**时要看的东西。整页一个 `overflow-auto` 时只有一种妥协：
 * 想看列表就得先把入口那一块滚上去 —— 而滚上去之后「我在看哪一层」就没有坐标了（上一块的
 * 信息再也找不回来）。分栏把两层各变成一个**确定高度、各自滚动**的区域。
 *
 * # 为什么两侧各自滚动，而不是分栏外面再包一层滚动
 *
 * 外面再包一层 = 嵌套滚动。两个滚动条叠在同一个可视区里时，滚轮命中哪个取决于光标位置，
 * 而用户看不出这件事。所以这里 `overflow-hidden`（`ResizablePanel` 自带）+ 每侧内部
 * `overflow-auto`：滚轮在哪一侧，就滚哪一侧。
 *
 * # 为什么用 `useDefaultLayout` 而不是自己写 localStorage
 *
 * 它把「面板 id → 尺寸」的存储格式、版本校验与解析失败回退都做了。手写一份就是第二个存储
 * 口径，而格式漂移是**静默**的 —— 读不出来时只是回到默认值，没人会报。这一处偏离
 * `component-guidelines.md`「面板内分栏把尺寸存进域 store」的前提也确实不成立：
 * 团队域的 store 不持久化（快照是后端的推导产物），为这一个数字新建一个 zustand + persist
 * 是过度设计。判据是**谁拥有存储格式**，不是「哪个 hook 更常见」。
 *
 * # 为什么抽成独立组件
 *
 * `TeamPanel` 逼近 300 行红线（`check_component_size` ratchet）。抽的是**整块 JSX 与它自己的
 * 布局状态**：分栏比例属于列表页的呈现，不属于「两个视图怎么切」那个导航决定。依赖全部由
 * 宿主传入 —— 本组件不认识 store，也不发起任何 IPC。
 */
interface TeamListPaneProps {
  list: TeamList | null;
  listLoading: boolean;
  /** `team_list` 的失败原文。 */
  listError: string | null;
  /**
   * `team_delete` 的失败原文。
   *
   * 它**属于这一屏**，不属于 `TeamPanel` 顶部那条通栏：删除入口只在列表行上（见
   * [`TeamListRow`]），所以它的失败也该出现在行附近。关闭错误则相反 —— 列表行也能发起关闭，
   * 所以那条留在宿主（两个视图都要看得见）。
   */
  deleteError: string | null;
  /** 重拉清单（错误块的「重试」与标题栏的「刷新」是同一个动作）。 */
  onRetryList: () => void;
  onOpenTeam: (teamId: string) => void;
  onRequestClose: (team: TeamRef) => void;
  onRequestDelete: (team: TeamRef) => void;
  /** 正在删哪个队（`null` = 没有删除在飞）。按队传，因为删除是按队的动作。 */
  deletingTeamId: string | null;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onOpenLeaderTerminal?: (session: TeamSession, title: string) => void;
}

/**
 * 面板 id：**模块级常量**，且 JSX 里也只能从这里取。
 *
 * 两条理由，缺一都不成立：
 *
 * 1. **引用稳定性**：`useDefaultLayout` 把 `panelIds` 放进它内部若干 `useMemo` /
 *    `useCallback` 的依赖里，行内数组字面量会让持久化回调的引用每帧都变（白掉 memo）；
 * 2. **同一个字符串不能在两处写**：这些 id 同时是 `<ResizablePanel id>` 的值、`defaultLayout`
 *    的键、以及 `useDefaultLayout` 存储键的一半。JSX 里再手写一遍字面量，就多出三个可以和
 *    这里漂移的点 —— 而漂移的症状是「拖过的高度读不回来」，没有任何报错。
 */
const LAUNCH_PANEL_ID = 'team-launch';
const LIST_PANEL_ID = 'team-list';
const PANEL_IDS = [LAUNCH_PANEL_ID, LIST_PANEL_ID];
const SPLIT_ID = 'neeko-team-launch-split';

/**
 * 分栏的**默认比例**：上 55% / 下 45%。
 *
 * 用百分比而不是像素：dock 列宽会变，像素上限在窄面板里等于「列表区固定 200px」——
 * 那比现状更糟（窄列里列表正好最需要空间）。只有用户拖过之后 `useDefaultLayout` 才接管。
 */
const DEFAULT_SPLIT: Record<string, number> = { [LAUNCH_PANEL_ID]: 55, [LIST_PANEL_ID]: 45 };

/** 两侧各留 120px 下限：低于它「已有团队」只剩一个标题。 */
const PANEL_MIN_PX = 120;

const TeamListPane: React.FC<TeamListPaneProps> = React.memo(
  ({
    list,
    listLoading,
    listError,
    deleteError,
    onRetryList,
    onOpenTeam,
    onRequestClose,
    onRequestDelete,
    deletingTeamId,
    onShowToast,
    onOpenLeaderTerminal,
  }) => {
    const layout = useDefaultLayout({
      id: SPLIT_ID,
      panelIds: PANEL_IDS,
      // 只持久化**用户拖动**的结果：程序性变化（首次布局 / 窗口 resize / 回到列表页时的重排）
      // 不该覆盖用户的选择。这个开关是 `useDefaultLayout` 的既定能力 —— 不用它就得在回调里
      // 自己判 `meta.isUserInteraction`，而那时注释会与行为不符（这坑踩过一次）。
      onlySaveAfterUserInteractions: true,
    });

    return (
      <ResizablePanelGroup
        orientation="vertical"
        id={SPLIT_ID}
        className={`min-h-0 flex-1 ${ISLAND_SPLIT_GROUP_CLASS}`}
        defaultLayout={layout.defaultLayout ?? DEFAULT_SPLIT}
        onLayoutChanged={layout.onLayoutChanged}
      >
        <ResizablePanel id={LAUNCH_PANEL_ID} minSize={PANEL_MIN_PX}>
          <TeamLaunchPanel onShowToast={onShowToast} onOpenLeaderTerminal={onOpenLeaderTerminal} />
        </ResizablePanel>
        {/* `orientation` 必须与 Group 一致：手柄的细边在哪一轴、光标形状都由它决定。 */}
        <ResizableHandle id="team-launch-list-handle" orientation="vertical" withHandle />
        <ResizablePanel id={LIST_PANEL_ID} minSize={PANEL_MIN_PX}>
          <TeamListSection
            list={list}
            loading={listLoading}
            error={listError}
            deleteError={deleteError}
            onRetry={onRetryList}
            onOpen={onOpenTeam}
            onRequestClose={onRequestClose}
            onRequestDelete={onRequestDelete}
            deletingTeamId={deletingTeamId}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  },
);
TeamListPane.displayName = 'TeamListPane';

export default TeamListPane;
