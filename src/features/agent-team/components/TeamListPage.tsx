import React from 'react';

import TeamListPageHeader from './TeamListPageHeader';
import TeamListSection from './TeamListSection';

/**
 * 列表态（主面）：页头（标题 + 「新建团队」常驻入口）+ 团队卡片列表。
 *
 * 「列表优先 + 视图推入」的主面 —— 创建是一个按钮推入的整屏视图（见
 * [`TeamLaunchPanel`]），列表才是主人。纯呈现：动作全部由宿主传入。
 */
interface TeamListPageProps {
  list: React.ComponentProps<typeof TeamListSection>['list'];
  listLoading: boolean;
  listError: string | null;
  deleteError: string | null;
  onRetryList: () => void;
  onOpenTeam: (teamId: string) => void;
  onRequestClose: React.ComponentProps<typeof TeamListSection>['onRequestClose'];
  onRequestDelete: React.ComponentProps<typeof TeamListSection>['onRequestDelete'];
  deletingTeamId: string | null;
  onRequestRename: React.ComponentProps<typeof TeamListSection>['onRename'];
  onCreate: () => void;
}

const TeamListPage: React.FC<TeamListPageProps> = React.memo(
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
    onRequestRename,
    onCreate,
  }) => (
    <div className="flex min-h-0 flex-1 flex-col">
      <TeamListPageHeader onCreate={onCreate} />
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
        onRename={onRequestRename}
      />
    </div>
  ),
);
TeamListPage.displayName = 'TeamListPage';

export default TeamListPage;
