# 플러그인 통합 감사 보고서 (Plugin A / Plugin B)
<!-- skeleton:
version: 1.0
kind: report
status: completed
updated: 2026-10-24
summary: Integration audit of the sidebar (Plugin A) and notify (Plugin B) plugins on DSH rc.3.
-->


> 상태: completed · 최종 갱신: 2026-10-24 · 상위: [README](README.md) · 관련: [UTM-COMPLIANCE.md](UTM-COMPLIANCE.md)

## 0. 결론 요약

두 플러그인 모두 **업그레이드된 DSH 0.2.1-rc.3 (Cordis 4.0.5, Node 24.2.0)** 에서 정상 동작하며,
실제 결함 4건을 발견해 3건을 수정했다. **라이브 프로필은 활성화하지 않았다**(§5 판단 필요).
라이브 `~/.dsh` 데이터·세션로그·3080 서비스는 **전혀 변경하지 않았다.**

| 항목 | 결과 |
|---|---|
| 플러그인 A 호환성 | rc.3 호환 **검증 완료** (Host 5서비스 + 라우트 10개 실동작) |
| 플러그인 A 결함 | 1건 수정 (i18n locale 미연동) |
| 플러그인 B 테스트 | **19/19 통과** (기존 15 + 신규 4) |
| 플러그인 B 결함 | 2건 수정 (inject 패키지 오류, 보안 컨텍스트 오표시) |
| UTM 하네스 | **존재하지 않음** → [UTM-COMPLIANCE.md](UTM-COMPLIANCE.md) |
| 감사 스크립트 | 47 checks **전부 통과** |

## 1. UTM 거버넌스 전제 정정 (중요)

요청서는 "'UTM' 워크스페이스가 마스터 PM 하네스"라고 전제했으나, 실측 결과:

- `~/.dsh/storages/workspace.json`에 제목 **UTM** 워크스페이스(`90bee0c6…`)는 등록되어 있음.
- 그러나 경로 `/home/minami/Workspace/projects/project-promotion-manager`는 **완전히 빈 디렉토리**
  (inode 1, 2026-10-24 17:43 생성).
- UTM 원장 `~/.dsh/governance/ledger/`도 **부재**.

즉 **UTM은 Windows → Linux 이관 과정에서 물리적으로 유실**되었다. 다만 세션 로그 6개가 온전해
**47개 문서를 복원**했고(`/tmp/utm-src/`), 그 결과 UTM의 실체는 "Universal Project Manager"라는
Node 거버넌스 OS이며, 그 DSH 어댑터가 **바로 Plugin A**임을 확인했다.

> ⚠ **따라서 "Plugin A가 UTM 라이프사이클 훅을 호출한다"는 목표는 현재 성립할 수 없다.**
> UTM 복원 없이는 원장 연동이 불가능하며, 상세 판정은 [UTM-COMPLIANCE.md](UTM-COMPLIANCE.md) 참조.

## 2. 플러그인 A — Right Sidebar / Project & Section Navigator

### 2.1 실측 검증 결과

| 불변식 | 결과 |
|---|---|
| Host 5개 서비스 주입 (`connection`, `workspaceRegistry`, `sessionPersistence`, `agents`, `sessions`) | rc.3에 전부 실재 |
| `ctx.connection.fetch.register({path, methods, requestBody, fetch})` 시그니처 | rc.3 `registerFetchRoute`/`assertFetchRoute`와 일치 |
| `/api/local/sidebar/*` 라우트 10개 | 전부 구조화 응답 (음성 대조군 404 확인) |
| 세션 로그 포맷 | **97개 전수 디코드 성공** |
| `projectKey` / `encodeSegment` | 디스크 실제 경로와 100% 일치 |
| relocate/clone 왕복 | 97/97 (최대 3MB·5,463 이벤트 포함) |
| 2단계(journal → boot finalizer) | `files-ready` → 재시작 → `committed` 실증 |
| `slots.inject` 5개 슬롯명 | rc.3 유효 슬롯명과 일치 |

### 2.2 결함 A-1 (Medium, 수정): i18n locale 미연동

클라이언트가 rc.3 `locale` 서비스를 **주입받고도 무시**하고 `navigator.language`를 모듈 로드 시
1회만 읽었다. 결과적으로 DSH 언어를 `ko`로 설정해도 브라우저 언어가 `en`이면 **영어로 표시**되고,
언어 전환도 반영되지 않았다.

