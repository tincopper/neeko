# Fix UI files: ../utils/cn -> @/lib/utils
$uiFiles = Get-ChildItem -Path 'src\ui' -Include '*.tsx' -Recurse
foreach ($file in $uiFiles) {
  $content = Get-Content $file.FullName -Raw
  $original = $content
  $content = $content -replace [regex]::Escape('from "../utils/cn"'), "from '@/lib/utils'"
  $content = $content -replace [regex]::Escape("from '../utils/cn'"), "from '@/lib/utils'"
  if ($content -ne $original) {
    Set-Content -Path $file.FullName -Value $content -NoNewline
    Write-Host "Fixed UI: $($file.Name)"
  }
}

# Fix shared/components/AppToast.tsx
$f = 'src\shared\components\AppToast.tsx'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape('from "../../utils/cn"'), "from '@/lib/utils'"
Set-Content -Path $f -Value $c -NoNewline
Write-Host "Fixed: AppToast.tsx"

# Fix layout/RightPanel.tsx
$f = 'src\layout\RightPanel.tsx'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape('from "../utils/cn"'), "from '@/lib/utils'"
Set-Content -Path $f -Value $c -NoNewline
Write-Host "Fixed: RightPanel.tsx"

# Fix layout/dockPanels.ts
$f = 'src\layout\dockPanels.ts'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape("from '@/components/panels/ProjectsPanel'"), "from '@/components/panels/ProjectsPanel'"
# ProjectsPanel was deleted - need to find the real location
# Actually ProjectsPanel is still in components/panels/ which we need to keep
Set-Content -Path $f -Value $c -NoNewline

# Fix app/AppModals.tsx
$f = 'src\app\AppModals.tsx'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape("from '../utils/platform'"), "from '@/shared/utils/platform'"
$c = $c -replace [regex]::Escape("from '../components/project'"), "from '@/components/project'"
$c = $c -replace [regex]::Escape("from '../components/connections'"), "from '@/components/connections'"
Set-Content -Path $f -Value $c -NoNewline
Write-Host "Fixed: AppModals.tsx"

# Fix features/agent/hooks/useAgentActions.ts
$f = 'src\features\agent\hooks\useAgentActions.ts'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape("from '../../../hooks/useWslProjects'"), "from '@/features/connection/hooks/useWslProjects'"
Set-Content -Path $f -Value $c -NoNewline
Write-Host "Fixed: useAgentActions.ts"

# Fix features/connection/hooks/useRemoteActions.ts - useWorktreeState
$f = 'src\features\connection\hooks\useRemoteActions.ts'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape("from '@/hooks/useWorktreeState'"), "from '@/features/project/hooks/useWorktreeState'"
Set-Content -Path $f -Value $c -NoNewline
Write-Host "Fixed: useRemoteActions.ts"

# Fix features/connection/hooks/useWslActions.ts - useWorktreeState
$f = 'src\features\connection\hooks\useWslActions.ts'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape("from '@/hooks/useWorktreeState'"), "from '@/features/project/hooks/useWorktreeState'"
Set-Content -Path $f -Value $c -NoNewline
Write-Host "Fixed: useWslActions.ts"

# Fix features/task/store.ts
$f = 'src\features\task\store.ts'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape("from '../../components/terminal/terminalCache'"), "from '@/features/terminal/components/terminalCache'"
Set-Content -Path $f -Value $c -NoNewline
Write-Host "Fixed: task/store.ts"

# Fix features/terminal/components/terminalFactory.ts - taskStore
$f = 'src\features\terminal\components\terminalFactory.ts'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape("from '../../../store/taskStore'"), "from '@/features/task/store'"
Set-Content -Path $f -Value $c -NoNewline
Write-Host "Fixed: terminalFactory.ts"

# Fix features/project/components/ProjectSidebar.tsx
$f = 'src\features\project\components\ProjectSidebar.tsx'
$c = Get-Content $f -Raw
$c = $c -replace [regex]::Escape("from '@/components/panels/ProjectsPanel'"), "from '@/components/panels/ProjectsPanel'"
# ProjectsPanel is still in components/panels/ (not a stub), so this should be fine
Set-Content -Path $f -Value $c -NoNewline
