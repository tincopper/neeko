import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Types used in this project
    "type-enum": [
      2,
      "always",
      [
        "feat", // New feature
        "fix", // Bug fix
        "refactor", // Code refactoring
        "chore", // Maintenance (deps, config, etc.)
        "docs", // Documentation
        "style", // Formatting (no logic change)
        "perf", // Performance improvement
        "test", // Adding/fixing tests
        "build", // Build system changes
        "ci", // CI/CD changes
        "revert", // Revert a commit
        "wip", // Work in progress (temp)
      ],
    ],
    // Scope is optional (e.g., feat(library): ... or feat: ...)
    "scope-empty": [0, "always"],
    // Subject can be in English or Chinese
    "subject-empty": [2, "never"],
    "subject-full-stop": [0, "never"],
    "subject-case": [0, "always"],
    // No length limit for body/footer (flexible for detailed descriptions)
    "body-max-line-length": [0, "always"],
    "footer-max-line-length": [0, "always"],
  },
};

export default config;
