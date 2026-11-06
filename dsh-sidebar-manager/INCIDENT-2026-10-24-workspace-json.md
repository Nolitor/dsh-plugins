# INCIDENT — 테스트가 라이브 `workspace.json`을 덮어쓴 사건

<!-- skeleton:
version: 1.0
kind: report
status: historical
updated: 2026-10-24
summary: Incident record: a test overwrote the live workspace.json, the blast radius, and the guard that prevents a repeat.
-->


> 상태: resolved · 발생 2026-10-24 20:33:05 KST · 복구 20:35 KST · 심각도: **High**

## 1. 무슨 일이 있었나

promotion 엔진 통합을 검증하던 중, **통합 테스트가 라이브 `~/.dsh/storages/workspace.json`을
`{"global":{"defaultWorkspaceId":"ws-default"}}` (46바이트)로 덮어썼다.**

워크스페이스 레지스트리는 이 파일이 유일한 진실원이므로, 방치하면 7개 워크스페이스와
51개 세션 소유권이 전부 소실된다.

## 2. 근본 원인 (2개)

### RC-1 — `resolveOptions`가 `config.dshHome`을 무시

```js
export function resolveOptions(config = {}) {
  const home = dshHome()          // ← process.env.DSH_HOME 또는 ~/.dsh 로만 결정
  return {
    dshHome: home,                // ← config.dshHome 이 있어도 버려짐
```

테스트는 `backupDir`/`stateDir`/`projectsRoot`는 temp로 지정했지만 `dshHome`은 지정할 수 없었고,
엔진이 `options.dshHome` 아래에 `workspace.json` 백업·복원을 수행하므로 라이브로 떨어졌다.

### RC-2 — 테스트 헬퍼가 `dshHome`을 전달하지 않음

`makeOptions()`가 `dshHome` 키를 아예 넘기지 않아 RC-1과 결합했다.
결과적으로 **테스트는 "PASS"라고 보고하면서 라이브 데이터를 오염**시켰다.

## 3. 오염 경로

```
applyPromotion → preview → registry.create (mock, 메모리)
finalizePendingPromotion / rollbackJournal → restoreWorkspaceFile(options, backupDir)
  → fs.copyFileSync(source, path.join(options.dshHome, 'storages', 'workspace.json'))
  → options.dshHome === /home/minami/.dsh   ← 라이브
```

## 4. 복구

| 단계 | 조치 |
|---|---|
| 1 | 테스트 중단, 백그라운드 서버 job kill |
| 2 | 손상 stub을 `/tmp/reco/workspace.json.corrupt-stub-20261024T203305`로 보존(증거) |
| 3 | 백업 4개를 파싱해 후보 비교 |
| 4 | `utm-blank-session-cleanup-2026-10-24T11-07-21-968Z.tgz`의 `workspace.json` 선택 |
| 5 | 7개 워크스페이스 title·세션수를 세션 시작 시점 실측값과 **전수 대조 → 7/7 일치** |
| 6 | tmp + `chmod 600` + `sync` + `mv` 로 **원자적 복원** |

**선택 근거**: 후보 중 유일하게 `updatedAt`(10:34:56.057Z)과 세션 분포가
감사 시점 기록과 일치했다(DSH Plugins 11 / 기본 12 / UTM 7).

**복구 결과**: 백업과 **byte-identical** (`cmp` 통과), 손상 stub 46 bytes → 정상 5,256 bytes, mode 0600.

## 5. 피해 범위 — 확인된 것

| 대상 | 상태 |
|---|---|
| `workspace.json` | **오염됨 → byte-identical 복구 완료** |
| 세션 로그 97개 | **무손상** (hash 검사 전후 동일) |
| `session_projcache` 97개 | **무손상** |
| `dsh-web.service` (3080) | 정상 (메모리에 원본 레지스트리 유지, HTTP 200) |
| 기타 `~/.dsh` | 무접촉 |

> 세션 로그와 projcache는 promotion 엔진이 **쓰기 경로를 갖지 않아** 구조적으로 무손상이었다.

## 6. 재발 방지 (적용 완료)

### lib/transaction.mjs

```diff
 export function resolveOptions(config = {}) {
-  const home = dshHome()
+  // `dshHome` is overridable so tests and dry runs can be rooted in a throwaway
+  // directory. Without this, an explicit temp root still resolved the DSH home
+  // from the ambient environment and wrote to the *live* ~/.dsh.
+  const home =
+    typeof config.dshHome === 'string' && config.dshHome.trim() !== '' ? config.dshHome : dshHome()
   return {
     dshHome: home,
```

### test/promotion.test.mjs — 이중 가드

```js
const options = resolveOptions({ dshHome: path.join(root, 'dsh-home'), ... })
const live = path.join(os.homedir(), '.dsh')
if (path.resolve(options.dshHome) === path.resolve(live)) {
  throw new Error('refusing to run: options.dshHome resolved to the live ~/.dsh')
}
if (!path.resolve(options.dshHome).startsWith(path.resolve(root))) {
  throw new Error(`refusing to run: options.dshHome "${options.dshHome}" escaped the temp root`)
}
```

**검증**: 테스트 실행 전후 `workspace.json` md5 동일(`9335104767a6…`) 확인 완료.

## 7. 교훈

1. **"PASS"는 안전을 의미하지 않는다.** 테스트가 라이브 자원에 쓰면 초록불이 오히려 위험하다.
2. 순수 함수가 아닌 IO 경계는 **주입 가능해야** 한다. `resolveOptions`는 설정 병합 함수인데
   환경변수를 직접 읽어 테스트 격리를 깨뜨렸다.
3. rsync로 `~/.dsh`를 복제하는 방식은 **라이브 writer와 경합**한다(이번에 손상된 복제본이
   최초 신호였다). 복제 전 `systemctl --user stop` 또는 파일 단위 일관성 스냅샷을 써야 한다.
