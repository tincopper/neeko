import { describe, it, expect } from 'vitest';
import { getFileIcon, fileIconSrc } from '../fileIcons';

describe('getFileIcon', () => {
  describe('special filenames', () => {
    it('should return "toml" for Cargo.toml', () => {
      expect(getFileIcon('Cargo.toml')).toBe('toml');
    });

    it('should return "lock" for Cargo.lock', () => {
      expect(getFileIcon('Cargo.lock')).toBe('lock');
    });

    it('should return "lock" for package-lock.json', () => {
      expect(getFileIcon('package-lock.json')).toBe('lock');
    });

    it('should return "lock" for pnpm-lock.yaml', () => {
      expect(getFileIcon('pnpm-lock.yaml')).toBe('lock');
    });

    it('should return "lock" for yarn.lock', () => {
      expect(getFileIcon('yarn.lock')).toBe('lock');
    });

    it('should return "json" for package.json', () => {
      expect(getFileIcon('package.json')).toBe('json');
    });

    it('should return "docker" for Dockerfile', () => {
      expect(getFileIcon('Dockerfile')).toBe('docker');
    });

    it('should return "docker" for Dockerfile.dev', () => {
      expect(getFileIcon('Dockerfile.dev')).toBe('docker');
    });

    it('should return "git" for .gitignore', () => {
      expect(getFileIcon('.gitignore')).toBe('git');
    });

    it('should return "git" for .gitattributes', () => {
      expect(getFileIcon('.gitattributes')).toBe('git');
    });

    it('should return "eslint" for .eslintrc', () => {
      expect(getFileIcon('.eslintrc')).toBe('eslint');
    });

    it('should return "eslint" for eslint.config.js', () => {
      expect(getFileIcon('eslint.config.js')).toBe('eslint');
    });

    it('should return "config" for .env', () => {
      expect(getFileIcon('.env')).toBe('config');
    });

    it('should return "config" for .env.local', () => {
      expect(getFileIcon('.env.local')).toBe('config');
    });

    it('should return "config" for tsconfig.json', () => {
      expect(getFileIcon('tsconfig.json')).toBe('config');
    });

    it('should return "config" for vite.config.ts', () => {
      expect(getFileIcon('vite.config.ts')).toBe('config');
    });

    it('should return "config" for Makefile', () => {
      expect(getFileIcon('Makefile')).toBe('config');
    });

    it('should return "markdown" for README.md', () => {
      expect(getFileIcon('README.md')).toBe('markdown');
    });

    it('should return "changelog" for CHANGELOG.md', () => {
      expect(getFileIcon('CHANGELOG.md')).toBe('changelog');
    });
  });

  describe('extension mapping', () => {
    it('should return "rust" for .rs', () => {
      expect(getFileIcon('main.rs')).toBe('rust');
    });

    it('should return "typescript" for .ts', () => {
      expect(getFileIcon('index.ts')).toBe('typescript');
    });

    it('should return "react-typescript" for .tsx', () => {
      expect(getFileIcon('App.tsx')).toBe('react-typescript');
    });

    it('should return "javascript" for .js', () => {
      expect(getFileIcon('utils.js')).toBe('javascript');
    });

    it('should return "javascript" for .mjs', () => {
      expect(getFileIcon('utils.mjs')).toBe('javascript');
    });

    it('should return "react" for .jsx', () => {
      expect(getFileIcon('Component.jsx')).toBe('react');
    });

    it('should return "python" for .py', () => {
      expect(getFileIcon('script.py')).toBe('python');
    });

    it('should return "go" for .go', () => {
      expect(getFileIcon('main.go')).toBe('go');
    });

    it('should return "java" for .java', () => {
      expect(getFileIcon('Main.java')).toBe('java');
    });

    it('should return "css" for .css', () => {
      expect(getFileIcon('styles.css')).toBe('css');
    });

    it('should return "sass" for .scss', () => {
      expect(getFileIcon('styles.scss')).toBe('sass');
    });

    it('should return "html" for .html', () => {
      expect(getFileIcon('index.html')).toBe('html');
    });

    it('should return "json" for .json', () => {
      expect(getFileIcon('data.json')).toBe('json');
    });

    it('should return "yaml" for .yaml', () => {
      expect(getFileIcon('config.yaml')).toBe('yaml');
    });

    it('should return "yaml" for .yml', () => {
      expect(getFileIcon('config.yml')).toBe('yaml');
    });

    it('should return "markdown" for .md', () => {
      expect(getFileIcon('notes.md')).toBe('markdown');
    });

    it('should return "image" for .png', () => {
      expect(getFileIcon('photo.png')).toBe('image');
    });

    it('should return "image" for .svg', () => {
      expect(getFileIcon('logo.svg')).toBe('image');
    });

    it('should return "font" for .woff2', () => {
      expect(getFileIcon('font.woff2')).toBe('font');
    });

    it('should return "binary" for .wasm', () => {
      expect(getFileIcon('module.wasm')).toBe('binary');
    });

    it('should return "database" for .sqlite', () => {
      expect(getFileIcon('data.sqlite')).toBe('database');
    });

    it('should return "lock" for .lock', () => {
      expect(getFileIcon('yarn.lock')).toBe('lock');
    });
  });

  describe('case insensitivity', () => {
    it('should handle uppercase extensions', () => {
      expect(getFileIcon('main.RS')).toBe('rust');
    });

    it('should handle mixed case filenames', () => {
      expect(getFileIcon('Cargo.TOML')).toBe('toml');
    });
  });

  describe('edge cases', () => {
    it('should return "_file" for unknown extension', () => {
      expect(getFileIcon('unknown.xyz')).toBe('_file');
    });

    it('should return "_file" for no extension', () => {
      expect(getFileIcon('noextension')).toBe('_file');
    });

    it('should return "_file" for dotfile without extension', () => {
      expect(getFileIcon('.hidden')).toBe('_file');
    });
  });
});

describe('fileIconSrc', () => {
  it('should return correct path for .rs files', () => {
    expect(fileIconSrc('main.rs')).toBe('/icons/rust.svg');
  });

  it('should return correct path for .ts files', () => {
    expect(fileIconSrc('index.ts')).toBe('/icons/typescript.svg');
  });

  it('should return correct path for unknown files', () => {
    expect(fileIconSrc('unknown.xyz')).toBe('/icons/_file.svg');
  });
});
