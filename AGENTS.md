# Browser target

Use regular Google Chrome for BetterSlopHits installation and browser verification. It has the user's target profile and Tampermonkey installation.

Do not use Chrome Beta for this project or enable Google profile sync in its dedicated debugging profile. The shared Chrome DevTools MCP may still be configured to target Beta; verify the connection before using it.

Do not resize the shared browser window. Use page-only viewport emulation for responsive checks.

Keep smoke tests in background tabs. Never activate Chrome or call `bringToFront()` during routine checks. Native fullscreen testing requires an explicit foreground opt-in from the user; skip it otherwise and report the skip.

Keep one regular Chrome remote-debugging connection alive across smoke-test runs and investigations. Reuse it rather than reconnecting for each command or test run: Chrome prompts for approval on every new connection. Do not disable Chrome's security prompts.

# Versions

Use `YYYY-MM-DD.NN`: the release date followed by its two-digit daily release number (for example, `2026-11-01.01`). Do not use semantic versioning. Use Europe/Vienna for the release date.
