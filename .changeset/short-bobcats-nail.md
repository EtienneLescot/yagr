---
'@yagr/runtime-events': patch
---

Clean up shell operation summaries by stripping transport noise like `[stderr]` and replacing raw `exit 0`-style status text with more useful user-facing output.
