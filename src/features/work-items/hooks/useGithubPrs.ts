/**
 * GitHub PR provider 的读面：**可用性 + 开关 + 列表**（design §8.3：默认关闭、并联期）。
 *
 * # 三件事为什么在同一个 hook 里
 *
 * 「能不能拉」（`gh` 装没装 / 登录没登录）、「用户要不要拉」（本地偏好）、「拉了些什么」
 * 是**同一条**因果链：只有前两个都成立才会发请求。拆成三个 hook 会让调用方自己拼这条链
 * （然后必然有一处拼错，比如「不可用也发请求」或「勾了就无条件重拉」）。
 *
 * # 「同一 workspace 重复开只拉一次」
 *
 * 开关关掉**不清缓存**：再勾回来时直接显示上一次的结果，不重新 `list_prs`（每次勾选都打一次
 * `gh` 是几百毫秒的外部进程）。要新数据是**显式动作** —— 面板的刷新按钮（`refresh()`），
 * 它自增 `epoch` 让 effect 绕过这条去重。换 workspace（切项目 / 切 worktree）则必然重拉：
 * 缓存按 `WorkspaceSession#key` 分槽，别的单元的结果不许冒充。
 *
 * # 失败保留旧列表
 *
 * 刷新失败只把 `error` 挂上去，`items` 保持上一次成功的值：把看板清空等于用一次网络抖动
 * 否认用户刚才看到的事实（而且他会以为 PR 被合掉了）。跨 workspace 失败才是空列表 ——
 * 那时旧列表本来就不属于这个单元。
 *
 * # gh 探测在挂载时做一次，不在勾选时做
 *
 * 勾选框必须**先**知道自己能不能勾（不可用时要 disabled + 原因），所以探测不能等到用户点。
 * 代价是每次面板挂载起两个 CLI 进程（与旧 `PullRequestsPanel` 同档），且不随环境变化刷新 ——
 * 用户装好 `gh` 后重开面板即可。为了省这两次进程把它做成「点一下才知道不行」，是拿真话换延迟。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isGhAuthenticated, isGhInstalled } from '@/features/git/api/gitApi';
import { useActiveWorkspaceSession } from '@/shared/store/workspaceStore';
import { invokeErrorMessage } from '@/shared/utils/invokeError';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { fetchGithubPrs } from '../providers/githubPr';
import {
  readGithubProviderPreference,
  writeGithubProviderPreference,
} from '../utils/providerPreference';
import { localStorageOrNull } from '../utils/viewPreference';
import type { TaskItem } from '../viewModel';

/** `gh` 的三态：`checking` 不是 `blocked` —— 前者是「还不知道」，后者是「确定不行」。 */
export type GithubAvailability = 'checking' | 'ready' | 'blocked';

/** 探测结果。`blocked` 必须带原因：一个沉默的 disabled 勾选框等同于坏了。 */
type GhProbe = { status: 'checking' } | { status: 'ready' } | { status: 'blocked'; reason: string };

/**
 * 一次落地的列表结果，按 workspace 分槽（`workspaceKey` 不匹配就是不属于当前单元）。
 *
 * `epoch` 记在结果上：请求序号比结果新 ⇒ 正在拉（`loading`）且旧的那句错误不该再显示。
 * 这样「加载中」「错误」都是**派生**出来的，effect 里不必同步 setState（那会多一轮渲染，
 * 而且还会被「effect 里同步 setState 会级联渲染」的 lint 拦下）。
 */
interface PrFetch {
  workspaceKey: string;
  epoch: number;
  items: TaskItem[];
  error: string | null;
}

/** 空列表的**稳定**引用：未启用 / 不可用时每次 render 返回同一个数组，下游 `memo` 才有意义。 */
const NO_ITEMS: TaskItem[] = [];

const CHECKING_REASON = '正在检查 GitHub CLI（gh）…';
const NO_PROJECT_REASON = '没有激活项目';

/**
 * 探一次 `gh` 的能力。
 *
 * **失败按「不可用」处理**：`isGhInstalled()` 抛错时我们并不知道它装没装，但此时唯一诚实的
 * 结论是「不能保证能用」→ 不勾、不请求、把原因说出来。把失败当「已登录」会让面板在
 * 每次勾选时弹一个后端错误，用户还以为是自己配错了。
 */
async function probeGh(): Promise<GhProbe> {
  let installed: boolean;
  try {
    installed = await isGhInstalled();
  } catch {
    return { status: 'blocked', reason: '无法确认 GitHub CLI（gh）是否已安装' };
  }
  if (!installed) return { status: 'blocked', reason: '未安装 GitHub CLI（gh）' };

  let authenticated: boolean;
  try {
    authenticated = await isGhAuthenticated();
  } catch {
    return { status: 'blocked', reason: '无法确认 GitHub CLI（gh）的登录状态' };
  }
  if (!authenticated)
    return { status: 'blocked', reason: 'GitHub CLI（gh）未登录（gh auth login）' };

  return { status: 'ready' };
}

