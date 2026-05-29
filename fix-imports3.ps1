$replacements = @(
  # [file, old, new]
  @('src\features\agent\hooks\useAgentActions.ts', "from '../../../hooks/useWslProjects'", "from '@/features/connection/hooks/useWslProjects'"),
  @('src\features\connection\hooks\useRemoteActions.ts', "from '@/hooks/useWorktreeState'", "from '@/features/project/hooks/useWorktreeState'"),
  @('src\features\connection\hooks\useWslActions.ts', "from '@/hooks/useWorktreeState'", "from '@/features/project/hooks/useWorktreeState'"),
  @('src\features\connection\components\RemoteItems.tsx', "from '../../../utils/distros'", "from '@/shared/utils/distros'"),
  @('src\features\connection\components\RemoteDialog.tsx', "from '../../../utils/idePresets'", "from '@/shared/utils/idePresets'"),
  @('src\features\connection\components\RemoteDialog.tsx', "from '../../../utils/projectAvatar'", "from '@/shared/utils/projectAvatar'"),
  @('src\features\connection\components\RemoteDialog.tsx', "from '../../../utils/cn'", "from '@/lib/utils'"),
  @('src\features\connection\components\WSLDialog.tsx', "from '../../../utils/distros'", "from '@/shared/utils/distros'"),
  @('src\features\connection\components\WSLDialog.tsx', "from '../../../utils/idePresets'", "from '@/shared/utils/idePresets'"),
  @('src\features\connection\components\WSLDialog.tsx', "from '../../../utils/projectAvatar'", "from '@/shared/utils/projectAvatar'"),
  @('src\features\connection\components\WSLDialog.tsx', "from '../../../utils/cn'", "from '@/lib/utils'"),
  @('src\features\editor\components\FileViewer.tsx', "from '../../../utils/codemirror'", "from '@/shared/utils/codemirror'"),
  @('src\features\editor\components\FileViewer.tsx', "from '../../../store/projectStore'", "from '@/features/project/store'"),
  @('src\features\editor\components\FileViewer.tsx', "from '../../../store/connectionStore'", "from '@/features/connection/store'"),
  @('src\features\editor\components\FileViewer.tsx', "from '../../../store/worktreeStore'", "from '@/features/project/worktreeStore'"),
  @('src\features\editor\components\FileViewer.tsx', "from '../../../utils/tabKey'", "from '@/shared/utils/tabKey'"),
  @('src\features\editor\components\FileViewer.tsx', "from '../../../utils/browserUtils'", "from '@/shared/utils/browserUtils'"),
  @('src\features\editor\components\FileViewer.tsx', "from '../../../utils/editorViewState'", "from '@/shared/utils/editorViewState'"),
  @('src\features\git\components\diff\useDiffData.ts', "from '../../../../store/projectStore'", "from '@/features/project/store'"),
  @('src\features\git\components\gitlog\GitLogPanel.tsx', "from '../../../../store/projectStore'", "from '@/features/project/store'"),
  @('src\features\git\components\gitlog\GitLogPanel.tsx', "from '../../../../store/connectionStore'", "from '@/features/connection/store'"),
  @('src\features\git\components\gitlog\GitLogPanel.tsx', "from '../../../../store/editorStore'", "from '@/features/editor/store'"),
  @('src\features\project\components\AddProjectModal.tsx', "from '../../../utils/idePresets'", "from '@/shared/utils/idePresets'"),
  @('src\features\project\components\AddProjectModal.tsx', "from '../../../utils/cn'", "from '@/lib/utils'"),
  @('src\features\project\components\ProjectSettingsDialog.tsx', "from '../../../utils/idePresets'", "from '@/shared/utils/idePresets'"),
  @('src\features\project\components\ProjectSettingsDialog.tsx', "from '../../../utils/cn'", "from '@/lib/utils'")
)

foreach ($r in $replacements) {
  $file = $r[0]
  $old = $r[1]
  $new = $r[2]
  if (Test-Path $file) {
    $content = Get-Content $file -Raw
    $content = $content.Replace($old, $new)
    Set-Content -Path $file -Value $content -NoNewline
    Write-Host "Fixed: $file"
  }
}
