# Reliability testing

Desktop file persistence is covered by `tests/desktop-store.test.mjs` and
`npm run test:desktop`. The desktop release workflow also runs the restart and
CSV export smoke test against the packaged executable on each operating system.
The smoke test completes two participants with distinct session IDs, verifies
32 combined response rows, compares JSON against a re-read Excel workbook, and
checks the CSV row count. Store tests compare every field across JSON, CSV and
Excel for 25 participants, exercise incomplete sessions, and inject workbook and
manifest write failures to verify that the last complete set remains current.
Deleted collections rebuild on restart from individual session files.
Partial-session tests also start and complete a later participant, reopen the
store, compare all three formats, and finish the original partial session without
changing its ID or prior responses. The native smoke test checks the combined
files after closing an unfinished test without export. With two participants
saved, individual CSV export must contain only the current participant's 16 rows.
It checks local-only loading, absence of Node access in the renderer, and invalid
session-key rejection. Native smoke tests use temporary data/profile folders.
On a Linux development machine without a usable Chromium OS sandbox, the test
can explicitly use `AINOGO_TEST_NO_SANDBOX=1`; release launchers do not add it.

Use Node.js 22.13 or newer (the deployment workflow uses the latest Node 22).

Run the controlled event tests with `npm test`. These cover the full rating flow,
input controls, configuration validation, timers, loading failures, and retries.

For browser tests, install Chromium once with `npx playwright install chromium`,
then run `npm run test:browser`. This builds the production app and starts a
temporary preview server on port 4173 and a development server on port 4174.
The latter exercises configuration variants by intercepting the configuration
module in the browser; it never changes the repository configuration.
Playwright closes the browser and servers after the run. Linux CI installs
system dependencies with `--with-deps`.

To use an existing Chrome installation instead of downloading Chromium:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser
```

Browser tests cover desktop and mobile-sized Chrome layouts, full-session data
integrity, focus changes, repeated input, image errors, and stalled-request
recovery. Mobile emulation is not a substitute for testing physical phones.
CSV stays hidden during normal trials and appears on completion. Saving failures
allow an earlier recovery export. The online preview remains unsaved, including
after interruptions, and does not change previously saved browser sessions.
The suite also completes sessions with real browser touch events, delays image
delivery, and checks reminder resets and completion after advancing the clock.
Touch sessions use CPU throttling and wait for each confirmed prompt transition
so synthesized clicks are processed before the test issues another response.
Tests do not establish laboratory-grade visual presentation or reaction timing.

To exercise the GitHub Pages `/ainogo/` base path locally, prefix the browser test
command with `GITHUB_ACTIONS=true`. Normal builds use `/`.

Both suites run before the GitHub Pages artifact is uploaded. Failure traces are
stored in `test-results/`; open one with `npx playwright show-trace <trace.zip>`.
CI retains these files for seven days as the `browser-failure-traces` artifact
when a check fails. A failed build cannot publish a Pages artifact.

An image that has not loaded within 15 seconds offers a retry. This loading
timeout is separate from the optional rating reminder; missing-response behavior
remains an unresolved study-design question in `QUESTIONS_FOR_ABIGAIL.txt`.

Keyboard-only mode supports numeric shortcuts and native Tab/Enter/Space
activation of rating buttons. Mouse-only mode rejects both forms of keyboard
submission. Configuration errors disable Start and show an unavailable message;
the administrator can inspect the browser console for the underlying cause.
Duplicate/blank image IDs are rejected to protect response identity.
Mouse gestures begun on a previous question (or before an image loaded) cannot
submit a later rating after a keyboard response. Image retries preserve existing
URL query parameters and fragments while issuing a fresh network request.
Each question keeps responses disabled across two animation-frame callbacks,
giving the updated image/question a rendering opportunity before accepting input
or starting a reminder timer. This prevents queued inputs from answering a new
question in the same browser task; it does not measure exact physical display time.
Touch/pen activation uses the pointer type rather than assuming a zero click
count means keyboard input. Repeated touch click counts do not trigger the mouse
double-click filter; the rendering and prompt-version guards still apply.
Buttons disable double-tap zoom with `touch-action: manipulation` while preserving
normal scrolling and pinch zoom.
Start is disabled in the static HTML until initialization succeeds; script
download failures and JavaScript-disabled browsers cannot start a broken study.

`showImageDuringRating: false` is currently rejected: the prototype has no separate
presentation phase, so hiding the image would collect ratings without ever
showing it. Implement that phase after its duration and advancement behavior are
decided. Final study instructions still require confirmation. Reaction-time
recording, local per-session saving, partial-session recovery, and CSV download
are implemented; their definitions and limitations are documented in `DATA.md`.

Deployment uses versioned GitHub Actions on Ubuntu 24.04 and limits each job to
15 minutes to avoid unbounded waits or unexpected runner-image migrations.