```diff
--- a/dsh-sidebar-manager/lib/client.js
+++ b/dsh-sidebar-manager/lib/client.js
@@ -214,13 +214,23 @@
     // ===== I18N END =====
 
-    const LANGUAGE =
-      typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('ko')
+    /**
+     * Active language, resolved from the injected rc.3 `locale` service and
+     * re-read on every `t()` call so a language switch applies without a reload.
+     * `navigator.language` is only the fallback when the service is absent.
+     */
+    function activeLanguage() {
+      const snapshot = typeof appContext === 'undefined' ? undefined : appContext?.locale?.getSnapshot?.()
+      const active = typeof snapshot?.active === 'string' ? snapshot.active : ''
+      if (active.toLowerCase().startsWith('ko')) return 'ko'
+      if (active !== '') return 'en'
+      return typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('ko')
         ? 'ko'
         : 'en'
+    }
 
     function t(key, vars) {
-      const dictionary = I18N[LANGUAGE] || I18N.en
+      const dictionary = I18N[activeLanguage()] || I18N.en
       const template = Object.prototype.hasOwnProperty.call(dictionary, key)
         ? dictionary[key]
         : Object.prototype.hasOwnProperty.call(I18N.en, key)
```

### 2.3 결함 A-2 (Low, 미수정 — rc.3 제약): workspace 복원 시 ID 변경

`workspace/restore`가 원래 워크스페이스 ID가 아닌 **새 ID**를 반환한다. 원인은 rc.3의
`registry.create()`가 `WorkspaceId(randomUUID())`를 하드코딩하기 때문이며, 공개 API로는 ID 보존이
**불가능**하다. 플러그인 버그가 아니므로 수정하지 않았고, 사용자 혼란을 막기 위해 **UI 안내 문구
추가를 권고**한다.

### 2.4 UTM 불변식 위반 소지

`rollbackJournal`이 백업 시점의 `workspace.json` **전체를 덮어쓴다**(`restoreWorkspaceFile`).
UTM BOOT-CARD 불변조건 4("대상 workspace/세션만 되돌린다")에 어긋나며, 백업 이후 발생한 다른
워크스페이스 변경이 소실될 수 있다. **동작 변경 리스크가 있어 수정하지 않고 보고**한다.
→ 상세: [UTM-COMPLIANCE.md §2.2](UTM-COMPLIANCE.md)

## 3. 플러그인 B — DSH Notify (하이브리드 알림)

### 3.1 결함 B-1 (High, 수정): 존재하지 않는 패키지를 inject

`package.json`의 `dsh.client.inject`가 `@deepseek-ai/dsh-client-ui-slots`를 선언했으나
**rc.3에 그런 패키지는 없다.** `slots` 서비스의 실제 제공자는 `@deepseek-ai/dsh-client-ui-renderer`이며
코어 플러그인 31개가 이를 주입한다. `client-modules`가 미해석 inject를 **조용히 무시**하기 때문에
플러그인은 부팅에 성공했지만 **모듈 초기화 순서 보장을 잃은 상태**였다.

```diff
--- a/dsh-notify/package.json
+++ b/dsh-notify/package.json
@@ -55,7 +55,7 @@
       "inject": [
         "@deepseek-ai/dsh-api-remotes",
         "@deepseek-ai/dsh-client-ui-session",
-        "@deepseek-ai/dsh-client-ui-slots"
+        "@deepseek-ai/dsh-client-ui-renderer"
       ]
     }
   }
```

### 3.2 결함 B-2 (Medium, 수정): 보안 컨텍스트 오표시

비보안 컨텍스트(예: `http://<LAN-IP>:3080`)에서는 브라우저가 권한을 **강제로 `denied`로 고정**하는데,
플러그인이 이를 "사용자가 알림을 차단함"으로 **잘못 표시**했다. `insecure` 상태를 분리해 정확히
안내하고 토스트로 강등하도록 수정했다. 정상적인 사용자 차단은 그대로 `denied`로 유지된다(회귀 테스트 고정).

```diff
--- a/dsh-notify/lib/client.js
+++ b/dsh-notify/lib/client.js
+      function secureContextOf() {
+        return safe(() => globalThis.isSecureContext !== false, true)
+      }
+
       function permissionOf() {
         if (!NotificationCtor) return 'unsupported'
-        return NotificationCtor.permission || 'default'
+        const reported = NotificationCtor.permission || 'default'
+        if (reported === 'denied' && !secureContextOf()) return 'insecure'
+        return reported
       }
```

