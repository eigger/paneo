# Paneo 실제 장치 설치 및 사용 가이드

[English](install-device.md) · [한국어](install-device.ko.md)

이 문서는 Paneo를 실제 Raspberry Pi 또는 상시 디스플레이 장치에서 사용하는 절차를 정리합니다.

권장 구성은 **서버 1대 + 디스플레이 Pi 여러 대**입니다. 작은 구성에서는 서버와 디스플레이를 같은 Pi 4 이상 장치에 같이 올려도 됩니다.

## 1. 구성 개요

서버 장치:

- Paneo 서버를 실행합니다.
- 편집기(`/`)와 디스플레이 페이지(`/d/<token>`)를 제공합니다.
- SQLite 데이터, 위젯 프록시, Home Assistant 설정을 저장합니다.

디스플레이 장치:

- Chromium kiosk로 `http://<server-ip>:4321/d/<token>`을 엽니다.
- 선택 사항으로 컴패니언 에이전트를 설치하면 화면 전원 켜기/끄기와 watchdog을 사용할 수 있습니다.

편집 장치:

- 같은 네트워크의 PC/태블릿/노트북에서 `http://<server-ip>:4321/`에 접속합니다.
- 위젯 배치 후 **적용**을 누르면 연결된 디스플레이에 즉시 반영됩니다.

## 2. 원클릭 설치

아래는 **역할별 설치**입니다. 구성에 맞는 **문단 하나만** 실행하세요. 위에서부터 순서대로 모두 돌릴 필요는 없습니다.

| 구성 | 실행할 문단 |
|------|-------------|
| 서버 1대 + 디스플레이 Pi 여러 대 (권장) | 서버 Pi → 각 디스플레이 Pi |
| Pi 한 대에 전부 | 올인원 Pi |
| PC에서 편집만 | 설치 없음 (브라우저 접속) |

공통: GitHub에서 받을 때는 `install.sh`가 `/opt/paneo`에 clone한 뒤 `scripts/install-pi.sh`를 호출합니다.

```sh
# 예: GitHub bootstrap (역할은 PANEO_MODE로 선택)
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=<server|display|all> ... bash
```

공통 환경 변수: `PANEO_REF=master`, `PANEO_INSTALL_DIR=/opt/paneo`, `PANEO_USER=pi`

---

### 서버 Pi

**설치 내용:** Node.js, Paneo 서버(`paneo` systemd 서비스). 편집기·API·SQLite를 이 장치에서 제공합니다.

**이 장치에서만 실행:**

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=server bash
```

소스를 이미 받아 둔 경우:

```sh
sudo env PANEO_MODE=server PANEO_DIR=$PWD bash scripts/install-pi.sh
```

설치 후 편집기: `http://<server-ip>:4321/` · 상태 확인: `systemctl status paneo`

---

### 디스플레이 Pi

**설치 내용:** Chromium kiosk 자동실행 + 컴패니언 에이전트(`paneo-agent` systemd). 서버에 등록된 `/d/<token>` 화면을 부팅 후 전체화면으로 엽니다.

**사전 준비:** 서버가 이미 동작 중이어야 합니다. 편집기에서 화면을 만들고 **디스플레이 열기** URL의 토큰을 복사합니다.

**이 장치에서만 실행:**

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
  | sudo env PANEO_MODE=display \
      PANEO_SERVER=http://<server-ip>:4321 \
      PANEO_TOKEN=<token> \
      bash
```

서버가 이미 떠 있으면 설치 스크립트만 받아도 됩니다:

```sh
curl -sSL http://<server-ip>:4321/install/pi.sh \
  | sudo env PANEO_MODE=display \
      PANEO_SERVER=http://<server-ip>:4321 \
      PANEO_TOKEN=<token> \
      bash
```

kiosk만 필요하고 에이전트(화면 전원 제어)는 빼려면 `PANEO_ENABLE_AGENT=0`을 추가합니다. 재부팅 후 kiosk가 뜹니다: `sudo reboot`

---

### 컴패니언 에이전트만 (선택)

**설치 내용:** `paneo-agent` 서비스만 추가합니다. 화면 전원 켜기/끄기·watchdog용입니다.

디스플레이 Pi 설치(`PANEO_MODE=display`)에 **이미 포함**되어 있어, 위 절차를 했다면 **별도 실행 불필요**합니다.

kiosk는 수동으로 쓰고 에이전트만 붙일 때:

```sh
curl -sSL http://<server-ip>:4321/agent/install.sh \
  | sudo env PANEO_SERVER=http://<server-ip>:4321 PANEO_TOKEN=<token> bash
