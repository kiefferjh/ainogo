# Session data and CSV export

Each accepted rating produces one record. Eight images produce 16 CSV rows,
including separate reaction times for valence and arousal. No participant names
or participant IDs are collected yet; each session has a random session ID.

## Storage and recovery

The downloadable desktop app saves JSON files in its local data folder, with
atomic replacement and previous-copy recovery. See [DESKTOP.md](DESKTOP.md) for
the Windows/macOS/Linux paths, backup instructions, and offline download details.
The **Open data folder** button shows the actual folder. Desktop CSV export uses
a native Save dialog. No session files are stored inside the installed program.

The browser preview saves after Begin and after each rating to this site's `localStorage`,
under `ainogo.session.v1.<session-id>`. Each session has its own key. Use browser
developer tools → Application/Storage → Local Storage to inspect the JSON.
The saved records contain the image order, configuration, individual responses,
timestamps, completion state, and a revision used to detect conflicting edits.

Saved sessions appear on the welcome screen. Select an unfinished session and
choose **Resume session** to continue at the next unanswered rating. Earlier
ratings and the original image order stay intact. Changes to study content or
configuration disable resume for that session; its valid data can still be
downloaded. Completed sessions remain listed for download after starting another.

Use one tab per session. Detected changes from another tab pause the old tab
instead of overwriting the saved record. Its current in-memory responses can
still be downloaded. Browser storage is not a transactional multi-user database.

Browser-preview records belong to the current browser profile and site origin, not to a
server or GitHub. They do not automatically reach the researcher. Clearing site
data, ending a private browsing session, or changing browser/device can remove
access. Download CSV files for separate storage and transfer them using the lab's
chosen process. There is no cloud synchronization or backend in this version.

If storage is blocked or full, the app warns and continues in memory. Download
the CSV before refreshing or closing in that case. Damaged local records are
ignored without deleting them or other sessions.

## Timing definition

Timing uses `performance.now()`, starting at the end of the two-frame presentation
guard when the image is loaded and the current question becomes ready for input.
It ends when the accepted response handler runs. Saving, image-loading delays,
and preparing the next question are outside that reaction-time interval.

Numeric shortcuts respond on keydown. Mouse, touch, pen, Enter, Space, and
assistive button activation respond on the button's click/activation event.
Consequently, these methods can include different physical press/release and
event-delivery delays. Keep `input_method` when analyzing results. Browser clock
resolution, rendering, devices, and scheduling limit precision; this is not a
measurement of exact physical stimulus onset or specialized laboratory timing.

Losing window focus, hiding the tab, or resuming after refresh restarts the
current question's timer and flags its eventual response as `interrupted=true`.
Image errors also flag the retried question. Such times describe the restarted
presentation, not an uninterrupted trial; exclude or analyze them separately.
Previously accepted responses are not retimed or changed.

The optional time limit still displays a reminder and permits a response.
`exceeded_time_limit` is based on that rating's measured elapsed time. The app
does not fabricate a missing rating or auto-advance after a reminder.

## CSV columns

| Column | Meaning |
| --- | --- |
| `schema_version` | Data schema, currently 1. |
| `session_id` | Random identifier shared by all rows of this session. |
| `session_started_at` | UTC wall-clock time when Begin was selected. |
| `session_completed_at` | UTC completion time; empty for a partial download. |
| `image_id` | Stable image identifier. |
| `image_filename` | Filename of the original stimulus URL (may contain a build hash). |
| `image_order` | Image position, starting at 1. |
| `rating_dimension` | `valence` or `arousal`. |
| `rating_position` | First or second rating for that image: 1 or 2. |
| `rating_value` | Integer from 1 through 9. |
| `reaction_time_ms` | Monotonic elapsed time in milliseconds, measured independently for this rating. |
| `input_method` | `keyboard`, `mouse`, `touch`, or `pen`; assistive button activation without pointer metadata is classified as keyboard. |
| `responded_at` | UTC wall-clock time of the response; not used to calculate reaction time. |
| `time_limit_ms` | Configured reminder interval, or empty for no limit. |
| `exceeded_time_limit` | Whether measured reaction time reached or exceeded that interval. |
| `interrupted` | Whether this question was interrupted/restarted. |
| `rating_order` | Configured order, such as `valence then arousal`. |

**Download session CSV** is available after the first rating, including for
unfinished sessions. Files use `ainogo-<session-id>.csv`, UTF-8 with a BOM, CRLF
record separators, CSV escaping, and spreadsheet formula protection for text.
Repeated downloads are snapshots of the same session, not additional sessions;
avoid counting them twice. The local JSON also retains a study-content signature
used to check resume compatibility. Keep the study protocol with exported data.