export interface UseGithubPrsResult {
  /** 用户的偏好（默认 `false`，design §8.3）。 */
  enabled: boolean;
  /** 勾选 / 取消：立即生效并落 localStorage（写失败静默，见 `providerPreference`）。 */
  setEnabled: (next: boolean) => void;
  availability: GithubAvailability;
  /** 勾选框为什么不可用（`null` = 可用 / 已就绪）。 */
  blockedReason: string | null;
  /** 真正可以混入看板的条目（未启用 / 不可用 / 属于别的 workspace 时是空数组）。 */
  items: TaskItem[];
  loading: boolean;
  /** 读失败原因（可读句子）；`items` 保留上一次成功的结果。 */
  error: string | null;
  /** 显式重拉（面板刷新按钮）：绕过「已拉过就不拉」的去重。 */
  refresh: () => void;
}

export function useGithubPrs(projectId: string | null, repoLabel = ''): UseGithubPrsResult {
  /**
   * `as ProjectId` 是**收回品牌**而不是重新铸造：面板的 `projectId` 来自
   * `useProjectStore.activeProjectId`，本来就是 `ProjectId`，只是在面板边界被放宽成 string
   * （面板不认识项目 store）。与 `WorkItemRunsSection` 同一处处理。
   */
  const session = useActiveWorkspaceSession(projectId as ProjectId | null);

  const [enabled, setEnabledState] = useState<boolean>(() =>
    readGithubProviderPreference(localStorageOrNull()),
  );
  const [probe, setProbe] = useState<GhProbe>({ status: 'checking' });
  const [fetched, setFetched] = useState<PrFetch | null>(null);
  /** 显式刷新计数：自增即绕过去重再拉一次（与 `useWorkItemRuns` 的 `token` 同一手法）。 */
  const [epoch, setEpoch] = useState(0);

  /** 上一次**已发出**的请求。用它而不是 `fetched` 做去重判据：在飞的时候 `fetched` 还是旧的。 */
  const lastRequest = useRef<{ workspaceKey: string; epoch: number } | null>(null);

  useEffect(() => {
    // 没有绑定项目 = 没有仓库可查：不必为两个用不上的 CLI 进程买单。
    if (projectId === null) return;
    let cancelled = false;
    // 探测结果是**这台机器**的事实（装没装、登录没登录），与哪个项目无关 —— 所以切项目时
    // 不回退到 `checking`（那会让勾选框闪一下灰，而答案其实没变）。
    void probeGh().then((result) => {
      if (cancelled) return;
      setProbe(result);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!enabled || probe.status !== 'ready' || session === null) return;
    const workspaceKey = session.key;
    const last = lastRequest.current;
    // 同一单元、同一 epoch 已经拉过（或正在拉）⇒ 不再发请求（开关反复勾选不会重复打 gh）。
    if (last !== null && last.workspaceKey === workspaceKey && last.epoch === epoch) return;
    lastRequest.current = { workspaceKey, epoch };

    let cancelled = false;

    fetchGithubPrs(session, repoLabel).then(
      (items) => {
        if (cancelled) return;
        setFetched({ workspaceKey, epoch, items, error: null });
      },
      (err: unknown) => {
        if (cancelled) return;
        setFetched((prev) => ({
          workspaceKey,
          epoch,
          // 同一单元的旧列表留着（失败不清空看板）；跨单元则必须是空的（旧列表属于别人）。
          items: prev !== null && prev.workspaceKey === workspaceKey ? prev.items : [],
          error: invokeErrorMessage(err, '读取 GitHub PR 失败'),
        }));
      },
    );

    return () => {
      cancelled = true;
    };
  }, [enabled, probe.status, session, epoch, repoLabel]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    // 写失败静默（隐私模式 / 配额）：一次偏好没存上不该让勾选报错。
    writeGithubProviderPreference(localStorageOrNull(), next);
  }, []);

  const refresh = useCallback(() => setEpoch((current) => current + 1), []);

  /** 当前单元已经落地的结果（`null` = 这个单元还没有结果）。 */
  const current = useMemo<PrFetch | null>(() => {
    if (session === null || fetched === null) return null;
    return fetched.workspaceKey === session.key ? fetched : null;
  }, [session, fetched]);

  const ready = enabled && probe.status === 'ready' && session !== null;
  // 「加载中」= 这个单元没有结果，或结果的序号比当前请求旧（显式刷新 / 换单元都会让它变旧）。
  const loading = ready && (current === null || current.epoch !== epoch);
  const items = ready ? (current?.items ?? NO_ITEMS) : NO_ITEMS;
  // 新请求在飞时旧错误自动隐去：同时说「失败了」和「正在拉」是自相矛盾的两句话。
  const error = ready && current !== null && current.epoch === epoch ? current.error : null;

  const availability: GithubAvailability = projectId === null ? 'blocked' : probe.status;
  const blockedReason =
    projectId === null
      ? NO_PROJECT_REASON
      : probe.status === 'blocked'
        ? probe.reason
        : probe.status === 'checking'
          ? CHECKING_REASON
          : null;

  return useMemo(
    () => ({ enabled, setEnabled, availability, blockedReason, items, loading, error, refresh }),
    [enabled, setEnabled, availability, blockedReason, items, loading, error, refresh],
  );
}
