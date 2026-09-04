/* eslint-disable check-file/filename-naming-convention */
/// <reference types="vite/client" />
declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.ico' {
  const src: string;
  export default src;
}

declare module 'plantuml-encoder' {
  export function encode(text: string): string;
  export function decode(encoded: string): string;
}

/* @types/react-dom 未覆盖 server.browser（浏览器专用 SSR 构建），
 * 复用 react-dom/server 的官方类型（本面板仅使用其浏览器安全子集 renderToStaticMarkup）。 */
declare module 'react-dom/server.browser' {
  export * from 'react-dom/server';
}
