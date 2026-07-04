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

**설치 내용:** Docker(없으면 설치) + Paneo 서버를 컨테이너로 실행하는 `paneo` systemd 서비스. 편집기·API·SQLite를 이 장치에서 제공합니다.

**이 장치에서만 실행:**

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh | sudo env PANEO_MODE=server bash
```

`latest` 대신 특정 릴리즈 버전을 고정하려면:

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/install.sh \
  | sudo env PANEO_MODE=server PANEO_IMAGE=ghcr.io/eigger/paneo:0.1.0 bash
```

설치 후 편집기: `http://<server-ip>:4321/` · 상태 확인: `systemctl status paneo` (또는 `docker logs -f paneo`)

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

`scripts/install-pi.sh`를 이미 받아 둔 경우(서버 역할은 나머지 소스 트리가 필요 없습니다 — 미리 빌드된 이미지를 그대로 씁니다):

```sh
sudo env PANEO_MODE=all PANEO_DEVICE_NAME="거실" bash scripts/install-pi.sh
```

옵션: `PANEO_PORT=8080`, `PANEO_TOKEN=<token>`(기존 화면), `PANEO_IMAGE=ghcr.io/eigger/paneo:0.1.0`, `PANEO_ENABLE_AGENT=0`, `PANEO_ENABLE_KIOSK=0`

---

아래 수동 설치 절차는 원클릭 스크립트를 쓰지 않거나 세부 설정을 직접 조정할 때 참고하세요.

## 3. 서버 설치

원클릭 `PANEO_MODE=server` 설치(§2)가 아래 내용을 그대로 대신 해줍니다 — 이 절은 직접 손으로
설정하거나 내부 동작을 이해하고 싶을 때 참고하세요.

### 3.1 준비

Docker가 필요합니다. 없으면 설치합니다.

```sh
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
```

### 3.2 Docker Compose로 실행

```sh
git clone https://github.com/eigger/paneo.git
cd paneo
docker compose pull   # 릴리즈 이미지(ghcr.io/eigger/paneo) 받기
docker compose up -d
```

- 편집기: `http://<server-ip>:4321/`
- 디스플레이: `http://<server-ip>:4321/d/<token>`

`docker-compose.yml`은 SQLite·사진·플러그인을 named volume(`paneo-data:/data`)에 영속화하고
`restart: unless-stopped`로 자동 재시작합니다 — 이 방식으로 관리하면 별도 systemd 유닛이 필요 없습니다.

### 3.3 또는: `docker run`을 감싸는 systemd 서비스 등록

원클릭 설치 스크립트가 `/etc/systemd/system/paneo.service`에 실제로 써주는 내용입니다 —
Compose 대신 `systemctl`/`journalctl`로 관리하고 싶을 때 씁니다.

```ini
[Unit]
Description=Paneo Server (Docker)
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
ExecStartPre=-/usr/bin/docker rm -f paneo
ExecStart=/usr/bin/docker run --rm --name paneo -p 4321:4321 -v paneo-data:/data ghcr.io/eigger/paneo:latest
ExecStop=/usr/bin/docker stop -t 10 paneo
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now paneo
sudo systemctl status paneo
```

로그: `journalctl -u paneo -f` 또는 `docker logs -f paneo`

### 3.4 대안: Docker 없이 Node.js로 직접 실행

권장 경로는 아니지만, 서버 자체가 Docker에 강하게 의존하진 않습니다 — Docker 지원이 약한 하드웨어이거나 Node를 직접 관리하고 싶을 때 사용하세요. Node.js 22.5 이상 또는 24 이상이 필요합니다(`node:sqlite` 내장 모듈 사용):

```sh
git clone https://github.com/eigger/paneo.git
cd paneo
npm install
PORT=4321 npm start
```

systemd로 등록하려면 위 유닛의 `ExecStart`를 `ExecStart=/usr/bin/npm start`로 바꾸고,
`WorkingDirectory=`는 clone한 경로로, `User=`는 root가 아닌 계정으로 지정하세요.

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

### 8.6 홈어시스턴트에서 화면 전원 제어하기

§8.3은 HA 데이터를 Paneo 위젯으로 가져오는 방향입니다. 반대로 HA 자동화에서 Paneo 디스플레이를 켜고 끄는 건 Paneo 쪽 코드 변경이 필요 없습니다 — 에디터의 "화면 켜기"/"화면 끄기" 버튼도 평범한 REST 엔드포인트를 호출할 뿐이라, HA가 `rest_command`로 같은 엔드포인트를 직접 호출하면 됩니다.

