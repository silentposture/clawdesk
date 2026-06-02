#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT_DIR=${1:-"$ROOT_DIR/artifacts/debug-bundle"}

mkdir -p "$OUT_DIR"

if command -v git >/dev/null 2>&1; then
  git -C "$ROOT_DIR" status --short --branch > "$OUT_DIR/git-status.txt" || true
  git -C "$ROOT_DIR" diff --stat > "$OUT_DIR/git-diff-stat.txt" || true
fi

if command -v node >/dev/null 2>&1; then
  node -v > "$OUT_DIR/node-version.txt" || true
fi

if command -v npm >/dev/null 2>&1; then
  npm -v > "$OUT_DIR/npm-version.txt" || true
fi

cat > "$OUT_DIR/README.txt" <<'EOF'
This bundle is intentionally redacted.
Do not add secrets, private hostnames, personal data, or raw screenshots with sensitive content.
EOF

for file in README.md LICENSE SECURITY.md CONTRIBUTING.md ROADMAP.md CHANGELOG.md PUBLIC_RELEASE_BLOCKERS.md; do
  if [ -f "$ROOT_DIR/$file" ]; then
    cp "$ROOT_DIR/$file" "$OUT_DIR/$file"
  fi
done

echo "Collected debug bundle in $OUT_DIR"

