module.exports = {
  root: true,
  env: {
    node: true,
    es6: true,
  },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  ignorePatterns: [
    'node_modules/*',
    'public/mockServiceWorker.js',
    'generators/*',
    'dist/*',
    'src-tauri/*',
  ],
  extends: ['eslint:recommended'],
  plugins: ['check-file'],
  overrides: [
    // ── .tsx files (React components) ──────────────────────────────────────
    {
      files: ['**/*.tsx'],
      parser: '@typescript-eslint/parser',
      settings: {
        react: { version: 'detect' },
        'import/resolver': {
          typescript: {},
        },
      },
      env: {
        browser: true,
        node: true,
        es6: true,
      },
      extends: [
        'eslint:recommended',
        'plugin:import/errors',
        'plugin:import/warnings',
        'plugin:import/typescript',
        'plugin:@typescript-eslint/recommended',
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
        'plugin:jsx-a11y/recommended',
        'plugin:prettier/recommended',
        'plugin:testing-library/react',
        'plugin:jest-dom/recommended',
        'plugin:vitest/legacy-recommended',
      ],
      rules: {
        // --- 架构层 ---
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              { target: './src/features/agent', from: './src/features', except: ['./agent'] },
              { target: './src/features/browser', from: './src/features', except: ['./browser'] },
              { target: './src/features/connection', from: './src/features', except: ['./connection'] },
              { target: './src/app/editor', from: './src/app', except: ['./editor'] },
              { target: './src/features/file', from: './src/features', except: ['./file'] },
              { target: './src/features/git', from: './src/features', except: ['./git', './file'] },
              { target: './src/features/project', from: './src/features', except: ['./project'] },
              { target: './src/features/session', from: './src/features', except: ['./session'] },
              { target: './src/features/settings', from: './src/features', except: ['./settings'] },
              { target: './src/features/skill', from: './src/features', except: ['./skill'] },
              { target: './src/features/task', from: './src/features', except: ['./task'] },
              { target: './src/features/terminal', from: './src/features', except: ['./terminal'] },
              { target: './src/features', from: './src/app', except: ['./app/editor'] },
              {
                target: [
                  './src/shared/components',
                  './src/shared/hooks',
                  './src/shared/store',
                  './src/shared/types',
                  './src/shared/utils',
                  './src/shared/contexts',
                  './src/lib',
                  './src/types',
                  './src/ui',
                  './src/layout',
                ],
                from: ['./src/features', './src/app'],
              },
            ],
          },
        ],
        'import/no-cycle': 'error',
        'import/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object'],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        // Block direct @tauri-apps/api/core imports outside api/ directories
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@tauri-apps/api/core',
                importNames: ['invoke'],
                message: 'Use the feature-specific API wrapper (e.g. projectApi.openIde) instead of invoke directly.',
              },
            ],
            patterns: [
              {
                group: ['@tauri-apps/api/core'],
                message: 'Use the feature-specific API wrapper instead of importing from @tauri-apps/api/core directly.',
              },
            ],
          },
        ],
        // .tsx files: PascalCase (React convention); exempt entry points
        'check-file/filename-naming-convention': [
          'error',
          {
            '**/*.tsx': 'PASCAL_CASE',
            '**/src/app/main.tsx': 'CAMEL_CASE',
          },
          { ignoreMiddleExtensions: true },
        ],
        // --- relaxed rules ---
        'import/default': 'off',
        'import/no-named-as-default-member': 'off',
        'import/no-named-as-default': 'off',
        'react/react-in-jsx-scope': 'off',
        'jsx-a11y/anchor-is-valid': 'off',
        'linebreak-style': ['error', 'unix'],
        'react/prop-types': 'off',
        '@typescript-eslint/no-unused-vars': ['error'],
        '@typescript-eslint/explicit-function-return-type': ['off'],
        '@typescript-eslint/explicit-module-boundary-types': ['off'],
        '@typescript-eslint/no-empty-function': ['off'],
        '@typescript-eslint/no-explicit-any': ['off'],
        'prettier/prettier': ['error', {}, { usePrettierrc: true }],
      },
    },
    // ── .ts files (hooks, utils, types, stores) ────────────────────────────
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      settings: {
        react: { version: 'detect' },
        'import/resolver': {
          typescript: {},
        },
      },
      env: {
        browser: true,
        node: true,
        es6: true,
      },
      extends: [
        'eslint:recommended',
        'plugin:import/errors',
        'plugin:import/warnings',
        'plugin:import/typescript',
        'plugin:@typescript-eslint/recommended',
        'plugin:react-hooks/recommended',
        'plugin:prettier/recommended',
        'plugin:vitest/legacy-recommended',
      ],
      rules: {
        // --- 架构层 ---
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              { target: './src/features/agent', from: './src/features', except: ['./agent'] },
              { target: './src/features/browser', from: './src/features', except: ['./browser'] },
              { target: './src/features/connection', from: './src/features', except: ['./connection'] },
              { target: './src/app/editor', from: './src/app', except: ['./editor'] },
              { target: './src/features/file', from: './src/features', except: ['./file'] },
              { target: './src/features/git', from: './src/features', except: ['./git', './file'] },
              { target: './src/features/project', from: './src/features', except: ['./project'] },
              { target: './src/features/session', from: './src/features', except: ['./session'] },
              { target: './src/features/settings', from: './src/features', except: ['./settings'] },
              { target: './src/features/skill', from: './src/features', except: ['./skill'] },
              { target: './src/features/task', from: './src/features', except: ['./task'] },
              { target: './src/features/terminal', from: './src/features', except: ['./terminal'] },
              { target: './src/features', from: './src/app', except: ['./app/editor'] },
              {
                target: [
                  './src/shared/components',
                  './src/shared/hooks',
                  './src/shared/store',
                  './src/shared/types',
                  './src/shared/utils',
                  './src/shared/contexts',
                  './src/lib',
                  './src/types',
                  './src/ui',
                  './src/layout',
                ],
                from: ['./src/features', './src/app'],
              },
            ],
          },
        ],
        'import/no-cycle': 'error',
        'import/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object'],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        // Block direct @tauri-apps/api/core imports outside api/ directories
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@tauri-apps/api/core',
                importNames: ['invoke'],
                message: 'Use the feature-specific API wrapper (e.g. projectApi.openIde) instead of invoke directly.',
              },
            ],
            patterns: [
              {
                group: ['@tauri-apps/api/core'],
                message: 'Use the feature-specific API wrapper instead of importing from @tauri-apps/api/core directly.',
              },
            ],
          },
        ],
        // .ts files: camelCase; exempt Vite convention files
        'check-file/filename-naming-convention': [
          'error',
          {
            '**/*.ts': 'CAMEL_CASE',
            'src/app/vite-env.d.ts': 'KEBAB_CASE',
          },
          { ignoreMiddleExtensions: true },
        ],
        // --- relaxed rules ---
        'import/default': 'off',
        'import/no-named-as-default-member': 'off',
        'import/no-named-as-default': 'off',
        'react/prop-types': 'off',
        'linebreak-style': ['error', 'unix'],
        '@typescript-eslint/no-unused-vars': ['error'],
        '@typescript-eslint/explicit-function-return-type': ['off'],
        '@typescript-eslint/explicit-module-boundary-types': ['off'],
        '@typescript-eslint/no-empty-function': ['off'],
        '@typescript-eslint/no-explicit-any': ['off'],
        'prettier/prettier': ['error', {}, { usePrettierrc: true }],
      },
    },
    // ── API files: allow @tauri-apps/api/core import ──────────────────────
    {
      files: ['src/features/*/api/*.ts', 'src/app/*/api/*.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
    // ── directory naming: kebab-case ───────────────────────────────────────
    {
      plugins: ['check-file'],
      files: ['src/**/!(__tests__)/*'],
      rules: {
        'check-file/folder-naming-convention': [
          'error',
          { 'src/**/!(__tests__)/**': 'KEBAB_CASE' },
        ],
      },
    },
  ],
};
