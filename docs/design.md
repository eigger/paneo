# Paneo 설계 문서

> 프로젝트명: **Paneo** (작업 저장소 경로는 `easydash`, 제품/패키지명은 Paneo).
> 위젯 `pluginId` 네임스페이스·컨테이너 이미지·UI 브랜딩은 Paneo 기준.

> 라즈베리 파이·상시 디스플레이 장치를 위한 대시보드 플랫폼.
> **웹에서 드래그&드롭으로 편집 → 디스플레이에 리로드 없이 실시간 반영.**

- 상태: Draft v0.1
- 작성일: 2026-07-03
- 대상 규모: 소수 다중 기기 (집/사무실 방마다 화면)
- 위젯: 플러그인 생태계 (서드파티 확장 가능)
- 호스팅: **셀프호스트 확정** — 클라우드 아님. 디스플레이와 같은 기기 병설(co-locate) 허용 (§10)

---

## 0. 결정 로그 (Decision Log)

2026-07-03 확정.

| # | 결정 | 선택 | 비고 |
|---|---|---|---|
| N0 | 프로젝트명 | **Paneo** | 대시보드 제품 충돌 없음. npm/GitHub 단독 선점 불가 시 `@scope/paneo`·`paneo-app` 대안 |
| A1 | 타깃 Pi / tier 경계 | **Pi 4+ = `high`, Pi 3·Zero 2 = `low`** | RTSP·영상은 `high` 전용 |
| A2 | 디스플레이 런타임 | **단일 React + 기능 플래그/code-split** | 저성능도 같은 코드로 degrade |
| A3 | 전송 채널 | **WebSocket 기본 + SSE 폴백** | 발행/명령 양방향 |
| A4 | M0 착수 | **착수** | 발행 허브+kiosk+"적용" 반영 |
| B1 | 호스팅 | **셀프호스트, 병설 허용** | 클라우드 ✕. 서버를 디스플레이 Pi와 같은 기기에 올려도 됨. Docker 단일 컨테이너 ✅ D18 |
| B2 | 컴패니언 에이전트 | **선택 설치 (사실상 표준 전제)** | 전원 제어가 거의 필수화될 것 → 원터치 설치·기본 권장, 로드맵 조기 배치 |
| B3 | 인증 범위 | **로컬 우선, 외부 노출은 옵션** | 편집기 로그인은 최소한 항상 |
| C1 | 서드파티 개방 | **단계적** (내장→검증→샌드박스 개방) | M6에서는 원격 번들 실행 없이 샌드박스 iframe 기반 외부 임베드까지만 개방 |
| C2 | MVP 위젯 | **17종** (시계·날짜·텍스트·날씨·대기질·일정목록·월간달력·RSS·사진·외부페이지·타이머·Home Assistant·세계시계·D-Day·할일목록·환율·QR코드) | M1→8종, M3→10종, M5→11종, D24→12종, D25→17종 |
| C3 | 사진/카메라 소스 | **로컬폴더 → Immich → RTSP** | |
| D1 | 다국어(i18n) | **처음부터 반영. 편집기 UI 언어 ↔ 기기 로케일 분리** | ko/en 시작, `Intl` 포맷, 카탈로그 확장(§4.4) |
| D2 | 편집기 메뉴 구조 | **설정(⚙ 모달) vs 편집(툴바) 분리, M0에서 선반영** | 툴바=화면선택·팔레트·적용, 설정=언어·로케일(→M2에 성능프로파일·전원스케줄·페어링 추가될 자리) |
| D3 | 위젯 팔레트 UX | **"+ 위젯 추가" 버튼 → 카테고리별(기본/데이터/미디어) 팝오버** | 위젯 늘어도 툴바 안 어지러움. `widgets.js`에 `category`만 지정하면 자동 편입 |
| D4 | 위젯 레이아웃 엔진 | **실제 CSS Grid로 전환**(수동 px 배치 폐기) + 자동 빈칸 배치 + ~~겹침 시 시각 경고(차단 아님)~~ → **겹치는 위젯을 자동으로 아래로 밀어내 항상 비겹침 유지** (2026-07-03 변경) | CSS는 배치(위치·크기)만 해결, 정렬가이드/충돌은 JS 필요. 그리드 라이브러리(gridstack.js 등) 도입은 보류 — 현재 규모에서 직접 구현이 더 가벼움. 밀어내기는 좌우가 아니라 **아래쪽으로만**(react-grid-layout류 표준 방식) — 가로는 `cols` 한도 때문에 처리가 훨씬 복잡해지는 반면, 세로는 이미 있는 "rows는 최소값, 필요시 자동 확장"(`effectiveRows`) 구조와 그대로 맞물림. `editor.js:resolveCollisions()`가 드래그 대상 위젯을 시작점으로 겹치는 위젯을 `y = 대상.y + 대상.h`로 밀고, 그 위젯이 또 다른 위젯과 겹치면 연쇄적으로 계속 밂(항상 아래로만 증가하므로 종료 보장). 드래그 중 매 pointermove마다 실행하되, 위젯 콘텐츠 재렌더링(`renderWidget`, 타이머·네트워크 폴링 재시작 유발) 없이 위치만 갱신(`repositionNodes()`)해서 끊김 없음. 편집기 캔버스/디스플레이 외곽 여백도 위젯 간 `gap`과 동일하게 통일(`applyGridContainer`의 `padding`) |
| D5 | 캘린더/RSS/사진 다중 소스 | **동적 "+ 추가" 리스트 입력**(URL 여러 개 등록) → 서버가 소스별로 캐시된 개별 fetch를 병렬 수행 후 병합·시간순 정렬·상한(15개)으로 잘라 반환 | 한 소스 실패해도 나머지는 정상 표시(`Promise.allSettled`). 사진도 textarea 줄바꿈 대신 동일한 리스트 UI로 통일 |
| D6 | 기기 해상도/방향 | **"A" 수동 설정**(프리셋 5종 + 직접 입력 + 회전 버튼)을 `Device.resolutionW/H`로 저장, 편집기 캔버스 `aspect-ratio`를 선택 기기 값으로 동적 계산. **"B" 자동 감지는 보류**(디스플레이가 WS로 실제 해상도 보고 → 같은 필드 덮어쓰기) — 같은 필드를 쓰도록 설계해 나중에 스키마 변경 없이 B로 확장 가능 | 방향(가로/세로)은 W>H로 자동 도출, 별도 필드 안 둠. 디스플레이 자체는 이미 CSS Grid(`1fr`)라 런타임에 모든 해상도에 비례 대응 — 이번 작업은 "편집기 미리보기 모양"을 실제 기기와 맞추는 것 |
| D7 | 기기 그룹 일괄 복사 | **레이아웃 한 기기→그룹 전체 복사 지원** | 편집기에서 "그룹에 복사" 버튼 → 그룹 내 모든 기기에 동일 레이아웃 발행. M2 완료 |
| D8 | ICS 월간 달력 그리드 | **기존 `paneo.calendar`(이벤트 리스트)와 별도 위젯 `paneo.calendar.month` 추가** | 동일 ICS 프록시 재사용. 7열 그리드, 오늘 하이라이트, 날짜 셀 이벤트 제목(8자 말줄임). M3 완료. **버그 수정(2026-07-03)**: 프록시 재사용이 문자 그대로였던 게 문제 — `/api/proxy/ical`이 "다음 15개 예정 이벤트"용으로 소스당 10개·병합 15개 캡 + "24시간 이전 제외" 필터를 걸었는데, 이건 `paneo.calendar`(리스트)엔 맞지만 `paneo.calendar.month`(한 달 전체를 보여줘야 함)엔 안 맞아서 바쁜 달력은 월 후반부 이벤트가 통째로 사라졌음. `from`/`to`(방문 중인 그리드의 날짜 범위) 쿼리를 추가해 월간 위젯은 캡·과거 제외 없이 해당 범위에 겹치는 모든 이벤트를 받도록 분리(`src/dataproxy.js`) — `paneo.calendar`는 기존 동작 그대로 |
| D9 | 멀티 알람 타이머 | **위젯 1개에 타이머 여러 개(`list`) — `paneo.timer`** | `timers: list[{ label, targetTime, mode }]` config 구조. countdown/countup/both 모드. 자정 자동 초기화. M3 완료. **확장(2026-07-03)**: 각 항목에 `showAt`/`hideAt`(둘 다 선택) 추가 — `label\|HH:MM[:SS]\|mode\|showAt\|hideAt`. 지금 시각이 `[showAt, hideAt)` 구간 밖이면 그 행 자체가 렌더링에서 빠짐(자정 넘어가는 구간도 처리). 설정된 타이머가 전부 구간 밖이면 위젯이 통째로 빈 상태가 됨 — "위젯이 보였다 안 보였다" 요구사항. `time`도 초 단위(`HH:MM:SS`)까지 허용하도록 `parseTargetTime` 확장(기존 `HH:MM`도 그대로 동작, 초는 0으로 기본). **인스펙터 UX 개선(2026-07-03)**: `label\|HH:MM\|mode\|showAt\|hideAt` 한 줄 수기 입력 대신, 항목당 이름(텍스트)·기준 시각(`<input type=time step=1>`)·모드(select)·표시 시작/종료(`<input type=time>`) 구조화 필드로 입력 — 새 인스펙터 필드 타입 `timerList`(editor.js). 저장 형식도 파이프 문자열 배열 → `{label,time,mode,showAt,hideAt}` 객체 배열로 전환하되, `render()`가 기존 파이프 문자열도 여전히 파싱해 이전에 저장된 레이아웃과 호환 |
| D10 | 에이전트 전용 WS 채널 분리 | **에이전트용 `/ws/agent?token=xxx` 엔드포인트 구축** | 브라우저 디스플레이 전송 채널인 `/ws`와 명확하게 분리하여 통신 신뢰성 확보. M4 완료. **버그 수정(2026-07-03)**: `agentPresent`는 "runtime-only, 서버 시작 시 0으로 리셋"이라는 주석만 있고 실제 리셋 코드가 없어서, 서버가 크래시/재시작하면 에이전트가 재접속하기 전까지 DB에 남은 이전 `true` 값을 그대로 보여줬음(에이전트 자체는 지수 백오프로 정상 재접속하므로 짧게만 부정확). `store.js:load()`에 `UPDATE devices SET agentPresent = 0` 추가 |
| D11 | 서버 중심 전원 스케줄링 | **서버 1분 Interval 스케줄러 + 에이전트 명령 전송** | 에이전트 자체에 복잡한 cron을 두지 않고, DB 설정에 기반해 서버가 주기적으로 체크하여 명령하는 Thin 에이전트 구조 선택. M4 완료 |
| D12 | Home Assistant REST 프록시 | **서버 사이드 API 호출 대행 및 토큰 은닉** | Bearer 토큰은 서버에만 저장하고, 디바이스 클라이언트는 토큰 노출 없이 특정 엔티티 조회를 서버 프록시로 수행. M5 완료 |
| D13 | Ken Burns 애니메이션 제어 | **고성능 프로파일(high) 한정 활성화** | CPU 자원 소모가 많은 줌/이동 애니메이션 효과는 `high` 기기에서만 작동하고 `low` 기기에서는 정적으로 전환되도록 설계. M5 완료 |
| D14 | M6 서드파티 범위 | **검증된 iframe 샌드박스 임베드까지만 마감** | `paneo.iframe`은 `http/https`만 허용, sandbox 모드(strict/scripts/trusted)를 명시, 매니페스트 권한을 편집기 속성 패널에 표시. 임의 원격 JS 번들 로딩은 보류 |
| D15 | RTSP 처리 | **이번 마무리에서 보류** | 카메라 게이트웨이/영상 디코딩은 부하와 배포 의존성이 커서 후속 M7 후보로 분리 |
| D16 | 위젯별 커스텀 CSS | **위젯 인스턴스에 `customCss`(CSS 선언 목록, 셀렉터 없음) 필드 추가, 인스펙터에 인라인 스타일로 적용** | 전체 스타일시트가 아니라 해당 위젯의 콘텐츠 요소에 `style.cssText`로 직접 주입 → 셀렉터가 없어 다른 위젯·앱 크롬으로 새어나갈 수 없음(추가 샌드박싱 불필요). x/y/w/h처럼 위젯 타입에 무관한 범용 속성이라 `config{}` 스키마가 아닌 `WidgetInstance` 최상위 필드로 둠. 2026-07-03 완료 |
| D17 | 서드파티 위젯 플러그인 | **하이브리드**: 파일시스템 설치형 `module`(관리자 신뢰 = 코어와 동일 권한, 샌드박스 없음) + URL 등록형 `iframe`(`paneo.iframe`과 동일한 샌드박스 재사용) 두 유형. `src/plugins.js`가 서버 기동 시 `data/plugins/<id>/manifest.json`을 스캔해 `/api/plugins`로 노출, `public/shared/widgets.js:loadPlugins()`가 편집기·디스플레이 양쪽에서 `widgets{}` 레지스트리에 동적 병합 | §7.3/D14가 못박은 "내장→검증된 iframe/레지스트리→완전 개방" 단계적 원칙의 다음 단계. 원격 코드를 무조건 열지 않고, 신뢰 경로(파일시스템 설치)와 비신뢰 경로(URL만 등록 → 샌드박스)를 분리해 자동 격리. `Plugin` 엔티티(§5)가 처음으로 실제 구현됨. 카테고리는 매니페스트 자기신고를 무시하고 항상 `plugin`으로 고정(위조 방지). 작성 가이드: `docs/plugins.md`, 동작 예제: `docs/examples/plugins/hello-badge/`. postMessage 기반 iframe 데이터 채널은 미구현(현재는 최초 로드 시 쿼리스트링으로만 config 전달) — 후속 개선 후보. 2026-07-03 완료 |
| D18 | 배포 산출물 Docker화 | **`Dockerfile`(멀티스테이지 아님, 빌드 스텝 없음) + `docker-compose.yml`(named volume `paneo-data:/data`)** — `node:22-alpine`, non-root(`USER node`), `HEALTHCHECK`는 별도 패키지 없이 Node 내장 `fetch`로 `/api/version` 확인 | §10/§11이 원래부터 원칙으로 못박아뒀던 걸 실제로 구현. `PANEO_DATA_DIR=/data`로 SQLite·사진·플러그인을 볼륨에 분리해 컨테이너 재생성에도 데이터 보존 — 실제로 `docker build` → 기기 생성 → 컨테이너 재기동 → 같은 기기 ID 유지까지 검증함. 편집기 인증·RTSP는 이번 범위에서 사용자가 명시적으로 제외(§12, §8.1) | 2026-07-03 완료 |
| D19 | 릴리즈 시 이미지를 GitHub Packages(GHCR)에 발행 | **`.github/workflows/docker-release.yml`** — 트리거는 태그 push가 아니라 **GitHub Release `published` 이벤트**(+ `workflow_dispatch` 수동 실행), `linux/amd64`+`linux/arm64` 멀티플랫폼 빌드 후 `ghcr.io/eigger/paneo`에 `{version}`/`{major}.{minor}`/`latest` 태그로 push. `docker-compose.yml`에 `image`와 `build`를 동시에 지정해 한 파일로 "릴리즈 이미지 pull"과 "로컬 빌드" 둘 다 지원 | 태그 push가 아니라 Release 이벤트를 트리거로 쓴 이유: 스쳐가는 실험용 태그가 실수로 이미지를 발행하지 않도록. GITHUB_TOKEN에 `packages: write` 권한만 주면 되고 별도 PAT/시크릿 불필요(GHCR가 GITHUB_TOKEN을 네이티브 지원). arm64를 포함한 건 주 타깃(A1)이 Pi 4/5(arm64)라서 — 병설(§10) 배포 시 Pi 본체에서 이 이미지를 그대로 당겨쓸 수 있어야 함. 2026-07-03 완료(워크플로 작성 및 YAML 구조 검증까지 — 실제 발행은 다음 GitHub Release 때 최초 실행됨) |
| D20 | 원클릭 설치 스크립트도 Docker로 전면 교체 | **`scripts/install-pi.sh`의 `install_server()`를 npm+systemd에서 Docker+systemd로 교체** — `curl -fsSL https://get.docker.com \| sh`로 Docker 설치, `docker pull`로 이미지 받고, `docker run --rm --name paneo`(foreground)를 감싼 systemd 유닛으로 관리(`ExecStartPre=-docker rm -f paneo`로 비정상 종료 잔여 컨테이너 정리, 데이터는 `paneo-data` named volume). 소스 clone·`npm install` 단계 전부 제거 | 사용자가 명시적으로 "전면 교체"를 선택(부분 지원 옵션 대신). 덕분에 `create_token_if_needed()`의 JSON 파싱도 `node -e`에서 `grep`/`sed`로 바꿔 서버 전용(`PANEO_MODE=server`) 설치에서 Node.js가 아예 필요 없어짐 — 컴패니언 에이전트·kiosk(`PANEO_MODE=display`)는 `vcgencmd`/`wlr-randr`/`xset`처럼 컨테이너가 닿을 수 없는 OS 레벨 접근이 필요해 여전히 호스트에 직접 설치(Node 필요, 기존 그대로). 실제 `docker run --rm --name paneo ...` 명령과 `grep`/`sed` 토큰 추출 로직을 로컬에서 재현해 검증(빌드→실행→API 응답→재시작 후 데이터 보존까지). `docs/install-device.md`/`.ko.md`도 동일하게 갱신, Docker 없이 쓰는 경로는 §3.4에 대안으로만 남김 | 2026-07-03 완료 |
| D21 | `paneo.photo` → 미디어 슬라이드쇼로 확장 (동영상, 랜덤 순서, 업로드) | **동영상 지원**: URL/로컬 파일 확장자로 이미지·동영상 자동 판별, 동영상은 `<video autoplay muted playsinline>`로 렌더링하고 재생이 끝나는 `ended` 이벤트에서 다음 항목으로 넘어감(사진은 기존처럼 `intervalSec` 타이머). **랜덤 순서(`shuffleOrder`)**: 직전과 다른 인덱스를 뽑는 셔플, Ken Burns 프리로드용 "다음 항목"도 동일하게 미리 확정해 실제 전환과 어긋나지 않게 함. **로컬 업로드/관리**: 인스펙터에 새 필드 타입 `fileManager` 추가(`editor.js`) — 파일 목록 조회·업로드·삭제를 위젯 설정이 아니라 서버 전역 `data/photos/`에 대해 수행. 서버에 `POST /api/proxy/photos/local/upload`(`@fastify/multipart`, 파일당 500MB 한도, 확장자 화이트리스트)와 `DELETE /api/proxy/photos/local/file/:filename` 추가, 목록/서빙 라우트의 허용 확장자도 동영상까지 확장 | 위젯 라벨을 "사진 슬라이드쇼"→"미디어 슬라이드쇼"로 변경(더 이상 사진 전용이 아님, pluginId `paneo.photo`는 기존 저장 데이터 호환을 위해 유지). 파일명은 항상 `path.basename()`으로 새니타이즈(업로드·삭제·서빙 세 지점 모두) — 경로 탈출 방지, 실제로 `../../package.json` 삭제 시도가 404로 막히는 것까지 확인. 업로드 시 동명 파일은 덮어쓰지 않고 `-1`, `-2`... 접미사로 자동 회피. 실제 멀티파트 업로드→목록 반영→위젯 `<video>` 렌더(`src`/`autoplay`/`muted`/클래스 확인)→삭제까지 전 구간 실기기로 검증(단, 진짜 코덱 재생 자체는 샌드박스에 인코더가 없어 확인 못함 — 구조적 배선만 검증). **후속 개선(2026-07-04)**: 소스별 옵션 필드가 전부 동시에 보이던 것을 `config` 필드에 범용 `showIf: { key, equals }` 조건 추가로 해결 — `renderInspector()`(editor.js)가 조건 불충족 필드를 통째로 건너뛰고, 조건을 좌우하는 필드(`source`)가 바뀌면 인스펙터를 다시 그림. `paneo.photo` 전용이 아니라 어떤 위젯의 `config`든 재사용 가능한 범용 메커니즘. 라벨도 "사진 소스"→"미디어 소스"로 변경, 각 필드 라벨의 "(source=xxx)" 접미사는 조건부 표시 자체가 그 역할을 대신하므로 제거 | 2026-07-04 완료 |
| D22 | 7-각도 코드 리뷰(멀티페이지·미디어위젯 diff) 결과 버그 수정 일괄 반영 | **①데이터 손실(치명)**: `src/store.js`의 `defaultLayout()`이 여전히 구 flat 형식을 반환해 새 기기조차 편집기의 `selectDevice()`가 위젯을 통째로 버리는 문제 — `defaultLayout()`을 pages 형식으로 변경, `selectDevice()`/`getCurrentPageLayout()`을 공용 `migrateToPages()`로 통합해 구 형식(`{grid,background,widgets}`)의 위젯·그리드·배경을 page-0으로 보존. **②그리드 설정 유실**: `cellSize()`/`isFree()`/`findFreeCell()`이 존재하지 않는 최상위 `layout.grid`를 읽던 것을 현재 페이지(`pg.grid`)로 통일. **③디스플레이 스와이프 중복 실행**: 포인터+터치 두 핸들러가 같은 제스처에 둘 다 반응해 페이지가 2번 넘어가던 문제 — `public/shared/swipe.js` 신설, 편집기·디스플레이가 공유(임계값 60px+수직비율 게이트로 통일, 편집기는 `touchOnly`로 위젯 드래그와 충돌 방지). **④전원 스케줄 입력**: `type=text`→`type=time` 복원(네이티브 형식 검증 회복). **⑤`paneo.photo` 배경 레이어 하드코딩**: 위젯 4곳(JS)+CSS 2곳에 흩어져 있던 `type==='paneo.photo'` 문자열 비교를 위젯 정의의 범용 플래그 `backgroundLayer:true` + DOM `data-background-layer` 속성으로 일반화(플러그인 등 다른 위젯도 재사용 가능). **⑥편집기 드래그 성능**: `repositionNodes()`의 위젯별 `querySelector` 반복을 pointermove당 1회 벌크 조회+Map 조회로, `attachDrag`의 `getCurrentPageLayout()` 중복 호출도 정리. **⑦로컬 파일 삭제 라우트**: 업로드/목록과 동일한 `MEDIA_EXT_RE` 확장자 검사 추가 | `paneo.timer`의 mode/showSeconds 변경(사용자 자신의 의도된 수정)은 그대로 둠 — 리뷰에서 발견됐지만 수정 대상에서 제외. 데이터 손실 버그는 실제로 구 형식 draft(`{grid:{cols:10,...},background:'#123456',widgets:[...]}`)를 만들어 편집기에서 열고, 위젯·그리드·배경이 전부 보존된 채로 자동저장까지 되는 것을 실기기로 확인. `backgroundLayer` 일반화도 사진 위젯 위로 다른 위젯을 드래그해 밀려나지 않는 것 재확인 | 2026-07-04 완료 |
| D23 | `paneo.photo` "local" 소스 — 위젯별 파일 선택 | **공유 업로드 풀 + 위젯별 체크박스 선택**: `data/photos/`는 여전히 모든 local 위젯이 공유하는 단일 풀(업로드는 한 번만)이지만, 어떤 파일을 "이 위젯 인스턴스"가 보여줄지는 `config.localSelectedFiles`(파일명 배열)로 위젯마다 따로 저장. 인스펙터 파일 매니저에 위젯별 체크박스 열 추가(`fileManager` 필드에 `selectionKey` 속성 도입 — `renderInspector`/`setupFileManager`가 범용으로 처리, `paneo.photo` 전용 로직 아님). 체크한 파일이 없으면(기존 위젯·기존 설정) 지금까지처럼 전체 표시 — 하위 호환 | 사용자가 "같은 위젯을 여러 개 만들면 로컬 이미지가 전부 똑같이 적용된다"고 지적 — 폴더 분리 대신 공유 풀을 유지하는 이 방향으로 결정(업로드는 한 곳에서 관리하고 배치만 위젯별로 다르게). 실제로 위젯 A엔 `photo-a.png`만, 위젯 B엔 `photo-b.png`만 체크해서 두 위젯이 서로 다른 사진을 보여주는 것, 그리고 A에서 체크박스를 하나 더 켜도 B의 선택은 전혀 영향받지 않는 것까지 실기기로 확인 | 2026-07-04 완료 |
| D24 | 신규 위젯 `paneo.airquality`(대기질) 추가 | 코드 리뷰 턴에서 추천했던 위젯 목록(대기질/할일/환율·주식/세계시계/디데이/QR) 중 첫 번째로 구현. 기존 `paneo.weather`와 동일한 지오코딩(`geocoding-api.open-meteo.com`) 재사용, 새 프록시 라우트 `GET /api/proxy/airquality`(`src/dataproxy.js`)가 `air-quality-api.open-meteo.com`의 PM10/PM2.5 농도(µg/m³)를 받아 **한국식 4단계 등급(좋음/보통/나쁨/매우나쁨)**으로 변환해 반환 — 국내 사용자에게 익숙한 "미세먼지" 표기 방식(US/European AQI 대신). 등급 경계는 순수 함수 `gradeIndex(value, thresholds)`로 분리해 단위 테스트(`test/dataproxy.test.js`) 추가. 위젯은 `paneo.weather` 바로 옆에 동일 패턴(`pollJson`+10분 캐시)으로 등록 | 등급 인덱스(0~3)를 서버가 텍스트와 함께 반환해 클라이언트가 로케일 문자열로 색상을 매칭하지 않고 인덱스로 CSS 클래스(`aq-grade-0~3`)를 매칭하도록 설계 — 다국어 등급 텍스트가 늘어나도 색상 로직이 깨지지 않음. 이 개발 샌드박스에서도 §14-8과 동일한 아웃바운드 네트워크 제한으로 실제 API 응답은 확인 못 함(`fetch failed`/`ETIMEDOUT`, `curl`은 정상) — `fetch`를 모킹해 렌더링·등급별 색상·인스펙터 설정 필드까지는 편집기에서 실기기로 확인. 좁은 기본 크기(3×2)에서 라벨("초미세먼지")이 값과 겹쳐 줄바꿈되는 문제를 발견해 라벨은 말줄임표로 축약하고 값은 항상 한 줄로 보이도록 CSS 수정 | 2026-07-04 완료 |
| D25 | 나머지 추천 위젯 5종 일괄 추가 | **세계시계**(`paneo.worldclock`, `label\|IANA타임존` 목록, `Intl.DateTimeFormat`으로 클라이언트에서 1초마다 갱신, 네트워크 불필요), **D-Day 카운트다운**(`paneo.dday`, `label\|YYYY-MM-DD` 목록, 자정 기준 일수 차이 계산, 1분마다 갱신), **할 일 목록**(`paneo.todo`, `완료여부\|내용` 형식, 인스펙터에 체크박스 열 추가 — `icsUrls`의 색상-select 특수 케이스와 동일하게 `todoItems` 전용 분기를 `editor.js`에 추가), **환율**(`paneo.exchangerate`, Frankfurter API — ECB 환율, API 키 불필요, `GET /api/proxy/exchangerate`, 1시간 캐시), **QR 코드**(`paneo.qrcode`, npm `qrcode` 패키지로 **서버에서 로컬 생성**해 데이터 URL만 반환 — 외부 QR 이미지 API에 위젯 내용(URL, wifi 정보 등)을 노출하지 않음, `GET /api/proxy/qrcode`, 24시간 캐시). 위젯 총 12종 → 17종 | 세계시계/D-Day/할일목록은 순수 클라이언트 계산이라 이 개발 샌드박스의 아웃바운드 네트워크 제한(§14-8)과 무관하게 즉시 실기기 검증 가능했음. 환율(Frankfurter)과 QR(로컬 생성)은 이 샌드박스에서도 실제로 네트워크 응답을 받아 실기기로 완전 검증(환율 "1 USD = 1,531.23 KRW" 실시간 데이터, QR 스캔 가능한 패턴 렌더링까지 스크린샷으로 확인) — 대기질/날씨와 달리 이 두 API는 샌드박스에서 막혀있지 않았음. 환율 위젯은 기본 크기 3×2에서 값이 두 줄로 줄바꿈되며 날짜가 잘리는 문제를 발견해 기본 크기를 3×3으로 조정. 검증 중 디바이스 선택 드롭다운이 아직 이전 값("거실")에 남아있는 상태로 위젯을 추가해버릴 뻔한 실수가 있었으나, 실제로는 위젯이 추가되지 않은 것과 실기기 데이터를 재확인해 실사용자의 "거실" 레이아웃(위젯 3개)이 전혀 변경되지 않았음을 검증함 | 2026-07-04 완료 |
| D26 | D25 위젯 3종의 설정 입력을 `\|` 구분 문자열 → 구조화 필드로 전환 | 사용자가 "디데이나 새로 추가한 위젯중에 텍스트 기반 설정 \|로 구분하는거 하지 말고 각각 옵션을 지정해줘, 알람 타이머처럼" 요청. `paneo.timer`의 `timerList`(항목별 라벨/시각 등을 각각 입력창으로) UX를 참고하되, `paneo.timer` 자체(사용자 자신의 커스터마이징)는 건드리지 않고 **범용 `structList` 인스펙터 필드 타입**을 새로 도입 — 위젯의 `config[].fields`(각 하위 필드의 key/label/type)만 선언하면 `editor.js`가 라벨+입력창을 자동 생성(텍스트/체크박스/네이티브 `<input type=date>`). `paneo.worldclock`(라벨+타임존), `paneo.dday`(라벨+`<input type=date>`), `paneo.todo`(완료 체크박스+내용)에 적용, 저장 형식도 `"라벨\|값"` 문자열 → `{label, tz}`/`{label, date}`/`{done, text}` 객체로 전환(세 위젯 모두 이번 세션에 새로 만들어 실사용 데이터가 없어 구버전 문자열 하위호환 불필요 — `paneo.timer`의 `normalizeEntry`와 달리 파서 분기 없이 객체만 처리). 이전 turn에 추가했던 `todoItems` 전용 `list` 특수 케이스(체크박스만 별도 처리)는 제거하고 `structList`로 대체 | 이 작업을 검증하던 중 심각한 실수 발생: D-Day 위젯 테스트 도중 에디터의 기기 선택 드롭다운이 (원인 불명 — 페이지 재로드 관련 추정) 테스트용 기기에서 실제 사용자 기기 "거실"로 되돌아간 상태였는데, 이를 재확인하지 않고 `삭제`+위젯추가+입력을 실행해 **"거실"의 실제 위젯 3개(시계·사진·대기질)가 지워지고 D-Day 위젯 1개로 대체되는 사고 발생**. 즉시 발견해 이전에 세션 중 캡처해둔 "거실"의 정확한 draft JSON(위젯 3개의 id·좌표·config 전부)으로 `PUT /api/devices/:id/draft`를 호출해 완전 복구, `published`(실제 배포본, 위젯 1개짜리 구버전 — 이 세션에서 한 번도 건드리지 않음)는 애초에 영향받지 않았음을 확인. 이후부터는 매 mutating 액션 직전에 `document.querySelector('select').value`(보이는 텍스트가 아니라 실제 device id)를 재확인하는 방식으로 절차를 강화해 나머지 위젯(할일 목록) 검증을 안전하게 완료 | 2026-07-04 완료 |
| D27 | `paneo.todo` — 디스플레이에서 탭하여 완료 체크/해제 | 사용자가 "할일 목록은... 완료를 쉽게 선택할수 있어야함. 디스플레이에서 클릭하면 완료 체크/해제가 되어야 할텐데" 요청. 이제까지 모든 위젯은 읽기 전용(디스플레이는 편집기가 발행한 레이아웃을 그대로 그리기만 함)이었는데, 이건 처음으로 **디스플레이가 자기 설정을 직접 써야 하는** 케이스라 새 경로가 필요했음. 신규 라우트 `POST /api/display/:token/toggle-todo`(`src/server.js`, `/ws`와 동일하게 페어링 **토큰**으로 인증 — 디스플레이는 내부 device id를 모름)와 `store.toggleTodoItem(token, widgetId, index)`(`src/store.js`)를 추가. **설계 결정: draft가 아니라 published만 수정** — 이건 디자인 편집이 아니라 런타임 상호작용이므로, 인스펙터에서 동시에 편집 중일 수 있는 draft와 충돌하지 않게 분리했고, 나중에 "적용"을 누르면 draft가 published를 덮어써서 토글도 자연스럽게 사라짐(의도된 동작). 토글 후 `broadcast()`로 같은 기기에 연결된 모든 물리 디스플레이에 갱신을 즉시 전파. `display.js`가 `renderWidget()` 호출 시 위젯별 `widgetId`+기기의 `deviceToken`을 `ctx`에 실어보내도록 확장, `editor.js`의 `ctx()`도 `widgetId`+`preview:true`를 실어보내도록 확장(9곳의 `renderWidget(..., ctx())` 호출을 전부 `ctx(w)`로 일괄 변경) — 위젯은 `ctx.preview`가 없고 `ctx.deviceToken`/`ctx.widgetId`가 있을 때만(=진짜 디스플레이일 때만) 각 항목에 클릭 리스너를 달아 낙관적으로 체크 표시를 바꾸고 서버에 토글 요청을 보냄(실패 시 되돌림) | `store.test.js`에 `toggleTodoItem`이 draft는 그대로 두고 published만 바꾸는 것, 존재하지 않는 토큰/위젯 id에는 null을 반환하는 것을 유닛 테스트로 추가. 실기기 검증: 격리된 테스트 기기의 `/d/:token` 디스플레이 페이지에서 항목 클릭 → 즉시 체크 토글 → 서버 `published`에 반영(`draft`는 불변 확인) → 페이지를 완전히 새로고침해도 토글된 상태 유지 확인. 에디터 프리뷰(`ctx.preview:true`)에서는 `.todo-interactive` 클래스가 붙지 않아 클릭해도 아무 일 없음을 확인(편집기는 draft를 보여주므로 토글과 무관하게 원래 설정 그대로 표시). 검증 도중 클릭 직후 곧바로 `reload()`를 호출해 진행 중이던 토글 fetch 요청이 취소되어 반영 안 된 것처럼 보인 적이 있었는데, 이는 테스트 스크립트가 응답을 기다리지 않은 것일 뿐 — 실제 카오스크 사용 환경에서는 위젯 클릭 후 페이지가 스스로 새로고침되는 경로가 없으므로(스와이프는 하드 리로드가 아니라 `applyLayout()` 재호출) 실사용에서 발생할 문제는 아님. 서버(`src/server.js`, `src/store.js`) 코드가 사용자 실제 서버(4321) 기동 이후 바뀌어 재시작 필요 — 재시작 전후로 "거실" 기기 데이터(사용자가 이 기능을 테스트하려고 직접 추가한 것으로 보이는 `paneo.todo` 위젯 포함)가 그대로임을 확인 | 2026-07-04 완료 |
| D28 | `paneo.todo` — 디스플레이에서 항목 추가/삭제도 가능 | 사용자가 "항목 추가 삭제도 디스플레이에서 가능?" 질문 — D27(탭-투-토글)과 같은 축의 연장으로 구현. `store.js`의 `toggleTodoItem`을 공용 헬퍼 `mutateTodoItems(token, widgetId, mutate)`로 일반화하고, 그 위에 `addTodoItem(token, widgetId, text)`(빈 텍스트는 무시)와 `deleteTodoItem(token, widgetId, index)`를 추가 — 셋 다 **published만 수정**(D27과 동일한 이유: 런타임 상호작용이지 디자인 편집이 아님). 신규 라우트 `POST /api/display/:token/add-todo`, `POST /api/display/:token/delete-todo`(`src/server.js`, `toggle-todo`와 동일하게 토큰 인증 + 처리 후 `broadcast()`). 위젯 UI: 각 항목 오른쪽에 삭제 "×" 버튼(클릭 시 `stopPropagation`으로 토글 핸들러와 분리 + 낙관적으로 `display:none` 숨김, 실패 시 되돌림), 목록 아래에 텍스트 입력 + "+" 버튼(Enter 키로도 제출) — 항목이 0개여도 인터랙티브 모드에서는 에러 대신 "할 일이 없습니다. 아래에서 추가하세요" 안내 후 입력창을 보여줌. 추가는 낙관적 UI 없이 요청 성공 후 서버가 `broadcast()`로 보내주는 `layout.set`이 새 항목을 포함해 다시 그려주는 것에 의존(삭제/토글과 달리 "새로 생길 위치"를 미리 알 수 없어 낙관적 렌더가 애매하기 때문) | `store.test.js`에 `addTodoItem`(published만 반영·draft 불변·빈 문자열은 무시), `deleteTodoItem`(인덱스로 제거·draft 불변·범위 밖 인덱스는 null) 유닛 테스트 추가. 격리된 테스트 기기의 `/d/:token`에서 실기기로 확인: 입력창에 문자 입력 후 "+"버튼 클릭 → 새 항목이 서버 `published`에 반영되고 화면에 나타남; 항목의 "×" 클릭 → 즉시 사라지고 서버에서도 제거됨, 남은 항목의 인덱스가 재계산되어 토글도 정상 작동; 삭제가 토글을 함께 발동시키지 않음(stopPropagation 확인); 에디터 프리뷰에는 삭제 버튼/입력창이 전혀 렌더링되지 않고 draft 원본 그대로만 보임을 확인 | 2026-07-04 완료 |
| D29 | 라즈베리파이 실기기 키오스크 검증 — 버그 5건 수정 | (다른 세션에서 실제 Pi 키오스크 배포·테스트 중 발견) **①Chromium 번역 팝업**: `public/display/index.html`에 `<html translate="no">` + `<meta name="google" content="notranslate">` 추가. **②월간달력 위에서 커서 노출**: `.cal-m-day`의 불필요한 `cursor:default`(클릭 핸들러 없는 순수 표시 셀)가 전역 `cursor:none`을 덮어쓰던 것 제거. **③미디어 슬라이드쇼 다중 사용 시 점진적 비동기화**: 위젯마다 독립된 `setTimeout(advance, intervalSec*1000)` 체인이 매번 "지금부터 N초"로 재앵커링되어, 시작 시점 차이와 타이머 지연이 위젯별로 다르게 누적되던 문제 — "루프 하나로 처리"보다 더 단순한 방식으로, 매 예약마다 절대 벽시계 경계(`Date.now() % intervalMs`로 계산된 다음 배수 지점)에 맞춰 재계산하는 `delayUntilNextBoundary()` 도입(`public/shared/widgets.js`). 같은 간격의 위젯은 항상 같은 순간에 전환되고, 한 번 지연이 생겨도 다음 예약에서 그리드로 즉시 복귀 — 공유 싱글턴 루프/등록 메커니즘 없이 각 위젯이 독립적으로 동일한 결론에 도달. **④iCloud ICS(`https://p03-calendars.icloud.com/holidays/kr_ko.ics`) 안 뜸**: Google 캘린더는 되는데 iCloud는 안 되는 이유는 네트워크 문제가 아니라, iCloud 공휴일 캘린더가 각 공휴일을 `RRULE:FREQ=YEARLY`(연 반복) 하나로만 저장하기 때문 — 기존 `fetchCalendarSource`는 `e.start`(최초 발생일, 대부분 과거)만 보고 반복 규칙을 전개하지 않아 "이미 지난 일정"으로 걸러졌음(`src/dataproxy.js`에 rrule 전개 로직 추가, "upcoming" 모드는 90일 앞까지). 전개 도중 **부가로 발견한 두 번째 버그**: (a) `node-ical`이 시스템 로컬 타임존이 UTC가 아닐 때 전개된 occurrence를 로컬 오프셋만큼 밀어서 반환(KST 환경에서 실측 +9시간 — `TZ=UTC`에서는 정상, `TZ=Asia/Seoul`에서는 어긋남을 직접 확인) → 쿼리 윈도우를 그 "밀린 좌표계"로 변환해 넣고 결과를 다시 반대로 보정하는 `toRRuleQuirkSpace`/`fromRRuleQuirkSpace` 추가(DST 없는 타임존은 완전 정확, DST 있는 타임존은 전환 시점 근처만 근사). (b) Apple 캘린더가 `SUMMARY;LANGUAGE=ko:...`처럼 파라미터를 붙이면 `node-ical`이 문자열 대신 `{params,val}` 객체를 반환해 제목이 `[object Object]`로 깨지던 것 → `icalTextValue()`로 `.val` 언랩. **⑤월간달력에 이벤트 많으면 영역 밖으로 늘어남**: `.cal-m-grid`에 `grid-template-rows`가 없어 행이 콘텐츠 높이에 맞춰 `auto`로 늘어났음(이벤트가 3개+"+N" 배지까지 쌓인 셀이 그 행 전체를 늘림) — `grid-template-rows:auto repeat(${weekRows},1fr)`을 인라인으로 지정해 헤더 행만 자연 높이, 나머지 주(week) 행은 항상 동일 비율로 분배되도록 고정 | ①②는 코드 확인만으로 명확한 버그(대체 방향 불필요). ③은 사용자가 "루프 하나에서 처리하는 게 어때?"라고 제안했지만, 위젯마다 독립적으로 절대 시각에 맞춰 재계산하는 방식이 공유 상태/등록 없이 동일한 결과(동기화)를 내면서 훨씬 단순해 이 방향으로 채택 — 실제로 위젯 A를 렌더링하고 350ms 뒤 위젯 B를 렌더링해 각각의 `setTimeout` 지연을 가로채 비교했을 때, 두 위젯의 최종 발동 시각이 2ms 이내로 일치함을 확인. ④는 로컬에서 실제 iCloud URL을 `curl --compressed`로 받아 raw ICS를 직접 열어보고 나서야 RRULE 반복 구조를 발견 — 이후 `TZ=UTC`/`TZ=Asia/Seoul` 두 환경에서 직접 스크립트를 돌려 node-ical의 시간대 버그를 재현·확인. `test/dataproxy.test.js`에 합성 RRULE 이벤트(반복 주기 중 과거/예정/기간초과 occurrence가 각각 올바르게 필터링되는지)와 파라미터 붙은 SUMMARY 유닛 테스트 추가, 실제 iCloud 파일로도 엔드투엔드 확인(제헌절·광복절·추석 등 정상 표시). ⑤는 오늘 날짜에 이벤트 6개를 욱여넣은 로컬 합성 ICS로 실기기 검증 — "+3" 배지까지 정상 표시되면서 위젯 전체가 그리드 밖으로 늘어나지 않음을 스크린샷으로 확인. 전체 37/37 테스트 통과. 이 수정들은 로컬 서버(4321)에는 반영했지만 라즈베리파이 실기기는 별도 장치라 재배포 필요 | 2026-07-04 완료 |
| D30 | `paneo.photo` 전환 효과(fade/slide) 추가 | 사용자가 "전환 될때 페이드 인아웃처럼 천천히 전환되는 옵션"을 요청. 새 `config.transition` enum(`none`/`fade`/`slide`, 기본 `none`)을 추가하고, 기존 "매번 `el.innerHTML` 통째로 교체" 방식을 `.ms-stage`(포지션 컨테이너) 안에 `.ms-layer` 여러 개를 겹쳐 쌓는 방식으로 바꿈 — 새 레이어를 `opacity:0`(fade) 또는 `translateX(100%)`(slide) 상태로 추가하고 강제 리플로우 후 `.ms-active` 클래스를 붙여 CSS 트랜지션을 발동, 700ms 후 이전 레이어를 제거. Ken Burns 효과와 마찬가지로 `ctx.performanceProfile==='high'`일 때만 적용(저사양 Pi에서 레이어 합성 비용 절감) — 비디오 항목에도 동일한 레이어 메커니즘 적용 | 위젯 A를 렌더링하고 350ms 뒤에 동일 설정으로 위젯 B를 렌더링해 각각의 예약된 `setTimeout` 지연을 가로채 비교 → 두 위젯의 최종 전환 시각이 2ms 이내로 일치(D29의 절대 시각 동기화가 전환 효과 도입 후에도 깨지지 않음 확인). 실기기(에디터)에서 "전환 효과=fade" 설정 후 3초 간격 두 이미지로 전환 시점마다 `.ms-layer`가 일시적으로 2개→1개로 바뀌는 것(교차 페이드 진행 중 상태)을 폴링으로 확인, 스크린샷으로도 전환 후 다음 이미지가 정상 표시됨을 확인 | 2026-07-04 완료 |
| D31 | `paneo.photo` 실제 버그 — 동영상이 다음 항목으로 절대 넘어가지 않음(라즈베리파이 "동영상 재생 안 됨" 조사 중 발견) | 사용자가 "라즈베리파이 키오스크에서 동영상 재생이 안 되는 것 같다"고 보고. D30 작업 중 비디오 `error` 이벤트 핸들러를 새로 추가(코덱 실패 시 무한정 멈추는 것 방지)하고 실기기로 검증하다가, **더 근본적인 기존 버그**를 발견: `pendingNextIndex`(다음 전환 시 사용할 인덱스)가 오직 이미지 분기에서만 계산되고 있어서, 현재 항목이 동영상이면 그 값이 계산되지 않고 "이전에 이미지를 마지막으로 그렸을 때 남은 값"을 그대로 씀 — 순차 재생에서는 거의 항상 "동영상 자기 자신"을 가리키는 값이 남아있어, 동영상이 끝나거나(ended) 에러가 나도(error) `advance()`가 같은 동영상을 무한 반복 재생함(다음 항목으로 절대 안 넘어감). `pendingNextIndex = pickNextIndex()` 호출을 이미지 분기 밖으로 옮겨 매 `paint()`마다(동영상이든 이미지든) 항상 계산되도록 수정. 부가로 조사한 라즈베리파이 환경 요인: (a) Debian 계열 `chromium-browser` 패키지는 특허 문제로 H.264/AAC 코덱이 빠진 채 배포되는 경우가 많아 `.mp4` 자체가 아예 디코드되지 않을 수 있음 — `scripts/install-pi.sh`/`update-pi.sh`에 `chromium-codecs-ffmpeg-extra` 설치 시도(best-effort, 저장소에 없으면 조용히 건너뜀) 추가, 근본 대안으로 `.webm`(VP8/VP9, 특허 이슈 없음) 사용 권장. (b) 키오스크 실행 플래그에 autoplay 정책 관련 플래그가 전혀 없었음 — `--autoplay-policy=no-user-gesture-required` 추가(이미 `muted`라 대부분 불필요하지만 일부 빌드의 엣지케이스 방어) | `pendingNextIndex` 버그는 실제 존재하는 URL(`https://example.com/does-not-exist.mp4`, 실제로 404 확인)로 동영상 슬라이드를 구성해 재현: 수정 전에는 `video.dispatchEvent(new Event('error'))`를 직접 호출해도 위젯이 같은 동영상에 그대로 머물렀고(신규로 붙인 리스너로 이벤트 자체는 정상 발동함을 별도 확인), 수정 후에는 동일한 재현 스크립트로 에러 발생 즉시 다음 이미지로 정상 전환됨을 확인(위젯을 직접 `renderWidget()`으로 격리 렌더링해 검증). 코덱/autoplay 플래그 쪽은 실제 Pi 하드웨어에 접근할 수 없어 직접 재현은 못 했고, 업계에 잘 알려진 원인(Debian chromium의 특허 코덱 미포함)에 근거한 진단 — 사용자가 실제로 `.webm` 테스트나 코덱 패키지 설치로 확인 필요 | 2026-07-04 완료 |
| D32 | 컴패니언 에이전트 화면 전원 on/off 안 됨 + 편집기 전원 스케줄 UX 개선 | 사용자가 "화면 갱신·화면 확인은 되는데 화면 끄기·켜기는 안 됨"이라 보고, 예전에 쓰던 [eigger/magicmirror-setup의 Webhook 스크립트](https://github.com/eigger/magicmirror-setup/tree/master/Webhook/Scripts)를 참고자료로 제시(`wlr-randr --output HDMI-A-1 --off/--on`를 직접 호출하던 방식). **원인 분석**: `agent/agent.js`는 이미 vcgencmd→wlr-randr→xset 순으로 시도하지만 문제가 둘 있었음 — ①`vcgencmd` 바이너리는 최신 Raspberry Pi OS(Bookworm/full-KMS)에도 거의 항상 존재하지만 `vcgencmd display_power`는 레거시 펌웨어 경로라 실제 패널을 제어하지 못하는 조용한 no-op인 경우가 흔함(사용자가 예전에 wlr-randr로 직접 제어했던 것도 이 때문으로 추정) — 그런데도 감지 순서상 vcgencmd가 존재하기만 하면 무조건 먼저 선택됨. ②에이전트는 `scripts/install-pi.sh`가 만드는 systemd 서비스로 실행되는데, 이 서비스 정의에 `WAYLAND_DISPLAY`/`XDG_RUNTIME_DIR` 환경변수가 전혀 없어서, wlr-randr를 실행해도 컴포지터 소켓을 찾지 못해 실패했을 것. **수정**: 시작 시 한 번 캐시하던 감지 방식을 버리고, `setPower()` 호출마다 매번 다시 판단하도록 변경(에이전트가 데스크톱 세션보다 먼저 부팅되는 경우의 레이스 컨디션 방지) — `os.userInfo().uid`로 에이전트 자신이 실행 중인 OS 사용자의 `/run/user/<uid>`를 찾아 그 안의 `wayland-*` 소켓 유무로 "지금 실제로 wlr-randr를 쓸 수 있는지"를 판단(단순히 바이너리 존재 여부가 아니라 실제 라이브 세션 여부로 판단), 있으면 그 환경변수를 실어서 wlr-randr 실행, 없으면 xset(X11)→vcgencmd(레거시 폴백) 순으로 내려감. **부가로**: 편집기의 화면 전원 스케줄 UI 개선 — ①"설정이 된 건지 안 된 건지 확인이 안 됨" 문제는 상태 배지(`● 설정됨 — HH:MM 켜짐/HH:MM 꺼짐` 또는 `○ 설정 안 됨`)를 새로 추가해 저장/해제/기기 전환마다 갱신되도록 함. ②시작/종료 시각 입력을 오전오후가 나올 수 있는 `<input type=time>`(브라우저 로케일에 따라 렌더링 다름)에서 `paneo.timer`가 이미 쓰는 것과 같은 순수 텍스트 `HH:MM` 입력(`pattern`으로 24시간제만 허용)으로 교체해 로케일과 무관하게 항상 24시간제로 보이도록 통일, 저장 시 형식 검증 실패하면 안내 토스트 표시. `i18n.js`의 `t(key, arg)`가 인자 하나만 받던 것을 `t(key, ...args)`로 확장(상태 배지 문구가 켜는/끄는 시각 두 값을 받아야 해서) | 에이전트 쪽은 실제 라즈베리파이가 없어 로컬(macOS, vcgencmd/wlr-randr/xset 전부 없음)에서 시뮬레이터 모드로 전체 왕복(서버 `/command` API → 에이전트 웹소켓 → `setPower()`)이 정상 동작하는 것과, `resolveWaylandEnv()`의 소켓 탐지 로직을 가짜 `/run/user/<uid>/wayland-0` 디렉터리로 격리 검증. 실제 하드웨어 동작(wlr-randr가 진짜 화면을 껐다 켜는지)은 검증 못 함 — 라즈베리파이에서 `update-pi.sh` 재실행 후 실기기 확인 필요. 편집기 UI는 격리된 테스트 기기로 실기기 검증: 저장 전 "○ 설정 안 됨" 확인 → 07:30/23:00 저장 후 "● 설정됨 — 07:30 켜짐 / 23:00 꺼짐"으로 즉시 갱신되는 것을 스크린샷으로 확인, 서버 `powerSchedule` 값도 일치 확인 → 잘못된 값("25:99") 저장 시도 시 토스트로 거부되고 기존 저장값이 그대로 유지되는 것 확인 → "스케줄 해제" 클릭 시 "○ 설정 안 됨"으로 정상 복귀 확인. 전체 37/37 테스트 통과 | 2026-07-04 완료 |
| D33 | 설정 패널 버튼 정렬/높이 불일치 2건 수정 | 사용자가 "스케줄 해제 버튼이랑 저장 버튼 높이가 다름(스타일), 원격 제어 버튼들 정렬이 좀 안 맞음 버튼 크기도"라고 보고. 실측으로 원인 두 가지를 각각 찾음. **①저장(34px)/스케줄 해제(40px) 높이 차**: `#power-save-btn`이 `.settings-close`(width:100%, `margin-top:6px`, 원래 `#resolution-rotate`처럼 `.button-row` 밖에서 단독으로 쓰이는 버튼용 스타일) 클래스를 같이 쓰고 있었는데, `.button-row`(`display:flex`, 기본 `align-items:stretch`) 안에서 형제 버튼(`#power-clear-btn`, margin-top 없음)과 나란히 있다 보니, flex stretch가 두 버튼의 바깥쪽 아래 끝을 맞추려고 `margin-top:6px`이 있는 저장 버튼의 실제 박스 높이를 6px 줄여버림(34+6=40, 40+0=40으로 총 높이는 같지만 버튼 박스 자체 높이가 달라 보임) — `index.html`에서 `#power-save-btn`의 `settings-close` 클래스 제거(단독 사용 버튼인 `#resolution-rotate`/`#group-apply-btn`/`#ha-save-btn`/닫기 버튼은 그대로 둠, `.button-row` 안에 있는 건 이 버튼 하나뿐이었음). **②원격 제어 4버튼(새로고침·화면 확인·화면 켜기·화면 끄기) 정렬/크기 불일치**: 너비·위치는 원래도 정확히 일치했는데, 높이만 39px(새로고침·화면 확인, 이모지 🔄📍 포함)와 34px(화면 켜기·화면 끄기, 순수 텍스트)로 5px 차이 — 원인은 CSS가 아니라 브라우저 렌더링: `line-height:normal`(미지정 시 기본값)은 폰트 자체의 메트릭으로 계산되는데, 이모지 글리프는 폴백되는 이모지 폰트(예: Apple Color Emoji)의 메트릭이 일반 텍스트 폰트보다 커서 그 줄을 포함한 버튼 전체가 더 높게 계산됨 — `.button-row button`에 명시적 `line-height:1.2`를 지정해 이모지 유무와 무관하게 항상 같은 줄 높이로 고정(`.button-row`에도 `align-items:stretch` 명시로 의도 확정) | 두 원인 모두 `getComputedStyle()`/`getBoundingClientRect()`로 실측해서 확인 후 수정 — 수정 전 저장(34px)/스케줄 해제(40px), 새로고침·화면 확인(39px)/화면 켜기·화면 끄기(34px)였던 것이 수정 후 6개 버튼 전부 정확히 34×126px로 일치함을 재측정으로 확인, 스크린샷으로도 시각적 정렬 확인. 전체 37/37 테스트 통과 | 2026-07-04 완료 |
| D34 | 원격 제어 버튼 두 줄이 세로로 딱 붙어 보이던 것 수정 | 사용자가 "새로고침, 화면 켜기 세로 방향으로 버튼이 딱 붙어 있잖아"라고 지적. `index.html`에서 "새로고침/화면 확인" `.button-row`와 "화면 켜기/화면 끄기" `.button-row`가 같은 `.field` 안에 두 개의 별도 `<div class="button-row">`로 바로 이어 붙어 있었는데, `.button-row`엔 가로 버튼 사이 `gap:8px`만 있고 위아래(세로) 간격이 전혀 없어서 두 줄이 그대로 맞닿아 보였음 — `.button-row + .button-row { margin-top: 8px; }`(인접 형제 결합자)로 "`.button-row` 바로 뒤에 또 다른 `.button-row`가 올 때만" 세로 간격을 추가, 전원 스케줄의 저장/해제 같은 단독 `.button-row`(앞에 이미 다른 요소의 margin으로 간격이 있음)는 영향받지 않도록 함 | `getBoundingClientRect()`로 재측정: 수정 전 두 행이 인접(간격 0), 수정 후 8px 간격 확인. 스크린샷으로도 시각적으로 분리됨을 확인. 순수 CSS 정적 파일 변경이라 서버 재시작 불필요. 전체 37/37 테스트 통과 | 2026-07-04 완료 |
| D35 | `paneo.photo` 페이드 전환 시 간헐적 깜빡임 수정 | 사용자가 "페이드 옵션인데 뭔가 깜빡이는 느낌, 스무스하게 이미지가 변경됐으면"이라고 보고. 원인: 새 레이어를 `opacity:0`으로 DOM에 추가하고 곧바로 `.ms-active`를 붙여 CSS 트랜지션을 시작시켰는데, `background-image` 로딩은 비동기라 이미지가 아직 도착하기 전에 페이드가 시작되면 빈 레이어가 서서히 나타나다가 로딩 완료 시점에 이미지가 "툭" 튀어나오는 것처럼 보임(캐시가 없는 콜드 상태일수록 심함, 그래서 "간헐적") — Ken Burns는 이미 다음 이미지를 미리 프리로드하지만, 페이드/슬라이드 전환 자체는 그 프리로드와 무관하게 독립적으로 동작해서 보호받지 못했음. 이미지일 때는 `new Image()`로 미리 로드해 `onload`/`onerror` 이후에만 실제 레이어 삽입+페이드 시작(`commitPaint`)을 하도록 변경, 중간에 새로운 `paint()` 호출이 들어와도 오래된 프리로드 콜백이 뒤늦게 실행되며 잘못된 레이어를 추가하지 않도록 세대 번호(`paintGeneration`) 가드 추가 | 실제 `Image()` 로딩을 가로채는 모의(mock) 객체로 `onload`가 호출되기 전까지는 `.ms-layer` 개수가 늘지 않고(새 레이어가 DOM에 아예 안 들어감), `onload` 호출 즉시 레이어가 추가됨을 확인 — 즉 "빈 레이어가 나타났다가 이미지가 팝인"하는 경로 자체가 원천 차단됐음을 검증. 실제 네트워크 이미지로도 3번 연속 전환이 깨끗하게 동작함을 확인. 전체 37/37 테스트 통과 | 2026-07-04 완료 |
| D36 | 홈어시스턴트 위젯 콘텐츠 오버플로우 방지 + weather.* 전용 카드 | 사용자가 "홈어시스턴트... 내용이 위젯을 벗어나지 않았으면, 폰트 크기를 자동으로 줄여주고, 웨더 엔티티를 연동하면 날씨 관련 카드로 보였으면"이라고 요청. **①오버플로우 방지**: `.ha-title`은 이미 `text-overflow:ellipsis`가 있었지만 `.ha-state-val`(엔티티 상태값)은 아무 오버플로우 처리가 없어서 긴 문자열이 위젯 밖으로 그대로 삐져나갈 수 있었음 — HA 엔티티의 `friendly_name`/`state`는 길이를 예측할 수 없어(우리 내장 위젯 텍스트와 달리) CSS `clamp()`만으로는 컨테이너/뷰포트 크기에만 반응할 뿐 콘텐츠 길이엔 대응 못함. 재사용 가능한 `fitTextToBox(el, minRatio=0.4)` 헬퍼를 추가 — `clamp()`가 계산해준 폰트 크기에서 시작해 `scrollWidth/Height`가 `clientWidth/Height`를 넘지 않을 때까지 1px씩 줄이고(최소 시작 크기의 40%까지만, 그 밑으로는 가독성이 떨어지므로 CSS `ellipsis`가 최종 안전장치로 넘겨받음), `.ha-title`/`.ha-state-val`에 적용. **②weather.\* 전용 카드**: `entityId.startsWith('weather.')`일 때 기존 범용 상태 카드 대신 아이콘+온도+상태문구+습도/풍속으로 구성된 전용 카드 렌더링 — HA의 공식 `weather.*` state(condition) 값(`sunny`/`partlycloudy`/`rainy` 등)을 이모지+한/영 라벨로 매핑하는 테이블 추가 | 모의 `fetch` 응답으로 `weather.home`(partlycloudy, 23.4°C, 습도 55%, 풍속 12km/h) 엔티티를 렌더링해 카드 레이아웃·아이콘(⛅)·한국어 라벨("구름 조금") 정상 표시 확인. 매우 긴 문자열(30자 이상의 한글 문장)로 스트레스 테스트 — 폰트가 최소 크기까지 줄어든 뒤에도 여전히 넘치는 극단적 케이스에서 CSS ellipsis가 실제로 시각적 오버플로우를 막아주는 것까지 스크린샷으로 확인(빨간 테두리 박스 안에 완전히 담김) | 2026-07-04 완료 |
| D37 | 에디터에서 원격 업데이트 트리거 (전체/서버만) + 홈어시스턴트에서 화면 전원 제어 | 사용자가 "에디트 화면에서 업데이트 가능했으면... 설치 옵션에 따라 전체 업데이트 또는 서버 업데이트"와 "화면 제어를 홈어시스턴트에서 가능했으면"을 요청. 두 결정 사항을 먼저 확인: 업데이트는 **컴패니언 에이전트 경유**(편집기가 인증이 없는 상태이므로, 서버가 직접 자기 컨테이너를 재기동하며 호스트 docker.sock을 컨테이너에 마운트하는 것보다 안전), HA 화면 제어는 **기존 REST API를 HA에서 직접 호출**(코드 변경 최소, 이미 `/api/devices/:id/command`가 인증 없이 열려 있어 HA의 `rest_command`가 바로 호출 가능). **업데이트 기능**: `scripts/update-pi.sh`에 `MODE`(위치 인자 우선, 없으면 `PANEO_UPDATE_MODE` 환경변수, 기본 `all`) 추가 — `server` 모드는 코덱 설치/키오스크 런처 갱신/키오스크 재시작 3단계를 건너뛰고 서버+에이전트 업데이트만 수행. `scripts/install-pi.sh`의 `install_agent()`에 `install_update_trigger()` 추가 — 서버 자신의 `/update.sh` 경로에서 update-pi.sh를 내려받아 `/usr/local/bin/paneo-update-pi.sh`에 고정 설치하고, `$SERVICE_USER`가 **정확히 그 경로**만 `sudo`로 비밀번호 없이 실행하도록 `/etc/sudoers.d/paneo-agent-update`를 좁게 스코프해 생성(`visudo -cf`로 문법 검증). `update-pi.sh` 자신도 에이전트 갱신 단계에서 설치된 트리거 스크립트를 자체 갱신하되, 현재 실행 중인 스크립트 파일을 직접 덮어쓰면(그 자체가 `/usr/local/bin/paneo-update-pi.sh`로 실행 중일 때) 실행 중인 인터프리터가 읽는 파일이 중간에 잘려나가 손상될 위험이 있어 **임시 파일에 받은 뒤 `mv`(원자적 rename)** 하는 방식으로 안전하게 구현. `agent/agent.js`는 `action:'update'` 메시지를 받으면 `spawn('sudo', [scriptPath, mode], {detached:true, ...})`로 완전히 분리된 프로세스로 실행(업데이트 스크립트가 도중에 `systemctl restart paneo-agent`로 에이전트 자신을 재시작시키므로, 부모-자식 관계로 묶여 있으면 에이전트 재시작 시 진행 중이던 업데이트까지 같이 죽어버림). `src/server.js`의 `/api/devices/:id/command`가 `action:'update'`(+`mode`)를 받아 에이전트로 중계하도록 확장. 편집기 설정 패널에 "전체 업데이트"/"서버만 업데이트" 버튼 추가(에이전트 연결 시에만 활성화, 클릭 시 `confirm()` 확인 — 삭제 버튼과 동일한 안전장치). **HA 화면 제어**: 코드 변경 없이 `docs/install-device.md`/`.ko.md`에 §8.6 신설 — `/api/devices`로 device id 확인 후 HA `configuration.yaml`에 `rest_command`(`paneo_screen_on`/`paneo_screen_off`) 등록하는 방법을 예시와 함께 문서화, 편집기 자체가 의도적으로 인증 없음(§10)과 동일한 노출 주의 문구 포함 | 실제 웹소켓 에이전트를 macOS에서 연결해 전체 왕복 확인: 편집기에서 "서버만 업데이트" 클릭 → 서버가 에이전트로 중계 → 에이전트가 `update command: mode=server` 로그 출력 → `sudo /usr/local/bin/paneo-update-pi.sh server`를 분리 프로세스로 실행 시도(이 macOS 환경엔 sudoers 설정도 스크립트 설치도 없어 `sudo: a password is required`로 실패하는 것까지 확인 — 딱 OS 경계까지는 정확히 의도대로 동작, 그 안쪽(실제 Pi의 sudoers/재부팅 동작)은 실기기 검증 필요). 에디터 UI는 실기기로 버튼 활성화 상태·확인 다이얼로그·토스트 메시지("업데이트 명령 전송 — 완료까지 몇 분 걸릴 수 있습니다")까지 확인. `install-pi.sh`/`update-pi.sh` 둘 다 `bash -n` 문법 검증 통과. 전체 37/37 테스트 통과. 실제 라즈베리파이 검증(sudoers 권한, 스크립트 자체 갱신의 안전성, 실제 재시작 흐름)은 못 함 | 2026-07-04 완료 |
| D38 | 업데이트 가능 여부 확인 + 캘린더/HA 날씨 위젯 크기 적응형 뷰 | 사용자가 "월간 달력을 캘린더로 수정하고 위젯 크기에 따라서 일간/주간(1주일)/주간(전주·이번주·다음주)/월간으로 수정 가능? 홈어시스턴트 날씨 위젯도 위젯 크기에 따라서 현재날씨/주간날씨 등등으로 가능? 업데이트 할 때 최신버전인지 확인 가능?"이라고 요청 — 3가지 기능. **①업데이트 가능 여부 확인**: 편집기가 "전체/서버 업데이트" 버튼만 있고 애초에 새 버전이 있는지는 몰랐음 — `src/version.js`에 `compareVersions(a,b)`(순수 숫자 x.y.z 비교)와 `checkForUpdate()`(GitHub Releases API `/repos/eigger/paneo/releases/latest` 조회, 1시간 모듈 레벨 캐시) 추가, `src/server.js`에 `GET /api/update-check` 라우트로 노출 — 브라우저가 GitHub API를 직접 호출하지 않고 서버가 중계·캐싱하는 이유는 (a) "서버가 서드파티 데이터를 가져와 캐싱한다"는 기존 아키텍처 패턴 유지, (b) 편집기 탭·기기 여러 개가 캐시 하나를 공유해 GitHub 비인증 60회/시간 제한을 피하기 위함. 편집기에 업데이트 버튼 위 "🆕 업데이트 가능 — vX.Y.Z" 상태 줄 추가. **②캘린더 위젯 크기 적응형 뷰**: 기존 `paneo.calendar.month`(내부 `pluginId`는 저장된 레이아웃 호환을 위해 유지, `label`만 "캘린더"/"Calendar"로 변경, `version` 2.0.0, `minSize`를 `{w:5,h:4}`→`{w:2,h:2}`로 완화)를 전면 재작성 — 위젯 자신의 렌더링 박스 크기를 `ResizeObserver`로 관찰해(수동 설정 토글 없이) `pickView(width,height)`가 4가지 뷰 중 하나를 자동 선택: 일간(가장 작을 때, 그날 일정을 아젠다 리스트로) → 주간 1주(`CAL_MIN_WEEK_WIDTH=260px` 이상, 이번 주만) → 3주(전주+이번주+다음주, `CAL_MIN_3WEEK_HEIGHT=220px` 이상) → 월간(`CAL_MIN_MONTH_HEIGHT=380px` 이상, 기존 달력 그리드). `buildWeekRows(date, weeksBefore, weeksAfter)` 헬퍼로 주 단위 뷰들을 통일 생성, 기존 월간 전용이었던 렌더 함수를 `renderGridView(view, now, cells, eventsByDate)`로 일반화(주간/3주 뷰에서는 `dimOtherMonth=false`라 다른 달 날짜를 흐리게 처리하지 않음). CSS는 `.widget-content`에 이미 있던 `container-type:size`를 활용해 `vw`/`vh` 대신 `cqh`(컨테이너 쿼리 높이) 단위로 전환 — 이 위젯만 유독 4가지 뷰에 걸쳐 박스 크기가 극단적으로 달라지기 때문(다른 위젯들은 인스턴스별 크기 편차가 크지 않아 `vw`/`vh`로 충분). **③HA 날씨 위젯 크기 적응형 예보**: `weather.*` 카드(D36)에 동일한 `ResizeObserver` 패턴 적용 — 위젯 높이가 `HA_WEATHER_FORECAST_MIN_HEIGHT=200px` 이상이면 현재 날씨 카드 아래에 최대 5일 예보 행 추가. 예보 데이터는 HA 버전에 따라 API가 달라 최선형(best-effort)으로 구현: 구버전 HA는 `weather.*` state의 `attributes.forecast`에 직접 들어있고, 2023.9+ HA는 `weather.get_forecasts` 서비스를 `return_response` 컨벤션(`POST .../services/weather/get_forecasts?return_response`)으로 호출해야 함 — `src/server.js`의 `/api/proxy/ha/services/:domain/:service` 프록시가 쿼리 파라미터를 그대로 전달하도록 확장해 이 컨벤션을 지원. 예보 fetch는 위젯 인스턴스당 최대 1회만(메모이즈된 프라미스) 수행 — 예보는 상태 폴링(30초)만큼 자주 안 바뀌므로 매 틱 재요청은 HA 서버에 불필요한 부하. 구버전 HA·네트워크 오류·예상 밖 응답 형태 등 모든 실패 모드는 조용히 예보 없는 기존 카드로 폴백. 두 기능 모두 `ResizeObserver` 콜백이 `pollJson`이 반환한 `el._cleanup`을 덮어쓰지 않도록 `pollCleanup = el._cleanup; el._cleanup = () => { pollCleanup?.(); ro.disconnect(); }`로 합성하는 패턴을 재사용 | 업데이트 확인: 유닛 테스트(`compareVersions` 비교, 모의 `fetch`로 `checkForUpdate` 반환값 검증) + 실제 편집기 로드해 "🆕 업데이트 가능 — v0.0.6" 정상 표시 확인. 캘린더: 실제 편집기 페이지에 테스트용 분리 DOM 엘리먼트(`flexShrink:0`로 페이지의 flex 레이아웃에 의한 크기 왜곡 방지)를 만들어 4가지 픽셀 크기 임계값 각각에서 일간/주간/3주간/월간 뷰가 올바른 헤더·행 개수로 렌더링됨을 확인. HA 날씨: 모의 `fetch`(state + `get_forecasts`)로 150px(예보 없음)→260px(예보 2일치, 한글 요일·아이콘·최고/최저온도 정상 표시)로 리사이즈 시 재조회 없이 실시간 전환 확인, `display.css`/`editor.css` 양쪽에 `.ha-weather-forecast`/`.ha-fc-day` 등 CSS 추가 후 실제 페이지 새로고침해 `getComputedStyle`로 `display:flex` 적용까지 확인. 전체 39/39 테스트 통과. 작업 내내 실제 "거실" 기기 화면은 별도 분리된 DOM에서만 테스트해 레이아웃이 전혀 바뀌지 않았음을 스크린샷으로 재확인. HA 예보 기능은 실제 HA 서버 없이는 두 API 버전 분기 모두를 실기기 검증하지 못함 | 2026-07-04 완료 |
| D39 | 나머지 데이터 위젯(날씨/대기질/RSS/일정 목록)도 크기 적응형으로 확장 | 사용자가 "다른 위젯도 크기에 따라서 형태를 조절이 필요한게 있으면 검토해줘"라고 요청. 서브에이전트로 전체 16개 내장 위젯을 조사해 크기 적응형이 의미 있는 4개(paneo.weather, paneo.airquality, paneo.rss, paneo.calendar)와 그렇지 않은 나머지(clock/date/text — 고정 단일 값이라 폰트 크기 외엔 확장할 구조 데이터 없음; timer/worldclock/dday — 이미 리스트 구조라 크기는 행 개수만 좌우; todo — 인터랙티브라 모드 추가 시 복잡도만 증가; exchangerate/qrcode/photo/iframe — 정보 밀도가 아니라 단일 값/미디어 크기·맞춤의 문제; HA 비-날씨 엔티티 — 이미 `fitTextToBox`로 처리됨)를 구분. 4개 모두 D36/D38에서 이미 검증된 동일 패턴(위젯 자신의 `ResizeObserver` + 높이 임계값으로 콘텐츠 모드 전환, `pollJson`의 `el._cleanup`을 감싸는 `pollCleanup?.(); ro.disconnect();` 합성)으로 구현. **①`paneo.weather`**(v1.1.0): `src/dataproxy.js`의 `fetchWeather()`에 `daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto` 추가(`timezone=auto` 없이는 daily 값이 UTC 날짜 경계로 나뉘어 위치의 실제 하루와 어긋남) — 200px 이상일 때 최대 5일 예보 스트립 추가, WMO 날씨 코드→이모지 매핑(`WEATHER_CODE_ICON`, HA 카드가 쓰는 condition-문자열 기반 매핑과는 별개 테이블) 신설. **②`paneo.airquality`**(v1.1.0): `fetchAirQuality()`에 `carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone` 추가(이 네 항목은 PM10/PM2.5와 달리 한국형 등급 기준이 없어 등급 배지 없이 원시값+단위만 표시) — 기존 PM10/PM2.5 2행은 크기 무관 항상 표시, 220px 이상일 때만 CO/NO2/O3/SO2 4행 추가. **③`paneo.rss`**(v1.1.0): 이미 받아오고 있었지만 안 쓰던 `isoDate`를 200px 이상일 때 각 항목 제목 아래에 표시(항목 개수 자체는 원래도 서버가 최대 15개를 반환하고 CSS `overflow:hidden`이 좁은 박스에서 자동으로 잘라 보여주므로 별도 캡 로직 불필요). **④`paneo.calendar`**(일정 목록 — `calendar.month`과는 별개 위젯, v1.1.0): 220px 이상일 때 각 이벤트에 시각(`cal-time`) 추가 표시 + 소스별 색상이 하나라도 지정돼 있으면 색상-출처 범례(`cal-legend`, URL의 hostname을 라벨로 사용) 하단에 추가 — 이를 위해 기존 `<ul class="w-calendar">` 단독 구조를 `<div class="w-cal-list">` 래퍼(flex column) + 내부 `<ul>`(flex:1) + 범례로 재구성, `.w-calendar`는 `.w-rss`와 베이스 스타일(list-style/padding/font-size)을 공유하므로 `.w-cal-list .w-calendar`로 패딩만 더 높은 특이도로 오버라이드해 RSS 쪽 스타일에는 영향 없게 처리 | 4가지 위젯 모두 편집기 페이지에 분리된 테스트용 DOM(`flexShrink:0`)을 만들어 모의 `fetch`로 150px(축약 모드)→260px(확장 모드) 리사이즈 시 실시간 전환 확인: 날씨는 예보 스트립 3일치(토/일/월, 아이콘·최고/최저온도) 정상 렌더링, 대기질은 CO/NO2/O3/SO2 4행이 등급 없이 원시값으로 추가됨, RSS는 각 항목에 한국어 로케일 날짜("7월 4일 오전 10:00")가 추가됨, 일정 목록은 시각("오후 02:00")과 2개 소스의 색상 범례(호스트명 "example.com")가 정상 표시됨. `display.css`/`editor.css` 양쪽에 새 클래스 존재 여부를 실제 페이지에서 fetch로 재확인. 전체 39/39 테스트 통과. "거실" 기기는 이번에도 분리된 DOM에서만 테스트해 스크린샷으로 레이아웃 불변 재확인 | 2026-07-04 완료 |
| D40 | 에디터/디스플레이 비주얼 절제된 고급화 | 사용자가 "디자인적으로 최선인지, 좀 더 세련되게 개선 가능?"이라고 질의 — 현재 디자인을 평가한 뒤(시스템 폰트, flat 단색 액센트, 선택 위젯 딱딱한 아웃라인 등 "기능적이지만 평범한 사내 도구" 느낌으로 진단) AskUserQuestion으로 범위(편집기만 vs 편집기+디스플레이 동시)와 과감도(절제된 고급화 vs 과감한 리브랜딩)를 확인 — "지금보다 괜찮으면 둘 다 적용, 너저분하면 적용하지 말 것" + "절제된 고급화" 선택받음. `display.css`는 실제 "거실" Pi가 그대로 렌더링하는 파일이라 다음 새로고침 때 실제 화면 모양이 바뀐다는 점(데이터 변경 아님, 순수 비주얼)을 미리 안내. **적용 내용** (기존 색상/레이아웃/기능 로직은 그대로 두고, 표면 마감만 교체): ① 폰트 — jsdelivr CDN의 Pretendard Variable(한/영 겸용 무료 가변 폰트, dynamic-subset)을 `@import`로 두 CSS 모두에 추가, 기존 `'Segoe UI', system-ui` 스택을 폴백으로 유지(CDN 접근 불가 시 조용히 폴백 — 오프라인 회복력 원칙과 상충하지 않음, 코어 레이아웃/데이터는 폰트 없이도 정상 동작). ② 위젯 카드 — 두 파일의 `.widget-content`(display) / `.ed-widget .widget-content`(editor)를 flat `rgba` 배경에서 은은한 2-스톱 그라디언트 + 소프트 그림자로 교체해 "떠 있는 카드" 느낌 부여, `.transparent-bg` 오버라이드에 `box-shadow:none!important` 추가해 배경 투명 위젯(전체화면 사진 등)엔 영향 없음. ③ 선택 위젯 표시 — 딱딱한 `outline:2px solid`를 부드러운 2단 글로우(`box-shadow: 0 0 0 2px accent, 0 0 22px accent/35%`)로 교체 + 트랜지션. ④ 에디터 크롬 — 헤더에 미세한 세로 그라디언트, 팔레트 드롭다운/설정 패널/토스트에 glassmorphism(반투명 배경 + `backdrop-filter: blur`) + 2단 그림자 + 인셋 하이라이트, 커스텀 스크롤바(`::-webkit-scrollbar`) 추가. ⑤ 버튼 — `.apply`/`.ha-toggle-btn`을 flat 블루에서 블루→인디고 그라디언트로, 대부분의 버튼에 `transition` + hover 시 1px lift + active 시 눌림(scale 0.97~0.98) 마이크로 인터랙션 추가. 캔버스 배경 vignette 등 리스크 대비 효과가 작은 항목은 절제 원칙에 따라 보류 | 실제 편집기 페이지(거실 기기가 열려 있는 상태)에서 리로드 후 폰트 로드 확인(`document.fonts` — Pretendard Variable 92개 서브셋 `loaded` 상태 확인), 팔레트/설정 패널 glassmorphism 스크린샷 확인, 위젯 선택 시 글로우 렌더링 확인, `/d/187170ff`(거실 디스플레이)로 이동해 위젯 카드의 새 깊이감 스크린샷 확인 후 편집기로 복귀 — 두 확인 과정 모두 "거실" 저장된 레이아웃·"저장됨" 상태가 그대로임을 재확인(순수 CSS라 데이터 변경 없음). 전체 39/39 테스트 통과 | 2026-07-04 완료 |
| D41 | editor.css 중복 CSS 정리 + README 전면 개편(다이나믹 위젯 강조, 스크린샷 갱신) + v0.0.7 | 사용자가 "정리해주고 리드미 갱신해줘 다이나믹 위젯 방식을 강조 및 스크린샷 캡춰해서(영어) 업데이트, 가장 최적의 디자인을 메인 리드미에 구성, 설치는 올인원 강조·나머지는 디테일로·심플하게, 업데이트 방법도 추가, 버전 변경해서 PR"을 요청. **①정리**: 이전에 발견해둔 `editor.css`의 `#page-selector`/`.page-dots`/`.page-dot` 중복 정의(구버전 블록이 파일 앞쪽에 남아있고, 완성도 높은 신버전이 뒤쪽에서 이겨서 실제로는 문제 없었지만 죽은 코드) 제거 — 구버전에만 있던 `.page-dot .page-del`은 `editor.js`에서 전혀 참조하지 않는 완전한 고아 CSS였음을 확인 후 함께 삭제, "왜 여기 정적으로 있어야 하는지"의 설명 코멘트는 신버전 블록으로 이전. **②원격 checkout 동기화**: 로컬 `master`가 origin보다 1커밋 뒤처져 있었음(이미 머지된 PR #5, PHOTOS_DIR 데이터 손실 수정이 로컬 워킹 트리엔 반영 안 된 상태로 이번 세션 작업이 그 위에 쌓이고 있었음) — `git stash` → `git merge --ff-only origin/master` → `git stash pop`으로 충돌 없이 병합, `package.json` 버전도 이미 태깅된 0.0.6으로 자동 정렬됨. **③스크린샷**: `playwright`+Chromium 설치 후 기존 `scripts/capture-screenshots.mjs`를 확장 — 이 샌드박스의 죽은 IPv6 경로 때문에 Node `fetch`가 open-meteo 등 일부 호스트에서 멈추는 문제를 `--no-network-family-autoselection --dns-result-order=ipv4first` 플래그로 해결, `boxW`/`boxH`(정확한 CSS px 목표 박스, 1×1 그리드로 렌더링) 필드를 추가해 캘린더의 일간/주간/3주간/월간 4가지 뷰와 날씨의 축약/예보 2가지 상태를 임계값(`CAL_MIN_WEEK_WIDTH` 등, `widgets.js`와 동일 상수)에 정확히 걸치는 픽셀 크기로 캡처 — 처음엔 스크립트가 가정한 캔버스 외곽 여백(24px)이 실제 `applyGridContainer`의 여백(=grid `gap`, 8px)과 달라 임계값을 살짝 벗어나는 버그 발생(원인 파악 후 boxW/boxH 전용 계산식만 분리 수정), 호스트 시스템 로컬 시각 기준으로 "오늘" 일정이 있는 로컬 생성 데모 ICS(`buildDemoIcs`, 서버 자신의 정적 파일 서빙 경로로 노출)를 추가해 캘린더 일간 뷰가 항상 최소 하나 이상의 일정을 보여주도록 함(공개 공휴일 피드는 캡처 당일에 일정이 없을 수 있어 불안정) — 이 과정에서 날짜 버킷팅이 스크립트 실행 호스트의 로컬 시간이 아니라 **기기에 설정된 타임존**(`ctx.timezone`) 기준이라는 걸 재확인(`widgets.js`의 `paintAndFetch`), 데모 기기의 타임존을 하드코딩된 `America/New_York` 대신 스크립트를 실제로 실행하는 호스트의 타임존(`Intl.DateTimeFormat().resolvedOptions().timeZone`)에 맞춰 둘을 일치시켜 해결. 연결 상태 표시 pill(D-이전 세션에서 병기 표시로 바꾼 것)이 fade-out(2초) 전에 스크린샷 타이밍과 겹쳐 작은 위젯 크롭에 새어 들어오는 것도 발견 — 타이밍에 의존하는 대신 `page.addInitScript`로 `#status`에 `display:none`을 주입해 결정적으로 제거. **④README**: "다이나믹 위젯"을 헤드라인으로 올려 캘린더 4-뷰 스트립과 날씨 축약/예보 쌍을 갤러리 상단에 배치, 위젯 목록을 실제 레지스트리 기준 17종으로 갱신(이전 문서는 11종만 나열해 세계시계/D-Day/할일/환율/QR/대기질이 누락돼 있었음), 설치 섹션은 올인원 원클릭 명령을 최상단에 노출하고 서버 전용/디스플레이 전용/수동 설치는 `<details>` 접이식으로 이동, "업데이트" 섹션 신설(README에 전혀 없던 내용) — `scripts/update-pi.sh`와 편집기 내 원격 업데이트 버튼을 모두 안내. `docs/install-device.md`/`.ko.md`의 §12도 같은 내용(§12.1 원클릭/§12.2 편집기/§12.3 수동)으로 갱신 — 실제로 `update-pi.sh`가 존재하는데도 그동안 이 문서엔 전혀 언급이 없던 문서 공백이었음. `README.ko.md`도 함께 갱신(영문판만 요청받았지만, 이번에 삭제한 `widgets/weather.png`를 참조하고 있어 방치하면 깨진 이미지가 되므로 구조·스크린샷을 영문판과 동일하게 맞춤). **⑤버전**: `package.json` 0.0.6 → 0.0.7(`npm install --package-lock-only`로 lockfile 동기화) | 전체 39/39 테스트 통과. `node scripts/capture-screenshots.mjs` 실행 결과 16장 스크린샷 전부 육안 확인(캘린더 4뷰가 정확히 다른 뷰로 렌더링됨, 날씨 축약/예보 정상 전환, 대기질 확장 행 표시, RSS 날짜 표시, 일정 목록 시각+범례 표시, 상태 pill 새어 들어옴 없음). README 이미지 경로 16개 전부 파일 존재 확인. `git merge --ff-only` 후에도 세션 내내 수정해온 모든 파일(위젯/CSS/문서)이 손실 없이 유지됨을 `git status`로 확인 | 2026-07-05 완료(브랜치 `release/v0.0.7` 푸시, PR 링크 안내)
| D42 | 시계 위젯 초 표시 옵션 + 렌더링 버그 3종 수정, 스크린샷 재캡처 | 사용자가 D41에서 생성한 스크린샷을 보고 "시계 위젯에 초 표시 옵션 추가, 초가 너무 혼자 작음(크기·위치 조정), 데이트/타이머 캡처 폰트가 작음, 디스플레이/에디터 캡처에서 시간이 위젯을 넘어감 — 개선해서 다시 캡처"를 요청, 실제로 세 가지 진짜 버그를 발견: **①`.clock-sec` 6px 버그**: `.clock-sec`이 `.clock-hm`의 flex **형제**였는데 `font-size:0.36em`은 형제가 아니라 **자신의 부모**(`.w-clock`, 명시적 font-size 없어 기본 16px)를 기준으로 계산돼 0.36×16≈6px로 렌더링 — 시계 크기와 무관하게 항상 거의 안 보이는 크기였음. `.clock-sec`을 `.clock-hm`의 **자식**으로 중첩시켜 `em`이 시계 자신의 폰트 크기를 기준으로 계산되게 고치고(`0.5em`로 상향), `Intl.formatToParts`를 시(hour)/분(minute)/초(second)를 한 포매터로 합쳐 파싱한 뒤 초 앞의 콜론까지 포함해 "12:58" + 작은 ":33" + " AM"처럼 분과 오전/오후 표시 **사이**에 자연스럽게 끼워 넣도록 재작성(기존엔 "12:3945"처럼 분과 초 사이에 콜론도 없이 그냥 붙어 있었음) — 표시 위치도 그냥 텍스트 흐름 안에 놓이므로 별도 정렬 없이 베이스라인에 자연스럽게 붙음. **②초 표시 옵션 신설**: `showSeconds` 체크박스 config 추가(`default:true`로 기존 항상-표시 동작과 하위호환 유지). **③시계 위젯 크기 초과 버그**: `hour12`+초 표시 조합처럼 콘텐츠 길이가 설정에 따라 달라지는데 `.clock-hm`의 `clamp(cqmin 기반)`은 그걸 모르고 항상 같은 최대 크기를 주다 보니 좁은 박스에서 줄바꿈되며 카드 밖으로 넘침 — `ResizeObserver` + 기존 `fitTextToBox` 헬퍼로 렌더 후(그리고 리사이즈 시) 실제로 박스에 맞는지 측정해 필요하면 축소하도록 수정. 이 과정에서 두 번째 버그 발견: 시계는 매초 `update()`가 `innerHTML`을 통째로 새로 그리는데, `fit()`을 최초 1회만 호출해서 **매 tick마다 이전 틱에서 축소해둔 인라인 font-size가 새 DOM 노드로 교체되며 사라짐** — 실제 스크린샷(스크립트가 waitMs만큼 대기하는 동안 setInterval이 최소 1번 이상 발동)에서 시계가 잘려 보인 직접적 원인이었음. `fit()`을 `update()` 끝에서도 호출하도록 수정(내용 길이는 tick마다 안 바뀌므로 매번 다시 맞추는 비용은 무시 가능). **④데이트/타이머 캡처 폰트 작음은 위젯 버그가 아니라 스크린샷 스크립트의 문제로 판명**: 이 두 위젯은 `vw` 단위(실제 키오스크 화면 전체 폭 기준, 컨테이너 쿼리 아님)로 폰트 크기를 정하는데, 개별 위젯 캡처가 "위젯 하나만 있는 그리드 = 뷰포트 전체"로 뷰포트를 아주 작게 잡다 보니 `vw` 계산값이 항상 `clamp()`의 최솟값(바닥)에 맞아 실제 12분할 대시보드에 놓였을 때보다 훨씬 작아 보였음 — 위젯 CSS는 그대로 두고 스크린샷 스크립트만 수정: `boxW`/`boxH` 없는(=cq 단위가 아니라 vw/vh 단위를 쓰는) 위젯은 메인 대시보드와 동일한 12×9 그리드·1280×720 고정 뷰포트(`REFERENCE_VIEWPORT`) 안에 자기 크기만큼만 배치해 실제 화면 비율을 재현하고, 크롭은 여전히 위젯 하나만 담음(크기 정확도가 필요한 `boxW`/`boxH` 기반 위젯은 기존 1×1 그리드 방식 그대로 유지) | 클록: 실제 위젯 렌더러로 `hour12`×`showSeconds` 조합 3가지, 여러 박스 크기에서 `.clock-sec` 폰트 크기(6px→41px 등 정상 범위), `scrollWidth<=clientWidth`(줄바꿈/넘침 없음) 확인, 2.3초 대기(다중 tick 경과)해도 축소된 크기가 유지되는지 확인. 스크린샷 재생성 후 clock/date/timer/editor.png/display.png 육안 재확인 — 시계가 "01:10:02 AM" 한 줄로 박스 안에 온전히 들어옴, 데이트("July 5, 2026"/"Sunday")·타이머("Lunch"/"-10:49:58") 폰트가 대시보드 비율에 맞게 커짐. 전체 39/39 테스트 통과. 아직 별도 버전은 안 올리고(같은 `release/v0.0.7` 브랜치에 추가 커밋) 이전 커밋과 함께 동일 PR로 나갈 예정 | 2026-07-05 완료
| D43 | v0.0.7 병합 후 실사용 중 발견된 버그: 캘린더 위젯 클릭(선택)하면 월간→주간(더 작은 뷰)으로 바뀌고 선택 테두리도 풀림 | 사용자가 v0.0.7을 병합·배포한 뒤 "캘린더 에디트 화면 클릭하면 월간 달력인데 다시 주간 달력으로 바뀜, 그러면서 클릭(테두리)가 풀림"이라고 실사용 버그 리포트. 원인 추적: `paneo.calendar.month`는 D38에서 추가한 "ResizeObserver 첫 콜백(다음 프레임)을 기다리면 매 렌더마다 한 프레임 동안 잘못된 뷰가 깜빡이므로" 최초 페인트만 `el.getBoundingClientRect()`로 **동기 측정** — 그런데 `public/editor/editor.js`의 캔버스 전체 `render()` 함수가 위젯 DOM(`node`/`content`)을 **`canvas`에 append하기 전에** `renderWidget()`(=위젯의 `render()`)을 호출하고 있었음(`content` 생성 → `renderWidget(content,...)` 호출 → 그다음에야 `canvas.appendChild(node)`) — 즉 캘린더가 자기 크기를 재는 시점에 아직 문서(document)에 붙어있지 않은 **분리된(detached) 노드**였고, `getBoundingClientRect()`는 분리된 노드에 대해 `{width:0, height:0}`을 반환하므로 `pickView(0,0)`이 항상 가장 작은 뷰(폭<260 조건에 걸려 일간/주간)를 선택했음. 이 버그 자체는 이전부터 존재했지만 그동안 드러나지 않은 이유: `render()`는 최초 페이지 로드시 한 번만 호출되고, 그 뒤로는 위젯을 드래그로 옮기거나 리사이즈할 때만 호출되는 줄 알았으나, 실제로는 `attachDrag()`의 `pointerup` 핸들러가 **실제로 드래그(마우스 이동)가 있었는지와 무관하게 무조건** `render()`를 호출하고 있어서(`pointermove`가 한 번도 안 온, 즉 그냥 클릭만 한 경우에도) **위젯을 클릭(선택)만 해도 캔버스 전체가 통째로 다시 그려지며** 모든 위젯의 DOM이 새로 생성되고, 그 순간 캘린더가 다시 분리 상태에서 측정당해 작은 뷰로 떨어짐 — 디스플레이(`public/display/display.js`)는 애초에 `node.appendChild(content)` → `stage.appendChild(node)` → `renderWidget(...)` 순서로 이미 올바르게 붙인 뒷renderWidget을 부르고 있어서 이 버그가 없었고, 오직 에디터에만 있던 순서 버그. "선택 테두리가 풀리는" 것도 별도 버그가 아니라 같은 원인의 부수효과: `render()`가 DOM을 통째로 새로 만들 때 `node.className`에 `selectedId`를 반영해 새로 만들긴 하지만(정상 동작), 위젯이 갑자기 작아지며 눈에 띄게 다시 그려지는 것을 사용자가 "테두리가 풀렸다"고 인지한 것. **수정**: `editor.js`의 `render()` 루프에서 `canvas.appendChild(node)`를 `renderWidget()` 호출 **이전**으로 이동(순서만 변경, 로직 변화 없음) — `public/display/display.js`가 이미 쓰고 있던 순서와 동일하게 맞춤. 다른 크기 적응형 위젯(weather/airquality/rss/calendar 목록/HA weather)은 전부 `pollJson`의 비동기 콜백 안에서 크기를 측정해 이 문제가 없음을 코드 검토로 확인(캘린더만 유일하게 렌더 함수 본문에서 동기적으로 측정) | 격리된 DOM(분리 vs 부착)으로 동일 위젯을 두 조건에서 직접 렌더링 비교: 분리 상태 렌더 → `.w-cal-day`(일간 뷰, 빈 상태) 렌더링 확인(버그 재현), 부착 후 렌더 → `.cal-m-grid` 35칸(월간 뷰) 정상 렌더링 확인(수정 확인). 실제 회귀 시나리오 재현을 위해 임시 테스트 기기(`__test_calendar_click_bug__`, 거실과 별개)를 API로 생성해 6×5 캘린더 위젯을 배치, 에디터에서 위젯을 여러 번 선택/해제 반복 클릭해도 뷰가 안 바뀌고 선택 테두리도 정상 유지됨을 스크린샷으로 확인 — 이후 테스트 기기는 API로 삭제해 "거실" 실기기 데이터에는 전혀 손대지 않음. 전체 39/39 테스트 통과 | 2026-07-05 진행중(커밋/PR 대기)

---

## 1. 목표 (Goals)

1. **비개발자도** 웹 편집기에서 드래그&드롭으로 대시보드를 구성.
2. 편집은 자유롭게 하다가 **"적용(Publish)"을 누르면 디스플레이에 반영** — 실시간 스트리밍이 아니라 초안/발행 모델(§6).
3. 라즈베리 파이는 **키오스크 브라우저로 URL 하나만** 띄우면 끝 (별도 앱 설치 최소화).
4. **여러 기기**를 등록하고, 방/그룹별로 서로 다른 레이아웃 송출.
5. 위젯은 **플러그인 규격**으로 추가 — 코어 수정 없이 새 위젯 등록.
6. **성능 프로파일(고성능/저성능)을 기기별로 선택** — 하드웨어에 맞게 런타임·위젯이 자동 degrade (§4.3).
7. 네트워크가 끊겨도 **마지막 화면은 계속 표시** (오프라인 내성).

## 2. 비목표 (Non-Goals) — 초기 범위 제외

- 범용 BI/분석 대시보드(Grafana 대체) 아님. 상시표시(ambient display)에 집중.
- 터치 인터랙션·앱 스토어 결제 등 복잡한 상호작용 화면 아님.
- 초기엔 멀티테넌트 SaaS 아님. 자체 호스팅(단일 조직/가정) 기준.

## 3. 사용자 & 시나리오

| 역할 | 하는 일 |
|---|---|
| **편집자(Editor)** | 웹 편집기로 레이아웃 구성, 기기에 배정, 실시간 미리보기 |
| **디스플레이(Display)** | Pi 키오스크. 배정된 레이아웃을 받아 렌더링만 함 |
| **플러그인 개발자** | 위젯 매니페스트 + 렌더 코드 작성해 위젯 추가 |

대표 시나리오: 편집자가 노트북에서 "거실 화면"에 날씨·캘린더·가족 사진 위젯을 배치 → 거실 Pi 화면이 **즉시** 바뀐다.

## 4. 아키텍처

```
┌──────────────────┐   WebSocket   ┌──────────────────────┐
│  웹 편집기         │◀── 양방향 ──▶│  서버 (허브)           │
│  react-grid-layout│               │  - 레이아웃/기기 저장    │
│  위젯 팔레트        │               │  - 위젯 데이터 프록시    │
└──────────────────┘               │  - WS 브로드캐스트 허브  │
                                    └──────────┬───────────┘
                                               │ WebSocket (레이아웃/데이터 push)
                                     ┌─────────┴─────────┐
                              ┌──────▼─────┐      ┌──────▼─────┐
                              │ 거실 Pi     │      │ 주방 Pi     │
                              │ (Chromium  │      │ (Chromium  │
                              │  --kiosk)  │      │  --kiosk)  │
                              └────────────┘      └────────────┘
```

### 4.1 컴포넌트

**A. 서버 (허브)** — 시스템의 중심.
- 레이아웃/기기/위젯 설정을 저장 (SQLite).
- **위젯 데이터 프록시**: 날씨·캘린더 등 외부 API를 서버가 대신 호출 → API 키를 디스플레이에 노출 안 함, CORS 회피, 캐싱·레이트리밋 통합.
- **WS 허브**: 편집기 변경을 해당 기기로 브로드캐스트, 데이터 갱신을 push.
- 단일 프로세스/단일 컨테이너로 배포 (Pi에서도, 별도 서버에서도 동일 코드 — §8).

**B. 웹 편집기** — React SPA.
- 그리드 드래그&드롭(`react-grid-layout`), 위젯 팔레트, 위젯별 설정 폼(플러그인 스키마 기반 자동 생성).
- 편집 대상 기기를 선택하면 그 기기 화면을 **실시간 미러링**하며 편집.

**C. 디스플레이 클라이언트** — 서버가 서빙하는 **웹 페이지**.
- Pi에서 `chromium-browser --kiosk http://<서버>/d/<기기토큰>`.
- WS 연결 → **"적용" 발행 시** 새 레이아웃 수신, 위젯 데이터는 주기적으로 갱신.
- 마지막 상태를 localStorage/IndexedDB 캐시 → 오프라인 시 유지.
- 기기 **성능 프로파일**에 따라 런타임 동작이 달라짐 (§4.3).

**D. (선택) 컴패니언 에이전트** — Pi의 systemd 서비스(경량 데몬).
- 브라우저 페이지만으로는 **불가능한 OS 레벨 작업**을 담당: 화면 전원 on/off, 재부팅, 밝기, 건강 상태 보고, 브라우저 워치독.
- 서버 WS에 연결해 `command`(§6) 수신. 화면 전원 제어(§9)를 쓰려면 필요. 위젯만 쓸 거면 생략 가능 → **선택 컴포넌트**.
- **다만 사실상 표준화 전제**: 실사용에선 화면 전원 제어가 거의 필수가 됨 → 에이전트를 **원터치 설치 스크립트**(curl one-liner/사전 빌드 이미지)로 제공하고, 기기 온보딩에서 **기본 권장**. 없어도 위젯은 동작(우아한 degrade)하되, 있으면 전원·건강·워치독이 켜짐.

### 4.2 왜 이 구조인가

- **소수 다중 기기**라서 중앙 허브가 유리(기기 등록·그룹·일괄 갱신). P2P는 과함.
- 디스플레이를 "얇은 웹 페이지"로 두면 Pi 프로비저닝이 극단적으로 단순(브라우저 하나).
- 데이터 프록시를 서버에 두면 보안(키 은닉)·성능(캐시)·확장(위젯이 임의 API 호출) 모두 해결.

### 4.3 성능 프로파일 (고성능/저성능 옵션화)

기기마다 `performanceProfile` 설정: `high` | `low` | `auto`. **코드베이스는 하나**, 프로파일에 따라 기능을 켜고 끔(별도 빌드 아님 → 유지보수 이중화 방지).

| 항목 | `high` (Pi 4/5, 미니PC) | `low` (Pi Zero 2/3, 저사양) |
|---|---|---|
| 디스플레이 런타임 | 풀 React | 경량 모드(Preact/코드분할, 무거운 모듈 미로드) |
| 애니메이션/전환 | 허용 (Ken Burns, 페이드 등) | 비활성, 정적 렌더 |
| 영상 위젯(RTSP·카메라) | WebRTC 재생 허용 | 정지 스냅샷으로 대체 또는 숨김 |
| 데이터 폴링 주기 | 짧게 | 길게(부하·발열 완화) |
| 렌더 프레임/해상도 | 제한 없음 | FPS·해상도 상한 |

- **위젯 매니페스트에 `requires` 명시**(예: `requires: ["video"]`). 저성능 기기에서는 미지원 위젯을 자동으로 스냅샷 대체하거나 편집기에서 경고.
- `auto`: 클라이언트가 `deviceMemory`/`hardwareConcurrency`/UA로 tier 추정 → 편집자가 오버라이드 가능.
- 무거운 위젯 코드는 **code-split**하여 `high`에서만 지연 로드 → `low` 기기의 초기 로드·메모리 절약.

### 4.4 국제화(i18n) & 로케일 — 처음부터 반영

다국어는 **두 축을 분리**한다(섞으면 나중에 못 푼다).

| 축 | 기준 | 저장 위치 | 영향 |
|---|---|---|---|
| **편집기 UI 언어** | 편집하는 *사람* | 브라우저/계정(`paneo:lang`) | 메뉴·버튼·인스펙터 라벨 |
| **디스플레이 로케일** | *기기* | `Device.locale`, `Device.timezone` | 날짜·시간·요일·숫자 포맷, 위젯 표시 언어 |

- 같은 집이라도 화면마다 로케일이 다를 수 있음 → **기기 속성**으로 관리.
- **위젯 현지화**: 렌더 시 `ctx.locale`/`ctx.timezone` 주입 → 위젯은 **`Intl.DateTimeFormat`/`Intl.NumberFormat`** 로 포맷(시계 12/24h, 요일·월 이름, 날씨 상태 텍스트, 캘린더 등). 하드코딩 금지.
- **UI 문자열**: 로케일별 메시지 카탈로그(JSON) + `t(key)` 헬퍼. ko/en으로 시작, 추가 언어는 카탈로그 파일만 얹으면 됨.
- **플러그인 매니페스트**: 위젯/설정 라벨을 로케일별로(`label: { ko, en }` 또는 i18n 키) → 서드파티도 번역 제공.
- **로케일 전달**: 발행 메시지에 로케일 동봉(`layout.set { layout, locale }`) → 디스플레이가 즉시 반영.
- **RTL**(아랍어·히브리어): `dir=rtl` 지원은 후순위로 열어둠.
- **폰트 커버리지**: Pi에 CJK/아랍 폰트 필요 → 프로비저닝 이미지에 Noto Sans CJK 등 포함(§11).

## 5. 데이터 모델 (초안)

```
Device        기기. { id, name, token,                            // ✅ 구현됨 (M0/M1)
                      resolutionW, resolutionH,                   // ✅ M1 — 방향은 W>H로 자동 도출, 별도 필드 없음(§4.4/D6)
                      performanceProfile: "high"|"low"|"auto",   // ✅ 필드는 있으나 §4.3 기능(저사양 degrade)은 아직 미구현
                      locale: "ko-KR", timezone?,                 // ✅ 구현됨 (§4.4 i18n)
                      pairingToken?, groupId?, assignedLayoutId?, lastSeenAt?, status?,  // ⏳ M2 예정
                      powerSchedule?, agentPresent: bool }        // ✅ M4 구현됨 (§9 화면 전원)
DeviceGroup   기기 그룹(방 단위). { id, name }  — ⏳ M2 예정, 그룹에 레이아웃 배정 시 소속 기기 일괄 적용
Layout        대시보드. { id, name, grid{cols,rows,gap}, background, widgets[],
                      draft{}, published{}, publishedAt }        // ✅ 초안/발행 분리(§6), rows는 최소값·자동 확장(§4.4 그리드 엔진)
WidgetInstance 배치된 위젯. { id, pluginId, x, y, w, h, config{}, customCss?, dataBindingId? }  // customCss ✅ D16
Plugin        위젯 플러그인 등록 정보. { id, version, type: "module"|"iframe", entry?|url?, manifest(§7) }  // ✅ D17 — DB 테이블이 아니라 파일시스템(data/plugins/) 스캔 기반, enabled 토글 없음(설치=활성)
DataSource    외부 데이터 연결. { id, type, credentialsRef, pollInterval }
User          편집자 계정. { id, email, role }
```

레이아웃 배정 우선순위: `Device.assignedLayoutId` > `DeviceGroup` 배정. 그룹으로 방 단위 일괄, 기기 개별 오버라이드 가능.

## 6. 동기화 모델 — 초안/발행 (Draft / Publish)

**실시간 스트리밍 미러링은 하지 않는다.** 편집자는 초안을 자유롭게 수정하고, **"적용(Publish)"을 눌렀을 때만** 디스플레이에 반영된다. 트래픽·깜빡임·복잡도가 크게 줄고, 편집 중간 상태가 화면에 노출되지 않는다.

```
편집 흐름
  1) 편집기가 layout.draft 를 로컬에서 수정 (서버에 자동 저장은 하되 디스플레이엔 미반영)
  2) 편집자가 "적용" 클릭
  3) 편집기 → 서버:  { type: "layout.publish", deviceId|groupId, layoutId }
  4) 서버: draft → published 복사 후, 대상 디스플레이에 push

서버 → 디스플레이
  { type: "layout.set", layout }                    // 발행된 최신 레이아웃
  { type: "widget.data", widgetId, payload }         // 위젯 데이터 주기 갱신
  { type: "command", action: "reload"|"identify"|"power" }  // 원격 제어(§9)

서버 → 편집기
  { type: "device.status", deviceId, status, lastSeenAt, tier }
```

- **미리보기**: 편집기 안의 프리뷰 패널에서만 draft를 렌더 → 실제 기기엔 영향 없음. (실기기 미러링이 아니므로 폰트/해상도 차이는 프리뷰에 기기 해상도를 적용해 근사.)
- **전송 채널**: WebSocket 권장하되, 발행 모델이라 빈도가 낮아 **SSE/폴링으로도 충분** → 저사양·불안정 네트워크에서 폴백 용이.
- **위젯 데이터**는 레이아웃과 독립적으로 주기 갱신(발행과 무관). 폴링 주기는 성능 프로파일(§4.3)에 연동.
- 재연결 시 서버가 최신 `layout.set` 재전송, 디스플레이는 그 전까지 캐시본 유지.

## 7. 플러그인/위젯 시스템 ★ (핵심 선택 사항)

위젯을 코어에서 분리하는 것이 이 프로젝트의 확장성 승부처. **매니페스트 + 렌더 모듈** 2요소로 정의.

### 7.1 매니페스트

```json
{
  "id": "weather",
  "name": "날씨",
  "version": "1.0.0",
  "defaultSize": { "w": 3, "h": 2 },
  "minSize": { "w": 2, "h": 2 },
  "configSchema": {                     // 편집기가 이걸로 설정 폼 자동 생성
    "location": { "type": "string", "label": "지역", "required": true },
    "units": { "type": "enum", "options": ["metric","imperial"], "default": "metric" }
  },
  "data": {                             // 서버가 대신 호출할 데이터 소스(선택)
    "source": "openweather",
    "pollInterval": 600
  },
  "permissions": ["network:openweathermap.org"]
}
```

### 7.2 렌더 모듈

- 위젯은 순수 함수형 컴포넌트: `render(el, config, ctx) → UI` (DOM에 직접 그림; `data`는 위젯이 필요시 서버 프록시에서 자체적으로 fetch/poll — §7.2 초안의 3-인자 `render(config, data, ctx)`보다 단순화된 실제 계약).
- 표준 인터페이스: `config`(사용자 설정), `ctx`(로케일·타임존·성능 프로파일, §4.4).
- ✅ D17: **내장(in-tree) 위젯**(`public/shared/widgets.js`)에 더해 **파일시스템 설치형 `module` 플러그인**(동적 `import()`)까지 개방됨. 원격 JS 번들의 자동 다운로드/실행(관리자 파일시스템 개입 없이)은 아직 열지 않음 — §7.3 참고.

### 7.3 샌드박싱 (서드파티 개방 단계)

- 서드파티 위젯은 신뢰 불가 → **iframe 샌드박스** 또는 제한된 런타임에서 렌더.
- 네트워크 접근은 매니페스트 `permissions` 화이트리스트로 제한, 실제 호출은 서버 프록시 경유.
- ✅ **D17 (M6 이후 확장)**: 서드파티 위젯 플러그인을 두 경로로 개방. (1) `module` 타입 — `data/plugins/<id>/`에 관리자가 직접 설치, 코어 위젯과 동일 권한으로 실행(샌드박스 없음 — 파일시스템에 넣는 행위 자체가 신뢰 결정). (2) `iframe` 타입 — manifest에 URL만 등록하면 `paneo.iframe`과 동일한 샌드박스(`strict`/`scripts`/`trusted`)로 격리 실행, 파일시스템 접근 불필요. 편집기 속성 패널은 두 타입 모두 `version`/`requires`/`permissions`/`sandbox`를 표시(내장 위젯과 동일 코드 경로). 작성 가이드: `docs/plugins.md`.
- **주의**: 임의 원격 코드의 **자동** 다운로드/실행은 여전히 열지 않음 — `module` 타입은 관리자가 직접 파일을 놓아야만 인식되고(핫 리로드 없음, 서버 재시작 시 1회 스캔), `iframe` 타입은 항상 샌드박스를 거친다. 내장 위젯 → 검증된 iframe/레지스트리 → 완전 개방이라는 단계적 개방 원칙은 유지.

### 7.4 MVP 내장 위젯 세트

시계 · 날씨 · 캘린더(iCal/Google) · 사진 슬라이드쇼 · RSS/뉴스 · 텍스트/메모 · iframe(임의 웹). 이 7종으로 매니페스트·데이터 프록시·설정폼 규격을 실전 검증.

## 8. 확장 위젯 & 연동 검토 (향후)

요청하신 3가지를 플러그인/데이터소스 규격(§7) 위에서 어떻게 얹을지 검토.

### 8.1 RTSP 카메라 표시

- **핵심 제약**: 브라우저는 RTSP를 직접 재생 못 함. 반드시 **게이트웨이가 변환**해야 함.
- **권장 구성**: 서버 옆에 **`go2rtc` 또는 `MediaMTX`**(RTSP 게이트웨이)를 두고 → RTSP를 **WebRTC**(저지연, ~0.5s)나 **HLS**(호환 좋지만 ~2–10s 지연)로 변환 → `camera` 위젯이 이를 재생.
- **성능 프로파일 연동(§4.3)**: 영상 디코딩은 무거움 → `high` 기기에서만 라이브 재생. `low` 기기는 **주기적 스냅샷(JPEG)** 으로 대체(게이트웨이의 still-frame 엔드포인트 사용).
- **매니페스트**: `requires: ["video"]`, config `{ streamUrl, mode: "webrtc"|"hls"|"snapshot", snapshotInterval }`.
- **주의**: 여러 화면이 동시에 같은 카메라를 물면 인코딩 부하↑ → 게이트웨이에서 단일 디코드→다중 배포 구조(go2rtc 기본 지원) 활용.

### 8.2 이미지 액자(Photo Frame) 모드

- §7.4의 "사진 슬라이드쇼" 위젯을 확장. **전체화면 단일 위젯 레이아웃 = 디지털 액자**.
- **소스**: 로컬 폴더 / 네트워크 공유(SMB) / Google Photos / **Immich**(자체호스팅 사진) / Unsplash.
- **효과**: `high`에서 Ken Burns·크로스페이드, `low`에서 정적 전환.
- **화면 전원 스케줄(§9)과 결합** → 낮에는 액자, 밤에는 화면 off 하는 진짜 액자 UX.
- config `{ source, interval, fit: "cover"|"contain", shuffle, effects }`.

### 8.3 Home Assistant 연동 기반

- **연결 방식**: HA의 **장기 액세스 토큰 + WebSocket API**로 서버가 HA에 접속해 엔티티 상태를 구독(`subscribe_events`). REST(`/api/states`)는 폴백.
- **데이터소스 타입 추가**: `DataSource.type = "home_assistant"` → 서버가 HA 연결을 관리하고, 위젯은 엔티티 id만 바인딩.
- **초기 위젯**: 엔티티 상태 표시(온도·습도·전력), 센서 게이지, HA 카메라 프록시(→ §8.1 RTSP 니즈와 통합), 알림/캘린더.
- **양방향(스위치 토글 등)**: 상시 디스플레이는 터치가 없을 수 있어 **표시 우선, 제어는 후순위**. 제어 시엔 HA `call_service` 사용 + 편집자 권한 필요.
- **주의**: HA 토큰은 서버에만 저장(§7 데이터 프록시 원칙). 디스플레이·편집기로 노출 금지.

### 8.4 ESP32 디스플레이 연동 검토

하드웨어 제약(낮은 RAM/플래시, 풀 브라우저 구동 불가)으로 인해 Pi처럼 HTML5/CSS Grid를 직접 렌더링할 수는 없으나, 다음 3가지 방식으로 확장 가능:

1. **서버 사이드 렌더링 후 이미지 푸시 (E-Ink / TFT LCD)**
   - 서버에서 Puppeteer 등의 headless 브라우저로 대상 디바이스 레이아웃을 백그라운드 렌더링 및 스크린샷 캡처(BMP/PNG).
   - ESP32는 HTTP GET으로 1~5분마다 이 이미지를 받아 디스플레이 버퍼에 쓰는 Thin 클라이언트로 동작.
   - 초저전력(배터리 가동) 전자종이 액자 대시보드 구현에 최적.
2. **원시 데이터 전송 + 기기 내 LVGL 렌더링**
   - ESP32가 서버 WebSocket에 연결하여 원시 데이터(`{ type: "widget.data", payload: { temp: 21.5, text: "맑음" } }`)만 구독.
   - ESP32 펌웨어에 내장된 LVGL 라이브러리로 디바이스 자체 폰트/아이콘을 직접 그리기 수행.
   - 데이터 트래픽이 극도로 낮고 화면 갱신이 빠름.
3. **전원 및 딥슬립 스케줄러 동기화**
   - 서버의 `powerSchedule` 정보를 수신하여 ESP32가 다음 켜질 시점까지 하드웨어 딥슬립(Deep Sleep)에 진입하도록 제어.
   - 배터리로 작동 시 몇 개월 이상 가동 가능한 대시보드 구축 가능.


## 9. 화면 전원 자동 제어 (꺼짐/켜짐)

상시 디스플레이의 번인·전력 대응. **컴패니언 에이전트(§4.1 D)가 필요** — 브라우저 페이지만으로는 HDMI/패널 전원을 못 끔.

- **제어 수단**(Pi):
  - **패널 DPMS**: `wlr-randr --output ... --off/--on`, X11이면 `xset dpms force off`, 또는 `vcgencmd display_power 0/1`.
  - **TV/모니터 전원(HDMI-CEC)**: `cec-ctl` / `echo 'standby 0' | cec-client` → 연결된 TV 자체를 끔.
- **트리거**:
  - **스케줄**(`Device.powerSchedule`): 예 23:00 off / 07:00 on.
  - **모션 센서**: PIR 센서 또는 **HA 재실감지(§8.3)** 연동 → 사람 있을 때만 켬.
  - **원격 명령**: 서버 → `command:{action:"power", on:false}` → 에이전트 실행.
- **밝기/디밍**(선택): 야간 자동 디밍으로 전원 off 대신 은은한 표시 유지(액자 모드와 궁합).
- **폴백**: 에이전트가 없는 기기는 화면 전원 제어 미지원(위젯 표시만) — 기능이 우아하게 degrade.

## 10. 호스팅 — 셀프호스트 (확정)

**클라우드 아님.** 서버는 **셀프호스트**하며, 별도 장비든 디스플레이 기기든 **어디에 올려도 되도록 병설(co-locate) 허용**. 핵심 원칙: **서버는 단일 이식 가능한 프로세스/컨테이너**, 어디서 돌리든 동일 코드.

| 배치 | 설명 | 적합 |
|---|---|---|
| **디스플레이 Pi에 병설** | 대표 Pi 1대가 디스플레이 + 서버 겸용. 장비 추가 0 | 가장 단순, 소규모 시작 |
| **별도 상시 장비(NAS·미니PC)** | 서버만 별도로. 디스플레이와 독립, 안정적 상시가동 | 기기 늘거나 24h 안정성 필요 시 |

- **배포 산출물**: **Docker 단일 컨테이너**(+ SQLite 볼륨). `docker run` 하나로 어디든 동일 기동 → 병설 ↔ 별도 장비 이전이 무중단에 가깝게.
- **병설 시 주의**: 서버 프로세스가 디스플레이 브라우저와 CPU/메모리를 공유 → `low` tier Pi에 병설은 지양(발열·버벅임). 병설은 `high` tier(Pi 4+) 권장.
- **네트워크**: 기본 로컬 네트워크. 외부 접속 필요 시 리버스 프록시(HTTPS) 옵션(§12).

## 11. 기술 스택 (제안)

- **서버**: Node.js + Fastify + `ws`(WebSocket) + SQLite(**`node:sqlite`** 내장 모듈, Node 22.5+/24— 네이티브 컴파일 불필요, 별도 빌드 툴체인 없이 어디서든 동일 동작). 단일 컨테이너.
- **편집기**: React + Vite + `react-grid-layout` + 스키마 기반 폼(RJSF 등).
- **디스플레이**: 서버가 서빙하는 React(또는 경량 프리액트) 페이지. Chromium `--kiosk`.
- **Pi 프로비저닝**: `cage`/`wayfire` + chromium kiosk 자동시작 스크립트, 또는 기존 kiosk 이미지.

대안: Pi 성능이 매우 낮은 모델(Zero/3)을 타깃하면 디스플레이 런타임을 **Preact/바닐라 + 최소 CSS**로 경량화 검토.

## 12. 보안

- **디스플레이 인증**: 기기별 페어링 토큰(URL에 포함). 토큰은 읽기 전용 권한(레이아웃 수신만).
- **편집기 인증**: ⏳ **의도적으로 미구현·보류** (2026-07-03 확인). 로그인 계정(로컬 네트워크라도 최소 비밀번호)이 원칙이지만, 실제로는 `/editor/`에 인증 없이 누구나 접근해 모든 기기 레이아웃을 수정할 수 있는 상태 — 코드가 원칙을 못 따라간 게 아니라, 사용자가 명시적으로 "일단 구현하지 말자"고 범위에서 제외함. **로컬 네트워크 밖으로 노출하기 전에 반드시 먼저 구현할 것.**
- **API 키 은닉**: 외부 서비스 키는 서버에만 저장, 디스플레이·편집기로 절대 전송 안 함.
- **플러그인**: §7.3 샌드박스 + 권한 화이트리스트.
- 외부 노출 시: HTTPS(리버스 프록시), 토큰 회전 지원.

## 13. 마일스톤 / 로드맵

- ✅ **M0 — 뼈대**: 서버(발행 허브+SQLite) + kiosk 페이지 + "적용" 시 레이아웃 반영. (2026-07-03 완료)
- ✅ **M1 — 편집기**: 드래그&드롭 그리드, SQLite(`node:sqlite`), 설정 폼, i18n, 데이터 프록시, 내장 위젯 8종. (2026-07-03 완료)
- ✅ **M2 — 기기 관리**: 기기 등록/페어링, 그룹(일괄 복사 D7), 성능 프로파일, 원격 reload/identify. (2026-07-03 완료)
- ✅ **M3 — 플러그인 규격 확정**: 위젯 매니페스트 확장(version/minSize/requires/permissions/enum), enum 인스펙터, `paneo.calendar.month`(ICS 월간 그리드 D8), `paneo.timer`(멀티 알람 타이머 D9), 서비스워커 오프라인 캐시. 위젯 10종. (2026-07-03 완료)
- ✅ **M4 — 컴패니언 에이전트**: 화면 전원 스케줄/원격 제어(§9), 건강 상태 보고. (2026-07-03 완료)
- ✅ **M5 — 확장 연동**: Home Assistant 데이터소스(§8.3), 이미지 액자 모드(§8.2). (2026-07-03 완료)
- ✅ **M6 — 서드파티 마무리(비-RTSP)**: 외부 페이지 위젯 샌드박스 모드, 매니페스트 권한/필요 기능 표시, 문서/README 최신화. (2026-07-03 완료)
- ✅ **서드파티 위젯 플러그인 (D17)**: `module`(파일시스템 설치) + `iframe`(URL 등록, 샌드박스) 하이브리드 개방. (2026-07-03 완료)
- **M7 후보 — RTSP & 고급 플러그인**: 카메라 게이트웨이 위젯(§8.1), 플러그인 마켓/원격 설치 UI(현재는 수동 파일 복사만 지원), iframe postMessage 데이터 채널, 더 강한 권한 모델.

## 14. 리스크 & 오픈 이슈

1. **Pi 성능**: 타깃 하드웨어 미확정. → M0에서 실제 Pi로 렌더 성능 벤치. 성능 프로파일(§4.3)로 완화하되 tier 경계는 실측 필요.
2. **번인(Burn-in)**: 상시 표시 → 야간 디밍/픽셀 시프트 + 화면 전원 스케줄(§9)로 대응.
3. **플러그인 보안**: 서드파티 코드 실행 = 최대 위험. 단계적 개방으로 완화.
4. **호스팅 확정**: §10 추천대로 컨테이너화하면 결정을 M2 이후로 미뤄도 안전.
5. **RTSP 부하**: 영상 트랜스코딩은 서버/게이트웨이 부하 큼(§8.1). 이번 M6에서는 보류했고, 후속 M7에서 저성능 호스트 스냅샷 폴백과 함께 설계 필요.
6. **컴패니언 에이전트 트레이드오프**: 화면 전원 제어를 위해 "브라우저만" 단순성이 일부 깨짐. 에이전트는 선택 설치로 유지.
7. ✅ **프리뷰 정확도**(해결, M1): 이전엔 가로는 `clientWidth/cols`로 화면 폭에 비례했지만 세로는 레이아웃에 저장된 고정 px(`rowHeight`)를 그대로 써서, 해상도·종횡비가 다른 디스플레이에 배포하면 세로 배치가 어긋나는 실제 버그가 있었음. **실제 CSS Grid**(`grid-template-columns/rows: repeat(n, 1fr)`)로 전환해 가로·세로 모두 컨테이너 크기에 비례하도록 수정(`public/shared/gridlayout.js`). 폰트 차이 등 잔여 오차는 경미.
8. **날씨 위젯 개발 환경 검증 한계**: M1 개발 샌드박스에서 `api.open-meteo.com`(예보 엔드포인트)만 특정 IP 대역 아웃바운드 차단으로 타임아웃됨(지오코딩 서브도메인·GitHub·RSS·iCal 등 다른 외부 호출은 모두 정상). 코드는 RSS/iCal과 동일 패턴으로 구현·에러 핸들링까지 확인됨 — 위젯은 로딩→에러 UI로 정상 degrade. 실제 셀프호스트 배포 환경에서 재검증 필요(코드 결함이 아닌 샌드박스 네트워크 제약으로 판단).

---
### 다음 액션
- [ ] 실제 타깃 Pi에서 `high`/`low` 프로파일 렌더링 점검
- [ ] 외부 페이지 위젯의 `strict`/`scripts`/`trusted` 모드별 동작 확인
- [ ] RTSP 카메라 게이트웨이(M7 후보) 진행 여부 결정
