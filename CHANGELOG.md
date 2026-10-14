# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-10-09

### Added
- `zentao self-update` (alias `upgrade`): user-facing updater with `--check`, `--to VERSION`, `--yes`, `--json`. Detects npm/pnpm global installs and delegates to that package manager; npx, git checkouts and unknown installs get manual instructions. Verifies the installed version and offline `--help` afterwards and restores the previous version if that check fails. Never logs in, touches config, or publishes (#4).
- `zentao --version`.

### Fixed
- Commands no longer call `process.exit()` synchronously, fixing a libuv assertion on Windows (#1).
- Bug status changes read back the actual state instead of reporting no-ops as success.

## [0.2.1] - 2024-XX-XX

### Added
- Initial release
- ZenTao products list tool
- ZenTao bugs list tool
- ZenTao bugs stats tool
