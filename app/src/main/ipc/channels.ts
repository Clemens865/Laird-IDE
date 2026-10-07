export const IPC = {
  SESSION_PING: 'session:ping',
  /**
   * Replaces the old unconditional `session:start` (Workstream D) — the
   * approval-mode-aware entry point every real send now goes through. See
   * `SessionManager.requestStart`/`confirmStart`/`cancelStart`.
   */
  SESSION_REQUEST_START: 'session:request-start',
  SESSION_CONFIRM_START: 'session:confirm-start',
  SESSION_CANCEL_START: 'session:cancel-start',
  SESSION_KILL: 'session:kill',
  SESSION_GRANT_AUTONOMY: 'session:grant-autonomy',
  SESSION_HISTORY_LIST: 'session:history-list',
  SESSION_EVENT: 'session:event',
  PROJECT_ADD: 'project:add',
  PROJECT_LIST: 'project:list',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_SET_PERMISSIONS: 'project:set-permissions',
  SKILLS_LIST: 'skills:list',
  SKILLS_SET_ENABLED: 'skills:set-enabled',
  SKILLS_RECOMMEND: 'skills:recommend',
  SKILLS_CREATE: 'skills:create',
  MARKETPLACE_LIST: 'marketplace:list',
  MARKETPLACE_BROWSE: 'marketplace:browse',
  MARKETPLACE_INSTALL: 'marketplace:install',
  MARKETPLACE_UNINSTALL: 'marketplace:uninstall',
} as const
