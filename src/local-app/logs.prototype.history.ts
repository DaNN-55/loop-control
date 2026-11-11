// One authentic historical runtime error, copied read-only and sanitized.
// Source has no timestamp, production order, request ID or operation ID.
export const historySnapshot = {
  "sourceFile": ".loop-control/local/app-private.log",
  "sourceStartLine": 13143,
  "sourceEndLine": 13149,
  "importedOn": "2026-11-11",
  "rawExcerpt": "Error: Connection terminated unexpectedly\n    at Connection.<anonymous> ([项目目录]/node_modules/pg/lib/client.js:204:73)\n    at Connection.wrapper (node:events:639:12)\n    at Connection.emit (node:events:514:28)\n    at Socket.<anonymous> ([项目目录]/node_modules/pg/lib/connection.js:64:12)\n    at Socket.emit (node:events:514:28)\n    at TCP.<anonymous> (node:net:362:12)",
  "excerptSha256": "51762aa1c662e94b521e484641027a0cb2d250e5306e8f418ffb78112c10664a"
} as const;
