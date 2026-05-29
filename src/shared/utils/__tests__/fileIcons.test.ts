import { describe, it, expect } from 'vitest';
import { getFileIcon, fileIconSrc } from '../../utils/fileIcons';

describe('getFileIcon', () => {
  it('识别 Rust 文件扩展名', () => {
    expect(getFileIcon('main.rs')).toBe('rust');
  });

  it('识别 TypeScript 文件', () => {
    expect(getFileIcon('index.ts')).toBe('typescript');
  });

  it('识别 TSX 文件为 react-typescript', () => {
    expect(getFileIcon('App.tsx')).toBe('react-typescript');
  });

  it('识别 JS 变体', () => {
    expect(getFileIcon('script.js')).toBe('javascript');
    expect(getFileIcon('module.mjs')).toBe('javascript');
    expect(getFileIcon('common.cjs')).toBe('javascript');
  });

  it('识别特殊文件名 - Cargo.toml', () => {
    expect(getFileIcon('Cargo.toml')).toBe('toml');
  });

  it('识别特殊文件名 - lock 文件', () => {
    expect(getFileIcon('Cargo.lock')).toBe('lock');
    expect(getFileIcon('package-lock.json')).toBe('lock');
    expect(getFileIcon('pnpm-lock.yaml')).toBe('lock');
    expect(getFileIcon('yarn.lock')).toBe('lock');
  });

  it('识别特殊文件名 - Dockerfile', () => {
    expect(getFileIcon('Dockerfile')).toBe('docker');
    expect(getFileIcon('dockerfile.dev')).toBe('docker');
  });

  it('识别特殊文件名 - .gitignore', () => {
    expect(getFileIcon('.gitignore')).toBe('git');
    expect(getFileIcon('.gitattributes')).toBe('git');
  });

  it('识别特殊文件名 - tsconfig', () => {
    expect(getFileIcon('tsconfig.json')).toBe('config');
    expect(getFileIcon('tsconfig.app.json')).toBe('config');
  });

  it('识别特殊文件名 - vite config', () => {
    expect(getFileIcon('vite.config.ts')).toBe('config');
    expect(getFileIcon('vite.config.js')).toBe('config');
  });

  it('识别特殊文件名 - 环境变量', () => {
    expect(getFileIcon('.env')).toBe('config');
    expect(getFileIcon('.env.local')).toBe('config');
    expect(getFileIcon('.env.production')).toBe('config');
  });

  it('识别特殊文件名 - README', () => {
    expect(getFileIcon('readme.md')).toBe('markdown');
    expect(getFileIcon('README')).toBe('markdown');
  });

  it('识别图片扩展名', () => {
    expect(getFileIcon('photo.png')).toBe('image');
    expect(getFileIcon('logo.svg')).toBe('image');
    expect(getFileIcon('banner.jpg')).toBe('image');
  });

  it('大写扩展名正确处理', () => {
    expect(getFileIcon('MAIN.RS')).toBe('rust');
    expect(getFileIcon('APP.TSX')).toBe('react-typescript');
  });

  it('未知扩展名返回 _file', () => {
    expect(getFileIcon('data.xyz')).toBe('_file');
    expect(getFileIcon('noext')).toBe('_file');
  });
});

describe('fileIconSrc', () => {
  it('返回以 /icons/ 开头的路径', () => {
    const result = fileIconSrc('main.rs');
    expect(result).toMatch(/^\/icons\//);
  });

  it('以 .svg 结尾', () => {
    const result = fileIconSrc('main.rs');
    expect(result).toMatch(/\.svg$/);
  });

  it('对应 getFileIcon 的结果', () => {
    expect(fileIconSrc('main.ts')).toBe(`/icons/typescript.svg`);
  });
});