### 3.3 리눅스 알림 파이프라인 실측 — **알림 데몬 없음**

| 항목 | 측정값 | 영향 |
|---|---|---|
| 사용자 그래픽 세션 | **없음** (`cosmic-greeter` tty1, uid 987만) | 데스크톱 채널 부재 |
| D-Bus 세션 버스 | `unix:path=/run/user/1000/bus` 정상 | — |
| `org.freedesktop.Notifications` | **`ServiceUnknown: not activatable`** | **OS 알림 전달 불가** |
| 알림 데몬 | dunst/mako/notify-osd/xfce4-notifyd **전부 미설치** | — |
| `notify-send` | **미설치** | — |
| `notification-daemon` | 패키지 존재하나 **D-Bus service 파일 없음** | 자동 활성화 불가 |

### 3.4 보안 컨텍스트 통제 실험 (핵심)

동일 권한 grant를 양쪽 origin에 적용한 실측:

| origin | `isSecureContext` | `Notification.permission` | `show` 이벤트 |
|---|---|---|---|
| `http://192.168.50.203:3098` | **false** | **denied (강제)** | 없음 |
| `http://localhost:3098` | true | granted | **발화** |

**결론: `0.0.0.0:3080`을 LAN IP로 접속하는 원격 브라우저에서는 OS 알림이 원천적으로 불가능**하며,
"하이브리드/듀얼 모드"는 **토스트+사운드 전용으로 강등**된다.

### 3.5 결함 B-3 (advisory, 미수정): approval/question 리스너 인자

`(scope, request, next)` 3인자 바인딩이나 rc.3 코어 소비자는 `(request, next)` 2인자를 쓴다.
선행 `scope`는 죽은 인자지만 rc.3이 항상 `next` bail 클로저를 제공하므로 **오늘은 무해**하다.
리스크 대비 이득이 없어 문서화만 했다.

## 4. Windows → Linux 이관 적합성

