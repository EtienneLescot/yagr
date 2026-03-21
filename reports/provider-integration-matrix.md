# Provider Integration Matrix

- Generated at: 2026-03-21T15:22:54.840Z
- Providers: `google-proxy`
- Timeouts: setup/model=60000ms, inference=75000ms
- Advanced scenario: enabled (timeout=120000ms)

## Summary

| Step | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| setup | 0 | 0 | 1 |
| model-listing | 0 | 0 | 1 |
| inference | 0 | 0 | 1 |
| advanced-scenario | 0 | 1 | 0 |

## Details

| Provider | Setup | Model Listing | Inference | Advanced Scenario |
| --- | --- | --- | --- | --- |
| `google-proxy` | **SKIP**<br>Unable to sign in to Gemini. Complete the Google OAuth flow and retry. | **SKIP**<br>Skipped because setup is not available. | **SKIP**<br>Skipped because setup is not available. | **FAIL**<br>Yagr CLI error: Gemini OAuth session not found. Run `yagr setup` again. (log: /home/etienne/repos/yagr/reports/provider-advanced-logs/google-proxy-2026-03-21T15-22-54-838Z.log) |
