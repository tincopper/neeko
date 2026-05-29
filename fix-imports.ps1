$files = Get-ChildItem -Path 'src\features' -Recurse -Include '*.ts','*.tsx'
foreach ($file in $files) {
  $content = Get-Content $file.FullName -Raw
  $original = $content
  
  # Store imports (3 levels deep)
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/projectStore['""]", "from '@/features/project/store'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/connectionStore['""]", "from '@/features/connection/store'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/worktreeStore['""]", "from '@/features/project/worktreeStore'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/editorStore['""]", "from '@/features/editor/store'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/fileStore['""]", "from '@/features/file/store'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/skillStore['""]", "from '@/features/skill/store'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/gitStore['""]", "from '@/features/git/store'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/browserStore['""]", "from '@/features/browser/store'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/taskStore['""]", "from '@/features/task/store'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/dockStore['""]", "from '@/shared/store/dockStore'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./store/appViewStore['""]", "from '@/shared/store/appViewStore'"
  
  # Store imports (2 levels deep)
  $content = $content -replace "from ['""]\.\./\.\./store/projectStore['""]", "from '@/features/project/store'"
  $content = $content -replace "from ['""]\.\./\.\./store/connectionStore['""]", "from '@/features/connection/store'"
  $content = $content -replace "from ['""]\.\./\.\./store/worktreeStore['""]", "from '@/features/project/worktreeStore'"
  $content = $content -replace "from ['""]\.\./\.\./store/editorStore['""]", "from '@/features/editor/store'"
  $content = $content -replace "from ['""]\.\./\.\./store/fileStore['""]", "from '@/features/file/store'"
  $content = $content -replace "from ['""]\.\./\.\./store/skillStore['""]", "from '@/features/skill/store'"
  $content = $content -replace "from ['""]\.\./\.\./store/gitStore['""]", "from '@/features/git/store'"
  $content = $content -replace "from ['""]\.\./\.\./store/browserStore['""]", "from '@/features/browser/store'"
  $content = $content -replace "from ['""]\.\./\.\./store/taskStore['""]", "from '@/features/task/store'"
  $content = $content -replace "from ['""]\.\./\.\./store/dockStore['""]", "from '@/shared/store/dockStore'"
  $content = $content -replace "from ['""]\.\./\.\./store/appViewStore['""]", "from '@/shared/store/appViewStore'"
  
  # Utils imports (3 levels deep)
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/cn['""]", "from '@/lib/utils'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/platform['""]", "from '@/shared/utils/platform'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/idePresets['""]", "from '@/shared/utils/idePresets'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/projectAvatar['""]", "from '@/shared/utils/projectAvatar'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/entryUpdates['""]", "from '@/shared/utils/entryUpdates'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/aheadBehindKey['""]", "from '@/shared/utils/aheadBehindKey'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/tabKey['""]", "from '@/shared/utils/tabKey'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/terminal['""]", "from '@/shared/utils/terminal'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/editorViewState['""]", "from '@/shared/utils/editorViewState'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/fileTree['""]", "from '@/shared/utils/fileTree'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/browserUtils['""]", "from '@/shared/utils/browserUtils'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/codemirror['""]", "from '@/shared/utils/codemirror'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/fileIcons['""]", "from '@/shared/utils/fileIcons'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/shortcutRegistry['""]", "from '@/shared/utils/shortcutRegistry'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/agents['""]", "from '@/shared/utils/agents'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./utils/withTimeout['""]", "from '@/shared/utils/withTimeout'"
  
  # Utils imports (4 levels deep)
  $content = $content -replace "from ['""]\.\./\.\./\.\./\.\./utils/fileIcons['""]", "from '@/shared/utils/fileIcons'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./\.\./utils/cn['""]", "from '@/lib/utils'"
  
  # Hooks imports
  $content = $content -replace "from ['""]\.\./\.\./\.\./hooks/useTerminalTabs['""]", "from '@/features/terminal/hooks/useTerminalTabs'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./hooks/useFileChangedEvent['""]", "from '@/features/git/hooks/useFileChangedEvent'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./hooks/useMarketplace['""]", "from '@/features/skill/hooks/useMarketplace'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./hooks/useWorktreeState['""]", "from '@/features/project/hooks/useWorktreeState'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./hooks/useSplitLayout['""]", "from '@/features/editor/hooks/useSplitLayout'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./hooks/useAppConfig['""]", "from '@/features/settings/hooks/useAppConfig'"
  
  # Contexts imports
  $content = $content -replace "from ['""]\.\./\.\./\.\./contexts/app-context['""]", "from '@/shared/contexts/app-context'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./contexts/wsl-context['""]", "from '@/features/connection/contexts/wsl-context'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./contexts['""]", "from '@/shared/contexts'"
  
  # Components imports
  $content = $content -replace "from ['""]\.\./\.\./\.\./components/terminal['""]", "from '@/features/terminal/components/terminalCache'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./components/terminal/SplitLayout['""]", "from '@/features/terminal/components/SplitLayout'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./components/terminal/terminalCache['""]", "from '@/features/terminal/components/terminalCache'"
  $content = $content -replace "from ['""]\.\./\.\./\.\./components/gitlog['""]", "from '@/features/git/components/gitlog'"
  
  if ($content -ne $original) {
    Set-Content -Path $file.FullName -Value $content -NoNewline
    Write-Host "Updated: $($file.FullName)"
  }
}
