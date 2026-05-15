import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import plantumlEncoder from "plantuml-encoder";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AppTheme } from "../../types";

function resolveImageSrc(src: string, basePath?: string): string {
  if (/^(https?:|data:|blob:|asset:)\/?\//i.test(src)) return src;
  if (!basePath) return src;
  if (/^([a-zA-Z]:[/\\]|\/)/.test(src)) {
    return convertFileSrc(src.replace(/\\/g, "/"));
  }
  const normalized = src.replace(/^\.\//, "").replace(/\\/g, "/");
  const base = basePath.replace(/\\/g, "/").replace(/\/$/, "");
  return convertFileSrc(`${base}/${normalized}`);
}

// -- Sub-components --

interface MermaidBlockProps {
  code: string;
  theme: AppTheme;
}

function MermaidBlock({ code, theme }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const id = useRef(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setSvg("");
    setError(null);

    import("mermaid")
      .then(({ default: mermaid }) => {
        if (cancelledRef.current) return;
        const isDark = theme === "dark" || theme === "one-dark-pro";
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
        });
        return mermaid.render(id.current, code);
      })
      .then((result) => {
        if (cancelledRef.current || !result) return;
        setSvg(result.svg);
      })
      .catch((err: Error) => {
        if (cancelledRef.current) return;
        setError(err.message || "Mermaid rendering failed");
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

  return (
    <div className="my-4 flex justify-center" dangerouslySetInnerHTML={{ __html: svg }} />
  );
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
    if (e.key === "Escape") setOverlay(false);
  }, []);

  const resolvedSrc = useMemo(() => {
    if (!src) return "";
    return resolveImageSrc(src, basePath);
  }, [src, basePath]);

  const isSvg = useMemo(() => {
    if (!src) return false;
    return src.endsWith(".svg") || src.startsWith("data:image/svg");
  }, [src]);

  if (!resolvedSrc) return null;

  if (loadError) {
    return (
      <span className="inline-block text-text-muted text-sm italic">
        {alt || "Image failed to load"}
      </span>
    );
  }

  return (
    <>
      <img
        src={resolvedSrc}
        alt={alt || ""}
        className="max-w-full rounded cursor-pointer transition-opacity hover:opacity-80"
        style={isSvg ? { width: "100%" } : undefined}
        onClick={() => setOverlay(true)}
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
            alt={alt || ""}
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
}

function extractCodeText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (!children) return "";
  if (Array.isArray(children)) {
    return children.map(extractCodeText).join("");
  }
  // React element (rehype-highlight wraps text in span.hljs-* elements)
  if (typeof children === "object" && "props" in children) {
    return extractCodeText(children.props.children);
  }
  return "";
}

function MarkdownPreviewImpl({ content, theme, className, basePath }: MarkdownPreviewProps) {
  return (
    <div className={`markdown-preview${className ? ` ${className}` : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || "");
            const lang = match?.[1];
            const codeString = extractCodeText(children).replace(/\n$/, "");

            if (lang === "mermaid") {
              return <MermaidBlock code={codeString} theme={theme} />;
            }

            if (lang === "plantuml") {
              return <PlantUMLBlock code={codeString} />;
            }

            if ((lang === "svg" || lang === "html") && codeString.includes("<svg")) {
              return (
                <div
                  className="my-4 flex justify-center"
                  dangerouslySetInnerHTML={{ __html: codeString }}
                />
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
            const isExternal = href && /^(https?:)?\/\//.test(href);
            return (
              <a
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                {...props}
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
