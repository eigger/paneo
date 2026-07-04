# Paneo

[![CI](https://github.com/eigger/paneo/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/eigger/paneo/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.5-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![GitHub Release](https://img.shields.io/github/v/release/eigger/paneo)](https://github.com/eigger/paneo/releases/latest)
[![License](https://img.shields.io/github/license/eigger/paneo)](https://github.com/eigger/paneo/blob/master/LICENSE)
[![Raspberry Pi](https://img.shields.io/badge/Raspberry%20Pi-supported-C51A4A?logo=raspberrypi&logoColor=white)](docs/install-device.ko.md)
[![Self-hosted](https://img.shields.io/badge/hosting-self--hosted-2563EB)](docs/design.md)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-widget-41BDF5?logo=home-assistant&logoColor=white)](docs/install-device.ko.md#83-home-assistant)
[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Feigger%2Fpaneo-2496ED?logo=docker&logoColor=white)](https://github.com/eigger/paneo/pkgs/container/paneo)

[English](README.md) · [한국어](README.ko.md)

라즈베리 파이와 상시 디스플레이를 위한 웹 편집형 대시보드입니다.
브라우저에서 레이아웃을 편집하고 **적용**을 누르면 연결된 화면이 새로고침 없이 즉시 갱신됩니다.

위젯은 **크기를 스스로 인식**합니다 — 모서리를 드래그해 크기를 바꾸면 별도 설정 없이 그 자리에서
레이아웃을 다시 짭니다. 달력은 하루 일정 목록에서 월간 그리드로, 날씨 카드는 예보 스트립이 자라나고,
뉴스 피드는 발행 시각을 드러냅니다 — 전부 같은 위젯이 얼마나 큰 공간을 받았느냐에 따라 결정됩니다.

## Gallery

| 화면 | 스크린샷 |
|------|----------|
| 편집기 | <img src="docs/images/editor.png" alt="Paneo 편집기" width="640" /> |
| 디스플레이 | <img src="docs/images/display.png" alt="Paneo 디스플레이 키오스크" width="640" /> |

### 크기 적응형 위젯

`paneo.calendar.month` 위젯 하나를 4가지 크기로 렌더링한 모습입니다 — 위젯 자신의 렌더링 박스
크기만으로 어떤 뷰를 보여줄지 스스로 결정합니다:

| 일간 (작음) | 주간 | 3주간 | 월간 (큼) |
|:---:|:---:|:---:|:---:|
| <img src="docs/images/widgets/calendar-day.png" alt="캘린더 일간 뷰" width="160" /> | <img src="docs/images/widgets/calendar-week.png" alt="캘린더 주간 뷰" width="220" /> | <img src="docs/images/widgets/calendar-3week.png" alt="캘린더 3주간 뷰" width="260" /> | <img src="docs/images/widgets/calendar-month.png" alt="캘린더 월간 뷰" width="340" /> |

날씨 위젯도 같은 방식으로 예보 스트립이 나타나고, 대기질/RSS/일정 목록 위젯은 공간이 생기면
추가 정보(오염물질 세부 항목, 발행 날짜, 소스별 색상 범례)를 보여줍니다:

| 날씨 — 축약 | 날씨 — 예보 포함 |
|:---:|:---:|
| <img src="docs/images/widgets/weather-compact.png" alt="날씨 위젯 축약" width="200" /> | <img src="docs/images/widgets/weather-forecast.png" alt="날씨 위젯 예보 포함" width="240" /> |

별도의 설정 토글이 전환하는 게 아니라, 위젯 자신의 박스에 붙은 `ResizeObserver`가 판단합니다 —
그래서 편집기에서 리사이즈 핸들을 드래그하는 도중에도 실시간으로 반응합니다.

### 전체 위젯

| 위젯 | 미리보기 |
|------|----------|
| 시계 | <img src="docs/images/widgets/clock.png" alt="시계 위젯" width="200" /> |
| 날짜 | <img src="docs/images/widgets/date.png" alt="날짜 위젯" width="200" /> |
| 알람 타이머 | <img src="docs/images/widgets/timer.png" alt="알람 타이머 위젯" width="200" /> |
| 사진/동영상 슬라이드쇼 | <img src="docs/images/widgets/photo.png" alt="사진 위젯" width="220" /> |
| 외부 페이지 | <img src="docs/images/widgets/iframe.png" alt="외부 페이지 위젯" width="240" /> |
| 대기질 (확장) | <img src="docs/images/widgets/airquality.png" alt="대기질 위젯" width="200" /> |
| RSS / 뉴스 (확장) | <img src="docs/images/widgets/rss.png" alt="RSS 위젯" width="220" /> |
| 일정 목록 (확장) | <img src="docs/images/widgets/calendar.png" alt="일정 목록 위젯" width="240" /> |

스크린샷은 없지만 함께 제공되는 위젯: **텍스트**, **홈어시스턴트** 엔티티(상태/토글 + 전용 날씨
카드), **세계시계**, **D-Day 카운트다운**, **할 일 목록**, **환율**, **QR 코드** — 내장 위젯만 17종,
서드파티 플러그인 위젯도 추가할 수 있습니다.

스크린샷 재생성: `node scripts/capture-screenshots.mjs` (최초 1회: `npm install --no-save playwright && npx playwright install chromium`. 위젯만: `PANEO_SCREENSHOT_MODE=widgets`)

> 설계 문서: [docs/design.md](docs/design.md) (결정 로그 §0) · 마일스톤: **M6 비-RTSP 완료**, RTSP 보류

## 현재 동작하는 기능

- **크기 적응형 위젯**: 달력(일간/주간/3주간/월간), 날씨(현재 vs 예보), 대기질(핵심 수치 vs 전체
  오염물질), RSS, 일정 목록이 렌더링 박스 크기에 따라 내부 뷰를 스스로 전환합니다 — 위 갤러리 참고.
- **편집기** (`/`): 위젯 그리드 드래그/리사이즈, 위젯별 설정(텍스트/숫자/체크박스/동적 URL 목록),
  카테고리별 **위젯 추가** 팝오버, 기기별 해상도(프리셋·직접 입력·회전), 편집기 UI 언어(ko/en)와
  디스플레이 로케일 — 모두 편집 툴바와 분리된 ⚙ 설정 패널에서 관리합니다.
- **디스플레이** (`/d/<token>`): 키오스크 페이지, WebSocket 레이아웃 푸시, 오프라인 캐시(네트워크가
  끊겨도 마지막 레이아웃 유지), 실제 CSS Grid로 해상도·종횡비에 비례해 렌더링합니다.
- **초안/발행 모델**: 편집 중인 내용은 **적용** 전까지 실제 디스플레이에 반영되지 않습니다.
- **내장 위젯 17종**: 시계, 날짜, 텍스트, 날씨, 대기질, 일정 목록, 크기 적응형 달력, RSS/뉴스,
  샌드박스 외부 페이지, 사진/동영상 슬라이드쇼, 알람 타이머, 홈어시스턴트 엔티티, 세계시계,
  D-Day 카운트다운, 할 일 목록, 환율, QR 코드 — 그리고 서드파티 플러그인 시스템.
- **데이터 프록시** (`src/dataproxy.js`): 위젯이 외부 API를 직접 호출하지 않고 서버가
  fetch·소스별 캐시·병합합니다.
- **기기 관리**: 해상도/로케일/성능 프로파일, 그룹, 원격 새로고침/화면 확인, 컴패니언 에이전트
  전원 스케줄, 편집기에서 바로 실행하는 원클릭 원격 업데이트.
- **업데이트 확인**: 업데이트를 실행하기 전에 편집기가 새 릴리즈가 있는지 먼저 알려줍니다.
- **M6 서드파티 가드레일**: 외부 페이지는 샌드박스 iframe으로 표시하고, 편집기에서 위젯
  버전/필요 기능/권한을 배포 전에 확인할 수 있습니다. RTSP/카메라 스트리밍은 의도적으로 보류했습니다.
- **SQLite 영속화**: Node 내장 `node:sqlite` 사용 — 네이티브 컴파일 불필요.

## 실행

```sh
npm install
npm start          # http://localhost:4321
```

또는 Docker로 (단일 컨테이너, `data/`는 볼륨에 영속화 — [docs/design.md](docs/design.md) §10 참고). [GitHub Release](https://github.com/eigger/paneo/releases)가 나올 때마다 GHCR에 빌드된 이미지가 자동으로 올라갑니다(`linux/amd64` + `linux/arm64` — 라즈베리 파이 본체에서도 그대로 실행 가능):

```sh
docker compose pull && docker compose up -d   # 릴리즈 이미지 사용
# 또는: docker compose up -d --build          # 로컬 소스에서 직접 빌드
```

- **편집기**: http://localhost:4321/ (최초 실행 시 기본 화면이 자동 생성됩니다)
- **디스플레이**: 편집기에서 **디스플레이 열기**를 누르거나 `http://localhost:4321/d/<token>` 접속

디스플레이를 다른 탭/창에서 열고, 편집기에서 위젯을 배치한 뒤 **적용**을 누르면 실시간으로 반영됩니다.

## 테스트

```sh
npm test
```

GitHub Actions(`.github/workflows/ci.yml`)에서 Node.js 22·24 환경으로 동일한 테스트를 실행합니다.

## 라즈베리 파이 설치

**명령 한 줄, 기기 한 대** — 서버 + 키오스크 디스플레이 + 컴패니언 에이전트를 한 번에:

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=all bash
```

끝나면 재부팅하세요 (`sudo reboot`) — 디스플레이가 바로 키오스크로 부팅됩니다. 서버와 디스플레이를
여러 대의 Pi로 나누는 경우가 아니라면 아래는 건너뛰어도 됩니다.

<details>
<summary><strong>여러 대 설치, 수동 설치, 기타 옵션</strong> (클릭해서 펼치기)</summary>

**역할에 맞는 블록 하나만** 실행하세요.

**서버 Pi** (서버만, 키오스크 없음):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=server bash
```

**디스플레이 Pi** (kiosk + 에이전트, 서버가 이미 실행 중이어야 하며 편집기의 **디스플레이 열기**에서 토큰 필요):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
  | sudo env PANEO_MODE=display \
      PANEO_SERVER=http://<server-ip>:4321 \
      PANEO_TOKEN=<token> \
      bash
```

그 밖의 옵션(버전 고정, 기기 이름 지정, Docker Compose/systemd 수동 구성, 컴패니언 에이전트만 설치,
Chromium kiosk 자동실행 세부사항)은 전체 가이드
[`docs/install-device.ko.md`](docs/install-device.ko.md) ([English](docs/install-device.md))를
참고하세요 — 첫 대시보드 구성, Home Assistant, 사진 액자, 문제 해결도 함께 다룹니다.

</details>

## 업데이트

Pi 본체에서 명령 한 줄로 서버 이미지와 에이전트(`all` 모드라면 코덱과 키오스크 브라우저 재시작까지)를
데이터 손실 없이 갱신합니다:

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/scripts/update-pi.sh | sudo bash
```

또는 디스플레이의 컴패니언 에이전트가 연결되어 있다면 편집기 ⚙ **설정** 패널에서 바로 같은 업데이트를
실행할 수 있습니다 — 새 릴리즈가 있는지도 먼저 보여줍니다. 자세한 내용(서버 전용 모드, Docker
Compose 수동 업데이트, 에이전트만 업데이트): [`docs/install-device.ko.md`](docs/install-device.ko.md#12-업데이트)

## 구조

- `src/server.js` — Fastify + `@fastify/websocket` REST + WS 허브
- `src/store.js` — SQLite(`node:sqlite`) 영속화, M0 JSON 자동 마이그레이션
- `src/dataproxy.js` — 날씨/대기질/iCal/RSS 서버 사이드 fetch + 캐시 + 병합
- `src/version.js` — 구성 요소 버전 정보 + GitHub 릴리즈 기반 업데이트 확인
- `src/brand.js` — 제품명/`pluginPrefix` 중앙 관리
- `public/shared/widgets.js` — 편집기 미리보기와 디스플레이가 공유하는 위젯 레지스트리
  (크기 적응형 `ResizeObserver` 위젯 포함)
- `public/shared/gridlayout.js` — 편집기·디스플레이 비례 레이아웃 공통 CSS Grid 계산
- `public/editor/` — 그리드 편집기
- `public/display/` — 키오스크 디스플레이 페이지
- `agent/` — 선택적 컴패니언 에이전트(화면 전원 제어 + 원격 업데이트)
- `install.sh` — GitHub에서 clone 후 Pi 설치를 시작하는 부트스트랩 스크립트
- `scripts/install-pi.sh` — 라즈베리 파이 원클릭 설치 스크립트
- `scripts/update-pi.sh` — 라즈베리 파이 원클릭 업데이트 스크립트
- `scripts/capture-screenshots.mjs` — README 스크린샷 재생성 (Playwright)
- `test/` — Node.js 내장 테스트 러너

## 위젯

`paneo.clock` · `paneo.date` · `paneo.text` · `paneo.weather` · `paneo.airquality` · `paneo.calendar` ·
`paneo.calendar.month` · `paneo.rss` · `paneo.iframe` · `paneo.photo` · `paneo.timer` ·
`paneo.homeassistant` · `paneo.worldclock` · `paneo.dday` · `paneo.todo` · `paneo.exchangerate` ·
`paneo.qrcode`

## 저장소

https://github.com/eigger/paneo
