# Paneo 서드파티 위젯 플러그인 (docs/design.md §7, D17)

Paneo는 내장 위젯 외에 **서드파티 위젯 플러그인**을 설치할 수 있습니다. 두 가지 유형이 있고, 신뢰 경계가 다릅니다.

| 유형 | 설치 방법 | 실행 위치 | 신뢰 수준 |
|---|---|---|---|
| `module` | 서버 파일시스템에 직접 폴더 설치 | 편집기/디스플레이 페이지에서 직접 실행 (샌드박스 없음) | 파일시스템에 넣는 행위 자체가 관리자의 신뢰 결정 — 내장 위젯과 동일 수준 |
| `iframe` | manifest에 외부 URL만 등록 | 샌드박스 `<iframe>` 안에서 실행 (`paneo.iframe`과 동일 메커니즘) | 파일시스템 접근 없음 — URL만 등록하면 되므로 가장 가벼움 |

## 설치 방법

1. `data/plugins/<플러그인id>/` 폴더를 만들고 `manifest.json`을 넣습니다. (`data/`는 런타임 데이터 디렉토리로, git에 커밋되지 않습니다 — 기기별로 필요한 플러그인만 설치하세요.)
2. `module` 타입이면 같은 폴더에 `entry`로 지정한 JS 파일(예: `widget.js`)도 넣습니다.
3. 서버를 재시작합니다. 플러그인은 서버 기동 시 1회 스캔됩니다(핫 리로드 없음 — 컴패니언 에이전트 설치와 같은 방식).
4. 편집기의 "+ 위젯 추가" 팝오버에 **서드파티** 카테고리로 나타납니다.

동작하는 예제가 [docs/examples/plugins/hello-badge/](examples/plugins/hello-badge/)에 있습니다. `data/plugins/hello-badge/`로 복사하고 서버를 재시작해 보세요.

## manifest.json 스키마

```json
{
  "id": "hello-badge",            // 필수. 폴더 이름과 반드시 일치해야 함
  "version": "1.0.0",             // 필수
  "type": "module",               // 필수. "module" | "iframe"
  "entry": "widget.js",           // type=module일 때 필수
  "url": "https://example.com/w", // type=iframe일 때 필수
  "sandboxMode": "scripts",       // type=iframe 전용. "strict" | "scripts" | "trusted"
  "label": { "ko": "...", "en": "..." },
  "icon": "🔌",
  "defaultSize": { "w": 3, "h": 2 }, // 필수
  "minSize": { "w": 2, "h": 1 },
  "requires": [],                 // 성능 프로파일 요구사항 태그 (§4.3)
  "permissions": [],              // 편집기 인스펙터에 검토용으로 표시됨
  "config": [                     // 인스펙터 자동 생성 폼 — 내장 위젯과 동일한 필드 형식
    { "key": "text", "label": { "ko": "문구", "en": "Text" }, "type": "text", "default": "" }
  ]
}
```

`config` 필드 `type`은 내장 위젯과 동일하게 `text`/`number`/`checkbox`/`enum`/`list`/`textarea`를 지원합니다 (`public/shared/widgets.js`의 인스펙터 렌더링 로직을 그대로 재사용).

## `module` 타입 작성법

`widget.js`는 `render(el, config, ctx)`를 export하는 ES 모듈입니다 — 내장 위젯과 완전히 같은 계약입니다.

```js
export function render(el, config, ctx) {
  // el: 이 위젯 인스턴스의 콘텐츠 엘리먼트
  // config: manifest의 config 필드값 (편집기 인스펙터에서 입력됨)
  // ctx: { locale, timezone, performanceProfile }
  el.textContent = config.text ?? '';
}
```

**샌드박스가 없습니다** — 이 코드는 편집기/디스플레이 메인 페이지에서 그대로 실행됩니다. `config` 값을 `innerHTML`에 꽂을 땐 직접 이스케이프하거나 `textContent`를 쓰세요(예제 참고). 정리(clear interval 등)가 필요하면 내장 위젯처럼 `el._cleanup = () => {...}`를 지정하세요 — `renderWidget()`이 다음 렌더 전에 자동으로 호출합니다.

## `iframe` 타입 작성법

파일시스템 설치 없이 `manifest.json`만으로 등록합니다:

```json
{
  "id": "external-dashboard",
  "version": "1.0.0",
  "type": "iframe",
  "url": "https://example.com/widget",
  "sandboxMode": "scripts",
  "defaultSize": { "w": 5, "h": 4 },
  "config": [{ "key": "room", "label": { "ko": "방", "en": "Room" }, "type": "text", "default": "" }]
}
```

`config` 값은 쿼리 스트링으로 `url`에 붙어 iframe에 전달됩니다(예: `?room=거실&locale=ko-KR`). 페이지 쪽에서 `location.search`로 읽으면 됩니다. `paneo.iframe`과 동일한 샌드박스 토큰(`strict`/`scripts`/`trusted`)을 사용합니다 — 신뢰하지 않는 사이트는 `strict`를 권장합니다.

> postMessage 기반 실시간 데이터 채널(iframe → config/data 양방향)은 아직 없습니다 — 현재는 최초 로드 시 쿼리스트링으로만 config가 전달됩니다. 향후 확장 후보입니다.
