// eslint-disable-next-line no-restricted-imports -- convertFileSrc is needed for resolving local image paths in markdown
import { convertFileSrc } from '@tauri-apps/api/core';
import { Check, Copy } from 'lucide-react';
import plantumlEncoder from 'plantuml-encoder';
import React, { useState, useEffect, useRef, useMemo, useCallback, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { AppTheme } from '@/shared/types';
import { resolveInternalHref } from '@/shared/utils/markdownLinks';
import { isDarkTheme } from '@/shared/utils/theme';

import { InlineDiffBlock } from './InlineDiffBlock';

function resolveImageSrc(src: string, basePath?: string): string {
  if (/^(https?:|data:|blob:|asset:)\/?\//i.test(src)) return src;
  if (!basePath) return src;
  if (/^([a-zA-Z]:[/\\]|\/)/.test(src)) {
    return convertFileSrc(src.replace(/\\/g, '/'));
  }
  const normalized = src.replace(/^\.\//, '').replace(/\\/g, '/');
  const base = basePath.replace(/\\/g, '/').replace(/\/$/, '');
  return convertFileSrc(`${base}/${normalized}`);
}

// -- Sub-components --

interface MermaidBlockProps {
  code: string;
  theme: AppTheme;
}

function MermaidBlock({ code, theme }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const id = useRef(`mermaid-${uid}`);
  const cancelledRef = useRef(false);

  // Reset state when inputs change
  useEffect(() => {
    // Defer to avoid sync setState in effect
    Promise.resolve().then(() => {
      setSvg('');
      setError(null);
    });
  }, [code, theme]);

  useEffect(() => {
    cancelledRef.current = false;

    import('mermaid')
      .then(({ default: mermaid }) => {
        if (cancelledRef.current) return;
        const isDark = isDarkTheme(theme);
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
        });
        return mermaid.render(id.current, code);
      })
      .then((result) => {
        if (cancelledRef.current || !result) return;
        setSvg(result.svg);
      })
      .catch((err: Error) => {
        if (cancelledRef.current) return;
        setError(err.message || 'Mermaid rendering failed');
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [code, theme]);

  if (error) {
    return (
      <div className="my-4 p-3 rounded border border-accent-red/30 bg-accent-red/10 text-accent-red text-sm">
        Mermaid rendering failed: {error}
      </div>
    );
  }

  if (!svg) {
    return <div className="my-4 animate-pulse bg-bg-tertiary rounded h-32" />;
  }

  return <div className="my-4 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />;
}

interface PlantUMLBlockProps {
  code: string;
}

function PlantUMLBlock({ code }: PlantUMLBlockProps) {
  const [hasError, setHasError] = useState(false);

  const url = useMemo(() => {
    try {
      const encoded = plantumlEncoder.encode(code);
      return `https://www.plantuml.com/plantuml/svg/${encoded}`;
    } catch {
      return null;
    }
  }, [code]);

  if (!url) {
    return (
      <div className="my-4 p-3 rounded border border-accent-red/30 bg-accent-red/10 text-accent-red text-sm">
        PlantUML encoding failed
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="my-4 p-3 rounded border border-accent-yellow/30 bg-accent-yellow/10 text-accent-yellow text-sm">
        PlantUML diagram failed to load
      </div>
    );
  }

  return (
    <div className="my-4 flex justify-center">
      <img
        src={url}
        alt="PlantUML diagram"
        className="max-w-full rounded"
        onError={() => setHasError(true)}
      />
    </div>
  );
}

interface ImageBlockProps {
  src?: string;
  alt?: string;
  basePath?: string;
}

function ImageBlock({ src, alt, basePath }: ImageBlockProps) {
  const [overlay, setOverlay] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOverlay(false);
  }, []);

  const resolvedSrc = useMemo(() => {
    if (!src) return '';
    return resolveImageSrc(src, basePath);
  }, [src, basePath]);

  const isSvg = useMemo(() => {
    if (!src) return false;
    return src.endsWith('.svg') || src.startsWith('data:image/svg');
  }, [src]);

  if (!resolvedSrc) return null;

  if (loadError) {
    return (
      <span className="inline-block text-text-muted text-sm italic">
        {alt || 'Image failed to load'}
      </span>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <img
        src={resolvedSrc}
        alt={alt || ''}
        className="max-w-full rounded cursor-pointer transition-opacity hover:opacity-80"
        style={isSvg ? { width: '100%' } : undefined}
        onClick={() => setOverlay(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOverlay(true);
          }
        }}
        onError={() => setLoadError(true)}
      />
      {overlay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setOverlay(false)}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={0}
          aria-label="Close image preview"
        >
          <img
            src={resolvedSrc}
            alt={alt || ''}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded"
          />
        </div>
      )}
    </>
  );
}

