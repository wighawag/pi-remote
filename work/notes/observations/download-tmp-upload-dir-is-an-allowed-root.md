# /session/download: default `uploads.type: 'tmp'` makes all of `os.tmpdir()` an allowed download root

2026-07-20 — noticed while writing Range tests for `GET /session/download`.

`resolveDownloadRoots()` always adds `resolveUploadDir()`, and the DEFAULT
`uploads.type` is `'tmp'` → `os.tmpdir()`. So with the default config, ANY file
anywhere under `/tmp` is downloadable via a valid session, not just files under
the session cwd. This is existing behaviour (not introduced by the Range work),
but it means an out-of-root test fixture placed in a sibling `/tmp` dir is in
fact IN-root. Out-of-scope for the video/Range task; flagging in case the
deny-by-default posture should exclude a shared world-writable `/tmp` by default.
