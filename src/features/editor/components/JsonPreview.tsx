import React, { useMemo } from 'react';

import { formatJson, highlightJson, type JsonTokenType } from '../utils/jsonPreview';

import MarkdownScrollContainer from './MarkdownScrollContainer';

interface JsonPreviewProps {
  tabKey: string;
  tabId: string;
  /** JSON 文件原始内容（只读格式化展示，绝不回写源文件） */
  content: string;
  fileName: string;
}

const TOKEN_CLASS: Record<JsonTokenType, string> = {
  key: 'text-accent-blue',
  string: 'text-accent-green',
  number: 'text-accent-orange',
  literal: 'text-accent-yellow',
  punct: 'text-text-secondary',
};

/** 格式化文本超过该长度则跳过高亮，整块纯文本渲染（避免海量 span 卡死 UI） */
const HIGHLIGHT_LIMIT = 256 * 1024;

/**
 * JSON 文件只读格式化预览：JSON.parse + 2 空格缩进 + 轻量语法高亮。
 * 源码非法时显示错误框；编辑仍在源码模式进行，预览不影响源文件格式。
 */
function JsonPreview({ tabKey, tabId, content, fileName }: JsonPreviewProps) {
  const result = useMemo(() => formatJson(content), [content]);
  const highlight = result.ok && result.formatted.length <= HIGHLIGHT_LIMIT;
  const tokens = useMemo(
    () => (result.ok && highlight ? highlightJson(result.formatted) : []),
    [result, highlight],
  );

  if (!result.ok) {
    return (
      <div className="h-full overflow-auto p-4">
        <div
          role="alert"
          className="my-4 p-3 rounded border border-accent-red/30 bg-accent-red/10 text-accent-red text-sm"
        >
          Invalid JSON: {result.error}
        </div>
      </div>
    );
  }

  return (
    <MarkdownScrollContainer tabKey={tabKey} tabId={tabId} content={content} variant="json">
      <pre className="text-xs leading-5 font-mono whitespace-pre" title={`Preview: ${fileName}`}>
        {highlight
          ? tokens.map((token, i) =>
              token.type === 'punct' ? (
                token.value
              ) : (
                <span key={i} data-token={token.type} className={TOKEN_CLASS[token.type]}>
                  {token.value}
                </span>
              ),
            )
          : result.formatted}
      </pre>
    </MarkdownScrollContainer>
  );
}

export default React.memo(JsonPreview);