1. 화면의 내부 device ID를 확인합니다 (페어링 토큰이 아닙니다):

   ```sh
   curl http://<서버-IP>:4321/api/devices
   ```

   `name`으로 원하는 기기를 찾아 `id` 값을 기록하세요.

2. 홈어시스턴트 `configuration.yaml`에 `rest_command`를 추가합니다:

   ```yaml
   rest_command:
     paneo_screen_on:
       url: "http://<서버-IP>:4321/api/devices/<device-id>/command"
       method: POST
       content_type: "application/json"
       payload: '{"action": "power", "on": true}'
     paneo_screen_off:
       url: "http://<서버-IP>:4321/api/devices/<device-id>/command"
       method: POST
       content_type: "application/json"
       payload: '{"action": "power", "on": false}'
   ```

3. 이제 어떤 HA 자동화·스크립트·대시보드 버튼에서든 `rest_command.paneo_screen_on` / `rest_command.paneo_screen_off`를 호출하면 됩니다.

해당 화면에 컴패니언 에이전트가 설치되어 연결되어 있어야 합니다(§6) — 에디터 자체의 전원 버튼과 완전히 같은 경로로 에이전트에 명령이 전달됩니다. 에디터 자체가 LAN 내에서 의도적으로 인증 없이 열려 있으므로(§10) 이 엔드포인트도 별도 접근 제어가 없습니다 — 에디터를 노출할 때와 동일하게 LAN 내부로만 두거나, LAN 밖에서 접근해야 한다면 리버스 프록시·VPN을 앞에 두세요.

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
docker logs -f paneo                # Docker로 실행 중이라면
docker ps -a --filter name=paneo    # 컨테이너 자체가 떴는지 확인
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

### 12.1 원클릭 (§2로 설치한 장치)

라즈베리파이 본체에서 실행 — 서버 이미지, 컴패니언 에이전트, (`all` 모드일 때) 코덱과 키오스크 브라우저 재시작까지
한 번에 갱신하며 데이터(SQLite DB, 사진, 플러그인)는 그대로 유지됩니다.

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/scripts/update-pi.sh | sudo bash
```

서버 전용 장치(코덱 설치·키오스크 런처·브라우저 재시작 등 키오스크 관련 단계를 모두 건너뜀):

```sh
curl -fsSL https://raw.githubusercontent.com/eigger/paneo/master/scripts/update-pi.sh | sudo bash -s server
```

이 라즈베리파이에 서버가 이미 실행 중이라면 GitHub 대신 서버 자신에게서 스크립트를 받아올 수 있습니다.

```sh
curl -fsSL http://localhost:4321/update.sh | sudo bash
```

### 12.2 편집기에서 (SSH 불필요)

디스플레이의 컴패니언 에이전트가 연결되어 있다면, 편집기 ⚙ **설정** 패널에 **전체 업데이트**/**서버만 업데이트**
버튼이 나타나 기존 웹소켓 연결을 통해 동일한 `update-pi.sh`를 원격 실행합니다 — 이미 설치가 끝난 장치를
SSH 접속 없이 갱신할 때 유용합니다. 새 버전이 있는지도 버튼을 누르기 전에 편집기에서 바로 확인할 수 있습니다.

### 12.3 수동 (설치 스크립트/Docker Compose 미사용)

서버 장치에서 최신 릴리즈 이미지를 받은 뒤 재시작합니다.

```sh
docker pull ghcr.io/eigger/paneo:latest
sudo systemctl restart paneo
```

systemd 대신 Docker Compose로 운영 중이라면:

```sh
cd /path/to/paneo   # docker-compose.yml이 있는 위치
docker compose pull
docker compose up -d
```

(§3.4처럼 Docker 없이 설치했다면: 저장소 디렉터리에서 `git pull` → `npm install` →
`sudo systemctl restart paneo`.)

에이전트 코드가 바뀐 경우 디스플레이 Pi에서 다시 설치하거나 `/opt/paneo-agent/agent.js`와 `version.json`을 갱신한 뒤 재시작합니다.

```sh
sudo systemctl restart paneo-agent
```

## 13. 현재 보류된 기능

RTSP/카메라 스트리밍은 아직 실제 장치 설치 범위에 포함하지 않습니다. 카메라 게이트웨이(`go2rtc`, `MediaMTX`)와 저성능 장치용 스냅샷 폴백은 후속 단계에서 다룹니다.
