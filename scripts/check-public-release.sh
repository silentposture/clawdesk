#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

required_files="
README.md
LICENSE
SECURITY.md
CONTRIBUTING.md
CODE_OF_CONDUCT.md
ROADMAP.md
CHANGELOG.md
PUBLIC_RELEASE_CHECKLIST.md
PUBLIC_RELEASE_BLOCKERS.md
.env.example
docs/README.md
docs/architecture.md
docs/security-model.md
docs/agent-bridge.md
docs/transport.md
docs/troubleshooting.md
docs/release-process.md
docs/mvp.md
docs/roadmap-issues.md
docs/codex-for-oss-application.md
docs/audit/public-release-audit.md
"

for file in $required_files; do
  if [ ! -f "$ROOT_DIR/$file" ]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

private_host_part_one='navia'
private_host_part_two='works.net'
private_host="${private_host_part_one}${private_host_part_two}"
gmail_part_one='@g'
gmail_part_two='mail.com'
gmail_pattern="${gmail_part_one}${gmail_part_two}"

scan_targets="README.md LICENSE SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md ROADMAP.md CHANGELOG.md PUBLIC_RELEASE_CHECKLIST.md PUBLIC_RELEASE_BLOCKERS.md .env.example docs src src-tauri scripts/check-public-release.sh scripts/collect-debug-bundle.sh .github infra"

for pattern in "$gmail_pattern" "$private_host"; do
  for target in $scan_targets; do
    if [ -e "$ROOT_DIR/$target" ] && grep -RInF \
      --exclude-dir=.git \
      --exclude-dir=node_modules \
      --exclude-dir=dist \
      --exclude-dir=target \
      --exclude-dir=artifacts \
      "$pattern" "$ROOT_DIR/$target"; then
      echo "Public release blocker: $pattern" >&2
      exit 1
    fi
  done
done

echo "PASS: public release surface looks clean."