```

---

### 올인원 Pi (서버 + 디스플레이 + 에이전트)

**설치 내용:** 위 **서버 Pi + 디스플레이 Pi + 에이전트**를 한 명령으로 처리합니다. Pi 4 이상 한 대에서 시험·소규모 구성에 적합합니다.

**위의 서버·디스플레이 절차를 따로 실행할 필요 없습니다.**

**이 장치에서만 실행:**

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=all bash
```

화면 이름 지정 (토큰 없으면 설치 중 자동 생성):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
  | sudo env PANEO_MODE=all PANEO_DEVICE_NAME="거실" bash
```

소스를 이미 받아 둔 경우:

```sh
sudo env PANEO_MODE=all PANEO_DIR=$PWD PANEO_DEVICE_NAME="거실" bash scripts/install-pi.sh
```

옵션: `PANEO_PORT=8080`, `PANEO_TOKEN=<token>`(기존 화면), `PANEO_ENABLE_AGENT=0`, `PANEO_ENABLE_KIOSK=0`

---

아래 수동 설치 절차는 원클릭 스크립트를 쓰지 않거나 세부 설정을 직접 조정할 때 참고하세요.

## 3. 서버 설치

### 3.1 준비

서버에는 Node.js가 필요합니다. `node:sqlite`를 사용하므로 Node.js 22.5 이상 또는 Node.js 24 이상을 권장합니다.

```sh
node --version
```

Raspberry Pi OS 또는 Debian 계열에서 Node.js가 너무 오래된 경우 NodeSource 등으로 최신 LTS/Current 버전을 설치하세요.

### 3.2 소스 받기

```sh
git clone https://github.com/eigger/paneo.git
cd paneo
npm install
```

이미 소스를 복사해 둔 경우에는 프로젝트 루트에서 `npm install`만 실행하면 됩니다.

### 3.3 서버 실행

```sh
npm start
```

기본 포트는 `4321`입니다.

- 편집기: `http://<server-ip>:4321/`
- 디스플레이: `http://<server-ip>:4321/d/<token>`

다른 포트를 쓰려면:

```sh
PORT=8080 npm start
```

### 3.4 systemd 서비스로 등록

서버를 부팅 시 자동 실행하려면 서버 장치에서 다음 파일을 만듭니다.

```sh
sudo nano /etc/systemd/system/paneo.service
```

예시:

```ini
[Unit]
Description=Paneo Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/paneo
Environment=PORT=4321
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

경로와 사용자는 실제 설치 위치에 맞게 바꾸세요.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now paneo
sudo systemctl status paneo
```

로그 확인:

```sh
journalctl -u paneo -f
```

## 4. 첫 화면 등록

1. 브라우저에서 `http://<server-ip>:4321/`를 엽니다.
2. 상단의 **화면** 선택 옆 `+` 버튼으로 새 화면을 만듭니다.
3. 오른쪽 위 설정 버튼에서 해상도, 방향, 로케일, 성능 프로파일을 맞춥니다.
4. **디스플레이 열기**를 눌러 표시 URL을 확인합니다.
5. URL의 `/d/<token>`에서 `<token>` 부분이 이 화면의 디스플레이 토큰입니다.

예:

```text
http://192.168.0.10:4321/d/abc123
```

이 경우 토큰은 `abc123`입니다.

## 5. 디스플레이 Pi 설정

### 5.1 Chromium 설치

Raspberry Pi OS Desktop에는 Chromium이 기본 포함되는 경우가 많습니다. 없으면 설치합니다.

```sh
sudo apt update
sudo apt install -y chromium-browser
```

배포판에 따라 패키지명이 `chromium`일 수 있습니다.

```sh
sudo apt install -y chromium
```

### 5.2 수동 실행 테스트

디스플레이 Pi에서 다음을 실행해 화면이 정상 표시되는지 먼저 확인합니다.

```sh
chromium-browser --kiosk --noerrdialogs --disable-infobars http://<server-ip>:4321/d/<token>
```

