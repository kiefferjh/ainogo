# Reliability testing

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
Start is disabled in the static HTML until initialization succeeds; script
download failures and JavaScript-disabled browsers cannot start a broken study.

`showImageDuringRating: false` is currently rejected: the prototype has no separate
presentation phase, so hiding the image would collect ratings without ever
showing it. Implement that phase after its duration and advancement behavior are
decided. Results are still held in memory, as the completion screen explains;
CSV export and final study instructions remain unfinished study features.

Deployment uses versioned GitHub Actions on Ubuntu 24.04 and limits each job to
15 minutes to avoid unbounded waits or unexpected runner-image migrations.
