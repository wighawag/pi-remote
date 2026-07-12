---
"wherever-dev": patch
---

Add a `wherever --version` command (with `-v` and `version` aliases) that prints the installed package version. The version is read at runtime from the package's own `package.json` next to the entrypoint, so it reports correctly regardless of how the CLI was launched (npm, a Volta shim, or an absolute service path). The version line is also listed in `wherever help`.