`chromium-browser` 명령이 없으면 `chromium`으로 바꿔 실행합니다.

### 5.3 부팅 시 kiosk 자동 실행

Raspberry Pi OS Desktop의 autostart를 사용할 수 있습니다.

```sh
mkdir -p ~/.config/lxsession/LXDE-pi
nano ~/.config/lxsession/LXDE-pi/autostart
```

예시:

```text
@xset s off
@xset -dpms
@xset s noblank
@chromium-browser --kiosk --noerrdialogs --disable-infobars http://<server-ip>:4321/d/<token>
```

저장 후 재부팅합니다.

```sh
sudo reboot
```

Wayland/labwc 기반 이미지에서는 autostart 위치가 다를 수 있습니다. 이 경우 OS의 “Startup Applications” 또는 compositor autostart 설정에 같은 Chromium 명령을 등록하세요.

## 6. 컴패니언 에이전트 설치

에이전트는 선택 사항입니다. 설치하면 편집기에서 원격 새로고침, 화면 확인, 화면 전원 켜기/끄기, 전원 스케줄을 사용할 수 있습니다.

디스플레이 Pi에서 실행합니다.

```sh
curl -sSL http://<server-ip>:4321/agent/install.sh \
  | sudo env PANEO_SERVER=http://<server-ip>:4321 \
    PANEO_TOKEN=<token> \
    bash
```

설치 후 상태 확인:

```sh
systemctl status paneo-agent
journalctl -u paneo-agent -f
```

편집기 설정 화면의 원격 제어 영역에 **에이전트 연결됨**이 표시되면 정상입니다.

에이전트가 화면 전원 제어에 사용하는 방식은 장치 환경에 따라 자동 선택됩니다.

- Raspberry Pi 펌웨어: `vcgencmd display_power`
- Wayland: `wlr-randr`
- X11: `xset dpms`
- 지원되지 않는 환경: 시뮬레이터 로그만 출력

Wayland에서 출력 이름이 기본값 `HDMI-A-1`과 다르면 서비스 환경 변수 `PANEO_DISPLAY_OUTPUT`을 조정해야 합니다.

## 7. 기본 사용 흐름

1. PC나 태블릿에서 `http://<server-ip>:4321/` 편집기를 엽니다.
2. 화면을 선택하거나 새로 만듭니다.
3. **위젯 추가**에서 시계, 날짜, 날씨, 사진, RSS, 월간 달력, Home Assistant 등을 배치합니다.
4. 위젯을 클릭한 뒤 오른쪽 속성 패널에서 설정을 입력합니다.
5. 드래그/리사이즈로 레이아웃을 맞춥니다.
6. 미리보기 상태가 괜찮으면 **적용**을 누릅니다.
7. 디스플레이 Pi의 화면이 WebSocket으로 즉시 갱신됩니다.

편집 중인 초안은 자동 저장되지만, 실제 디스플레이에는 **적용**을 누르기 전까지 반영되지 않습니다.

## 8. 주요 기능 설정

### 8.1 해상도와 방향

설정에서 디스플레이 해상도를 실제 장치와 맞춥니다.

- 가로 TV/모니터: `1920 × 1080`, `1280 × 720`
- 세로 화면: `1080 × 1920`, `480 × 800`
- 특수 패널: 직접 입력

편집기 캔버스가 이 비율을 기준으로 표시되므로 실제 장치와 맞추는 것이 중요합니다.

### 8.2 성능 프로파일

- `고성능`: Pi 4/5, 미니PC 권장. Ken Burns 같은 애니메이션이 활성화됩니다.
- `저성능`: Pi 3, Zero 2 등. 폴링 간격을 늘리고 무거운 효과를 줄입니다.
- `자동`: 디스플레이 브라우저가 메모리/코어 수를 기준으로 추정합니다.

### 8.3 Home Assistant

설정 화면에서 Home Assistant 서버 URL과 장기 액세스 토큰을 저장합니다.

예:

```text
http://192.168.0.20:8123
```

그 다음 `홈어시스턴트` 위젯을 추가하고 엔티티 ID를 입력합니다.

```text
sensor.living_room_temperature
light.living_room
switch.air_purifier
```

토큰은 서버에만 저장되며 디스플레이 URL로 노출되지 않습니다.

### 8.4 사진 액자

