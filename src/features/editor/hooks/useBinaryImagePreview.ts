import { useProjectStore } from '@/shared/store/projectStore';
import type { FileTab } from '@/shared/types';
import { isImageFile } from '@/shared/utils/fileTree';

/**
 * 该 tab 是否可按**本地图片**预览。
 *
 * 物理约束：图片预览走 Tauri `asset` 协议，只对 Local 项目成立 —— SSH/WSL 远程
 * 文件取不到 asset URL，因此远程项目即便扩展名匹配、内容为二进制，也只能退化
 * 到只读兜底视图（见 `fileEditorFallbackKind`）。
 *
 * 把「项目环境查询」收在这里：组件不该为此直接订阅 `projectStore`。
 */
export function useBinaryImagePreview(tab: FileTab): boolean {
  const environmentType = useProjectStore(
    (s) => s.projects.find((p) => p.id === tab.projectId)?.environment.type,
  );
  return tab.content.is_binary && isImageFile(tab.filePath) && environmentType === 'Local';
}
