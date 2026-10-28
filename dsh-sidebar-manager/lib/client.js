/**
 * Sidebar Manager — Browser half (module-loader CJS factory).
 *
 * All user-facing copy lives in the I18N object below. Do not hardcode UI text
 * anywhere else in this file. The active language follows navigator.language:
 * any `ko*` locale selects Korean; everything else falls back to English.
 */
window.__ModuleLoader__.load({
  id: '@nolit/dsh-sidebar-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    // ===== I18N START (edit user-facing text only in this block) =====
    const I18N = {
      ko: {
        // Session row actions
        'session.trash.aria': '세션 영구 삭제',
        'session.menu.purge': '영구 삭제…',
        'session.menu.move': '다른 워크스페이스로 이동…',
        'session.menu.fork': '새 프로젝트로 분기…',
        // Footer entry and workspace manager
        'workspaceManager.aria': '워크스페이스 관리자',
        'workspaceManager.title': '워크스페이스 관리자',
        'workspaceManager.description': '워크스페이스를 보관·복원하거나 이름을 변경합니다.',
        'workspaceManager.empty': '등록된 워크스페이스가 없습니다.',
        'workspaceManager.archive': '보관',
        'workspaceManager.restore': '복원',
        'workspaceManager.archived': '보관된 워크스페이스',
        'workspaceManager.rename': '이름 변경…',
        'workspaceManager.renameFolder': '폴더까지 이름 변경…',
        'workspaceManager.renameAction': '이름 변경',
        'workspaceManager.includeFolder': '실제 디렉토리 포함',
        'workspaceManager.folderName': '새 디렉토리명',
        'workspaceManager.folderHint': '체크한 경우에만 실제 폴더를 함께 변경합니다.',
        'workspaceManager.inlineHint': 'Enter 저장 · Esc 취소',
        'workspaceManager.unchanged': '변경된 내용이 없습니다.',
        'workspaceManager.pathPreview': '경로: {oldPath} → {newPath}',
        'workspaceManager.close': '닫기',
        // Virtual grouping (HQ tree)
        'groups.title': '가상 그룹 (HQ)',
        'groups.description': '그룹별 관제탑과 하위 모듈을 표시합니다. 이름/구조 변경은 이 관리자에서만 수행하세요.',
        'groups.empty': '아직 구성된 그룹이 없습니다.',
        'groups.system': '시스템',
        'groups.project': '프로젝트',
        'groups.proposed': '제안',
        'groups.hq': '관제탑',
        'groups.hqMissing': 'HQ(00) 없음',
        'groups.modules': '모듈',
        'groups.sessions': '세션 {count}',
        'groups.open': '열기',
        'groups.align': '사이드바 순서 정렬',
        'groups.alignPreview': '정렬 미리보기',
        'groups.alignApplied': '사이드바 순서를 정렬했습니다.',
        'groups.alignNoop': '이미 정렬된 상태입니다.',
        'groups.alignFailed': '정렬 실패 — 원래 순서로 복구했습니다.',
        'groups.moveCount': '이동 {count}건',
        'groups.ungrouped': '미분류',
        'groups.refresh': '새로고침',
        'groups.pinTop': '상단 고정',
        'groups.confirmOrderTitle': '사이드바 순서 정렬',
        'groups.confirmOrderBody': '다음 순서로 네이티브 사이드바를 재배열합니다. 시스템 코어가 먼저, 이후 그룹이 {INDEX} 순으로 배치됩니다.',
        'groups.confirmOrderMoves': '이동 {count}건',
        'groups.confirmOrderNoop': '이미 정렬되어 있어 변경이 없습니다.',
        'groups.confirmOrderCheck': '위 내용을 확인했으며 사이드바 순서가 변경됨을 이해합니다.',
        'groups.confirmOrderApply': '정렬 실행',
        'groups.confirmOrderCancel': '취소',
        'groups.hqTitle': 'HQ(00) 관제탑 생성',
        'groups.hqGroup': '그룹 이름',
        'groups.hqMain': '메인 프로젝트 이름',
        'groups.hqCreate': 'HQ 생성 및 승격',
        'groups.hqCreated': 'HQ를 생성했습니다.',
        'groups.hqExists': '이미 존재합니다.',
        'groups.orphansTitle': '레거시/고아 로그',
        'groups.orphansScan': '분류 스캔',
        'groups.orphansNote': '분류만 수행합니다. 로그는 이동/삭제되지 않습니다.',
        'groups.orphansTotal': '전체 {total} · 미연결 {count}',
        'groups.promoteTitle': '프로젝트 승격',
        'groups.promotePath': '대상 경로',
        'groups.promoteTitleField': '워크스페이스 제목',
        'groups.promoteAction': '승격 실행',
        'groups.promotePreview': '승격 미리보기',
        'groups.manageOnly': '구조 변경은 이 관리자에서만 수행하세요.',
        'groups.policyReadOnly': '참조 전용',
        'groups.policySelfContained': '자체 완결',
        'groups.roleContract': '계약',
        'groups.roleImplementation': '구현',
        'groups.advisoryTitle': '관찰 항목 (비차단)',
        'groups.advisoryNone': '관찰된 항목이 없습니다.',
        'groups.noticeArtifacts': '계약 노드에서 구현 아티팩트가 관찰되었습니다 (정보 제공용).',
        // Common dialog text
        'common.cancel': '취소',
        'common.close': '닫기',
        'common.confirm': '실행',
        'common.preflight': '사전 확인 중…',
        'common.preflightFailed': '사전 확인에 실패했습니다.',
        'common.previewUnavailable': '사전 확인 API가 아직 준비되지 않았습니다(P2).',
        'common.applyFailed': '작업을 시작하지 못했습니다.',
        'common.backendPending': 'Host API가 아직 준비되지 않았습니다(P2).',
        'common.preview': '사전 확인',
        'common.restartRequired': 'DSH 서버를 재시작한 뒤 사이드바에 반영됩니다.',
        'common.cwdWarning': '이후 에이전트의 명령 실행과 파일 생성 기준 경로가 새 경로로 바뀝니다.',
        'common.applied': '적용되었습니다.',
        'common.unknownError': '알 수 없는 오류가 발생했습니다.',
        'common.loading': '불러오는 중…',
        // Shared confirmation gate
        'gate.ack': '위 내용을 확인했으며, DSH 재시작 후 반영됨을 이해합니다.',
        'gate.affected': '영향받는 세션: {count}개',
        'gate.workspace': '워크스페이스: {title}',
        'gate.path': '경로: {oldPath} → {newPath}',
        'gate.liveBlocked': '실행 중이거나 열려 있는 세션이 {count}개 있어 작업할 수 없습니다. 세션을 닫은 뒤 다시 시도하세요.',
        'gate.defaultWorkspaceBlocked': '기본 워크스페이스는 폴더 이름을 변경할 수 없습니다. 이름만 변경하세요.',
        'gate.targetExists': '대상 경로가 이미 존재합니다: {path}',
        'gate.restart': '파일을 먼저 재배치한 뒤, DSH 서버를 재시작해야 목록에 반영됩니다.',
        'gate.externalPath': 'projectsRoot 밖의 경로입니다. 계속하려면 명시적으로 허용해야 합니다.',
        'gate.absolutePath': '절대 경로를 입력하세요.',
        'gate.blankName': '이름을 입력하세요.',
        'gate.blockers': '차단 사유',
        'gate.previewPending': '사전 확인 결과를 기다리는 중입니다…',
        'gate.sessionMissing': '세션을 찾을 수 없습니다.',
        'gate.workspaceMissing': '워크스페이스를 찾을 수 없습니다.',
        'gate.sameWorkspace': '이미 대상 워크스페이스에 속해 있습니다.',
        'gate.workspaceDirMissing': '워크스페이스 디렉터리가 없습니다: {path}',
        'gate.folderInvalid': '폴더명에는 경로 구분자를 쓸 수 없습니다.',
        'gate.samePath': '새 경로가 기존 경로와 같습니다.',
        'gate.archiveMissing': '보관된 워크스페이스 기록이 없습니다.',
        'gate.sessionControllerMissing': '세션 컨트롤러를 사용할 수 없습니다.',
        'gate.forkChildLive': '분기된 세션이 아직 활성 상태라 이동할 수 없습니다. 잠시 후 다시 시도하세요.',
        // Move to workspace
        'move.title': '다른 워크스페이스로 이동',
        'move.select': '대상 워크스페이스',
        'move.submit': '이동 예약',
        // Fork to new workspace
        'fork.title': '새 프로젝트로 분기',
        'fork.name': '프로젝트 이름',
        'fork.path': '디스크 경로',
        'fork.pathHint': '기본값은 projectsRoot/<slug>이며 직접 수정할 수 있습니다.',
        'fork.submit': '분기 예약',
        // Workspace rename (folder-linked)
        'rename.title': '워크스페이스 이름 변경',
        'rename.displayName': '표시 이름',
        'rename.folderCheckbox': '실제 디스크 폴더명도 함께 변경',
        'rename.folderName': '새 폴더명',
        'rename.preview': '변경 경로: {oldPath} → {newPath}',
        'rename.submit': '이름 변경 예약',
        // Hard delete
        'purge.title': '세션 영구 삭제',
        'purge.desc': '아카이브된 Cold 세션의 로그·캐시·레지스트리 매핑을 삭제합니다. 이 작업은 되돌릴 수 없습니다.',
        'purge.notArchived': '먼저 세션을 아카이브해야 합니다.',
        'purge.liveBlocked': '실행 중인 세션은 삭제할 수 없습니다.',
        'purge.ack': '이 작업은 되돌릴 수 없음을 이해합니다.',
        'purge.submit': '영구 삭제',
        'purge.done': '세션을 영구 삭제했습니다.',
        // Notices
        'notice.restartScheduled': '작업이 예약되었습니다. DSH를 재시작하면 반영됩니다.',
        'notice.archived': '워크스페이스를 보관했습니다.',
        'notice.restored': '워크스페이스를 복원했습니다.',
        'notice.renamed': '워크스페이스 이름을 변경했습니다.',
        'notice.renameFailed': '워크스페이스 이름을 변경하지 못했습니다.',
        'notice.previewCount': 'Cold 세션 {count}개가 영향을 받습니다.',
        'notice.archiveFailed': '워크스페이스를 보관하지 못했습니다.',
        'notice.restoreFailed': '워크스페이스를 복원하지 못했습니다.',
      },
      en: {
        // Session row actions
        'session.trash.aria': 'Permanently delete session',
        'session.menu.purge': 'Delete permanently…',
        'session.menu.move': 'Move to workspace…',
        'session.menu.fork': 'Fork to new workspace…',
        // Footer entry and workspace manager
        'workspaceManager.aria': 'Workspace manager',
        'workspaceManager.title': 'Workspace manager',
        'workspaceManager.description': 'Archive, restore, or rename workspaces.',
        'workspaceManager.empty': 'No workspaces are registered.',
        'workspaceManager.archive': 'Archive',
        'workspaceManager.restore': 'Restore',
        'workspaceManager.archived': 'Archived workspaces',
        'workspaceManager.rename': 'Rename…',
        'workspaceManager.renameFolder': 'Rename folder too…',
        'workspaceManager.renameAction': 'Rename',
        'workspaceManager.includeFolder': 'Include actual directory',
        'workspaceManager.folderName': 'New directory name',
        'workspaceManager.folderHint': 'The actual folder changes only when this is checked.',
        'workspaceManager.inlineHint': 'Enter to save · Esc to cancel',
        'workspaceManager.unchanged': 'No changes to save.',
        'workspaceManager.pathPreview': 'Path: {oldPath} → {newPath}',
        'workspaceManager.close': 'Close',
        // Virtual grouping (HQ tree)
        'groups.title': 'Virtual groups (HQ)',
        'groups.description': 'Control tower and sub-modules per group. Rename and restructure only from this manager.',
        'groups.empty': 'No groups configured yet.',
        'groups.system': 'System',
        'groups.project': 'Project',
        'groups.proposed': 'Proposed',
        'groups.hq': 'HQ',
        'groups.hqMissing': 'No HQ (00)',
        'groups.modules': 'Modules',
        'groups.sessions': '{count} sessions',
        'groups.open': 'Open',
        'groups.align': 'Align sidebar order',
        'groups.alignPreview': 'Preview order',
        'groups.alignApplied': 'Sidebar order aligned.',
        'groups.alignNoop': 'Already aligned.',
        'groups.alignFailed': 'Align failed — previous order restored.',
        'groups.moveCount': '{count} moves',
        'groups.ungrouped': 'Ungrouped',
        'groups.refresh': 'Refresh',
        'groups.pinTop': 'Pinned on top',
        'groups.confirmOrderTitle': 'Align sidebar order',
        'groups.confirmOrderBody': 'Reorders the native sidebar: system cores first, then groups by {INDEX}.',
        'groups.confirmOrderMoves': '{count} moves',
        'groups.confirmOrderNoop': 'Already aligned — nothing to change.',
        'groups.confirmOrderCheck': 'I understand the sidebar order will change.',
        'groups.confirmOrderApply': 'Apply order',
        'groups.confirmOrderCancel': 'Cancel',
        'groups.hqTitle': 'Create HQ (00) control tower',
        'groups.hqGroup': 'Group name',
        'groups.hqMain': 'Main project name',
        'groups.hqCreate': 'Create & promote HQ',
        'groups.hqCreated': 'HQ created.',
        'groups.hqExists': 'Already exists.',
        'groups.orphansTitle': 'Legacy / orphan logs',
        'groups.orphansScan': 'Scan',
        'groups.orphansNote': 'Classification only. No log is moved or deleted.',
        'groups.orphansTotal': '{total} total · {count} disconnected',
        'groups.promoteTitle': 'Promote project',
        'groups.promotePath': 'Target path',
        'groups.promoteTitleField': 'Workspace title',
        'groups.promoteAction': 'Promote',
        'groups.promotePreview': 'Preview promotion',
        'groups.manageOnly': 'Restructure only from this manager.',
        'groups.policyReadOnly': 'Reference only',
        'groups.policySelfContained': 'Self-contained',
        'groups.roleContract': 'Contract',
        'groups.roleImplementation': 'Implementation',
        'groups.advisoryTitle': 'Observations (non-blocking)',
        'groups.advisoryNone': 'No observations.',
        'groups.noticeArtifacts': 'Implementation artifacts observed in a contract node (informational).',
        // Common dialog text
        'common.cancel': 'Cancel',
        'common.close': 'Close',
        'common.confirm': 'Run',
        'common.preflight': 'Checking…',
        'common.preflightFailed': 'Preflight failed.',
        'common.previewUnavailable': 'The preview API is not available yet (P2).',
        'common.applyFailed': 'Could not start the operation.',
        'common.backendPending': 'The Host API is not available yet (P2).',
        'common.preview': 'Preview',
        'common.restartRequired': 'A DSH server restart is required before this appears in the sidebar.',
        'common.cwdWarning': 'The agent working directory for future commands and file creation will change to the new path.',
        'common.applied': 'Applied.',
        'common.unknownError': 'An unknown error occurred.',
        'common.loading': 'Loading…',
        // Shared confirmation gate
        'gate.ack': 'I have read the details and understand that a DSH restart is required.',
        'gate.affected': 'Affected sessions: {count}',
        'gate.workspace': 'Workspace: {title}',
        'gate.path': 'Path: {oldPath} → {newPath}',
        'gate.liveBlocked': '{count} session(s) are running or open, so this operation is blocked. Close them and retry.',
        'gate.defaultWorkspaceBlocked': 'The default workspace folder cannot be renamed. Rename the label only.',
        'gate.targetExists': 'The target path already exists: {path}',
        'gate.restart': 'The files are relocated now, but the sidebar updates only after the DSH server restarts.',
        'gate.externalPath': 'This path is outside projectsRoot. Enable external paths explicitly to continue.',
        'gate.absolutePath': 'Enter an absolute path.',
        'gate.blankName': 'Enter a name.',
        'gate.blockers': 'Blockers',
        'gate.previewPending': 'Waiting for the preview result…',
        'gate.sessionMissing': 'The session was not found.',
        'gate.workspaceMissing': 'The workspace was not found.',
        'gate.sameWorkspace': 'The session already belongs to the target workspace.',
        'gate.workspaceDirMissing': 'The workspace directory is missing: {path}',
        'gate.folderInvalid': 'A folder name cannot contain path separators.',
        'gate.samePath': 'The new path equals the current path.',
        'gate.archiveMissing': 'No archived workspace record was found.',
        'gate.sessionControllerMissing': 'The session controller is unavailable.',
        'gate.forkChildLive': 'The forked session is still active, so it cannot be moved yet. Try again shortly.',
        // Move to workspace
        'move.title': 'Move to workspace',
        'move.select': 'Target workspace',
        'move.submit': 'Schedule move',
        // Fork to new workspace
        'fork.title': 'Fork to new workspace',
        'fork.name': 'Project name',
        'fork.path': 'Disk path',
        'fork.pathHint': 'Defaults to projectsRoot/<slug> and can be edited.',
        'fork.submit': 'Schedule fork',
        // Workspace rename (folder-linked)
        'rename.title': 'Rename workspace',
        'rename.displayName': 'Display name',
        'rename.folderCheckbox': 'Also rename the actual disk folder',
        'rename.folderName': 'New folder name',
        'rename.preview': 'Path change: {oldPath} → {newPath}',
        'rename.submit': 'Schedule rename',
        // Hard delete
        'purge.title': 'Permanently delete session',
        'purge.desc': 'Deletes the log, cache, and registry mapping of an archived cold session. This cannot be undone.',
        'purge.notArchived': 'Archive the session first.',
        'purge.liveBlocked': 'A running session cannot be deleted.',
        'purge.ack': 'I understand that this cannot be undone.',
        'purge.submit': 'Delete permanently',
        'purge.done': 'The session was permanently deleted.',
        // Notices
        'notice.restartScheduled': 'The operation is scheduled. Restart DSH to apply it.',
        'notice.archived': 'Workspace archived.',
        'notice.restored': 'Workspace restored.',
        'notice.renamed': 'Workspace name changed.',
        'notice.renameFailed': 'Could not change the workspace name.',
        'notice.previewCount': '{count} cold session(s) will be affected.',
        'notice.archiveFailed': 'Could not archive the workspace.',
        'notice.restoreFailed': 'Could not restore the workspace.',
      },
    }
    // ===== I18N END =====

    /**
     * Active language, resolved from the injected `locale` service and
     * re-read on every `t()` call so a language switch applies without a reload.
     * `navigator.language` is only the fallback when the service is absent.
     */
    function activeLanguage() {
      const snapshot = typeof appContext === 'undefined' ? undefined : appContext?.locale?.getSnapshot?.()
      const active = typeof snapshot?.active === 'string' ? snapshot.active : ''
      if (active.toLowerCase().startsWith('ko')) return 'ko'
      if (active !== '') return 'en'
      return typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('ko')
        ? 'ko'
        : 'en'
    }

    function t(key, vars) {
      const dictionary = I18N[activeLanguage()] || I18N.en
      const template = Object.prototype.hasOwnProperty.call(dictionary, key)
        ? dictionary[key]
        : Object.prototype.hasOwnProperty.call(I18N.en, key)
          ? I18N.en[key]
          : key
      if (vars === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
      )
    }

    const BLOCKER_KEYS = {
      SESSION_MISSING: 'gate.sessionMissing',
      WORKSPACE_MISSING: 'gate.workspaceMissing',
      SAME_WORKSPACE: 'gate.sameWorkspace',
      SESSION_LIVE: 'gate.liveBlocked',
      WORKSPACE_DIR_MISSING: 'gate.workspaceDirMissing',
      DEFAULT_WORKSPACE: 'gate.defaultWorkspaceBlocked',
      TARGET_EXISTS: 'gate.targetExists',
      TITLE_BLANK: 'gate.blankName',
      FOLDER_BLANK: 'gate.blankName',
      FOLDER_INVALID: 'gate.folderInvalid',
      SAME_PATH: 'gate.samePath',
      ARCHIVE_MISSING: 'gate.archiveMissing',
      NOT_ARCHIVED: 'purge.notArchived',
      FORK_CHILD_LIVE: 'gate.forkChildLive',
      SESSION_CONTROLLER_MISSING: 'gate.sessionControllerMissing',
      PATH_ABSOLUTE: 'gate.absolutePath',
      EXTERNAL_PATH: 'gate.externalPath',
    }

    function blockerText(entry) {
      if (typeof entry === 'string') return entry
      if (entry === null || typeof entry !== 'object') return ''
      const key = BLOCKER_KEYS[entry.code]
      if (key !== undefined) {
        const text = t(key, entry)
        if (text !== key) return text
      }
      return String(entry.message ?? entry.code ?? '')
    }

    // ----- plugin-local UI state -------------------------------------------------
    let appContext = null
    let ui = { dialog: null, notice: null }
    const listeners = new Set()
    let noticeTimer = null

    function setUi(patch) {
      ui = { ...ui, ...patch }
      for (const listener of listeners) listener()
    }

    function useUi() {
      const [, force] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => {
        listeners.add(force)
        return () => listeners.delete(force)
      }, [])
      return ui
    }

    function notify(message) {
      if (noticeTimer !== null) clearTimeout(noticeTimer)
      setUi({ notice: message })
      noticeTimer = setTimeout(() => {
        noticeTimer = null
        setUi({ notice: null })
      }, 5000)
    }

    function openDialog(dialog) {
      setUi({ dialog })
    }

    function closeDialog() {
      setUi({ dialog: null })
    }

    // ----- transport helpers -----------------------------------------------------
    async function post(route, body) {
      const response = await fetch(`/api/local/sidebar/${route}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      let data = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }
      if (response.status === 501) {
        return { ok: false, status: 501, pending: true, data }
      }
      return { ok: response.ok && data.ok !== false, status: response.status, data }
    }

    async function preview(route, body) {
      const result = await post(`${route}/preview`, body)
      if (result.pending) {
        return {
          ok: false,
          pending: true,
          blockers: [t('common.previewUnavailable')],
          affectedSessionCount: 0,
        }
      }
      if (!result.ok) {
        return {
          ok: false,
          blockerCodes: result.data?.blockerCodes ?? [],
          blockers: result.data?.blockers ?? [],
          affectedSessionCount: result.data?.affectedSessionCount ?? 0,
          liveSessionCount: result.data?.liveSessionCount,
          oldPath: result.data?.oldPath,
          newPath: result.data?.newPath,
          workspaceTitle: result.data?.workspaceTitle,
        }
      }
      return result.data
    }

    async function loadWorkspaceBaseline() {
      if (appContext === null || appContext.remote?.workspace === undefined) {
        return { items: [], archivedSessionIds: [], pinnedSessionIds: [] }
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      try {
        for await (const frame of appContext.remote.workspace.follow(controller.signal)) {
          if (frame?.type === 'baseline') {
            controller.abort()
            return frame.value
          }
        }
      } catch (error) {
        if (error?.name !== 'AbortError') throw error
      } finally {
        clearTimeout(timer)
        controller.abort()
      }
      return { items: [], archivedSessionIds: [], pinnedSessionIds: [] }
    }

    function run(route, body, successKey) {
      return post(route, body).then((result) => {
        if (!result.ok) {
          notify(result.pending ? t('common.backendPending') : result.data?.error || t('common.applyFailed'))
          return false
        }
        notify(result.data?.restartRequired === true ? t('notice.restartScheduled') : t(successKey || 'common.applied'))
        closeDialog()
        return true
      })
    }

    // ----- icons and styles ------------------------------------------------------
    function Icon({ kind, size = 14 }) {
      const paths = {
        trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
        archive: ['M3 5h18v4H3z', 'M5 9v10h14V9', 'M9 13h6'],
        folder: ['M3 6h6l2 2h10v11H3z'],
        sheet: ['M6 3h8l4 4v14H6z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
        close: ['M6 6l12 12', 'M18 6L6 18'],
        chevron: ['M9 6l6 6-6 6'],
      }
      const children = (paths[kind] || paths.sheet).map((d) => h('path', { key: d, d }))
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        children,
      )
    }

    /**
     * Group accent resolution.
     *
     * `groups.json` may carry an explicit `color`, but a bare hex ignores the theme
     * (audit F: dark/light contrast). Spec §4.1/§4.2 seat variables are the durable
     * source: we prefer a declared color, then fall back to theme seats so the UI
     * adapts to the active palette without any DOM/CSS injection.
     */
    const GROUP_ACCENT_FALLBACKS = [
      'var(--dsw-alias-state-business-primary, currentColor)',
      'var(--dsw-alias-label-primary, currentColor)',
      'currentColor',
    ]
    function groupAccent(group, ordinal = 0) {
      if (typeof group?.color === 'string' && group.color !== '') return group.color
      if (group?.kind === 'system') return 'var(--dsw-alias-state-business-primary, currentColor)'
      return GROUP_ACCENT_FALLBACKS[ordinal % GROUP_ACCENT_FALLBACKS.length]
    }

    const styles = {
      // --- Virtual grouping (HQ tree) -------------------------------------------
      groupSection: {
        marginTop: 8,
        paddingTop: 12,
        borderTop: '1px solid color-mix(in srgb, currentColor 15%, transparent)',
      },
      groupHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
      groupHeading: { margin: 0, fontSize: 15, fontWeight: 600 },
      groupHeaderActions: { display: 'inline-flex', gap: 4, flexWrap: 'wrap' },
      groupNotice: {
        marginTop: 6,
        padding: '6px 8px',
        borderRadius: 6,
        fontSize: 12,
        background: 'color-mix(in srgb, currentColor 8%, transparent)',
      },
      groupList: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 },
      groupCard: {
        border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
        borderRadius: 8,
        padding: '8px 10px',
      },
      groupCardHeader: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
      groupCardTitle: { fontSize: 13, fontWeight: 600 },
      groupKind: {
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        padding: '1px 5px',
        borderRadius: 4,
        background: 'color-mix(in srgb, currentColor 10%, transparent)',
      },
      groupPin: { fontSize: 11, opacity: 0.85 },
      groupModules: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 },
      groupItem: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 2px',
        borderRadius: 6,
      },
      groupItemHq: { background: 'color-mix(in srgb, currentColor 7%, transparent)' },
      groupBadgeIndex: {
        minWidth: 26,
        textAlign: 'center',
        fontSize: 10,
        fontWeight: 600,
        opacity: 0.8,
        fontVariantNumeric: 'tabular-nums',
      },
      groupLabel: { fontSize: 13, fontWeight: 500 },
      groupHint: { marginTop: 4, fontSize: 11, opacity: 0.7 },
      groupFormRow: { display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' },
      groupConfirm: {
        marginTop: 8,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-state-business-primary, currentColor)',
        background: 'color-mix(in srgb, currentColor 6%, transparent)',
      },
      groupConfirmTitle: { fontSize: 13, fontWeight: 700 },
      groupConfirmBody: { fontSize: 12, marginTop: 4, lineHeight: 1.5 },
      groupConfirmCheck: { display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 8, fontSize: 12 },
      iconButton: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        minHeight: 24,
        padding: '2px 5px',
        border: 0,
        borderRadius: 6,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
      },
      menuItem: {
        display: 'block',
        width: '100%',
        padding: '7px 10px',
        border: 0,
        background: 'transparent',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        font: 'inherit',
      },
      backdrop: {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.36)',
        padding: 16,
      },
      panel: {
        width: 'min(560px, 100%)',
        maxHeight: 'min(720px, calc(100vh - 32px))',
        overflow: 'auto',
        borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-l2, #444)',
        background: 'var(--dsw-alias-bg-layer-2, #1f1f1f)',
        color: 'inherit',
        padding: 16,
        boxSizing: 'border-box',
        boxShadow: '0 18px 50px rgba(0, 0, 0, 0.45)',
      },
      title: { margin: '0 0 12px', fontSize: 15, fontWeight: 600 },
      row: { display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' },
      field: {
        width: '100%',
        boxSizing: 'border-box',
        marginTop: 4,
        padding: '7px 9px',
        borderRadius: 7,
        border: '1px solid var(--dsw-alias-border-l2, #555)',
        background: 'var(--dsw-alias-bg-layer-1, #161616)',
        color: 'inherit',
        font: 'inherit',
      },
      label: { display: 'block', fontSize: 12, opacity: 0.85, marginTop: 10 },
      gateBox: {
        marginTop: 12,
        padding: 10,
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, #555)',
        background: 'var(--dsw-alias-bg-layer-1, #161616)',
        fontSize: 12,
        lineHeight: 1.5,
      },
      blocker: { color: 'var(--dsw-alias-state-error-primary, #ff7b72)', whiteSpace: 'pre-wrap' },
      checkbox: { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 12, lineHeight: 1.5 },
      footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
      primary: {
        padding: '7px 12px',
        borderRadius: 7,
        border: 0,
        background: 'var(--dsw-alias-state-business-primary, #4f7cff)',
        color: '#fff',
        cursor: 'pointer',
        font: 'inherit',
      },
      plain: {
        padding: '7px 12px',
        borderRadius: 7,
        border: '1px solid var(--dsw-alias-border-l2, #555)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        font: 'inherit',
      },
      list: { display: 'flex', flexDirection: 'column', gap: 6 },
      listRow: {
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 10px',
        border: '1px solid var(--dsw-alias-border-l2, #444)',
        borderRadius: 8,
      },
      listText: { minWidth: 0 },
      path: { fontSize: 11, opacity: 0.7, overflowWrap: 'anywhere' },
      panelPage: {
        height: '100%',
        overflow: 'auto',
        boxSizing: 'border-box',
        padding: '24px 28px 40px',
        width: '100%',
      },
      panelInner: { width: '100%', maxWidth: 820, margin: '0 auto' },
      panelHeading: { margin: 0, fontSize: 20, fontWeight: 650 },
      panelDescription: { margin: '6px 0 18px', fontSize: 12, opacity: 0.75, lineHeight: 1.5 },
      panelRows: { display: 'flex', flexDirection: 'column', gap: 8 },
      panelRow: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        border: '1px solid var(--dsw-alias-border-l2, #444)',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,0.04))',
      },
      panelName: { flex: '1 1 260px', minWidth: 0 },
      panelActions: { display: 'flex', flex: '0 0 auto', gap: 6, alignItems: 'center' },
      inlineFolder: { flexBasis: '100%', paddingLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 },
      inlineHint: { fontSize: 11, opacity: 0.62 },
      archivedHeading: { margin: '22px 0 8px', fontSize: 12, fontWeight: 650 },
      empty: { opacity: 0.7, fontSize: 12, padding: '12px 0' },
      notice: {
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 1100,
        maxWidth: 420,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2, #555)',
        background: 'var(--dsw-alias-bg-layer-2, #1f1f1f)',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
        fontSize: 12,
        whiteSpace: 'pre-wrap',
      },
    }

    // ----- shared gate -----------------------------------------------------------
    function Gate({ preview: value, ack, setAck, busy, onSubmit, submitLabel }) {
      const blockers = Array.isArray(value?.blockerCodes) && value.blockerCodes.length > 0
        ? value.blockerCodes.map(blockerText).filter(Boolean)
        : (Array.isArray(value?.blockers) ? value.blockers.filter(Boolean) : [])
      const ready = value?.ok === true && blockers.length === 0
      const affected = value?.affectedSessionCount
      const oldPath = value?.oldPath
      const newPath = value?.newPath
      const title = value?.workspaceTitle
      return h(
        'div',
        { style: styles.gateBox },
        h('div', null, t('gate.affected', { count: affected ?? '—' })),
        title !== undefined ? h('div', null, t('gate.workspace', { title })) : null,
        oldPath !== undefined || newPath !== undefined
          ? h('div', null, t('gate.path', { oldPath: oldPath ?? '—', newPath: newPath ?? '—' }))
          : null,
        h('div', { style: { marginTop: 8 } }, t('common.cwdWarning')),
        h('div', { style: { marginTop: 6, fontWeight: 600 } }, t('gate.restart')),
        blockers.length > 0
          ? h(
              'div',
              { style: { marginTop: 8 } },
              h('div', { style: { fontWeight: 600 } }, t('gate.blockers')),
              h('div', { style: styles.blocker }, blockers.join('\n')),
            )
          : value?.pending === true || value === undefined
            ? h('div', { style: { marginTop: 8, opacity: 0.8 } }, t('gate.previewPending'))
            : null,
        h(
          'label',
          { style: styles.checkbox },
          h('input', {
            type: 'checkbox',
            checked: ack,
            disabled: !ready || busy,
            onChange: (event) => setAck(event.target.checked),
          }),
          h('span', null, t('gate.ack')),
        ),
        h(
          'div',
          { style: styles.footer },
          h(
            'button',
            {
              type: 'button',
              style: styles.primary,
              disabled: !ready || !ack || busy,
              onClick: onSubmit,
            },
            busy ? t('common.preflight') : t(submitLabel),
          ),
        ),
      )
    }

    // ----- dialogs ---------------------------------------------------------------
    function Modal({ title, onClose, children }) {
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      return h(
        'div',
        {
          style: styles.backdrop,
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose()
          },
        },
        h(
          'div',
          { role: 'dialog', 'aria-modal': 'true', style: styles.panel },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('h2', { style: styles.title }, title),
            h(
              'button',
              { type: 'button', style: styles.iconButton, onClick: onClose, 'aria-label': t('common.close') },
              h(Icon, { kind: 'close' }),
            ),
          ),
          children,
        ),
      )
    }

    /**
     * Virtual-group (HQ) tree for the Workspace Manager.
     *
     * Strictly contract-only:
     *  - reads the tree from our own `groups/view` route,
     *  - navigates with the official `uiWorkspace.openWorkspace`,
     *  - never touches the native sidebar DOM or its CSS.
     */
    function GroupTreeSection({ onChanged }) {
      const [state, setState] = React.useState({ loading: true, tree: null, error: null })
      const [orderBusy, setOrderBusy] = React.useState(false)
      const [orderInfo, setOrderInfo] = React.useState(null)
      const alive = React.useRef(true)

      const [advisory, setAdvisory] = React.useState(null)

      const load = React.useCallback(
        () =>
          Promise.all([post('groups/view', {}), post('groups/advisory', {}).catch(() => ({ ok: false }))]).then(
            ([result, advisoryResult]) => {
              setAdvisory(advisoryResult?.ok ? advisoryResult.data : null)
              if (!result.ok) {
                setState({ loading: false, tree: null, error: result.data?.error || t('common.unknownError') })
                return
              }
              setState({ loading: false, tree: result.data, error: null })
            },
          ),
        [],
      )

      React.useEffect(() => {
        alive.current = true
        load()
        return () => {
          alive.current = false
          setOrderInfo(null)
        }
      }, [load])

      const openWorkspace = (workspaceId) => {
        const nav = appContext?.get?.('uiWorkspace')
        if (nav?.openWorkspace === undefined) {
          notify(t('common.applyFailed'))
          return
        }
        // Official contract: connect the workspace and open its session.
        Promise.resolve(nav.openWorkspace(workspaceId)).catch(() => notify(t('common.applyFailed')))
      }

      const previewOrder = () => {
        setOrderBusy(true)
        post('workspace/order/preview', {})
          .then((result) => {
            if (result.ok) setOrderInfo({ kind: 'preview', ...result.data })
            else notify(result.data?.error || t('common.applyFailed'))
          })
          .catch(() => notify(t('common.applyFailed')))
          .finally(() => setOrderBusy(false))
      }

      const [confirmOpen, setConfirmOpen] = React.useState(false)
      const [confirmChecked, setConfirmChecked] = React.useState(false)
      const [hqGroup, setHqGroup] = React.useState('')
      const [hqMain, setHqMain] = React.useState('HQ')
      const [orphans, setOrphans] = React.useState(null)
      const [promotePath, setPromotePath] = React.useState('')
      const [promoteTitle, setPromoteTitle] = React.useState('')

      const requestOrderConfirm = () => {
        setOrderBusy(true)
        post('workspace/order/preview', {})
          .then((result) => {
            if (!result.ok) {
              notify(result.data?.error || t('common.applyFailed'))
              return
            }
            setOrderInfo({ kind: 'preview', ...result.data })
            setConfirmChecked(false)
            setConfirmOpen(true)
          })
          .catch(() => notify(t('common.applyFailed')))
          .finally(() => setOrderBusy(false))
      }

      const createHq = () => {
        const group = hqGroup.trim()
        if (group === '') {
          notify(t('gate.blankName'))
          return
        }
        setOrderBusy(true)
        post('groups/hq/promote', { group, main: hqMain.trim() || 'HQ' })
          .then((result) => {
            if (result.ok) notify(t('groups.hqCreated'))
            else notify(result.data?.blockerCodes?.join(', ') || result.data?.error || t('common.applyFailed'))
            load()
            if (onChanged) onChanged()
          })
          .catch(() => notify(t('common.applyFailed')))
          .finally(() => setOrderBusy(false))
      }

      const scanOrphans = () => {
        setOrderBusy(true)
        post('groups/orphans', {})
          .then((result) => {
            if (result.ok) setOrphans(result.data)
            else notify(result.data?.error || t('common.applyFailed'))
          })
          .catch(() => notify(t('common.applyFailed')))
          .finally(() => setOrderBusy(false))
      }

      const previewPromotion = () => {
        const target = promotePath.trim()
        if (target === '') {
          notify(t('gate.blankName'))
          return
        }
        setOrderBusy(true)
        post('promotion/preview', { mode: 'existing', path: target, title: promoteTitle.trim() })
          .then((result) => {
            const data = result.data ?? {}
            if (data.ok === false) notify((data.blockerCodes ?? []).join(', ') || t('common.applyFailed'))
            else notify(`${t('groups.promotePreview')}: ${data.canonicalPath ?? target}`)
          })
          .catch(() => notify(t('common.applyFailed')))
          .finally(() => setOrderBusy(false))
      }

      const runPromotion = () => {
        const target = promotePath.trim()
        if (target === '') {
          notify(t('gate.blankName'))
          return
        }
        setOrderBusy(true)
        post('promotion/apply', { mode: 'existing', path: target, title: promoteTitle.trim() })
          .then((result) => {
            if (result.ok) notify(t('groups.hqCreated'))
            else notify((result.data?.blockerCodes ?? []).join(', ') || t('common.applyFailed'))
            load()
            if (onChanged) onChanged()
          })
          .catch(() => notify(t('common.applyFailed')))
          .finally(() => setOrderBusy(false))
      }

      const applyOrder = () => {
        setConfirmOpen(false)
        setOrderBusy(true)
        post('workspace/order/apply', {})
          .then((result) => {
            if (!result.ok) {
              notify(t('groups.alignFailed'))
              load()
              if (onChanged) onChanged()
              return
            }
            notify(result.data?.unchanged || result.data?.applied === false ? t('groups.alignNoop') : t('groups.alignApplied'))
            setOrderInfo({ kind: 'applied', ...result.data })
            load()
            if (onChanged) onChanged()
          })
          .catch(() => notify(t('groups.alignFailed')))
          .finally(() => setOrderBusy(false))
      }

      const tree = state.tree
      const groups = tree?.groups ?? []

      const renderWorkspaceRow = (entry, { isHq, muted }) => {
        const workspace = entry.workspace ?? entry
        const label = entry.sub ?? workspace.title
        const workspaceId = workspace.id ?? workspace.workspaceId
        return h(
          'div',
          {
            key: workspaceId,
            style: { ...styles.groupItem, ...(isHq ? styles.groupItemHq : null), ...(muted ? { opacity: 0.75 } : null) },
            'data-workspace-id': workspaceId,
          },
          h('span', { style: styles.groupBadgeIndex }, isHq ? t('groups.hq') : (entry.index ?? '—')),
          h(
            'div',
            { style: styles.panelName },
            h('div', { style: styles.groupLabel }, label),
            h(
              'div',
              { style: styles.path },
              `${workspace.title} · ${t('groups.sessions', { count: workspace.sessionCount ?? 0 })}`,
            ),
          ),
          h(
            'button',
            { type: 'button', style: styles.plain, disabled: orderBusy, onClick: () => openWorkspace(workspaceId) },
            t('groups.open'),
          ),
        )
      }

      return h(
        'section',
        { style: styles.groupSection, 'aria-label': t('groups.title') },
        h(
          'div',
          { style: styles.groupHeader },
          h('h2', { style: styles.groupHeading }, t('groups.title')),
          h(
            'div',
            { style: styles.groupHeaderActions },
            h('button', { type: 'button', style: styles.plain, disabled: orderBusy, onClick: previewOrder }, t('groups.alignPreview')),
            h('button', { type: 'button', style: styles.plain, disabled: orderBusy, onClick: requestOrderConfirm }, t('groups.align')),
            h('button', { type: 'button', style: styles.plain, disabled: orderBusy, onClick: () => load() }, t('groups.refresh')),
          ),
        ),
        h('p', { style: styles.panelDescription }, t('groups.description')),
        // --- order confirmation dialog -------------------------------------
        confirmOpen
          ? h(
              'div',
              { style: styles.groupConfirm, role: 'dialog', 'aria-modal': 'true', 'aria-label': t('groups.confirmOrderTitle') },
              h('div', { style: styles.groupConfirmTitle }, t('groups.confirmOrderTitle')),
              h('div', { style: styles.groupConfirmBody }, t('groups.confirmOrderBody')),
              h(
                'div',
                { style: styles.groupConfirmBody },
                orderInfo?.unchanged
                  ? t('groups.confirmOrderNoop')
                  : t('groups.confirmOrderMoves', { count: orderInfo?.moves?.length ?? 0 }),
              ),
              h(
                'div',
                { style: styles.groupConfirmBody },
                [t('groups.manageOnly')],
              ),
              h(
                'label',
                { style: styles.groupConfirmCheck },
                h('input', {
                  type: 'checkbox',
                  checked: confirmChecked,
                  disabled: orderBusy || orderInfo?.unchanged === true,
                  onChange: (event) => setConfirmChecked(event.target.checked),
                }),
                h('span', null, t('groups.confirmOrderCheck')),
              ),
              h(
                'div',
                { style: styles.groupHeaderActions },
                h(
                  'button',
                  {
                    type: 'button',
                    style: styles.plain,
                    disabled: !confirmChecked || orderBusy,
                    onClick: applyOrder,
                  },
                  t('groups.confirmOrderApply'),
                ),
                h('button', { type: 'button', style: styles.plain, onClick: () => setConfirmOpen(false) }, t('groups.confirmOrderCancel')),
              ),
            )
          : null,
        // --- advisory observations (never blocking) ------------------------
        advisory !== null
          ? h(
              'div',
              { style: styles.groupCard, 'aria-label': t('groups.advisoryTitle') },
              h(
                'div',
                { style: styles.groupCardHeader },
                h('span', { style: styles.groupCardTitle }, t('groups.advisoryTitle')),
                h('span', { style: styles.groupHint }, `${advisory.observations?.length ?? 0}`),
              ),
              (advisory.observations?.length ?? 0) === 0
                ? h('div', { style: styles.groupHint }, t('groups.advisoryNone'))
                : h(
                    'div',
                    { style: styles.groupModules },
                    advisory.observations.map((observation) =>
                      h(
                        'div',
                        { key: `${observation.code}:${observation.workspaceId ?? ''}`, style: styles.groupItem },
                        h('span', { style: styles.groupBadgeIndex }, observation.level),
                        h(
                          'div',
                          { style: styles.panelName },
                          h('div', { style: styles.groupLabel }, observation.title ?? observation.workspaceId ?? ''),
                          h('div', { style: styles.path }, observation.detail ?? ''),
                        ),
                      ),
                    ),
                  ),
            )
          : null,
        // --- HQ creation ---------------------------------------------------
        h(
          'div',
          { style: styles.groupCard },
          h('div', { style: styles.groupCardHeader }, h('span', { style: styles.groupCardTitle }, t('groups.hqTitle'))),
          h(
            'div',
            { style: styles.groupFormRow },
            h('input', { style: styles.field, placeholder: t('groups.hqGroup'), value: hqGroup, disabled: orderBusy, onChange: (e) => setHqGroup(e.target.value), 'aria-label': t('groups.hqGroup') }),
            h('input', { style: styles.field, placeholder: t('groups.hqMain'), value: hqMain, disabled: orderBusy, onChange: (e) => setHqMain(e.target.value), 'aria-label': t('groups.hqMain') }),
            h('button', { type: 'button', style: styles.plain, disabled: orderBusy, onClick: createHq }, t('groups.hqCreate')),
          ),
        ),
        // --- explicit project promotion ------------------------------------
        h(
          'div',
          { style: styles.groupCard },
          h('div', { style: styles.groupCardHeader }, h('span', { style: styles.groupCardTitle }, t('groups.promoteTitle'))),
          h(
            'div',
            { style: styles.groupFormRow },
            h('input', { style: styles.field, placeholder: t('groups.promotePath'), value: promotePath, disabled: orderBusy, onChange: (e) => setPromotePath(e.target.value), 'aria-label': t('groups.promotePath') }),
            h('input', { style: styles.field, placeholder: t('groups.promoteTitleField'), value: promoteTitle, disabled: orderBusy, onChange: (e) => setPromoteTitle(e.target.value), 'aria-label': t('groups.promoteTitleField') }),
            h('button', { type: 'button', style: styles.plain, disabled: orderBusy, onClick: previewPromotion }, t('groups.promotePreview')),
            h('button', { type: 'button', style: styles.plain, disabled: orderBusy, onClick: runPromotion }, t('groups.promoteAction')),
          ),
        ),
        // --- orphan classifier (read-only) ---------------------------------
        h(
          'div',
          { style: styles.groupCard },
          h(
            'div',
            { style: styles.groupCardHeader },
            h('span', { style: styles.groupCardTitle }, t('groups.orphansTitle')),
            h('button', { type: 'button', style: styles.plain, disabled: orderBusy, onClick: scanOrphans }, t('groups.orphansScan')),
          ),
          h('div', { style: styles.groupHint }, t('groups.orphansNote')),
          orphans !== null
            ? h(
                'div',
                { style: styles.groupHint },
                t('groups.orphansTotal', { total: orphans.total ?? 0, count: orphans.disconnected?.length ?? 0 }),
              )
            : null,
        ),
        orderInfo !== null
          ? h(
              'div',
              { style: styles.groupNotice },
              orderInfo.kind === 'preview'
                ? `${t('groups.alignPreview')}: ${t('groups.moveCount', { count: orderInfo.moves?.length ?? 0 })}${orderInfo.unchanged ? ` · ${t('groups.alignNoop')}` : ''}`
                : `${t('groups.align')}: ${t('groups.moveCount', { count: orderInfo.moves ?? 0 })}${orderInfo.matchesTarget === false ? ' ⚠' : ''}`,
            )
          : null,
        state.loading
          ? h('div', { style: styles.empty }, t('common.loading'))
          : state.error !== null
            ? h('div', { style: styles.blocker }, state.error)
            : groups.length === 0
              ? h('div', { style: styles.empty }, t('groups.empty'))
              : h(
                  'div',
                  { style: styles.groupList },
                  groups.map((group, index) =>
                    h(
                      'div',
                      { key: group.groupId, style: styles.groupCard, 'data-group-id': group.groupId },
                      h(
                        'div',
                        { style: styles.groupCardHeader },
                        h(
                          'span',
                          { style: { ...styles.groupKind, color: groupAccent(group, index) } },
                          group.kind === 'system' ? t('groups.system') : group.proposed ? t('groups.proposed') : t('groups.project'),
                        ),
                        h('span', { style: styles.groupCardTitle }, group.label),
                        group.pinTop ? h('span', { style: styles.groupPin }, '★') : null,
                        h('span', { style: styles.path }, t('groups.sessions', { count: group.sessionCount ?? 0 })),
                      ),
                      group.hq !== null
                        ? renderWorkspaceRow(group.hq, { isHq: true })
                        : h('div', { style: styles.groupHint }, t('groups.hqMissing')),
                      group.modules.length > 0
                        ? h('div', { style: styles.groupModules }, group.modules.map((entry) => renderWorkspaceRow(entry, { isHq: false })))
                        : null,
                      group.loose.length > 0
                        ? h('div', { style: styles.groupModules }, group.loose.map((entry) => renderWorkspaceRow(entry, { isHq: false, muted: true })))
                        : null,
                    ),
                  ),
                  tree?.ungrouped?.length > 0
                    ? h(
                        'div',
                        { style: { ...styles.groupCard, opacity: 0.85 } },
                        h('div', { style: styles.groupCardHeader }, h('span', { style: styles.groupCardTitle }, t('groups.ungrouped'))),
                        h('div', { style: styles.groupModules }, tree.ungrouped.map((workspace) => renderWorkspaceRow({ workspace }, { isHq: false, muted: true }))),
                      )
                    : null,
                ),
      )
    }

    function WorkspaceManagerPanel() {
      const [state, setState] = React.useState({ loading: true, items: [], archived: [], error: null })
      const [drafts, setDrafts] = React.useState({})
      const [busyId, setBusyId] = React.useState(null)
      const alive = React.useRef(true)

      const draftFor = (workspace) => ({
        title: workspace.title,
        includeFolder: false,
        folderName: pathBasename(workspace.path),
        folderDirty: false,
      })

      const load = React.useCallback(
        () =>
          Promise.all([
            loadWorkspaceBaseline().then((baseline) => baseline.items || []).catch(() => []),
            post('workspace/archived', {})
              .then((result) => (result.ok && Array.isArray(result.data.items) ? result.data.items : []))
              .catch(() => []),
          ]).then(([items, archived]) => {
            if (!alive.current) return
            setState({ loading: false, items, archived, error: null })
            setDrafts((previous) => {
              const next = {}
              for (const workspace of items) next[workspace.workspaceId] = previous[workspace.workspaceId] || draftFor(workspace)
              return next
            })
          }),
        [],
      )

      React.useEffect(() => {
        alive.current = true
        load().catch((error) => {
          if (alive.current) {
            setState({ loading: false, items: [], archived: [], error: error?.message || t('common.unknownError') })
          }
        })
        return () => {
          alive.current = false
        }
      }, [load])

      const updateDraft = (workspaceId, patch) => {
        setDrafts((previous) => ({ ...previous, [workspaceId]: { ...previous[workspaceId], ...patch } }))
      }

      const resetDraft = (workspace) => updateDraft(workspace.workspaceId, draftFor(workspace))

      const openFolderGate = (workspace, draft) => {
        const title = draft.title.trim()
        const folderName = draft.folderName.trim()
        if (title === '') {
          notify(t('gate.blankName'))
          return
        }
        if (folderName === '') {
          notify(t('rename.folderName'))
          return
        }
        openDialog({
          kind: 'rename',
          workspaceId: workspace.workspaceId,
          title,
          folderName,
          path: workspace.path,
          onDone: load,
        })
      }

      const saveTitle = (workspace) => {
        const draft = drafts[workspace.workspaceId]
        if (draft === undefined || busyId !== null) return
        const title = draft.title.trim()
        if (title === '') {
          notify(t('gate.blankName'))
          return
        }
        if (draft.includeFolder) {
          openFolderGate(workspace, draft)
          return
        }
        if (title === workspace.title) {
          notify(t('workspaceManager.unchanged'))
          return
        }
        setBusyId(workspace.workspaceId)
        post('workspace/rename-folder', {
          workspaceId: workspace.workspaceId,
          title,
          folderRename: false,
          confirmCwdChange: false,
          acknowledged: true,
        })
          .then((result) => {
            if (!result.ok) {
              notify(result.pending ? t('common.backendPending') : result.data?.error || t('notice.renameFailed'))
              return
            }
            notify(t('notice.renamed'))
            return load()
          })
          .finally(() => setBusyId(null))
      }

      const archive = (workspace) => {
        if (busyId !== null) return
        setBusyId(workspace.workspaceId)
        post('workspace/archive', { workspaceId: workspace.workspaceId })
          .then((result) => {
            if (!result.ok) {
              notify(result.pending ? t('common.backendPending') : result.data?.error || t('notice.archiveFailed'))
              return
            }
            notify(t('notice.archived'))
            return load()
          })
          .finally(() => setBusyId(null))
      }

      const restore = (workspaceId) => {
        if (busyId !== null) return
        setBusyId(workspaceId)
        post('workspace/restore', { workspaceId })
          .then((result) => {
            if (!result.ok) {
              notify(result.pending ? t('common.backendPending') : result.data?.error || t('notice.restoreFailed'))
              return
            }
            notify(t('notice.restored'))
            return load()
          })
          .finally(() => setBusyId(null))
      }

      const onKeyDown = (event, workspace) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          resetDraft(workspace)
          event.currentTarget.blur()
          return
        }
        if (event.key === 'Enter' && event.nativeEvent?.isComposing !== true) {
          event.preventDefault()
          saveTitle(workspace)
        }
      }

      return h(
        'section',
        { style: styles.panelPage, 'aria-label': t('workspaceManager.title') },
        h(
          'div',
          { style: styles.panelInner },
          h('h1', { style: styles.panelHeading }, t('workspaceManager.title')),
          h(
            'p',
            { style: styles.panelDescription },
            `${t('workspaceManager.description')} · ${t('workspaceManager.inlineHint')}`,
          ),
          h(GroupTreeSection, { onChanged: load }),
          h('h2', { style: { ...styles.panelHeading, fontSize: 14, marginTop: 16 } }, t('workspaceManager.title')),
          state.loading
            ? h('div', { style: styles.empty }, t('common.loading'))
            : state.error !== null
              ? h('div', { style: styles.blocker }, state.error)
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { style: styles.panelRows },
                    state.items.length === 0
                      ? h('div', { style: styles.empty }, t('workspaceManager.empty'))
                      : state.items.map((workspace) => {
                          const draft = drafts[workspace.workspaceId] || draftFor(workspace)
                          const newPath = joinPath(parentPath(workspace.path), draft.folderName.trim())
                          return h(
                            'div',
                            { key: workspace.workspaceId, style: styles.panelRow, 'data-workspace-id': workspace.workspaceId },
                            h(
                              'div',
                              { style: styles.panelName },
                              h('input', {
                                style: styles.field,
                                value: draft.title,
                                'aria-label': `${t('rename.displayName')}: ${workspace.title}`,
                                disabled: busyId !== null,
                                onChange: (event) => updateDraft(workspace.workspaceId, { title: event.target.value }),
                                onKeyDown: (event) => onKeyDown(event, workspace),
                                onFocus: (event) => event.currentTarget.select(),
                              }),
                              h('div', { style: styles.path }, workspace.path),
                            ),
                            h(
                              'div',
                              { style: styles.panelActions },
                              h(
                                'button',
                                {
                                  type: 'button',
                                  style: styles.plain,
                                  disabled: busyId !== null,
                                  onClick: () => saveTitle(workspace),
                                },
                                busyId === workspace.workspaceId
                                  ? t('common.preflight')
                                  : t('workspaceManager.renameAction'),
                              ),
                              h(
                                'button',
                                {
                                  type: 'button',
                                  style: styles.plain,
                                  disabled: busyId !== null,
                                  onClick: () => archive(workspace),
                                },
                                t('workspaceManager.archive'),
                              ),
                            ),
                            h(
                              'label',
                              { style: { ...styles.checkbox, flexBasis: '100%', marginTop: 0 } },
                              h('input', {
                                type: 'checkbox',
                                checked: draft.includeFolder,
                                disabled: busyId !== null,
                                onChange: (event) =>
                                  updateDraft(workspace.workspaceId, { includeFolder: event.target.checked }),
                              }),
                              h('span', null, t('workspaceManager.includeFolder')),
                            ),
                            draft.includeFolder
                              ? h(
                                  'div',
                                  { style: styles.inlineFolder },
                                  h(
                                    'label',
                                    { style: { ...styles.label, marginTop: 0 } },
                                    t('workspaceManager.folderName'),
                                    h('input', {
                                      style: styles.field,
                                      value: draft.folderName,
                                      'aria-label': t('workspaceManager.folderName'),
                                      disabled: busyId !== null,
                                      onChange: (event) =>
                                        updateDraft(workspace.workspaceId, {
                                          folderName: event.target.value,
                                          folderDirty: true,
                                        }),
                                      onKeyDown: (event) => onKeyDown(event, workspace),
                                    }),
                                  ),
                                  h('div', { style: styles.inlineHint }, t('workspaceManager.folderHint')),
                                  h(
                                    'div',
                                    { style: styles.inlineHint },
                                    t('workspaceManager.pathPreview', { oldPath: workspace.path, newPath }),
                                  ),
                                )
                              : null,
                          )
                        }),
                  ),
                  state.archived.length > 0
                    ? h(
                        'div',
                        null,
                        h('h2', { style: styles.archivedHeading }, t('workspaceManager.archived')),
                        h(
                          'div',
                          { style: styles.panelRows },
                          state.archived.map((workspace) =>
                            h(
                              'div',
                              { key: workspace.workspaceId, style: styles.panelRow, 'data-workspace-id': workspace.workspaceId },
                              h(
                                'div',
                                { style: styles.panelName },
                                h('div', null, workspace.title),
                                h('div', { style: styles.path }, workspace.path),
                              ),
                              h(
                                'div',
                                { style: styles.panelActions },
                                h(
                                  'button',
                                  {
                                    type: 'button',
                                    style: styles.plain,
                                    disabled: busyId !== null,
                                    onClick: () => restore(workspace.workspaceId),
                                  },
                                  t('workspaceManager.restore'),
                                ),
                              ),
                            ),
                          ),
                        ),
                      )
                    : null,
                ),
        ),
      )
    }

    function RenameDialog({ data, onClose }) {
      const [previewState, setPreviewState] = React.useState(null)
      const [ack, setAck] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        let alive = true
        setPreviewState({ pending: true, ok: false, blockers: [] })
        preview('workspace/rename-folder', {
          workspaceId: data.workspaceId,
          title: data.title,
          folderName: data.folderName,
          folderRename: true,
        }).then((value) => {
          if (alive) setPreviewState(value)
        })
        return () => {
          alive = false
        }
      }, [data.folderName, data.title, data.workspaceId])
      const submit = () => {
        if (busy) return
        setBusy(true)
        post('workspace/rename-folder', {
          workspaceId: data.workspaceId,
          title: data.title,
          folderName: data.folderName,
          folderRename: true,
          confirmCwdChange: true,
          acknowledged: true,
        })
          .then((result) => {
            if (!result.ok) {
              notify(result.pending ? t('common.backendPending') : result.data?.error || t('notice.renameFailed'))
              return
            }
            notify(t('notice.restartScheduled'))
            data.onDone?.()
            onClose()
          })
          .finally(() => setBusy(false))
      }
      return h(
        Modal,
        { title: t('rename.title'), onClose },
        h('div', { style: { fontSize: 12, opacity: 0.8 } }, data.title),
        h(Gate, {
          preview: previewState,
          ack,
          setAck,
          busy,
          onSubmit: submit,
          submitLabel: 'rename.submit',
        }),
      )
    }

    function MoveDialog({ data, onClose }) {
      const [targets, setTargets] = React.useState([])
      const [targetId, setTargetId] = React.useState('')
      const [previewState, setPreviewState] = React.useState(null)
      const [ack, setAck] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        let alive = true
        loadWorkspaceBaseline()
          .then((baseline) => {
            if (alive) setTargets(baseline.items || [])
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [])
      React.useEffect(() => {
        if (targetId === '') {
          setPreviewState(null)
          return
        }
        let alive = true
        setPreviewState({ pending: true, ok: false, blockers: [] })
        preview('session/move', {
          sessionId: data.sessionId,
          targetWorkspaceId: targetId,
        }).then((value) => {
          if (alive) setPreviewState(value)
        })
        return () => {
          alive = false
        }
      }, [targetId, data.sessionId])
      const submit = () => {
        if (busy) return
        setBusy(true)
        run(
          'session/move',
          {
            sessionId: data.sessionId,
            targetWorkspaceId: targetId,
            confirmCwdChange: true,
            acknowledged: true,
          },
          'common.applied',
        ).finally(() => setBusy(false))
      }
      return h(
        Modal,
        { title: t('move.title'), onClose },
        h('div', { style: { fontSize: 12, opacity: 0.8 } }, data.displayTitle),
        h('label', { style: styles.label }, t('move.select'), h(
          'select',
          {
            style: styles.field,
            value: targetId,
            onChange: (event) => setTargetId(event.target.value),
          },
          h('option', { value: '' }, '—'),
          targets.map((workspace) =>
            h('option', { key: workspace.workspaceId, value: workspace.workspaceId }, workspace.title),
          ),
        )),
        h(Gate, {
          preview: previewState,
          ack,
          setAck,
          busy,
          onSubmit: submit,
          submitLabel: 'move.submit',
        }),
      )
    }

    function ForkDialog({ data, onClose }) {
      const [title, setTitle] = React.useState('')
      const [targetPath, setTargetPath] = React.useState('')
      const [previewState, setPreviewState] = React.useState(null)
      const [ack, setAck] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        setPreviewState({ pending: true, ok: false, blockers: [] })
        preview('session/fork-to-workspace', {
          sessionId: data.sessionId,
          title,
          path: targetPath,
        }).then((value) => {
          setPreviewState(value)
        })
      }, [data.sessionId, title, targetPath])
      const submit = () => {
        if (busy) return
        setBusy(true)
        run(
          'session/fork-to-workspace',
          {
            sessionId: data.sessionId,
            title,
            path: targetPath,
            confirmCwdChange: true,
            acknowledged: true,
          },
          'common.applied',
        ).finally(() => setBusy(false))
      }
      return h(
        Modal,
        { title: t('fork.title'), onClose },
        h('div', { style: { fontSize: 12, opacity: 0.8 } }, data.displayTitle),
        h('label', { style: styles.label }, t('fork.name'), h('input', {
          style: styles.field,
          value: title,
          onChange: (event) => setTitle(event.target.value),
        })),
        h('label', { style: styles.label }, t('fork.path'), h('input', {
          style: styles.field,
          value: targetPath,
          placeholder: t('fork.pathHint'),
          onChange: (event) => setTargetPath(event.target.value),
        })),
        h('div', { style: { fontSize: 11, opacity: 0.7, marginTop: 4 } }, t('fork.pathHint')),
        h(Gate, {
          preview: previewState,
          ack,
          setAck,
          busy,
          onSubmit: submit,
          submitLabel: 'fork.submit',
        }),
      )
    }

    function PurgeDialog({ data, onClose }) {
      const [archived, setArchived] = React.useState(null)
      const [ack, setAck] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        let alive = true
        loadWorkspaceBaseline()
          .then((baseline) => {
            if (alive) setArchived((baseline.archivedSessionIds || []).includes(data.sessionId))
          })
          .catch(() => {
            if (alive) setArchived(false)
          })
        return () => {
          alive = false
        }
      }, [data.sessionId])
      const submit = () => {
        if (busy) return
        setBusy(true)
        run('session/purge', { sessionId: data.sessionId, acknowledged: true }, 'purge.done').finally(() =>
          setBusy(false),
        )
      }
      const blocked = archived !== true
      return h(
        Modal,
        { title: t('purge.title'), onClose },
        h('div', { style: { fontSize: 12 } }, data.displayTitle),
        h('p', { style: { fontSize: 12, lineHeight: 1.5 } }, t('purge.desc')),
        archived === false
          ? h('div', { style: styles.blocker }, t('purge.notArchived'))
          : null,
        h(
          'label',
          { style: styles.checkbox },
          h('input', {
            type: 'checkbox',
            checked: ack,
            disabled: blocked,
            onChange: (event) => setAck(event.target.checked),
          }),
          h('span', null, t('purge.ack')),
        ),
        h(
          'div',
          { style: styles.footer },
          h('button', { type: 'button', style: styles.plain, onClick: onClose }, t('common.cancel')),
          h(
            'button',
            {
              type: 'button',
              style: styles.primary,
              disabled: blocked || !ack || busy,
              onClick: submit,
            },
            busy ? t('common.preflight') : t('purge.submit'),
          ),
        ),
      )
    }

    function DialogHost() {
      const state = useUi()
      if (state.dialog === null) return null
      const dialog = state.dialog
      if (dialog.kind === 'rename') return h(RenameDialog, { data: dialog, onClose: closeDialog })
      if (dialog.kind === 'move') return h(MoveDialog, { data: dialog, onClose: closeDialog })
      if (dialog.kind === 'fork') return h(ForkDialog, { data: dialog, onClose: closeDialog })
      if (dialog.kind === 'purge') return h(PurgeDialog, { data: dialog, onClose: closeDialog })
      return null
    }

    // ----- slot components -------------------------------------------------------
    function TrashButton({ sessionId, displayTitle }) {
      return h(
        'button',
        {
          type: 'button',
          style: styles.iconButton,
          title: t('session.trash.aria'),
          'aria-label': t('session.trash.aria'),
          onClick: (event) => {
            event.stopPropagation()
            openDialog({ kind: 'purge', sessionId, displayTitle })
          },
        },
        h(Icon, { kind: 'trash' }),
      )
    }

    function MenuAction({ label, onClick }) {
      return h('button', { type: 'button', role: 'menuitem', style: styles.menuItem, onClick }, label)
    }

    function PurgeMenuItem({ sessionId, displayTitle, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      return h(MenuAction, {
        label: t('session.menu.purge'),
        onClick: () => {
          setMenuOpen(false)
          openDialog({ kind: 'purge', sessionId, displayTitle })
        },
      })
    }

    function MoveMenuItem({ sessionId, displayTitle, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      return h(MenuAction, {
        label: t('session.menu.move'),
        onClick: () => {
          setMenuOpen(false)
          openDialog({ kind: 'move', sessionId, displayTitle })
        },
      })
    }

    function ForkMenuItem({ sessionId, displayTitle, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      return h(MenuAction, {
        label: t('session.menu.fork'),
        onClick: () => {
          setMenuOpen(false)
          openDialog({ kind: 'fork', sessionId, displayTitle })
        },
      })
    }

    function WorkspaceManagerIcon({ size = 16 }) {
      return h(Icon, { kind: 'folder', size })
    }

    const PANEL_ID = 'workspace-manager'

    function NoticeHost() {
      const state = useUi()
      if (state.notice === null) return null
      return h('div', { role: 'status', style: styles.notice }, state.notice)
    }

    // ----- small path helpers ----------------------------------------------------
    function pathBasename(value) {
      if (typeof value !== 'string') return ''
      const parts = value.replace(/\\/g, '/').split('/').filter(Boolean)
      return parts.length > 0 ? parts[parts.length - 1] : ''
    }
    function parentPath(value) {
      if (typeof value !== 'string') return ''
      const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
      const index = normalized.lastIndexOf('/')
      return index <= 0 ? normalized : normalized.slice(0, index)
    }
    function joinPath(parent, name) {
      if (typeof parent !== 'string' || parent === '') return name
      const separator = parent.includes('\\') ? '\\' : '/'
      return `${parent.replace(/[\\/]+$/, '')}${separator}${name}`
    }

    const inject = ['slots', 'locale', 'uiWorkspace', 'remote.workspace', 'remote']

    function apply(ctx) {
      appContext = ctx

      ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.workspaces.session.row.action',
            id: 'sidebar-manager.trash',
            order: 150,
          },
          TrashButton,
        ),
      )

      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'sidebar-manager.purge', order: 520 },
          PurgeMenuItem,
        ),
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'sidebar-manager.move', order: 540 },
          MoveMenuItem,
        ),
      )
      ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
        ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'sidebar-manager.fork', order: 560 },
          ForkMenuItem,
        ),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID }, WorkspaceManagerPanel),
      )

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            label: () => t('workspaceManager.aria'),
          },
          WorkspaceManagerIcon,
        ),
      )

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'sidebar-manager.dialogs' }, DialogHost),
      )
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'sidebar-manager.notice' }, NoticeHost),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