// -- Main component --

interface MarkdownPreviewProps {
  content: string;
  theme: AppTheme;
  className?: string;
  basePath?: string;
  /** 点击内部相对链接时的回调（resolve 为绝对路径后调用）；不传则走 toast 兜底提示 */
  onInternalLinkClick?: (absPath: string) => void;
}

function extractCodeText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (!children) return '';
  if (Array.isArray(children)) {
    return children.map(extractCodeText).join('');
  }
  // React element (rehype-highlight wraps text in span.hljs-* elements)
  if (typeof children === 'object' && 'props' in children) {
    return extractCodeText(children.props.children);
  }
  return '';
}

interface FencedCodeBlockProps {
  lang: string;
  code: string;
  codeClassName?: string;
  children: React.ReactNode;
}

function FencedCodeBlock({ lang, code, codeClassName, children }: FencedCodeBlockProps) {
  const copyToClipboard = useCopyToClipboard();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(code, 'code block');
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  }, [code, copyToClipboard]);

  return (
    <div className="group relative my-4">
      {lang ? (
        <span className="absolute top-0 left-0 translate-y-[-100%] px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted bg-bg-tertiary rounded-t">
          {lang}
        </span>
      ) : null}
      <pre className="relative">
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          className={cn(
            'absolute top-2 right-2 w-6 h-6 inline-flex items-center justify-center rounded-md',
            'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity',
            'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            copied && 'text-accent-green opacity-100',
          )}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        <code className={codeClassName}>{children}</code>
      </pre>
    </div>
  );
}

function MarkdownPreviewImpl({
  content,
  theme,
  className,
  basePath,
  onInternalLinkClick,
}: MarkdownPreviewProps) {
  return (
    <div className={`markdown-preview${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const lang = match?.[1];
            const codeString = extractCodeText(children).replace(/\n$/, '');

            if (lang === 'mermaid') {
              return <MermaidBlock code={codeString} theme={theme} />;
            }

            if (lang === 'plantuml') {
              return <PlantUMLBlock code={codeString} />;
            }

            if (lang === 'diff') {
              return <InlineDiffBlock code={codeString} />;
            }

            if ((lang === 'svg' || lang === 'html') && codeString.includes('<svg')) {
              return (
                <div
                  className="my-4 flex justify-center"
                  dangerouslySetInnerHTML={{ __html: codeString }}
                />
              );
            }

            if (lang) {
              return (
                <FencedCodeBlock lang={lang} code={codeString} codeClassName={codeClassName}>
                  {children}
                </FencedCodeBlock>
              );
            }

            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
          img({ src, alt }) {
            return <ImageBlock src={src} alt={alt} basePath={basePath} />;
          },
          a({ href, children, ...props }) {
            // 保持浏览器默认行为的链接：外链（http/https/协议相对）、邮件/电话协议、同页锚点。
            // 其余（内部相对路径）一律 preventDefault 阻断 webview 页面导航（闪退根因）。
            const isDefaultLink =
              !!href &&
              (/^(https?:)?\/\//.test(href) ||
                /^(mailto|tel):/i.test(href) ||
                href.startsWith('#'));
            const isExternal = href && /^(https?:)?\/\//.test(href);
            const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
              if (isDefaultLink) return;
              e.preventDefault();
              const abs = href ? resolveInternalHref(href, basePath) : '';
              if (abs && onInternalLinkClick) {
                onInternalLinkClick(abs);
                return;
              }
              useNotificationStore
                .getState()
                .addNotification({ type: 'error', title: '链接无法打开', message: href ?? '' });
            };
            return (
              <a
                href={href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                {...props}
                onClick={handleLinkClick}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownPreview = React.memo(MarkdownPreviewImpl);
