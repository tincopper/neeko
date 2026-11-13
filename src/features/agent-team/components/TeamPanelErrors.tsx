import React from 'react';

import ErrorNotice from './ErrorNotice';

/**
 * 面板顶栏的两条**团队级写操作**错误（关闭 / 恢复）。
 *
 * # 为什么它们贴顶栏，而删除错误贴在列表行
 *
 * 关闭与恢复的入口横跨两个视图：关闭在团队视图（头部 / `closing` 横幅的「重试关闭」）与
 * 列表行上都能发起；恢复在团队视图（头部 / 花名册 / 抽屉）。所以它们的错误不能挂在某一个
 * 视图上 —— 从列表行发起的关闭失败必须**在列表里**看得见，把两条错误做成「按视图二选一」的
 * 单一槽位，就会让其中一条一个字都不显示（这正是回归的形状）。
 *
 * 删除错误则相反：它只可能来自列表行，所以渲染在 `TeamListPage` 里（贴着那一行）。
 *
 * # 两条错误并列而不是互斥
 *
 * 它们是两件事实（「关闭没关完」/「恢复没恢复成」），不是同一件事的两个版本。失败时团队分
 * 别停在 `closing` / 原状态，用户需要原样读到后端那句话才知道下一步做什么。
 */
interface TeamPanelErrorsProps {
  /** `team_close` 的后端原文（逐个点名关不掉的成员）。 */
  closeError: string | null;
  /** `team_resume` 的后端原文（`sealed` / `closing` 的理由原样显示）。 */
  resumeError: string | null;
}

const TeamPanelErrors: React.FC<TeamPanelErrorsProps> = ({ closeError, resumeError }) => (
  <>
    <ErrorNotice message={closeError} className="shrink-0 border-b border-border px-2 py-1" />
    <ErrorNotice message={resumeError} className="shrink-0 border-b border-border px-2 py-1" />
  </>
);

export default React.memo(TeamPanelErrors);
