<!-- GitHub release body for Nolitor/dsh-notify v0.0.1-rc.4. English is the default; the Korean section follows. -->

## The published `0.0.1-rc.3` was broken. This release fixes it.

`0.0.1-rc.3` shipped to npm and GitHub with a defect that made the peak countdown chip **dead**.
The slot registered correctly, so nothing looked broken from the outside — the chip simply painted
nothing. Every render threw:

```
ReferenceError: doc is not defined
```

If you installed `0.0.1-rc.3`, upgrade. It is superseded and is not a valid install target.

```bash
dsh plugin --profile web add @nolit/dsh-notify
```

- npm: https://www.npmjs.com/package/@nolit/dsh-notify
- Version: `0.0.1-rc.4` · dist-tags `rc` and `latest` · DSH `>=0.2.2-alpha.2 <0.3.0` · Node `>=24.9`

---

## What was wrong

`makePeakChip` builds the header chip. It is a **UI adapter that lives outside `createNotifyCore`**,
but it read the core's internal `doc` binding. That binding was out of lexical scope, so the
component threw on the first line that touched it.

The failure was invisible for two reasons:

1. **Registration succeeded.** The slot accepted the component, so the plugin appeared healthy in
   the loader tree and in `--dump-config`.
2. **The suite never rendered the component.** It asserted *which slot* registered, not that the
   component survives a render. 69 tests passed with the chip dead.

| Surface | Before (`0.0.1-rc.3`) | After (`0.0.1-rc.4`) |
| :--- | :--- | :--- |
| Peak chip | slot registered, never painted | renders |
| Render of the registered component | throws `ReferenceError` | returns a button element |
| Regression test | none (slot registration only) | renders the component and asserts no throw |
| Tests | 69 in the published tarball | **70** |

**The fix.** The component resolves the document from the browser global inside the component body,
which is the correct source for a UI adapter, and passes it to `readActiveProvider` /
`watchActiveProvider`. Core-side callers (`peakAnnounce`, `syncBadge`) were already inside the
closure and are unchanged.

**Regression test.** The suite now renders the registered component and asserts it does not throw.
A green suite that never invokes the component proves nothing about it.

## Verification, measured against the published tarball

The render probe below ran against the **tarball downloaded from npm**, not the source tree:

| Target | Result |
| :--- | :--- |
| `0.0.1-rc.3` from npm | `THREW -> ReferenceError: doc is not defined` |
| `0.0.1-rc.4` from npm | `RENDERED element button` |

Also verified: `npm test` 70/70, the packaging gate (`check-npm-publishable`, 38-file tarball)
passes, every relative import in the tarball resolves, and `package.json`, `market/index.json`,
`cordis.patch.yml` and the client module id all agree on `@nolit/dsh-notify`.

## Unchanged and correct

The package name `@nolit/dsh-notify`, the `cordis.patch.yml` row id `notify`, the mount seat
`conversation.session.header.utilities`, the peak window definition (fixed UTC schedule with
Chinese public holidays excluded, matched on the Beijing calendar day), and the route gate
(`deepseek-official` and `deepseek-account` only, unless *show on any provider* is enabled).

---

## 한국어

## 배포된 `0.0.1-rc.3`은 고장난 상태였습니다. 이번 릴리스가 고칩니다.

`0.0.1-rc.3`은 피크 카운트다운 칩이 **죽어 있는** 상태로 npm과 GitHub에 배포됐습니다. 슬롯
등록은 정상이라 겉으로는 아무 문제가 없어 보였고, 칩은 그냥 아무것도 그리지 않았습니다.
렌더마다 다음 예외가 발생했습니다:

```
ReferenceError: doc is not defined
```

`0.0.1-rc.3`을 설치하셨다면 업그레이드하십시오. 폐기된 버전이며 유효한 설치 대상이 아닙니다.

```bash
dsh plugin --profile web add @nolit/dsh-notify
```

- npm: https://www.npmjs.com/package/@nolit/dsh-notify
- 버전: `0.0.1-rc.4` · dist-tags `rc`, `latest` · DSH `>=0.2.2-alpha.2 <0.3.0` · Node `>=24.9`

## 무엇이 잘못됐나

`makePeakChip`은 헤더 칩을 만드는 함수로, **`createNotifyCore` 바깥에 있는 UI 어댑터**입니다.
그런데 코어 내부의 `doc` 바인딩을 읽었습니다. 그 바인딩은 어휘 범위(lexical scope) 밖이라
처음 참조하는 줄에서 예외가 났습니다.

실패가 보이지 않았던 이유는 두 가지입니다:

1. **등록은 성공했습니다.** 슬롯이 컴포넌트를 받아들였기 때문에 로더 트리와 `--dump-config`
   에서는 정상으로 보였습니다.
2. **테스트가 컴포넌트를 렌더하지 않았습니다.** 어느 슬롯에 등록됐는지만 확인했고, 렌더를
   견디는지는 확인하지 않았습니다. 칩이 죽은 상태로 69개 테스트가 통과했습니다.

| 표면 | 이전 (`0.0.1-rc.3`) | 이후 (`0.0.1-rc.4`) |
| :--- | :--- | :--- |
| 피크 칩 | 슬롯 등록만 되고 그려지지 않음 | 렌더됨 |
| 등록된 컴포넌트 렌더 | `ReferenceError` 발생 | button 엘리먼트 반환 |
| 회귀 테스트 | 없음(슬롯 등록만 확인) | 렌더 후 예외 없음을 확인 |
| 테스트 | 배포 tarball 기준 69개 | **70개** |

**수정.** 컴포넌트 본문에서 브라우저 전역의 document를 직접 읽습니다. UI 어댑터에게는 그것이
올바른 출처이며, 그 값을 `readActiveProvider` / `watchActiveProvider`에 넘깁니다. 코어 내부
호출자(`peakAnnounce`, `syncBadge`)는 이미 클로저 안이었으므로 변경하지 않았습니다.

**회귀 테스트.** 이제 등록된 컴포넌트를 실제로 렌더해서 예외가 없는지 확인합니다. 컴포넌트를
한 번도 호출하지 않는 초록불 테스트는 그 컴포넌트에 대해 아무것도 증명하지 못합니다.

## 검증 — 배포된 tarball 기준

아래 렌더 프로브는 소스트리가 아니라 **npm에서 내려받은 tarball**을 대상으로 실행했습니다:

| 대상 | 결과 |
| :--- | :--- |
| npm의 `0.0.1-rc.3` | `THREW -> ReferenceError: doc is not defined` |
| npm의 `0.0.1-rc.4` | `RENDERED element button` |

추가 확인: `npm test` 70/70, 패키징 게이트(`check-npm-publishable`, 38파일 tarball) 통과,
tarball 내 모든 상대 import 해석 성공, `package.json`·`market/index.json`·`cordis.patch.yml`·
클라이언트 모듈 id가 모두 `@nolit/dsh-notify`로 일치.

## 변경하지 않았고 올바른 것

패키지명 `@nolit/dsh-notify`, `cordis.patch.yml`의 행 id `notify`, 마운트 슬롯
`conversation.session.header.utilities`, 피크 시간대 정의(고정 UTC 스케줄 + 중국 공휴일 제외,
베이징 달력일 기준), 라우트 게이트(`deepseek-official`·`deepseek-account`만, *모든 제공자에서
표시*를 켜면 예외)는 그대로입니다.