사진 슬라이드쇼 위젯에서 다음 소스를 사용할 수 있습니다.

- `urls`: 이미지 URL 목록
- `local`: 서버의 `data/photos` 폴더
- `unsplash`: 키워드 기반 외부 이미지
- `immich`: Immich 서버와 API 키

로컬 사진을 쓰려면 서버 장치에 이미지를 넣습니다.

```sh
mkdir -p data/photos
cp *.jpg data/photos/
```

서버를 재시작할 필요 없이 다음 폴링 때 목록이 반영됩니다.

### 8.5 외부 페이지

외부 페이지 위젯은 `http/https` URL만 표시합니다. 샌드박스 모드는 다음 기준으로 고릅니다.

- `scripts`: 기본값. 스크립트는 허용하지만 같은 출처 권한은 주지 않습니다.
- `strict`: 가장 제한적입니다. 단순 정적 페이지에 적합합니다.
- `trusted`: 신뢰한 내부 서비스에만 사용하세요. `allow-same-origin`이 포함됩니다.

일부 사이트는 `X-Frame-Options` 또는 CSP 때문에 iframe 표시를 막을 수 있습니다. 이 경우 Paneo 문제가 아니라 해당 사이트의 보안 정책입니다.

## 9. 버전 확인

각 구성 요소는 독립적으로 버전을 가집니다. 서버에서 다음 API로 확인할 수 있습니다.

```sh
curl http://<server-ip>:4321/api/version
```

편집기 **설정** 패널에도 서버·편집기·디스플레이·에이전트 버전이 표시됩니다. 에이전트는 연결 시 자신의 버전을 서버에 보고합니다.

## 10. 네트워크와 보안

- 서버와 디스플레이는 같은 LAN에 두는 구성을 권장합니다.
- 외부 인터넷에 편집기를 그대로 노출하지 마세요.
- 외부 접속이 필요하면 HTTPS 리버스 프록시와 인증을 먼저 구성하세요.
- Home Assistant 토큰, Immich API 키는 신뢰한 관리자만 입력하세요.
- 디스플레이 URL의 토큰은 해당 화면을 표시할 수 있는 키입니다. 공개 채널에 공유하지 마세요.

## 11. 문제 해결

서버가 열리지 않을 때:

```sh
systemctl status paneo
journalctl -u paneo -f
```

포트가 맞는지 확인합니다.

```sh
ss -ltnp | grep 4321
```

디스플레이가 갱신되지 않을 때:

- 디스플레이 Pi가 `http://<server-ip>:4321/d/<token>`에 접속 가능한지 확인합니다.
- 편집기에서 **적용**을 눌렀는지 확인합니다.
- 서버 로그에서 WebSocket 연결 오류를 확인합니다.

에이전트가 연결되지 않을 때:

```sh
systemctl status paneo-agent
journalctl -u paneo-agent -f
```

`PANEO_SERVER`와 `PANEO_TOKEN` 값이 맞는지 확인합니다.

화면 전원 제어가 되지 않을 때:

- `vcgencmd display_power 0`을 직접 실행해 봅니다.
- Wayland라면 `wlr-randr` 설치 여부와 출력 이름을 확인합니다.
- X11이라면 `xset q`가 동작하는지 확인합니다.

외부 위젯이 비어 있을 때:

- URL이 `http://` 또는 `https://`인지 확인합니다.
- 해당 사이트가 iframe 임베드를 허용하는지 확인합니다.
- 샌드박스 모드를 `scripts` 또는 `trusted`로 바꿔 봅니다.

## 12. 업데이트

서버 장치에서 최신 코드를 받은 뒤 재시작합니다.

```sh
cd /home/pi/paneo
git pull
npm install
sudo systemctl restart paneo
```

에이전트 코드가 바뀐 경우 디스플레이 Pi에서 다시 설치하거나 `/opt/paneo-agent/agent.js`와 `version.json`을 갱신한 뒤 재시작합니다.

```sh
sudo systemctl restart paneo-agent
```

## 13. 현재 보류된 기능

RTSP/카메라 스트리밍은 아직 실제 장치 설치 범위에 포함하지 않습니다. 카메라 게이트웨이(`go2rtc`, `MediaMTX`)와 저성능 장치용 스냅샷 폴백은 후속 단계에서 다룹니다.
