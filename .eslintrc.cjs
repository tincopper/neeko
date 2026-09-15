// Import/Export Firewall: 跨 feature 仅允许导入公开面（index 门面 + store/types 直导）。
// zone 语义：target 目录内的文件不得从 from 目录导入（except 豁免），见
// eslint-plugin-import/no-restricted-paths。
const FEATURE_DIRS = [
  'action-menu', 'agent', 'browser', 'connection', 'conversation', 'debug',
  'editor', 'file', 'git', 'library', 'lsp', 'notification', 'project',
  'quick-open', 'runner', 'session', 'settings', 'skill', 'status-bar', 'symbol-nav',
  'task', 'terminal', 'theme',
];
// except 相对 from（feature 根）解析。store/types/api 兼容单文件与目录形态。
const FIREWALL_EXCEPT = [
  './index.ts', './store.ts', './store', './types.ts', './types',
  './api.ts', './api',
];
const firewallZones = FEATURE_DIRS.map((name) => ({
  target: FEATURE_DIRS.filter((other) => other !== name).map(
    (other) => `./src/features/${other}`,
  ),
  from: `./src/features/${name}`,
  except: FIREWALL_EXCEPT,
  message:
    `Import/Export Firewall: 跨 feature 仅允许导入公开面 (index/store/types)。` +
    `私有实现请经 @/features/${name} 门面导入。`,
}));

// store 域内**切片目录**（如 `runner/store/debug/**`）是**组合内部件**（slice 工厂 +
// types/shared/中间件），不是「公开状态接口」。而 `FIREWALL_EXCEPT` 里的 `'./store'` 是
// **路径前缀**豁免（为 `store/debugStore.ts` 这类公开 store 设计），会把切片目录一并放行
// —— 于是别的 feature 可以直导 `createSessionSlice` 自行 `create()` 出第二个 store 实例，
// 击穿「单实例」不变量，门面形同虚设。这里把前缀豁免收窄回来：切片只允许被**本 feature**
// （含 `store/debugStore.ts` 组合根）引用，其余一律经门面。
const sliceZones = [
  {
    target: [
      ...FEATURE_DIRS.filter((name) => name !== 'runner').map((name) => `./src/features/${name}`),
      './src/app',
      // 非 feature / 非 app 的顶层目录。既有 shared 相关 zone 只枚举了 `shared/<sub>` 六个
      // **子目录**，`src/shared/*.ts`（如真实存在的 `shared/events.ts`）不在其中 —— 实测该处
      // 可直导切片且无任何报错（Neeko Check F20）。这里补齐根级，顺带覆盖 layout/lib/ui/types。
      './src/shared',
      './src/layout',
      './src/lib',
      './src/ui',
      './src/types',
    ],
    from: './src/features/runner/store/debug',
    message:
      'store/debug/** 是 debugStore 的组合内部件（slice 工厂，非公开状态接口）：' +
      '跨 feature / app 请经 @/features/runner/store/debugStore 门面导入。',
  },
];

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
              // 切片封闭 zone 必须先于通用前缀豁免：见顶部 `sliceZones` 定义处注释。
              ...sliceZones,
              ...firewallZones,
              { target: './src/app/editor', from: './src/app', except: ['./editor'] },
              { target: './src/features', from: './src/app', except: ['./app/editor'] },
              {
                target: './src/layout',
                from: ['./src/features', './src/app'],
                message:
                  'layout/ must not import from features/ or app/. Move coordination logic to src/app/.',
              },
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
                message:
                  'Use the feature-specific API wrapper (e.g. projectApi.openIde) instead of invoke directly.',
              },
            ],
            patterns: [
              {
                group: ['@tauri-apps/api/core'],
                message:
                  'Use the feature-specific API wrapper instead of importing from @tauri-apps/api/core directly.',
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
              // 切片封闭 zone 必须先于通用前缀豁免：见顶部 `sliceZones` 定义处注释。
              ...sliceZones,
              ...firewallZones,
              { target: './src/app/editor', from: './src/app', except: ['./editor'] },
              { target: './src/features', from: './src/app', except: ['./app/editor'] },
              {
                target: './src/layout',
                from: ['./src/features', './src/app'],
                message:
                  'layout/ must not import from features/ or app/. Move coordination logic to src/app/.',
              },
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
                message:
                  'Use the feature-specific API wrapper (e.g. projectApi.openIde) instead of invoke directly.',
              },
            ],
            patterns: [
              {
                group: ['@tauri-apps/api/core'],
                message:
                  'Use the feature-specific API wrapper instead of importing from @tauri-apps/api/core directly.',
              },
            ],
          },
        ],
        // .ts files: camelCase; exempt Vite convention files
        'check-file/filename-naming-convention': [
          'error',
          {
            '**/*.ts': 'CAMEL_CASE',
            '**/vite-env.d.ts': 'KEBAB_CASE',
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
