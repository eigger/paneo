# Paneo

[![CI](https://github.com/eigger/paneo/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/eigger/paneo/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.5-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![GitHub Release](https://img.shields.io/github/release/eigger/paneo.svg)](https://github.com/eigger/paneo/releases)
[![License](https://img.shields.io/github/license/eigger/paneo)](https://github.com/eigger/paneo/blob/master/LICENSE)
[![Raspberry Pi](https://img.shields.io/badge/Raspberry%20Pi-supported-C51A4A?logo=raspberrypi&logoColor=white)](docs/install-device.ko.md)
[![Self-hosted](https://img.shields.io/badge/hosting-self--hosted-2563EB)](docs/design.md)
[![Home Assistant](https://img.shields.io/badge/Home%20Assistant-widget-41BDF5?logo=home-assistant&logoColor=white)](docs/install-device.ko.md#83-home-assistant)

[English](README.md) · [한국어](README.ko.md)

라즈베리 파이와 상시 디스플레이를 위한 웹 편집형 대시보드입니다.
브라우저에서 레이아웃을 편집하고 **적용**을 누르면 연결된 화면이 새로고침 없이 즉시 갱신됩니다.

> 설계 문서: [docs/design.md](docs/design.md) (결정 로그 §0) · 마일스톤: **M6 비-RTSP 완료**, RTSP 보류

## 현재 동작하는 기능

- **편집기** (`/`): 위젯 그리드 드래그/리사이즈, 위젯별 설정(텍스트/숫자/체크박스/동적 URL 목록),
  카테고리별 **위젯 추가** 팝오버, 기기별 해상도(프리셋·직접 입력·회전), 편집기 UI 언어(ko/en)와
  디스플레이 로케일 — 모두 편집 툴바와 분리된 ⚙ 설정 패널에서 관리합니다.
- **디스플레이** (`/d/<token>`): 키오스크 페이지, WebSocket 레이아웃 푸시, 오프라인 캐시(네트워크가
  끊겨도 마지막 레이아웃 유지), 실제 CSS Grid로 해상도·종횡비에 비례해 렌더링합니다.
- **초안/발행 모델**: 편집 중인 내용은 **적용** 전까지 실제 디스플레이에 반영되지 않습니다.
- **위젯 11종**: 시계, 날짜, 텍스트, 날씨(Open-Meteo, API 키 불필요), 일정 목록, 월간 달력,
  RSS/뉴스, 샌드박스 외부 페이지, 사진 슬라이드쇼/액자, 알람 타이머, Home Assistant 엔티티.
- **데이터 프록시** (`src/dataproxy.js`): 위젯이 외부 API를 직접 호출하지 않고 서버가 fetch·캐시·병합합니다.
- **기기 관리**: 해상도/로케일/성능 프로파일, 그룹, 원격 새로고침/화면 확인,
  선택적 컴패니언 에이전트 전원 스케줄.
- **M6 서드파티 가드레일**: 외부 페이지는 샌드박스 iframe으로 표시하고, 편집기에서 위젯
  버전/필요 기능/권한을 배포 전에 확인할 수 있습니다. RTSP/카메라 스트리밍은 의도적으로 보류했습니다.
- **SQLite 영속화**: Node 내장 `node:sqlite` 사용 — 네이티브 컴파일 불필요.

## 실행

```sh
npm install
npm start          # http://localhost:4321
```

- **편집기**: http://localhost:4321/ (최초 실행 시 기본 화면이 자동 생성됩니다)
- **디스플레이**: 편집기에서 **디스플레이 열기**를 누르거나 `http://localhost:4321/d/<token>` 접속

디스플레이를 다른 탭/창에서 열고, 편집기에서 위젯을 배치한 뒤 **적용**을 누르면 실시간으로 반영됩니다.

## 테스트

```sh
npm test
```

GitHub Actions(`.github/workflows/ci.yml`)에서 Node.js 22·24 환경으로 동일한 테스트를 실행합니다.

## 실제 장치 설치

자세한 내용은 [`docs/install-device.ko.md`](docs/install-device.ko.md) ([English](docs/install-device.md))를 참고하세요.

- 서버 설치 및 `systemd` 서비스 등록
- 디스플레이 Pi Chromium kiosk 자동실행
- 컴패니언 에이전트(화면 전원 제어) 선택 설치
- 첫 대시보드 구성, Home Assistant, 사진 액자, 문제 해결

라즈베리 파이 설치 — **역할에 맞는 블록 하나만** 실행하세요.

**서버 Pi** (`paneo` 서비스만):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=server bash
```

**디스플레이 Pi** (kiosk + 에이전트, 서버·토큰 필요):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
  | sudo env PANEO_MODE=display \
      PANEO_SERVER=http://<server-ip>:4321 \
      PANEO_TOKEN=<token> \
      bash
```

**올인원 Pi** (서버 + 디스플레이 + 에이전트 한 번에 — 위 두 절차를 따로 실행하지 않음):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=all bash
```

자세한 내용: [`docs/install-device.ko.md`](docs/install-device.ko.md)

## 구조

- `src/server.js` — Fastify + `@fastify/websocket` REST + WS 허브
- `src/store.js` — SQLite(`node:sqlite`) 영속화, M0 JSON 자동 마이그레이션
- `src/dataproxy.js` — 날씨/iCal/RSS 서버 사이드 fetch + 캐시 + 병합
- `src/brand.js` — 제품명/`pluginPrefix` 중앙 관리
- `public/shared/widgets.js` — 편집기 미리보기와 디스플레이가 공유하는 위젯 레지스트리
- `public/shared/gridlayout.js` — 편집기·디스플레이 비례 레이아웃 공통 CSS Grid 계산
- `public/editor/` — 그리드 편집기
- `public/display/` — 키오스크 디스플레이 페이지
- `agent/` — 선택적 컴패니언 에이전트(화면 전원 제어)
- `install.sh` — GitHub에서 clone 후 Pi 설치를 시작하는 부트스트랩 스크립트
- `scripts/install-pi.sh` — 라즈베리 파이 원클릭 설치 스크립트
- `test/` — Node.js 내장 테스트 러너

## 위젯

`paneo.clock` · `paneo.date` · `paneo.text` · `paneo.weather` · `paneo.calendar` · `paneo.calendar.month` ·
`paneo.rss` · `paneo.iframe` · `paneo.photo` · `paneo.timer` · `paneo.homeassistant`

## 저장소

https://github.com/eigger/paneo