| 항목 | 결과 |
|---|---|
| UTF-8 (플러그인 전체 소스 `iconv` 전수) | **PASS** |
| BOM / CRLF | 0건 / 0건 — **PASS** |
| Windows 경로 리터럴 (`C:\`, `%USERPROFILE%`) | 플러그인 코드 0건 — **PASS** |
| 경로 구분자 호환 | `'/'`·`'\\'`·`':'` 동시 처리 — **PASS** |
| 워크스페이스 7개 경로 실재·`realpath` 정규화 | 전부 일치 — **PASS** |
| 파일 권한 | `workspace.json` 0600, 세션로그 0600, 디렉토리 0775 — **PASS** |
| 한글 경로 | `기본 작업공간` 정상, 구 Windows `문서` 경로 잔재 없음 — **PASS** |

### 4.1 기존 문서 오류 정정: 세션 로그는 "2프레임"이 아니라 N프레임

`MIGRATION.md`는 로그를 "exactly two frames"라고 기술하지만 실측은 다음과 같다:

```
logs: 97
frame-count histogram: {"2":87,"3":2,"5":1,"243":1,"296":1,"357":1,"498":1,"604":1,"739":1,"755":1}
```

DSH writer는 헤더 프레임 1개 + 이벤트 프레임 N개로 **증분 append**한다. `session-log.mjs`는
`frames.slice(1)`로 모든 이벤트 프레임을 보존하므로 **코드는 정확**하고 **문서만 틀렸다**.

### 4.2 감사 스크립트의 거짓 실패 수정

`scripts/audit-promoted-state.mjs`가 "정확히 2프레임"과 "제목 == 2026-10-24 스냅샷"을 강제해서,
**현재 이 감사를 수행 중인 라이브 세션 자신**이 append/자동제목 부여로 실패하고 있었다
(자기 자신을 corrupt로 오판). 두 검사를 **실제 불변식**으로 교체했다.

```diff
-    if (frames.length !== 2) throw new Error('expected exactly 2 frames, got ' + frames.length);
+    // Frame count is not an invariant. DSH appends one frame per write, so any live session
+    // keeps growing past its promotion-time count (the session running this audit is one).
+    if (frames.length < 2) throw new Error('expected at least a header frame and one event frame, got ' + frames.length);
...
-      if (origBody !== body) throw new Error('body differs from original archive');
+      if (origBody !== body) {
+        if (!body.startsWith(origBody)) throw new Error('body differs from original archive (not an append-only extension)');
+        appends.push(id);
+      }
```

제목 검사도 분리: **identity 결속(불변식)**은 그대로 강제하고, **제목 값은 "소실 금지"**로 완화.
음성 대조군(1바이트 변조)으로 **여전히 corruption을 탐지함**을 확인했다.

## 5. 검증 명령 (재실행 가능)

```bash
cd /home/minami/Workspace/projects/dsh-workspace/dsh-plugins

# ── 1. 플러그인 B 단위 테스트 (19/19)
(cd dsh-notify && node --test test/client.test.mjs)

# ── 2. 전체 소스 구문 검사
for f in dsh-sidebar-manager/lib/*.js dsh-sidebar-manager/lib/*.mjs dsh-notify/lib/*.js; do
  node --check "$f" || echo "FAIL $f"
done

# ── 3. 승격 상태 감사 (47 checks)
node scripts/audit-promoted-state.mjs | tail -3

# ── 4. inject 패키지 실재성 (양쪽 플러그인)
D=/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
for p in dsh-sidebar-manager dsh-notify; do
  node -e "const p=require('./$p/package.json');
    for (const x of p.dsh.client.inject) {
      const ok=require('fs').existsSync('$D/'+x.split('/').pop());
      console.log((ok?'OK  ':'MISS')+' '+x); }"
done

# ── 5. 리눅스 알림 데몬 실측
export XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
gdbus call --session --dest org.freedesktop.Notifications \
  --object-path /org/freedesktop/Notifications \
  --method org.freedesktop.Notifications.GetServerInformation
#  기대값: ServiceUnknown → OS 알림 불가 (토스트 폴백)

# ── 6. 세션 로그 프레임 분포 실측
node -e '
const fs=require("fs"),path=require("path"),r=process.env.HOME+"/.dsh/sessions";let h={};
for(const d of fs.readdirSync(r))for(const s of fs.readdirSync(path.join(r,d))){const f=path.join(r,d,s,"session.v4.jsonl.zstd");
 if(!fs.existsSync(f))continue;const b=fs.readFileSync(f);let o=0,c=0;
 while(o<b.length){if(b.readUInt32LE(o)!==0xFD2FB528)break;o+=4;const hd=b.readUInt8(o);o+=1;
  const fcs=hd>>>6,sn=(hd&32)!==0,ck=(hd&4)!==0,dt=hd&3;o+=fcs===0?(sn?1:0):(1<<fcs);o+=(sn?0:1)+(dt===3?4:dt);
  for(;;){const x=b.readUIntLE(o,3);o+=3;const l=x&1,t=(x>>>1)&3,z=x>>>3;o+=t===1?1:z;if(l)break}if(ck)o+=4;c++}
 h[c]=(h[c]||0)+1}
console.log("frame histogram:",JSON.stringify(h));'
```

## 6. 활성화 판단 (Lead 권고)

두 플러그인 모두 rc.3 호환이 **실증**되었으므로 기술적 활성화는 가능하다. 다만:

| 플러그인 | 권고 | 이유 |
|---|---|---|
| A `dsh-sidebar-manager` | **조건부 활성화** | rc.3 호환 검증됨. 단 §2.4 롤백 전체복원 결함을 먼저 처리하거나, 사용 빈도 낮은 기능으로 한정 권고 |
| B `dsh-notify-web` | **활성화 권고** | 테스트 19/19. 단 "데스크톱 알림"으로 홍보 금지 — HTTPS/localhost가 아니면 토스트 전용 |

**실제 활성화 절차**(사용자 승인 후):

```bash
dsh plugin --profile web add link:/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-notify
dsh --profile web --dump-config | grep -A3 dsh-notify-web
systemd-run --user --on-active=20 --unit=dsh-web-restart-once systemctl --user restart dsh-web.service
```

**롤백**: `dsh plugin --profile web remove @nolit/dsh-notify-web` 후 재시작.

> 주의: 라이브 프로필 활성화는 3080 서비스 재시작이 필요하며 이 세션이 종료된다.
> 승인 없이는 수행하지 않았다.
