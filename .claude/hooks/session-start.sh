#!/bin/bash
#
# Session start for Claude Code on the web.
#
# Two jobs, both idempotent: install node modules, and make sure a Chromium
# the installed `playwright-core` will actually launch exists. Everything the
# audit core does — the browser suite, the hydration suite, `npm run
# blind:test` — dies at `browserType.launch` without the second one.
#
# Local machines are left alone (`CLAUDE_CODE_REMOTE`): a developer's browser
# registry is theirs, and a hook that reaches into it would be repairing
# something that is not broken.
#
# ## When this runs
#
# `startup` and `resume` only — the matcher is in `settings.json`, which is
# JSON and cannot say why, so it is said here.
#
# Both of those can land in a container that has nothing, which is the whole
# reason this exists; a resumed session especially, because the session
# outlives the container it started in. `clear` and `compact` cannot: they
# happen inside a container that `startup` or `resume` already provisioned, so
# there is nothing to install and nothing to link.
#
# Firing there is not merely wasted work. Compaction happens *mid-task*, so an
# `npm install` — or, if the expected build is missing, a 180-second
# `playwright install` — would run against the same `node_modules` as whatever
# command is in flight. `tests/deploy/session-start-hook-scope.test.ts` pins
# the matcher, because nothing else reads that file.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

echo "session-start: installing node modules"
npm install --no-audit --no-fund

# ---------------------------------------------------------------------------
# Chromium
#
# The container ships a Chromium under PLAYWRIGHT_BROWSERS_PATH, but not
# necessarily the build this `playwright-core` asks for — the pinned revision
# moves with every Playwright upgrade, and the image is built independently.
# When they disagree, Playwright refuses to launch and tells you to run
# `playwright install`, which on a network policy without `cdn.playwright.dev`
# answers 403 four times and leaves you where you started.
#
# So: try the real download first, and if the expected build still is not
# there, point the expected path at the build that *is* installed. Linking
# across revisions is a compromise, not a fix — it is the same browser family
# some revisions apart, which has been good enough to drive a full audit, and
# is not something to trust a Chromium-version-sensitive bug report to.
# ---------------------------------------------------------------------------
BROWSERS_ROOT="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

revision_for() {
  python3 -c "
import json, sys
browsers = json.load(open('node_modules/playwright-core/browsers.json'))['browsers']
print(next(b['revision'] for b in browsers if b['name'] == sys.argv[1]))
" "$1"
}

# Where this playwright-core expects to find each binary.
expected_path() {
  case "$1" in
    chromium) echo "$BROWSERS_ROOT/chromium-$2/chrome-linux64/chrome" ;;
    chromium-headless-shell)
      echo "$BROWSERS_ROOT/chromium_headless_shell-$2/chrome-headless-shell-linux64/chrome-headless-shell"
      ;;
  esac
}

# Any binary of the right kind already unpacked in the registry, newest first.
# Both layouts are searched: builds before Chrome-for-Testing used
# `chrome-linux/chrome` and `chrome-linux/headless_shell`.
installed_binary() {
  case "$1" in
    chromium) find "$BROWSERS_ROOT" -maxdepth 3 -type f -name chrome -path '*chromium-*' 2>/dev/null | sort -r | head -1 ;;
    chromium-headless-shell)
      find "$BROWSERS_ROOT" -maxdepth 3 -type f \( -name headless_shell -o -name chrome-headless-shell \) 2>/dev/null | sort -r | head -1
      ;;
  esac
}

if [ ! -d "$BROWSERS_ROOT" ]; then
  echo "session-start: no browser registry at $BROWSERS_ROOT, leaving Chromium alone"
  exit 0
fi

needs_browser=false
for browser in chromium chromium-headless-shell; do
  if [ ! -x "$(expected_path "$browser" "$(revision_for "$browser")")" ]; then
    needs_browser=true
  fi
done

if [ "$needs_browser" = true ]; then
  echo "session-start: expected Chromium build missing, trying playwright install"
  # Never fatal. A blocked CDN is the case this whole block exists for, and a
  # session that refuses to start because a download was denied is worse than
  # one that starts with a linked browser.
  timeout 180 npx playwright install chromium >/dev/null 2>&1 || true
fi

for browser in chromium chromium-headless-shell; do
  revision="$(revision_for "$browser")"
  want="$(expected_path "$browser" "$revision")"

  if [ -x "$want" ]; then
    continue
  fi

  have="$(installed_binary "$browser")"
  if [ -z "$have" ]; then
    echo "session-start: no $browser binary to link; browser suites will not run" >&2
    continue
  fi

  mkdir -p "$(dirname "$want")"
  ln -sfn "$have" "$want"
  # Playwright checks for these markers before it will use a registry entry.
  marker_dir="$(dirname "$(dirname "$want")")"
  touch "$marker_dir/INSTALLATION_COMPLETE" "$marker_dir/DEPENDENCIES_VALIDATED"
  echo "session-start: linked $browser $revision -> $have"
done
