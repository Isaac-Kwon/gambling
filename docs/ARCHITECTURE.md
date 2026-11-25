# ARCHITECTURE — 설계·결정 문서 (구현 에이전트용)

> 작성 2026-11-24. 구현 에이전트는 이 문서를 **문자 그대로** 따른다.
> 우선순위: **사용자 결정 > `docs/CONTEXT.md` > 이 문서 > `docs/BASE_PROMPT.md`.** 이 문서가 BASE_PROMPT와 다르면 이 문서가 맞다(차이는 §14에 기록).
> 구현 중 이 문서와 다르게 해야 할 이유가 생기면 고치지 말고 `docs/DECISIONS.md`에 한 줄을 남기고 보고한다.
>
> **개정 2026-11-24 (사용자 답변 반영).** 바뀐 곳:
> (1) **PixiJS v8 유지** — 탭 게이트 뒤 지연 로드하는 장식 계층으로 재설계: §1.1~§1.4, §2.3, §4, §6.1, §6.3~§6.6, §9.3, §11, §12.
> (2) **심해전설의 남은 큐는 종료 시 일괄 지급**(몰수 없음): §5.3, §5.5, §5.6, §6.2, §6.3, §8.1, §8.3, §8.4, §10.6, §11, §12.
> (3) **슬롯 체감 변형 a·b를 둘 다 구현**(`?sv=b`, `Session.sv`), 변형 b의 띠·페이테이블 확정: §5.1, §5.3, §5.6, §6.2, §6.3, §7, §10, §11, §12.
> (4) 이름 승인, (5) CI 기준 변경 승인: §13에서 §14로 옮김.

## 0. 공통 규칙

### 0.1 URL·경로 (사용자 확정)
| 대상 | 개발(`/`) | 배포 |
|---|---|---|
| 로비 + 게임 5종 (gambling 페이지) | `/index.html` | `https://isaack.dev/gambling/` |
| 해석 페이지 | `/understanding/index.html` | `https://isaack.dev/gambling/understanding/` |

- gambling의 HTML 엔트리는 저장소 루트 `/index.html`이고, 소스는 `/gambling/src`, `/gambling/fx`, `/gambling/games`에 둔다. 리다이렉트는 없다.
- 모든 내부 URL은 `import.meta.env.BASE_URL`로 만든다. 절대 경로 `/…`를 문자열로 쓰지 않는다.
- 이 문서에서 "gambling"은 페이지 이름이고, 배포 경로의 `/gambling/`은 저장소 이름이다. 둘을 혼동하지 않는다.

### 0.2 조정자 전용 파일 (구현 에이전트는 수정 금지, 필요한 변경은 보고서에 적는다)
`package.json`, `package-lock.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `.github/**`, `docs/**`, `shared/i18n.ts`, `shared/i18n.gambling.ts`, `shared/i18n.understanding.ts`.

### 0.3 중립 이름 규칙 (gambling과 shared 전체)
압축 후에도 남는 것은 **문자열 리터럴, 객체 키, CSS 클래스, data 속성, i18n 키, 파일 이름**이다. 이들에 해석 용어를 쓰지 않는다.
| 쓰지 않는다 | 대신 쓴다 |
|---|---|
| `nearMiss` | `dispVar` |
| `ldw`, `disguised` | `celebrate` (+ `payout < bet`은 understanding이 계산) |
| `houseEdge`, `rtp` (gambling이 import하는 코드 경로에서) | `edge`, 또는 scripts·understanding 전용 함수 안에서만 사용 |
| `fake*`, `bait` | `amb`(ambient), `ticker`, `crowd` |
| `anticipation`을 설명하는 문장 | `antic` (파일 이름 `anticipation.ts`는 허용) |

`shared/`는 두 페이지가 함께 쓰므로 gambling과 같은 규칙을 적용한다. understanding 전용 설명 문자열은 `understanding/`과 `i18n/understanding/`에만 둔다.

### 0.4 import 경계
- `gambling/**` → `shared/**`, `i18n/gambling/**`만 import 가능. `understanding/**`, `i18n/understanding/**`, `shared/i18n.understanding.ts` import 금지.
- `shared/**` → `gambling/**`, `understanding/**` import 금지.
- `understanding/**` → `shared/**`만. gambling 코드는 import하지 않는다(데모 세션은 빌드 시점 JSON, §10.4).
- 이 경계는 `scripts/check-gambling-bundle.ts`의 소스 검사 단계와 Vitest 테스트로 강제한다(§11.3).

## 1. 빌드·번들 순수성·PWA

### 1.1 Vite 설정 변경 요청 (조정자)
- `build.rollupOptions.output.chunkFileNames = 'assets/c-[hash].js'` — 공유 청크 이름에 모듈 이름이 새지 않게 한다.
- `build.sourcemap = false`.
- `pixi.js`(^8.23)는 **그대로 둔다**(§4). Pixi는 동적 import 하나로만 들어오므로 `manualChunks`로 따로 묶지 않는다(묶으면 정적 폐포에 끌려 들어올 수 있다). `@fontsource/lilita-one`, `@fontsource/press-start-2p` 추가(§2.4).
- npm 스크립트: `"rtp": "tsx scripts/rtp-check.ts"`, `"check:bundle": "tsx scripts/check-gambling-bundle.ts"`, `"gen:icons"`, `"gen:demo"`, `"e2e": "playwright test"`.

### 1.2 "gambling 산출물"의 정의 (금지어 검사 대상)
로비가 루트에 있으므로 `dist/gambling/**`를 훑는 방식은 쓸 수 없다. `scripts/check-gambling-bundle.ts`는 다음 순서로 대상을 정한다.
1. `dist/.vite/manifest.json`을 읽고 `src === "index.html"`이며 `isEntry`인 항목에서 시작한다.
2. `imports`와 `dynamicImports`를 재귀로 따라가며 각 항목의 `file`, `css[]`, `assets[]`를 모은다. understanding과 공유하는 청크도 여기에 포함된다. 게임 청크와 Pixi 청크(그리고 Pixi가 내보내지만 실행 중에는 받지 않는 청크, §4.2)도 `dynamicImports`로 따라가므로 금지어 검사 대상이다.
3. 고정 대상 추가: `dist/index.html`, `dist/404.html`, `dist/manifest.webmanifest`.
4. Phase 6 이후 추가: `dist/sw.js`, `dist/workbox-*.js`. 이 두 종류는 precache 목록에 경로가 들어가므로 **`understanding` 규칙만 면제**하고 나머지 금지어는 검사한다.
5. 텍스트 파일(`.js .css .html .webmanifest .json .svg`)만 검사하고 바이너리(`.woff2 .png`)는 건너뛴다.

### 1.3 금지어 (대소문자 무시, 별도 표기 제외)
- BASE_PROMPT 목록: `교육`, `중독`, `하우스 엣지`, `house edge`, `near-miss`, `니어미스`, `LDW`(대소문자 구분, 단어 경계), `1336`(앞뒤가 숫자·소수점이 아닐 때), `바다이야기`, `understanding`(아래 특례).
- **허용 문구 (2026-11-25):** `i18n/gambling/notice.{ko,en,it}.json`의 값(제작 목적, 도박 중독 경고, 1336 안내)은 정확히 그 문자열일 때만 금지어 검사에서 뺀다(`noticePhrases` → `scanText`의 `allowPhrases`; 원문, JSON 이스케이프, `\uXXXX` 형태). 다른 곳에 같은 단어가 나오면 여전히 실패한다.
- 추가: `하우스엣지`, `houseEdge`, `near miss`, `nearMiss`, `도박`, `예방`, `치유`, `오개념`, `기댓값`, `퀴즈`, `해설`, `실험`, `educat`, `addict`, `helpline`, `fallacy`, `debrief`, `disguised`, `RTP`(대소문자 구분, 단어 경계).
- **`understanding` 특례:** gambling 그래프의 JS 전체에서 등장 횟수가 **1회 이하**이고, 그 1회는 바로 뒤에 `/`가 붙은 형태(`understanding/`)여야 한다. 이 문자열은 `gambling/src/cashout.ts`의 `const DETAIL_PATH = 'understanding/'` 한 곳에만 둔다. HTML과 매니페스트에서는 0회.
- 외부 요청 검사: gambling 산출물과 understanding 산출물 모두에서 `https?://`를 찾고, 허용 목록(`http://www.w3.org/`로 시작하는 XML 네임스페이스, understanding의 출처 링크, **Pixi 청크 안의 `http://www.pixijs.com/`** — 콘솔 인사말용 문자열이며 `hello: false`라 출력도 요청도 없다. 2026-11-24 빌드 실측에서 Pixi 청크의 URL은 이것뿐이고 금지어는 0건)에 없으면 실패.
- Workbox 런타임(`dist/workbox-*.js`)의 `console.warn` 안 `https://bit.ly/wb-…` 링크는 허용 목록에 넣지 않고 `vite.config.ts`의 `stripWorkboxLinks`가 빌드 뒤 지운다(2026-11-25) — 외부 URL 규칙을 느슨하게 하지 않기 위해.
- 금지 API 검사(dist의 모든 JS): `Notification`, `PushManager`, `setAppBadge`, `periodicSync`, `storage.persist`.
- **예산 (개정):** 재는 대상은 `index.html` 엔트리의 **정적 import 폐포**다 — 매니페스트에서 `imports`만 재귀로 따라간 JS 파일의 gzip(레벨 9) 합계. `dynamicImports`는 넣지 않는다. **250KB 초과는 실패**(초과를 받아들이려면 조정자가 DECISIONS에 기록하고 `--budget`으로 올린다).
  - **Pixi 청크는 따로 출력한다:** 매니페스트의 `gambling/fx/gl/stage.ts` 동적 엔트리(`isDynamicEntry`)에서 `imports`만 따라간 폐포에서 엔트리 폐포를 뺀 것. 기준값 91KB(§4.2 실측). 110KB를 넘으면 경고를 출력한다(실패 아님. 금지한 Pixi 모듈이 들어왔다는 신호다).
  - **Pixi 격리 검사(실패 조건, `gambling/fx/gl/stage.ts`가 생기는 Phase 2부터):** ① `gambling/fx/gl/stage.ts` 항목이 매니페스트에 `isDynamicEntry`로 있어야 하고, ② 엔트리의 정적 폐포에 그 항목이 없어야 하며, ③ 정적 폐포의 어떤 JS에도 문자열 `pixijs.com`이 없어야 한다.
  - 게임별 청크, CSS, 폰트 크기도 함께 출력한다(정보용).

### 1.4 PWA (Phase 6)
- 매니페스트 1개. `id = start_url = scope = base`(배포 시 `/gambling/`). `display: "fullscreen"`, `display_override: ["fullscreen","standalone"]`, `orientation: "portrait"`, `theme_color = background_color = "#0B0612"`, `lang: "ko"`.
- Workbox `generateSW`:
  - `globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}']`, `globIgnores: ['404.html']`.
  - `navigateFallback: 'index.html'`, `navigateFallbackDenylist: [/\/understanding(\/|$)/]`.
  - `ignoreURLParametersMatching: [/^(seed|fx|lang|demo|sv)$/]` — `understanding/?demo=1` 같은 주소가 precache된 `understanding/index.html`에 맞도록 한다.
  - Pixi 청크도 precache에 들어간다(오프라인에서도 연출이 나온다). Pixi가 내보내지만 받지 않는 청크(§4.2, gzip 약 16KB)도 함께 들어가는데, 이름이 해시라 골라낼 수 없으므로 그대로 둔다. precache는 서비스 워커가 받는 것이고 페이지가 Pixi를 실행하는 것이 아니므로 `?fx=off` 규칙(§6.5)과 충돌하지 않는다.
  - understanding은 하위 경로를 만들지 않는다(섹션 이동은 해시). 그래서 `understanding/*`의 폴백은 precache의 디렉터리 인덱스로 충분하다.
  - `skipWaiting: false`, `clientsClaim: false`, `cleanupOutdatedCaches: true`.
- `registerType: 'prompt'`, `injectRegister: false`. 두 엔트리의 `main.ts`가 `virtual:pwa-register`의 `registerSW({ immediate: false })`를 콜백 없이 호출한다. 새 서비스 워커는 모든 창이 닫힌 뒤(다음 실행 때) 적용된다.
- 내부 링크는 항상 끝에 `/`를 붙인 `understanding/`을 쓴다.
- 검증은 `BASE_PATH=/gambling/ vite build && vite preview`로 한다.

## 2. 브랜드와 비주얼

### 2.1 가상 카지노
| 항목 | 값 |
|---|---|
| 이름 | **오로벨 카지노 / OROBELLE CASINO** — 사용자 승인(2026-11-24). (이탈리아어 oro "금" + belle. 2026-11-24 웹 검색에서 같은 이름의 카지노·게임 브랜드를 찾지 못했다) |
| `name` | `OROBELLE 오로벨 카지노` |
| `short_name` | `오로벨` |
| `description` | `네온 불빛 아래 펼쳐지는 슬롯, 룰렛, 블랙잭, 크래시. 지금 오로벨에서 잭팟의 주인공이 되세요!` |
| 슬로건(게이트 화면) | `TONIGHT IS YOUR NIGHT` |
| 엠블럼 | 금색 종(bell) 실루엣 안에 별 하나. `public/icons/icon.svg`로 직접 그린다 |

현재 스캐폴드의 임시 이름 "Lucky Palace / 럭키 팰리스"는 실존 업소와 겹칠 수 있으므로 Phase 2에서 모두 바꾼다(`index.html`의 `<title>`, `i18n`의 `app.title`).

게임 표시 이름: 슬롯 **ORO SEVENS(오로 세븐즈)**, 룰렛 **RUBY ROULETTE**, 블랙잭 **BLACKJACK 21**, 크래시 **SKYROCKET**, 해양 아케이드 **심해전설**(§3). 로비 섹션은 "카지노관"(앞의 넷)과 "아케이드관"(심해전설)이다.

### 2.2 팔레트 (CSS 변수, `gambling/src/ui/theme.css`)
| 변수 | 값 | 용도 |
|---|---|---|
| `--bg` | `#0B0612` | 배경, theme-color |
| `--surface` / `--surface-2` | `#1A0F2B` / `#2A1745` | 카드, 패널 |
| `--gold-1/2/3` | `#FFE9A6` / `#F5C542` / `#B8791A` | 금색 그라데이션(위→아래), 주요 버튼, 당첨 숫자 |
| `--red` / `--crimson` | `#E0183C` / `#FF2D55` | 강조, CASH OUT, HOT 배지 |
| `--magenta` / `--cyan` / `--violet` | `#FF3DA5` / `#29E6FF` / `#7A3CFF` | 네온 선 |
| `--win` | `#3DFF8A` | 잔고 증가 표시 |
| `--text` / `--muted` | `#FFF6E0` / `#A99BC2` | 본문 |

understanding 팔레트(`understanding/src/style.css`): 바탕 `#FFFFFF`, 본문 `#1C1C1E`, 보조 `#6B7280`, 선 `#E5E7EB`, 강조색 하나 `#1F4FD8`. 그림자·그라데이션·애니메이션을 쓰지 않는다.

### 2.3 네온·글로우 방식
- 글로우는 **정적 레이어**로 만든다: `text-shadow`/`filter: drop-shadow`를 2~3겹 쌓은 요소를 미리 그려 두고, 애니메이션은 그 레이어의 `opacity`와 `transform`만 바꾼다. `blur` 반경, `box-shadow`, `filter` 값을 프레임마다 바꾸지 않는다.
- 위 규칙은 DOM 쪽 글로우(글자, 버튼, 릴 테두리, 당첨 라인)에 적용한다. 광선·빛 번짐·코인·컨페티는 Pixi 장식 계층(§4)이 가산 합성 스프라이트로 그린다. 캔버스 요소에는 `mix-blend-mode`를 걸지 않는다(전체 프레임 오프스크린 합성 비용).
- 무한 반복 애니메이션 가운데 `opacity|filter|background|color|box-shadow`를 바꾸는 것은 주기 1초 이상, ease-in-out만 허용(§6.6 점멸 규칙). transform만 바꾸는 반복(코인 회전 등)은 제한 없음.
- 금색 글자: `background: linear-gradient(var(--gold-1), var(--gold-2) 55%, var(--gold-3)); -webkit-background-clip: text` + 어두운 외곽선(`-webkit-text-stroke` 또는 겹친 복제 요소).

### 2.4 타이포그래피
| 용도 | 글꼴 | 방식 |
|---|---|---|
| 로고, 등급 배너, 숫자(잔고·당첨액·배수) | **Lilita One** (OFL) | `@fontsource/lilita-one/latin-400.css`만 import |
| 심해전설 캐비닛 LED 표시 | **Press Start 2P** (OFL) | `@fontsource/press-start-2p/latin-400.css`, ocean 청크에서만 import |
| 한글 전부 | 시스템 스택 | `system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif` |
| understanding | 시스템 스택만 | 웹폰트 없음 |

- 근거: 한글 웹폰트는 서브셋을 해도 수백 KB~수 MB이므로 싣지 않는다. 라틴 서브셋 woff2 두 개는 합쳐 약 30KB 이하로 예상한다(Phase 2에서 실측해 DECISIONS에 기록, 합계 40KB 초과 시 보고). 폰트는 JS 예산(250KB)에 들어가지 않지만 precache 용량과 첫 화면에 영향을 주므로 `font-display: swap`으로 둔다.
- 한글 제목은 시스템 글꼴 굵게(800~900) + §2.3의 금색 글자 처리로 꾸민다.
- 카운트업 숫자는 자릿수마다 고정 폭 칸(`inline-block; width: .62em; text-align: center`)에 넣어 흔들리지 않게 한다.

### 2.5 화면 틀
- `#frame { width: min(100vw, 430px); height: min(100dvh, 932px); }`를 가운데 두고, 바깥은 `--bg` 위에 흐린 빛망울 배경을 깐다(데스크톱·태블릿). safe-area 패딩은 `#frame` 안쪽에 적용한다.
- 가로 모드이고 높이가 480px 미만이면 게임을 멈추고 카지노풍 "세로로 돌려주세요" 덮개를 띄운다(레이아웃이 깨지지 않는 방법으로 이 방식을 택한다).
- 터치 억제(`touch-action: manipulation`, `overscroll-behavior: none`, `user-select: none`, `-webkit-touch-callout: none`)는 `#frame`에만 건다.

## 3. 해양 아케이드 머신 "심해전설"

- 이름: **심해전설 (ABYSS LEGEND)** — 사용자 승인(2026-11-24). "바다이야기"를 비롯한 실제 기기 이름·그래픽·캐릭터·음악은 쓰지 않는다. 2026-11-24 검색에서 같은 이름의 기기를 찾지 못했다.
- 팔레트: `#021B2E`(심해), `#06304A`, 청록 `#19D3C5`, 산호 `#FF6B5E`, 진주 `#F4EDE0`, 금 `#FFC83D`.
- **캐비닛 프레임(코드로 그린 SVG·CSS):** 위에는 뒤에서 빛나는 간판(청록+금 글자), 가운데는 크롬 테두리 베젤과 화면, 화면 위에 정적인 주사선·비네트 덮개(불투명도 낮게), 아래는 조작 패널. 조작 패널의 둥근 아케이드 버튼 3개(BET / START / STOP)가 **실제 조작 버튼**이고 엄지 영역에 놓인다. 패널 왼쪽에 동전 투입구 장식, 오른쪽에 티켓 배출구(상품권이 나오는 자리). 크레딧 표시는 Press Start 2P의 LED 풍.
- **릴 심볼(슬롯 심볼 ID에 스킨만 입힌다, §7.1):** `7`→황금 진주, `W`→보물상자, `B`→해마, `R`→거북, `C`→문어, `H`→불가사리, `s h c d`→소라·산호·닻·물방울. 굵은 외곽선의 단순한 도형으로 직접 그린다.
- **예시 생물 3종과 기대 등급** — 생물은 보너스 총액 구간에 따라 **결정적으로** 정해진다(연출 난수를 쓰지 않는다). 예시는 보너스 시퀀스가 실제로 있을 때만 나온다(가짜 예시 없음).

| 생물 | 총액 구간(트리거 판 베팅 대비) | 풀리는 판 수 | 연출 |
|---|---|---|---|
| 대왕조개 `clam` | 5×, 10×, 15× | 3~5 | 화면이 30% 어두워지고 바닥에서 조개가 천천히 열리며 진주 빛이 샌다. 1.8초 |
| 상어 `shark` | 30×, 50×, 100× | 4~7 | 55% 암전, 실루엣이 빠르게 가로지른다. 심장박동음. 2.4초 |
| 고래 `whale` | 250×, 500×, 1250× | 6~10 | 75% 암전, 화면보다 큰 실루엣이 느리게 지나간다. 저음 드론과 합성한 울음소리. 4초 |

  암전은 600ms 이상에 걸쳐 서서히 바뀌므로 점멸이 아니다(§6.6).
- **상품권 티켓(가상 디자인):** 가로로 긴 감열지 띠. 크림색 바탕, 청록 물결 무늬, 진주조개 문양, 문구 `심해전설 상품권`, 액면 `5,000`, 연출 스트림으로 만든 일련번호 `AL-000000`, 절취선. 실제 상품권의 이름·색·배치를 흉내 내지 않는다. 한 판 지급액이 그 판 베팅의 10배 이상이면 티켓 `clamp(round(payout / (5 × bet)), 2, 12)`장이 배출구에서 이어져 나온다. 지급은 평소대로 크레딧 지갑에 들어가고 티켓은 연출일 뿐이다. `disp.ticket = 장수`.

## 4. 이펙트 엔진 결정

**결정(사용자, 2026-11-24): PixiJS v8(WebGL)을 쓴다.** 초안의 "DOM + Canvas 2D" 제안은 채택되지 않았다. 다만 Pixi는 화면 전체가 아니라 **장식 계층 한 장**만 그리고, **탭 게이트 뒤에 동적 import로 지연 로드**한다. 그래서 첫 로딩 정적 JS는 250KB 예산 안에 남고, `?fx=off`와 헤드리스 테스트는 Pixi 없이 돈다.

### 4.1 무엇을 누가 그리나
**규칙: Pixi가 그리는 것에는 게임 정보가 하나도 없다.** Pixi 계층을 통째로 빼도(fx=off, 로드 전, WebGL 없음, 컨텍스트 손실) 게임은 완전히 보이고 조작된다.

| 그리는 쪽 | 대상 |
|---|---|
| **DOM·SVG·CSS** (게임 `view.ts`, HUD, `fx`의 DOM 백엔드) | 릴과 심볼, 카드, 칩, 룰렛 휠과 베팅판, **크래시 그래프 곡선과 배수 숫자**(SVG `path` + 글자), 잔고, 버튼, 등급 배너 글자, 카운트업 숫자, 당첨 라인 강조, 릴 테두리 발광(§2.3의 정적 글로우), 화면 흔들림(`transform`), 점멸 덮개(`fx.flash`), 심해전설의 암전·생물 실루엣·티켓 띠 |
| **Pixi** (`gambling/fx/gl/stage.ts`) | 파티클(코인 분수, 컨페티, 물방울, 날리는 티켓 조각, 불꽃), 광선(회전하는 쐐기 스프라이트), 글로우·빛 번짐 덮개(미리 흐리게 구운 스프라이트의 가산 합성), 크래시 로켓 끝의 배기 불꽃(`antic` `rise`의 장식분) |

- 근거: 릴·카드·잔고가 DOM에 있어야 Playwright가 상태를 읽고, fx=off가 같은 DOM을 쓴다. 글자는 DOM이 선명하다. Pixi는 DOM으로 하기 비싼 것(수백 개 스프라이트, 가산 합성)만 맡는다.
- **필터(BlurFilter·블룸)는 기본 구성에 넣지 않는다.** 글로우는 아틀라스에 미리 흐리게 구운 텍스처를 `blendMode = 'add'`로 겹쳐서 낸다(전체 화면 필터 패스는 중급 기기의 필레이트를 먹는다). 품질 2 전용 블룸을 더할지는 P2-C1이 실기기에서 재고 정한다(`BlurFilter` + `pixi.js/filters` 추가 비용 실측 +5.6KB gzip).

### 4.2 Pixi v8 import 규칙 (번들 크기)
이 저장소의 pixi.js 8.23.0 + Vite 8로 실측(gzip 레벨 9, 2026-11-24).

| 구성 | Pixi 청크 gzip |
|---|---|
| **채택:** `WebGLRenderer, Container, Sprite, Texture, Rectangle, ParticleContainer, Particle` | **91KB** |
| + `BlurFilter`와 `import 'pixi.js/filters'` | 96KB |
| + `MeshRope` | 93KB |
| + `Graphics` | 113KB |
| `Application` + `autoDetectRenderer` | 117~138KB, 그리고 WebGPU·Canvas 렌더러 청크가 따로 생긴다 |

```ts
// gambling/fx/gl/stage.ts — 저장소에서 'pixi.js'를 import하는 유일한 파일
import { WebGLRenderer, Container, Sprite, Texture, Rectangle, ParticleContainer, Particle } from 'pixi.js';
import 'pixi.js/particle-container';   // 파이프 등록. 8.23에서는 ParticleContainer 모듈이 스스로 등록하므로 크기 변화 없음(버전이 바뀌어도 동작하게 명시)

const renderer = new WebGLRenderer();
await renderer.init({
  canvas, width: cssW, height: cssH, resolution,      // resolution = min(devicePixelRatio, 2)
  backgroundAlpha: 0, antialias: false, preserveDrawingBuffer: false,
  hello: false, skipExtensionImports: true,            // browserAll(accessibility, dom, events, filters)을 받지 않는다
});
```
- **쓰지 않는다:** `Application`, `autoDetectRenderer`(WebGPU·Canvas 렌더러 청크를 만든다), `Graphics`(+22KB), `Text`/`BitmapText`/`HTMLText`, `Assets`, `Ticker`(프레임은 `Clock.frame`이 준다), 이벤트 시스템(캔버스는 `pointer-events: none`), `pixi.js/app` 등 다른 서브패스, `pixi.js/advanced-blend-modes`(`'add'`는 기본 블렌드다).
- 루트 `'pixi.js'`에서 이름으로 import하면 패키지의 `sideEffects` 목록 덕분에 쓰지 않는 모듈이 빠진다. `lib/` 깊은 경로는 패키지 `exports`에 없으므로 import하지 않는다.
- `skipExtensionImports: true`여도 `browserAll` 등 **실행 중에는 받지 않는 동적 청크**(gzip 약 16KB)가 dist에 생긴다(Pixi 내부의 `import()` 문 때문). 예산에 넣지 않고, 금지어 검사와 precache에는 들어간다(§1.2, §1.4).
- **텍스처는 전부 Canvas 2D로 구운 아틀라스 한 장**(`gl/atlas.ts`, 1024×1024 이하, 게이트 탭 뒤 한 번만 굽는다): 코인 회전 8프레임, 컨페티 조각 4종, 광선 쐐기, 부드러운 글로우 원 2종, 물방울, 티켓 조각, 불꽃. `Texture.from(canvas)` 뒤 `new Texture({ source, frame: new Rectangle(...) })`로 잘라 쓴다. v8의 `ParticleContainer`는 한 컨테이너 안의 파티클이 같은 텍스처 소스를 써야 하므로 아틀라스가 한 장이어야 한다.
- 장면 구성: `ParticleContainer` 2개(보통 합성: 코인·컨페티·티켓·물방울 / 가산 합성: 불꽃) + `Sprite` 몇 개(광선, 글로우). 드로 콜 3~5회.
- **2026-11-24 헤드리스 Chrome(SwiftShader WebGL)에서 확인한 것:** 위 구성 그대로 `init` → 아틀라스 스프라이트(가산)와 파티클 250개 렌더, `renderer.resize(w, h, resolution)`, `WEBGL_lose_context`로 손실시킨 동안의 `render()`는 예외 없음, 복구 뒤 Pixi가 스스로 자원을 다시 올려 같은 화면을 그림, `destroy(true)`.

### 4.3 지연 로드와 `?fx=off`
- `gambling/fx/gl/loader.ts`(정적 폐포에 들어가는 작은 파일, Pixi를 import하지 않는다):
```ts
export interface GfxLayer {
  readonly alive: boolean;                                   // 컨텍스트 손실 중이면 false
  emit(kind: string, n: number, at: DOMRect | null, ms: number): number;   // 실제로 내보낸 개수(상한·품질로 줄어들 수 있다)
  glow(at: DOMRect | null, k: number, ms: number): void;     // 가산 글로우·배기 불꽃
  frame(dtMs: number): void;                                 // 살아 있는 것이 있을 때만 시뮬레이션 + render
  resize(cssW: number, cssH: number): void; setQuality(q: 0 | 1 | 2): void;
  suspend(): void; resume(): void; stop(): void; destroy(): void;
}
export function loadGfx(host: HTMLElement, o: { quality: Quality; pre: Rng; onLost(): void }): Promise<GfxLayer | null>;
// WebGL 생성자가 없으면 청크를 받지 않고 null. 있으면 `await import('./stage')` → init 실패 시 null. 절대 reject하지 않는다.
```
- **호출 시점:** 게이트의 `pointerup` 핸들러에서 `sfx.unlock()`과 세션 시작을 한 **뒤** `void loadGfx(...)`를 부른다. 로비는 기다리지 않고 바로 뜬다. 로드가 끝나면 `#gfx`에 캔버스를 붙이고 DOM 백엔드의 `gfx` 자리에 넣는다. 그 전의 `emit`은 0을 돌려주고(파티클 생략, 기록 없음) 배너·카운트업·소리는 정상으로 나온다.
- **`?fx=off`에서는 `loadGfx`를 부르지 않는다.** `main.ts`의 분기는 한 곳이다: fx=off → `createNullFx()`만 만들고 끝, fx=on → `createFx(createDomBackend(...))`를 만들고 게이트 탭에 `loadGfx`를 건다. fx=off 세션에서는 Pixi 청크를 요청하지도 실행하지도 않고 `<canvas>`도 없다(E2E로 확인, §11.4).
- 'pixi.js' import는 `gl/stage.ts` 한 파일에만, `gl/stage.ts`를 가리키는 것은 `gl/loader.ts`의 `import()` 한 줄에만 둔다(소스 검사 테스트 §11.1, 번들 검사 §1.3).

### 4.4 캔버스 배치
- `#frame` 안의 겹침 순서(아래 → 위): 게임 화면과 HUD(DOM) → **`#gfx` Pixi 캔버스** → `#fx-dom`(등급 배너, 카운트업 숫자, 점멸 덮개) → 시트·모달·게이트·영수증·회전 안내 덮개.
- `#gfx { position: absolute; inset: 0; pointer-events: none; }`, 캔버스는 CSS로 100%×100%. 탭은 모두 아래 DOM으로 통과한다. 코인이 HUD 잔고 쪽으로 날아가도 되도록 HUD보다 위에 둔다. 배너 글자는 광선보다 위다.
- 좌표: `emit`의 `at`은 대상 요소의 `getBoundingClientRect()`에서 `#frame` 원점을 뺀 값이다(DOM 백엔드가 계산해 넘긴다). `ResizeObserver`로 `#frame` 크기가 바뀌면 `resize`.
- 투명 캔버스(`backgroundAlpha: 0`, premultiplied alpha)를 DOM 위에 보통 합성으로 올린다. 캔버스 안에서 가산 합성한 부드러운 스프라이트는 아래 DOM에도 빛이 더해진 것처럼 보인다.
- **쉬는 동안 비용 0:** 살아 있는 파티클·스프라이트가 없으면 `frame()`은 `render()`를 부르지 않는다(마지막에 한 번 비운 뒤 정지).

### 4.5 DPR·적응형 품질
| 품질 | 캔버스 배율 | 동시 파티클 상한 | 광선·글로우 |
|---|---|---|---|
| 2 (시작값) | `min(dpr, 2)` | 600 | 모두 |
| 1 | `min(dpr, 1.5)` | 250 | 광선 유지, 글로우 절반 |
| 0 | 1 | 100 | 광선 없음 |
| 꺼짐 | — | 0 | 계층 `destroy()` |

- `quality.ts`(순수 상태 기계): Pixi가 실제로 그린 프레임만 잰다. 프레임 시간 지수이동평균이 22ms를 30프레임 넘으면 한 단계 내리고, 14ms 미만이 10초 이어지면 한 단계 올린다. 품질 0에서 40ms 초과가 5초 이어지면 계층을 끈다(`aux("gfx", {b: "none", why: "slow"})`). 소프트웨어 렌더링 WebGL을 만난 저사양 기기가 이 경로로 빠진다.
- 단계가 바뀐 뒤 12프레임은 판정하지 않고, 내릴 때는 평균을 22ms에서 다시 시작한다. 올리기 대기(10초)는 "되튐"(올린 직후 다시 내림)일 때만 두 배가 되고, 빠름과 느림 사이 구간은 올리기 진행을 멈출 뿐 초기화하지 않는다(2026-11-25 P7-A2) — 이전에는 2→1→0이 1초 안에 연달아 일어나고 회복에 약 40초가 걸렸다.
- 상한 숫자는 시작값이다. P2-C1이 중급 안드로이드 실기기에서 재고 고친다(DECISIONS에 기록).

### 4.6 컨텍스트 손실과 폴백
- **손실:** Pixi의 `GlContextSystem`이 `webglcontextlost`에서 `preventDefault()`를 하고 `webglcontextrestored`에서 자원을 다시 올린다(§4.2에서 확인). 우리 쪽 처리: 손실 이벤트 → `alive = false`, 살아 있는 파티클을 모두 버리고 해당 `FxRun`을 끝낸다(기록의 `ms`는 실제 값으로 고친다), `render()` 생략, `emit`은 0. 복구 이벤트 → `alive = true`. 5초 안에 복구되지 않거나 한 세션에서 3번 손실되면 `destroy()` 후 계층을 영구히 비운다(`aux("gfx", {b: "none", why: "lost"})`).
- 백그라운드: `fx.suspend()`가 루프를 멈춘다. iOS가 백그라운드에서 컨텍스트를 버리면 위와 같은 경로로 처리된다.
- **WebGL을 쓸 수 없을 때의 폴백은 "장식 계층 없음"(null)이다.** Canvas 2D 폴백 렌더러는 두지 않는다. 이유: 두 번째 렌더러는 구현과 검증이 두 배이고(Pixi의 `CanvasRenderer`는 청크도 는다), DOM 쪽 연출(배너, 카운트업, 정적 글로우, 흔들림, 점멸, 소리, 진동)이 그대로 남아 당첨과 손실의 비대칭은 유지된다.
- 어느 경우든 **기록은 실제로 보여준 것만** 남긴다: `emit`이 0을 돌려주면 `particles:<kind>` 기록을 만들지 않는다. 계층 상태는 `aux("gfx", {b: "gl" | "none", q, why?})`로 로드 시와 바뀔 때 남긴다.

### 4.7 헤드리스 테스트
- node 테스트는 `gambling/fx/gl/*`를 import하지 않는다. fx=on 쪽은 **실제 `createFx` + `nullBackend`**(§6.5)다. `nullBackend.emit`은 요청한 개수(상한 적용 후)를 그대로 돌려주므로 연출 결정·연출 난수 소비·기록이 실제와 같이 일어난다.
- 파티클의 움직임(위치·속도·수명)은 `fx/particles.ts`의 **순수 시뮬레이션**(`Float32Array`, Pixi·DOM 없음)이 계산하고, `gl/stage.ts`는 그 값을 `Particle`에 옮겨 그리기만 한다. 그래서 상한·수명·결정성은 node에서 테스트한다.
- **FxBackend 추상화는 유지한다.** 그리는 쪽을 바꾸는 일(필터 추가, 다른 렌더러)은 `gl/stage.ts`와 `backend.ts` 안에서 끝난다.

## 5. 공유 계층 (`/shared/`)

### 5.1 `shared/config.ts`
```ts
export type GameId = "slot" | "roulette" | "blackjack" | "crash" | "ocean";
export const START_CREDITS = 10_000;
export const MIN_BET: Record<GameId, number> = { slot: 20, ocean: 20, roulette: 10, blackjack: 20, crash: 100 };
export const MIN_BET_GLOBAL = 10;                    // bust ⇔ balance < 10
export const BET_STEPS = { slot: [20, 40, 100, 200, 400, 1000], ocean: [20, 40, 100, 200], crash: [100, 200, 500, 1000, 2000] } as const;
export const CHIPS = { roulette: [10, 50, 100, 500], blackjack: [20, 100, 500] } as const;
export const TIER_MIN = [2, 5, 15, 50] as const;     // NICE, BIG, MEGA, EPIC (이번 판 베팅 대비 배수)
export type Tier = 0 | 1 | 2 | 3 | 4;
export function tierOf(payout: number, bet: number): Tier;
export type SlotVariant = "a" | "b";                 // 슬롯 체감 변형(§7). 심해전설과 무관
export const SLOT_VARIANTS = ["a", "b"] as const;
export const DEFAULT_SLOT_VARIANT: SlotVariant = "a";
```
지급 규약(모든 게임): `payout`은 **원금을 포함해 지갑에 돌아오는 총액**, `net = payout − bet`. 크레딧은 항상 정수.

### 5.2 `shared/rng.ts`
- 생성기: **xoshiro128\*\***(32비트 상태 4개). 시드 문자열 → 상태는 `cyrb128`. 상태가 모두 0이면 `s[0] = 1`.
- **스트림 분리는 라벨로, 라운드 분리는 카운터로 한다.** `at(n)`은 문자열 `seed + "|" + label + "|" + n`을 `cyrb128`로 해시한 값을 상태로 삼는 `xoshiro128ss`다. 라운드마다 새 생성기를 쓰므로 어떤 라운드가 난수를 몇 개 쓰든 다음 라운드에 영향이 없다.
- 라벨: 결과 `res:<gameId>`, 연출 `pre:<gameId>`, `pre:lobby`, `pre:fx`. 인덱스 `n`은 그 게임의 라운드 번호(1부터). 블랙잭은 슈 번호, 로비는 표시 항목 순번.
- **결정: 게임 순서는 결과를 바꾸지 않는다.** 슬롯의 n번째 판 결과는 (시드, n)만으로 정해진다. 이유: 수업 모드에서 같은 시드를 쓴 학생끼리 비교할 수 있고, 새로고침 뒤 이어하기가 쉽고, fx on/off 일치가 구조적으로 보장된다.
```ts
export interface Rng {
  u32(): number;                       // [0, 2^32)
  float(): number;                     // [0, 1), u32 / 2^32
  int(n: number): number;              // [0, n) 균등, 거부 표본법(모듈로 편향 없음)
  weighted(w: readonly number[]): number;   // 정수 가중치, 인덱스 반환
  shuffle<T>(a: T[]): T[];             // Fisher–Yates, 제자리
}
export function cyrb128(s: string): [number, number, number, number];
export function xoshiro128ss(state: [number, number, number, number]): Rng;
export function createRng(seed: string, label: string): Rng;          // 순차 스트림(시뮬레이션·rtp-check용)
export interface RoundRng { at(n: number): Rng }
export function createRoundRng(seed: string, label: string): RoundRng;
export interface Streams { res(g: GameId): RoundRng; pre(k: GameId | "lobby" | "fx"): RoundRng }
export function createStreams(seed: string): Streams;
export function randomSeed(): string;  // crypto.getRandomValues → 영숫자 10자
```

### 5.3 `shared/schema.ts`
BASE_PROMPT §4.1을 그대로 두고, 빠진 것만 선택 필드로 더한다(`+` 표시).
```ts
export type Session = {
  v: 1; seed: string; mode: "free" | "class"; fx: "on" | "off";
  display: "browser" | "standalone" | "fullscreen"; installed: boolean;
  device: { w: number; h: number; dpr: number; touch: boolean; orient: "portrait" | "landscape" };
  startedAt: number; endedAt?: number; endReason?: "bust" | "cashout";
  startCredits: number; events: Ev[]; nav: { t: number; to: string }[];
  id?: string;            // + 세션 식별자(이어하기 대조용)
  lang?: "ko" | "en" | "it";   // +
  sv?: SlotVariant;       // + 슬롯 변형(`?sv=`). gambling은 항상 쓰고, 읽는 쪽은 없으면 "a"
  rm?: boolean;           // + prefers-reduced-motion
  aux?: Aux[];            // + 라운드에 속하지 않는 표시·상태 기록
  unreleased?: number;    // + 심해전설 큐에서 일괄 지급(flush)으로 나간 크레딧의 합. 기록일 뿐 몰수가 아니다(§8.3)
  demo?: boolean;         // + 빌드 시점에 만든 데모 세션
};
export type Aux = { t: number; kind: string; d?: Record<string, unknown> };
export type Ev = {
  t: number; game: GameId; round: number;
  bet: number; payout: number; net: number; balance: number;
  disp?: Record<string, unknown>;
  ctl?: { stopPressed?: boolean; turbo?: boolean; auto?: boolean; gesture?: "tap" | "swipe" };
  fx?: { type: string; ms: number; k: number }[];
  dec?: Record<string, unknown>;
  te?: number;                       // + 정산 시각
  out?: Record<string, unknown>;     // + 결과 스트림이 정한 사실(릴 정지 위치, 룰렛 번호, 카드, 크래시 지점)
};
```
- 시각 `t`, `te`, `nav.t`, `aux.t`는 모두 `startedAt` 이후 경과 ms(정수). `startedAt`은 게이트 화면을 탭한 시각(epoch ms).
- 필드 역할: `out` = 정직한 결과, `dec` = 플레이어의 선택, `ctl` = 조작 방식, `disp` = 화면에 보여준 것, `fx` = 발생한 자극.
- `nav.to` 값: `gate`, `lobby`, `slot`, `roulette`, `blackjack`, `crash`, `ocean`, `cashout`.
- `aux.kind` 값: `ticker`{name, game, amt}, `hot`{games}, `crowd`{n}, `level`{n}, `bg`, `fg`, `mute`{on}, `install`{step}, `resume`, `gfx`{b: "gl" | "none", q?, why?}(§4.6).
- 게임별 타입(각 규칙 파일에서 export하고 `Ev`의 `out/dec/disp`를 좁혀 쓴다):

| 게임 | `out` | `dec` | `disp` |
|---|---|---|---|
| slot | `{stops:number[], mult:number}` | `{lineBet}` | `{tier, celebrate, dispVar?:{cells:[number,"a"\|"b"][]}, antic?:number}` |
| ocean | `{stops, basePay, seqPay, omen?:Omen}` | `{bonusSeqId?, queued?, releasedFromSeq?}` / 일괄 지급 `{bonusSeqId, flush:true, seqs?}` | `{tier, celebrate, omen?:Omen, ticket?:number}` |
| roulette | `{n:number}` | `{bets:Placed[]}` | `{tier, celebrate, board:number[]}` |
| blackjack | `{shoe, pos, dealer:string[], hands:{cards:string[], bet:number, res:string}[]}` | `{trueCountApprox, steps:{hand, action, optimal, trueCountApprox}[]}` | `{tier, celebrate}` |
| crash | `{crash:number}` | `{target:number\|null, manualCashoutAt:number\|null}` | `{tier, celebrate, crowd?:number}` |

  `disp.tier`는 두 모드 모두에서 기록한다(순수 함수). `celebrate`, `dispVar`, `antic`, `omen`, `ticket`은 실제로 보여줬을 때만 기록한다(fx=off에서는 없다).
- **심해전설 일괄 지급 `Ev`(§8.3):** `game: "ocean"`, `bet: 0`, `payout = net =` 큐에 남은 금액 전부, `round` = 그때까지 정산된 심해전설 판 수(새 판 번호와 난수 카운터를 쓰지 않는다), `dec: { bonusSeqId, flush: true }`(`bonusSeqId`는 큐 맨 앞 시퀀스. 시퀀스가 둘 이상이면 `seqs: {id, amount}[]`를 더한다), `out`·`disp`·`ctl` 없음, `fx`는 빈 배열. 판이 아니므로 판 수를 세는 쪽은 `dec.flush`인 `Ev`를 뺀다.

### 5.4 `shared/logger.ts`
```ts
export const SESSION_KEY = "eg.session.v1";
export type SessionMeta = Omit<Session, "events" | "nav" | "aux" | "endedAt" | "endReason">;
export interface Logger {
  readonly session: Session;
  now(): number;                                   // startedAt 이후 ms
  push(ev: Ev): void; nav(to: string): void; aux(kind: string, d?: Record<string, unknown>): void;
  end(reason: "bust" | "cashout"): void;           // endedAt, endReason 기록 후 save()
  save(): boolean;                                  // try/catch, 성공 여부만 반환
  scheduleSave(): void;                             // 1.5초에 한 번 이하
}
export function createLogger(meta: SessionMeta, o?: { storage?: Pick<Storage, "getItem" | "setItem"> | null; clock?: () => number; resume?: Session }): Logger;
```
저장 시점: 라운드 정산(`scheduleSave`), 그 판의 연출이 끝났을 때, `visibilitychange`(hidden), `pagehide`, 정산 화면. `Ev.fx` 배열은 정산 뒤에도 같은 객체에 계속 채워지므로(§6.4) 저장은 직렬화 시점의 내용을 쓴다.

### 5.5 `shared/handoff.ts`
```ts
export type Summary = {
  v: 1; seed: string; mode: Session["mode"]; fx: Session["fx"]; display: Session["display"]; installed: boolean;
  startedAt: number; durMs: number; endReason: "bust" | "cashout";
  startCredits: number; finalCredits: number; peak: { bal: number; t: number }; maxWin: number;
  fxMsPos: number; fxMsNeg: number;            // net > 0 인 판 / net ≤ 0 인 판의 연출 ms 합
  chase: number;                               // 순손실 직후 같은 게임에서 베팅을 올린 횟수
  games: Partial<Record<GameId, { n: number; bet: number; pay: number; cel: number; celNeg: number; dv: number; stop: number }>>;
  omen?: { n: number; after: number };
  sv?: SlotVariant; lang?: Lang; rm?: boolean;   // localStorage 없이도 해석 페이지가 동작하도록 함께 넘긴다
  unreleased?: number;                           // Session.unreleased 그대로
};
export function summarize(s: Session): Summary;
export function encodeSummary(s: Summary): Promise<string>;   // "2." + base64url(deflate-raw(JSON)) — CompressionStream 없으면 "1." + base64url(JSON)
export function decodeSummary(payload: string): Promise<Summary | null>;
export function loadSession(storage?: Pick<Storage, "getItem"> | null): Session | null;   // 파싱 실패·v 불일치 → null
export type Handoff = { kind: "full"; session: Session } | { kind: "summary"; summary: Summary } | null;
export function resolveHandoff(hash: string, storage?: Pick<Storage, "getItem"> | null): Promise<Handoff>;
```
- 해시 형식: `#s=<payload>`. 길이 2,000자 이하를 테스트로 보장한다.
- `summarize`에서 일괄 지급 `Ev`(`dec.flush`)는 `games.ocean.pay`와 `finalCredits`·`peak`에는 들어가고 판 수 `n`, `cel`, `stop`, `chase`, `omen.after`에는 들어가지 않는다.
- `resolveHandoff` 규칙: localStorage의 세션에 `endedAt`이 있고, 해시가 없거나 해시의 `startedAt`과 같으면 `full`. 아니면 해시가 있으면 `summary`. 둘 다 없으면 `null`.

### 5.6 규칙 엔진 (`/shared/rules/`) — DOM·시간·전역 상태 없는 순수 함수, 난수는 인자로 받은 `Rng`만 쓴다
```ts
// slot.ts ----------------------------------------------------------------
export type Sym = "W" | "7" | "B" | "R" | "C" | "H" | "s" | "h" | "c" | "d";
export interface SlotConfig { id: string; strips: readonly string[]; lines: readonly (readonly number[])[];
  pay: Readonly<Record<Exclude<Sym, "W">, readonly [number, number, number]>>; top: "7" }
export const SLOT_A: SlotConfig;                       // id "a", §7.1
export const SLOT_B: SlotConfig;                       // id "b", §7.1
export const SLOTS: Readonly<Record<SlotVariant, SlotConfig>>;   // { a: SLOT_A, b: SLOT_B }. 이름 없는 `SLOT`은 내보내지 않는다
export interface LineWin { line: number; sym: Sym; count: 3 | 4 | 5; pay: number }   // pay: 라인 베팅 배수
export interface SlotResult { stops: number[]; wins: LineWin[]; mult: number; payout: number; top5: boolean }
export function drawStops(cfg: SlotConfig, rng: Rng): number[];
export function gridOf(cfg: SlotConfig, stops: readonly number[]): Sym[][];            // [릴][행 0..2]
export function evaluate(cfg: SlotConfig, stops: readonly number[]): { wins: LineWin[]; mult: number; top5: boolean };
export function spin(cfg: SlotConfig, rng: Rng, lineBet: number): SlotResult;
export function slotPresentation(cfg: SlotConfig, r: SlotResult, pre: Rng): { dispVar?: { cells: [number, "a" | "b"][] }; antic?: number };
export function slotExact(cfg: SlotConfig): { sumLinePay: number; cycle: number; ret: number; sigma: number; hit: number; tierFreq: number[] };
//   32⁵ 전수(1~3초). 테스트·scripts·understanding의 워커에서만 부른다. 메인 스레드에서 부르지 않는다

// ocean.ts ---------------------------------------------------------------
export type Omen = "clam" | "shark" | "whale";
export interface OceanConfig { slot: SlotConfig; triggerDen: 68; bonus: readonly { mult: number; w: number; omen: Omen }[];
  release: Record<Omen, readonly [number, number]>; omenDelay: readonly [1, 3]; cap: 1250 }
export const OCEAN: OceanConfig;                       // §8. OCEAN.slot = { id: "ocean", strips: SLOT_A.strips, lines: SLOT_A.lines, pay: 심해전설 표 }. 슬롯 변형과 무관
export interface OceanSeq { id: number; round: number; bet: number; mult: number; total: number; omen: Omen;
  delay: number; chunks: number[]; next: number; wait: number }     // wait: 예시까지 남은 판 수(큐 맨 앞일 때만 줄어든다), -1이면 예시 표시 완료
export interface OceanState { round: number; nextId: number; queue: OceanSeq[] }
export interface OceanResult extends SlotResult { basePay: number; seqPay: number; triggered?: OceanSeq; omen?: Omen;
  released?: { seqId: number; amount: number; remaining: number } }
export function oceanInit(): OceanState;
export function oceanSpin(cfg: OceanConfig, st: OceanState, rng: Rng, bet: number): { state: OceanState; result: OceanResult };  // st를 변형하지 않는다
export function oceanPending(st: OceanState): number;                    // 큐에 남은 금액 합(모든 시퀀스의 chunks[next..])
export function oceanFlush(st: OceanState): { state: OceanState; amount: number; seqId: number; seqs: { id: number; amount: number }[] } | null;
//   큐가 비었으면 null. 아니면 큐를 비운 새 상태와 남은 금액 전부. 난수를 쓰지 않고 round도 올리지 않는다(§8.3)
export function oceanExact(cfg: OceanConfig): { base: number; bonus: number; total: number };

// roulette.ts ------------------------------------------------------------
export type RouletteBet = { kind: "straight"; n: number } | { kind: "split"; a: number; b: number }
  | { kind: "red" | "black" | "odd" | "even" | "low" | "high" } | { kind: "dozen" | "column"; i: 1 | 2 | 3 };
export type Placed = { bet: RouletteBet; amt: number };
export const RED: ReadonlySet<number>; export const WHEEL_ORDER: readonly number[];   // 유럽식 휠 순서
export function isValid(b: RouletteBet): boolean;      // split은 판 위에서 인접한 두 칸(0과 1·2·3 포함)
export function spinWheel(rng: Rng): number;           // rng.int(37)
export function returnOf(placed: readonly Placed[], n: number): number;   // 원금 포함. straight 36×, split 18×, dozen·column 3×, 나머지 2×
export function rouletteExact(b: RouletteBet): number; // 37칸 전수, 항상 36/37

// blackjack.ts -----------------------------------------------------------
export type Card = number;                             // 0..51, rank = c % 13 (0=A … 9=10, 10=J, 11=Q, 12=K)
export interface BjRules { decks: 6; cut: 0.75; s17: true; bjPays: 1.5; das: true; resplit: false; surrender: false; peek: true }
export const BJ: BjRules;
export interface Shoe { no: number; cards: Card[]; pos: number; rc: number }           // rc: Hi-Lo 러닝 카운트(공개된 카드만)
export function newShoe(no: number, rng: Rng): Shoe;   // 312장 셔플. rng = streams.res("blackjack").at(no)
export function needsShuffle(s: Shoe): boolean;        // pos ≥ 234, 라운드 시작 시에만 검사
export function handValue(cards: readonly Card[]): { total: number; soft: boolean };
export function trueCount(s: Shoe): number;            // rc / 남은 덱 수, 0.5 단위 반올림
export type Action = "H" | "S" | "D" | "P";
export interface HandView { cards: readonly Card[]; fromSplit: boolean; can: { double: boolean; split: boolean } }
export function optimalAction(hand: HandView, dealerUp: Card, rules?: BjRules): Action;   // §9.2 표. 불가능한 D는 표의 대체 행동으로
export type BjState = { /* 구현자가 정의: shoe, 딜러 패, 손들, 차례, 단계 */ };
export function bjDeal(shoe: Shoe, bet: number): BjState;
export function bjAct(st: BjState, a: Action): BjState;             // 플레이어 차례가 끝나면 딜러까지 진행
export function bjLegal(st: BjState, canAfford: (extra: number) => boolean): Action[];
export function bjSettle(st: BjState): { payout: number; totalBet: number; hands: { cards: Card[]; bet: number; res: "win" | "lose" | "push" | "bj" | "bust" }[] };
// blackjackEv.ts (understanding·scripts 전용, gambling은 import하지 않는다)
export function actionEv(hand: HandView, dealerUp: Card, a: Action): number;   // 무한 덱 근사, 초기 베팅 단위

// crash.ts ---------------------------------------------------------------
export const CRASH = { edge: 0.01, k: 0.12, minTarget: 1.01, maxTarget: 1000, cap: 10000, countdownMs: 3000 } as const;
export function crashFromU(u: number): number;         // max(1, min(cap, floor(99 / u) / 100)), u ∈ (0, 1]
export function crashPoint(rng: Rng): number;          // u = (rng.u32() + 1) / 2^32
export function multAt(tSec: number): number;          // floor(100 × e^(k·t)) / 100
export function timeOf(mult: number): number;          // ln(mult) / k
export function settleCrash(bet: number, crash: number, cashoutAt: number | null): number;   // cashoutAt ≤ crash ? bet × cashoutAt : 0
```

## 6. gambling 런타임

### 6.1 디렉터리와 계층
```
index.html                      게이트·로비·게임이 모두 이 한 페이지 안에 있다
gambling/src/  main.ts params.ts env.ts clock.ts router.ts session.ts wallet.ts registry.ts types.ts
               gate.ts lobby.ts hud.ts cashout.ts install.ts  ui/(theme.css fonts.css kit.ts svg.ts format.ts logo.ts)
gambling/fx/   types.ts index.ts null.ts backend.ts flashGuard.ts quality.ts tiers.ts countup.ts particles.ts
               shake.ts anticipation.ts sfx.ts haptics.ts glow.css
               gl/loader.ts(작음, 정적)  gl/stage.ts(Pixi, 동적 청크)  gl/atlas.ts(stage가 import)
gambling/games/<id>/  index.ts(GameModule) core.ts view.ts art.ts style.css core.test.ts
gambling/harness/  ctx.ts run.ts bots.ts parity.test.ts     (node에서 도는 헤드리스 실행기)
```
- 각 게임은 **`core.ts`(DOM 없는 진행 로직)** 와 **`view.ts`(DOM)** 로 나눈다. `core.ts`는 `GameCtx`만 받고 `document`, `window`, `setTimeout`, `Date`, `Math.random`을 직접 쓰지 않는다. 시간은 `ctx.clock`, 난수는 `Round.res/pre`만 쓴다.
- 게임은 `registry.ts`에서 `() => import('../games/<id>/index.ts')`로 지연 로드한다. 첫 로딩 JS(정적 폐포)에는 게이트·로비·HUD·지갑·fx의 지휘부와 DOM 백엔드·소리만 들어간다. Pixi는 `fx/gl/stage.ts` 동적 청크에만 있다(§4.3).

### 6.2 계약 (`gambling/src/types.ts`)
```ts
export interface GameModule {
  readonly id: GameId;
  mount(root: HTMLElement, ctx: GameCtx): void | Promise<void>;
  unmount(): void;                 // 리스너·타이머·rAF·오디오 루프 해제. 여러 번 불려도 안전
  canLeave(): boolean;             // 라운드 진행 중이면 false (로비·CASH OUT은 정산 뒤로 미룬다)
  onSuspend?(): void; onResume?(): void;
}
export interface GameCtx {
  game: GameId; wallet: Wallet; rounds: RoundApi; fx: Fx; rng: Streams; clock: Clock;
  log: Pick<Logger, "aux" | "now">; settings: Settings; store: GameStore;
  t: (key: string, params?: Record<string, string | number>) => string;
  nav: { toLobby(): void; requestCashout(reason?: "bust" | "cashout"): void };
}
export interface Wallet {
  readonly balance: number;        // 진실의 값. 화면의 잔고 숫자는 hud가 따로 카운트업한다
  canBet(amount: number): boolean;
  debit(amount: number): void;     // 부족하면 throw
  credit(amount: number): void;
  onChange(cb: (balance: number, delta: number) => void): () => void;
}
export interface RoundApi {
  count(g?: GameId): number;                                    // 정산된 라운드 수
  begin(o: { bet: number; ctl?: Ev["ctl"] }): Round;            // debit, 번호 부여, fx 수집 시작
  readonly active: Round | null;
}
export interface Round {
  readonly n: number; readonly res: Rng; readonly pre: Rng;     // rng.res(game).at(n), rng.pre(game).at(n)
  addBet(amount: number): void;                                 // 더블·스플릿
  ctl(patch: Partial<NonNullable<Ev["ctl"]>>): void;
  settle(o: { payout: number; out?: Ev["out"]; dec?: Ev["dec"]; disp?: Ev["disp"] }): Ev;   // credit, Ev 기록, 저장 예약
}
export interface Clock { now(): number; wait(ms: number): Promise<void>; frame(cb: (dtMs: number) => void): () => void;
  pause(): void; resume(): void }                               // pause 중에는 now()가 멈춘다
export interface Settings { readonly fx: "on" | "off"; readonly lang: Lang; readonly reducedMotion: boolean; muted: boolean;
  readonly sv: SlotVariant }                                    // 슬롯만 읽는다: SLOTS[ctx.settings.sv]
export interface GameStore { get<T>(key: string): T | undefined; set(key: string, value: unknown): void }   // JSON 값만. 세션 동안 유지
```
- `GameStore`에 두는 것: 블랙잭 슈(`no`, `pos`, `rc`), 심해전설 `OceanState`, 각 게임의 마지막 베팅 단계, 룰렛의 직전 배치.
- bust 판정은 `session.ts`가 한다: 정산 뒤 그 판의 연출이 끝났을 때(`fx.idle()`) `wallet.balance < MIN_BET_GLOBAL`이면 **먼저 심해전설 큐를 일괄 지급한다**(`flushOcean()`, 아래). 지급 뒤 잔고가 `MIN_BET_GLOBAL` 이상이면 세션은 계속되고, 여전히 미만이면(또는 큐가 비어 있었으면) `requestCashout("bust")`. 잔고가 10 이상이지만 현재 게임의 최소 베팅보다 적으면 게임이 "크레딧 부족" 시트(버튼: 로비 / CASH OUT)를 띄운다. 이때는 일괄 지급을 하지 않는다(CASH OUT을 누르면 그때 지급된다).
- **`flushOcean()`(`session.ts` 내부 함수, 어느 화면에 있든 동작):** `GameStore`의 `OceanState`(키 `"ocean.state"`, 심해전설 게임도 이 키를 쓴다)에 `oceanFlush`(§5.6)를 적용한다. `null`이면 아무것도 하지 않는다. 아니면 새 상태를 저장하고, `wallet.credit(amount)`, §5.3 형식의 `Ev` 하나를 `logger.push`, `session.unreleased += amount`, HUD에 한 줄 알림(`hud.bonus`, "심해전설 BONUS +{amt}")을 띄운다. 이 알림은 잔고 변화의 설명이므로 fx=off에서도 글자로 보여준다. 축하 연출(`celebrate`)은 하지 않는다. `RoundApi`의 판 번호와 난수는 건드리지 않는다. `session.ts`는 `shared/rules/ocean`에서 `oceanFlush`만 import한다(심해전설 청크가 로드되지 않은 이어하기 직후에도 동작해야 하므로 게임 모듈에 맡기지 않는다).
- 세션 레벨: `xp` = 누적 베팅액, 레벨 n의 기준은 `500·n·(n+1)`. 레벨이 오르면 작은 배너 + `aux("level")`. 저장하지 않는다.

### 6.3 내비게이션·게이트·백그라운드·정산
- **라우팅은 해시.** `#/` = 로비, `#/g/<gameId>` = 게임. 이유: Pages 하위 경로와 서비스 워커 폴백에 설정이 필요 없고, 안드로이드 뒤로 가기가 게임 → 로비로 동작한다. `router.ts`가 `hashchange`를 받아 현재 게임을 `unmount`하고 다음 화면을 `mount`하며 `logger.nav(to)`를 남긴다. `canLeave()`가 false면 해시를 되돌리고 정산 뒤에 이동한다.
- 쿼리: `?seed=`(있으면 `mode: "class"`), `?fx=off`, `?lang=`, **`?sv=b`**(슬롯 변형. `b`가 아니면 모두 `a`). UI에 노출하지 않는다. `params.ts`가 읽어 `Settings.sv`와 `Session.sv`에 넣는다.
- **게이트(탭해서 시작):** 페이지를 열 때마다 라우터 위에 덮는다. 로고, 슬로건, `터치하여 입장`. `pointerup` 핸들러 안에서 `fx.sfx.unlock()`을 부르고 세션을 시작(또는 이어하기)한 뒤 `nav("gate")` → `nav("lobby")`. fx=on이면 이어서 `void loadGfx(...)`로 Pixi 계층 로드를 시작한다(기다리지 않는다, §4.3). 브라우저 모드에서 `requestFullscreen()`은 부르지 않는다.
- **이어하기:** `session.ts`가 저장할 때마다 `eg.rt.v1`에 `{id, balance, rounds, xp, store}`를 함께 쓴다. 페이지를 열었을 때 `endedAt`이 없는 세션이 있고 `startedAt`이 6시간 이내이며 `?seed=`가 없거나 같고 **현재 주소의 `fx`·`sv` 값이 저장된 세션과 같으면** 그 세션을 이어 간다(`aux("resume")`). 다르면 새 세션이다(한 세션 안에서 변형이나 연출 모드가 섞이지 않게 한다). 진행 중이던 판은 무효이고 잔고는 마지막 정산 값이다. 라운드 난수가 카운터 기반이라 같은 번호의 판은 같은 결과가 다시 나온다. `endedAt`이 있는 세션만 남아 있으면 새 세션을 만든다(첫 정산 때 덮어쓴다).
- **백그라운드:** `visibilitychange` hidden → `clock.pause()`, `fx.suspend()`(AudioContext suspend, Pixi 계층 루프 정지), 오토 스핀 취소(돌아와도 자동으로 재개하지 않는다), `logger.save()`, `aux("bg")`. visible → `clock.resume()`, `fx.resume()`, `aux("fg")`. iOS에서 오디오가 다시 잠기면 다음 `pointerdown`에서 `unlock()`을 다시 부른다.
- **정산:** HUD의 CASH OUT은 항상 보인다. 판이 진행 중이면 눌린 상태로 두었다가 정산 뒤에 연다. 순서: 현재 게임 `unmount` → **`flushOcean()`(§6.2. 큐에 남은 금액을 `Ev` 하나로 지급. bust 경로에서는 이미 지급했으므로 아무 일도 없다)** → `logger.end(reason)` → `encodeSummary` → 영수증 덮개(브랜드 머리말, `CASH OUT TICKET`, 최종 크레딧, 플레이 시간 mm:ss, 최고 당첨, 플레이한 게임과 판 수, 일괄 지급이 있었으면 "심해전설 BONUS +N" 한 줄) → 버튼 하나 **"상세 내역 보기"** → `location.assign(BASE_URL + DETAIL_PATH + '#s=' + payload)`. 덮개가 뜨면 라우터와 모든 입력을 잠근다. 두 번째 버튼 **"게임으로 돌아가기"**는 `location.assign(BASE_URL + location.search)`로 로비를 다시 열어 게이트와 새 세션을 시작한다(2026-11-25 사용자 결정).

### 6.4 fx API (`gambling/fx/types.ts`)
```ts
export type FxRecord = { type: string; ms: number; k: number };
export interface FxRun { readonly done: Promise<void>; skip(): void }
export interface Fx {
  readonly enabled: boolean;                       // fx=off면 false
  collect(into: FxRecord[] | null): void;          // RoundApi.begin이 그 판의 Ev.fx 배열을 건넨다
  idle(): Promise<void>;                           // 진행 중인 연출이 모두 끝나면 resolve
  celebrate(o: { amount: number; bet: number; target: HTMLElement; anchor?: HTMLElement }): FxRun;   // 등급에 맞는 배너·카운트업·파티클·흔들림·소리·진동을 묶어 실행
  countup(o: { el: HTMLElement; from: number; to: number; ms: number; tick?: boolean }): FxRun;
  particles(kind: "coins" | "confetti" | "rays" | "bubbles" | "tickets", o: { k: number; at?: HTMLElement; ms?: number }): FxRun;
  shake(o: { el: HTMLElement; k: number; ms: number }): FxRun;
  antic(o: { el: HTMLElement; kind: "reel" | "rise" | "dim"; k: number; ms: number }): FxRun;
  flash(o: { el: HTMLElement; color: string; ms: number; area: number }): FxRun;   // flashGuard가 거절하면 아무것도 하지 않고 기록도 없다
  sfx: Sfx; haptics: Haptics;
  suspend(): void; resume(): void;
}
export interface Sfx { unlock(): Promise<void>; play(name: SfxName, o?: { k?: number; pitch?: number }): void;
  loop(name: "ambient" | "spin" | "rise" | "heartbeat", on: boolean, o?: { pitch?: number }): void; setMuted(m: boolean): void }
export type SfxName = "tap" | "stop" | "tick" | "coin" | "chip" | "card" | "win0" | "win1" | "win2" | "win3" | "win4" | "omen" | "ticket" | "level";
export interface Haptics { pulse(pattern: number | number[]): void }   // navigator.vibrate가 없으면 조용히 건너뛴다. 한 번에 합계 600ms 이하
```
**기록 규칙:** 연출을 시작할 때 `{type, ms: 예정 시간, k}`를 수집 배열에 넣고, 끝나거나 건너뛰면 같은 객체의 `ms`를 실제 걸린 시간으로 고친다. `collect`가 가리키는 배열은 다음 `begin` 전까지 그 판의 것이므로, 정산 뒤에 도는 축하 연출도 그 판의 `Ev.fx`에 들어간다.

| `type` | `k`의 뜻 | 상한 |
|---|---|---|
| `tier` | 등급 0.5(2× 미만 당첨)·1·2·3·4 | 배너 1.2 / 2.5 / 4 / 6초 |
| `countup` | 당첨 배수(payout / bet) | `clamp(600 + 450 × 배수, 600, 8000)`ms, 탭하면 건너뜀 |
| `particles:<kind>` | **실제로** 뿜은 개수(`FxBackend.emit`의 반환값. 0이면 기록하지 않는다) | 동시에 600개(품질 1: 250, 품질 0: 100, Pixi 계층이 없으면 0). §4.5 |
| `shake` | 진폭 px | 8px, 1초. 등급 2 이상에서만. reduced-motion이면 0 |
| `antic:<kind>` | 감속한 릴 수 / 배수 / 암전 비율 | — |
| `flash` | 1 | flashGuard |
| `sfx:<name>` | 최대 게인 0~1 | 마스터 게인 0.5 + 리미터, 어택 10ms 이상 |
| `haptic` | 진동 ms 합 | 600 |
| `omen`, `ticket` | 등급 1·2·3 / 장수 | §3 |

등급별 묶음(`celebrate`): 0 = 당첨 라인 강조 + `win0` + 카운트업. 1 NICE = 배너 + 코인 20. 2 BIG = 코인 60 + 광선 + 흔들림 4px. 3 MEGA = 코인 120 + 컨페티 80 + 광선 + 흔들림 6px + 점멸 2회. 4 EPIC = 코인 200 + 컨페티 150 + 광선 + 흔들림 8px + 점멸 3회(2초에 걸쳐). **`payout > 0`이면 `payout < bet`이어도 등급 0 축하를 그대로 한다.** `payout === 0`이면 아무 연출도 소리도 없이 다음 판 버튼만 즉시 켠다.

### 6.5 구현 구조와 `?fx=off`
- `fx/index.ts`의 `createFx({ backend, clock, pre, guard, quality })`가 실제 구현이다. **무엇을 얼마나 오래 할지 정하는 부분(순수)** 과 **그리는 부분(`FxBackend`)** 을 나눈다.
```ts
export interface FxBackend {       // backend.ts: createDomBackend(DOM·WebAudio + Pixi 계층 자리) / 테스트용 nullBackend
  banner(tier: number, ms: number): void; setText(el: unknown, text: string): void;
  emit(kind: string, n: number, at: unknown, ms: number): number;   // 실제로 내보낸 개수. Pixi 계층이 없으면 0
  shake(el: unknown, px: number, ms: number): void;
  antic(el: unknown, kind: string, k: number, ms: number): void; flash(el: unknown, color: string, ms: number): void;
  tone(name: string, gain: number, pitch: number): void; vibrate(p: number | number[]): void;
  suspend(): void; resume(): void; stop(): void;
}
export function createDomBackend(o: { frame: HTMLElement; gfx: { current: GfxLayer | null } }): FxBackend;   // gfx.current는 loadGfx가 끝나면 채워진다(§4.3)
export const nullBackend: FxBackend;   // DOM·Pixi 없음. emit은 요청 개수를 그대로 돌려준다
```
- **그리는 일의 분담:** `createDomBackend`는 배너·글자·흔들림·점멸·정적 글로우·`antic`의 CSS 부분을 DOM으로 처리하고, `emit`과 `antic`의 장식분(크래시 배기 불꽃, 릴 주변 반짝임)은 `gfx.current`가 있을 때만 Pixi 계층에 넘긴다. `fx/index.ts`(지휘부)는 Pixi를 모른다.
- `fx/null.ts`의 `createNullFx()`는 같은 `Fx` 인터페이스를 구현한다. 모든 메서드는 즉시 resolve된 `done`을 돌려주고 아무것도 기록하지 않는다. 예외는 `countup` 하나로, `el`의 글자를 최종 값으로 바로 바꾼다.
- `main.ts`가 `?fx=off`이면 `createNullFx()`를, 아니면 `createFx({ backend: createDomBackend(...) , ... })`를 `GameCtx.fx`에 넣는다. **fx=off에서는 `loadGfx`를 부르지 않으므로 Pixi 청크를 받지도 실행하지도 않는다**(§4.3). **게임 코드에는 fx 모드를 묻는 분기를 두지 않는다.** 예외는 `view.ts`의 순수 표시 시간(릴 회전 길이)뿐이고 `ctx.fx.enabled`로만 판단한다.
- 게임 로직은 fx의 반환값·시간·상태를 결과 계산에 쓰지 않는다. `await run.done`은 화면 순서를 맞추는 데만 쓴다.
- fx=off의 화면: 같은 DOM, `<canvas>` 없음, 글로우·배너·파티클·소리 없음. 슬롯 릴은 회전 없이 150ms 뒤 결과를 보여준다. `dispVar`, `antic`, 예시, 티켓, 티커, HOT 배지, 가짜 접속자를 보여주지 않는다. 크래시의 배수 상승은 게임 규칙이므로 같은 속도로 글자만 갱신한다.
- 적응형 품질(`quality.ts`, 순수 상태 기계): 단계·임계값·캔버스 배율·파티클 상한은 §4.5 표. 프레임 시간은 Pixi 계층이 실제로 그린 프레임만 잰다. 컨텍스트 손실과 폴백은 §4.6.

### 6.6 flashGuard (`gambling/fx/flashGuard.ts`) — DOM 없는 순수 모듈
```ts
export interface FlashGuard { request(nowMs: number, o?: { area?: number; red?: boolean }): boolean }
export function createFlashGuard(o?: { maxPerSec?: number; windowMs?: number }): FlashGuard;   // 기본 3, 1000
```
- 허용 조건: `(now − 1000, now]` 구간에 이미 허용한 횟수가 3 미만. 따라서 어떤 1초 구간에도 4회 이상이 들어가지 않는다.
- `red === true`이고 `area > 0.25`(화면 대비 면적)이면 항상 거절한다.
- `prefers-reduced-motion`이면 `maxPerSec = 1`로 만들고 흔들림 진폭을 0으로 한다. 나머지 연출은 유지한다(기본값 유지).
- **점멸의 정의:** 100ms 안에 끝나는 밝기 변화가 화면의 25%를 넘는 면적에서 일어나는 것. 이런 변화는 `fx.flash()`로만 만든다. CSS에 직접 쓰지 않는다. 600ms 이상에 걸친 암전·밝아짐은 점멸이 아니다.
- **Pixi 계층은 점멸을 만들지 않는다.** 광선·글로우 스프라이트의 알파는 `particles.ts`의 순수 함수 `envelope(t, ms)`로만 정하고, 이 함수는 올라갈 때와 내려갈 때 각각 200ms 이상 걸리게 한다(테스트로 강제). 화면의 25%를 넘는 빠른 밝기 변화가 필요하면 `fx.flash()`(DOM 덮개, flashGuard 경유)만 쓴다. 파티클 하나하나의 반짝임은 면적이 작아 해당하지 않는다.

## 7. 슬롯 수학 (ORO SEVENS)

**체감 변형 두 가지를 모두 구현한다(사용자 결정).** 규칙(심볼 10종, 5×3, 20라인, 와일드)과 RTP 목표(94.0%)는 같고 **릴 띠와 페이테이블만 다르다.** 변형 a는 자주 조금씩 당첨되고(당첨 판 40.6%), 변형 b는 덜 자주 더 크게 당첨된다(30.0%). 숨은 쿼리 `?sv=b`로 고르고(기본 a) `Session.sv`에 기록한다. 화면·연출 규칙(§7.5)·베팅 단계는 두 변형이 완전히 같아서, 차이는 수학뿐이다. 심해전설은 변형과 무관하게 변형 a의 띠를 쓴다(§8.1).

### 7.1 구성 (띠와 페이테이블 외에는 두 변형 공통)
- 5릴 × 3행, 고정 페이라인 20개, 왼쪽 릴부터 연속 일치. 총 베팅 = 20 × 라인 베팅. 라인 베팅은 1, 2, 5, 10, 20, 50.
- 프리 스핀과 스캐터는 넣지 않는다(한 판 = 한 번의 베팅을 유지해 로그와 계산을 단순하게 한다).
- 심볼(코드로 그린 SVG): `7` 불꽃 세븐(**잭팟 심볼**), `B` 금종, `R` 루비, `C` 클로버, `H` 편자, `s h c d` 스페이드·하트·클럽·다이아 네온 문양, `W` WILD(금별). `W`는 릴 2·3·4에만 있고 `7`을 포함한 모든 심볼을 대신한다. 릴 1에 `W`가 없으므로 라인의 심볼은 항상 릴 1의 심볼이다.
- **잭팟 결과**는 `7`로 시작해 5칸이 모두 `7` 또는 `W`인 페이라인이 하나 이상 있는 것(`top5`).
- 물리 릴 띠(길이 32, 원형). 정지 위치 `i`의 화면은 행 0·1·2 = `strip[i], strip[i+1], strip[i+2]`. 두 변형 모두 릴마다 `7`이 1개다(그래서 `7`이 화면에 보일 확률과 기대 연출 빈도가 같다). `W`는 변형 a가 릴 2·3·4에 2개씩, 변형 b가 1개씩이다.
- **변형 a의 띠 (`SLOT_A`, 기본값)**
```
R1  shcdHCBRshcdH7CshcdHBshcdRCHshcd
R2  shcdCHWBRshcd7CHshcdWshcBRCHdshc
R3  dHshcRCWBdHshc7RdCHshcdWBRCHshcd
R4  sdHhcCWBRsdHhc7CsdHhcsdWBRCHhcsd
R5  scdHhRCBscdHh7RCscdHhscdBRCHhscd
```
  (R3은 원형 이음매에서 `d`가 연달아 나온다 — 31번과 0번 칸. 전수 계산에 포함된 의도한 값이므로 고치지 않는다. 변형 b의 띠에는 같은 창에 같은 심볼이 두 번 나오는 자리가 없다.)
- 페이라인(릴 1~5의 행 번호):
```
11111 00000 22222 01210 21012 10001 12221 00122 22100 12101
10121 01110 21112 01010 21212 11011 11211 00200 22022 02220
```
- **변형 b의 띠 (`SLOT_B`, `?sv=b`)** — 페이라인은 변형 a와 같다.
```
R1  shcdHCRshcdBH7CshcdRHCshcdBRhsHC
R2  shcdCHWshcdBRHshcd7CRshcdHCBcRCH
R3  shcdHRCWshcdBH7CshcdRBHCshcdBRHC
R4  shcdHCWshcdBRHshcdC7RshcdHCBdRCH
R5  shcdHBRCshcdH7CHshcdRBHCshcdBRHC
```
  릴별 개수(`7 B R C H s h c d W` 순): R1 `1 2 3 4 4 5 5 4 4 0`, R2 `1 2 3 4 4 4 4 5 4 1`, R3 `1 3 3 4 4 4 4 4 4 1`, R4 `1 2 3 4 4 4 4 4 5 1`, R5 `1 3 3 4 5 4 4 4 4 0`. 옮겨 적은 뒤 이 개수와 맞는지 테스트로 확인한다. 변형 a보다 낮은 심볼이 적고 중간 심볼이 많으며 와일드가 릴마다 1개다.
- 페이테이블(라인 베팅 배수, 3 / 4 / 5개):

| 변형 | 7 | B | R | C | H | s, h | c, d |
|---|---|---|---|---|---|---|---|
| **a** | 150 / 750 / 3000 | 60 / 250 / 1000 | 50 / 200 / 750 | 30 / 100 / 400 | 20 / 80 / 300 | 12 / 40 / 150 | 10 / 25 / 100 |
| **b** | 250 / 1000 / 3000 | 100 / 400 / 2000 | 75 / 250 / 1000 | 40 / 150 / 600 | 30 / 100 / 400 | 15 / 50 / 200 | 10 / 40 / 150 |

### 7.2 정확한 값 (32⁵ = 33,554,432개 정지 조합 전수 계산, 설계 단계에서 서로 독립인 두 구현으로 확인함)
| 항목 | 변형 a | 변형 b |
|---|---|---|
| RTP | **31,537,860 / 33,554,432 = 93.990%** | **31,540,800 / 33,554,432 = 93.999%** |
| 표준편차 σ (총 베팅 단위) | 2.712 | 3.130 |
| 당첨 판 비율 | 40.64% (13,636,608 조합) | **30.00%** (10,065,920 조합) |
| 당첨 판의 평균 지급 | 2.31× | 3.13× |
| 베팅보다 적은 당첨(축하는 하지만 순손실) | 전체 판의 12.75% (당첨 판의 31.4%) | 전체 판의 8.23% (당첨 판의 27.4%) |
| 2× 미만 당첨(등급 0) | 3.7판에 1번 | 6.6판에 1번 |
| NICE / BIG / MEGA / EPIC | 11.2 / 24.6 / 182 / 3,771판에 1번 | 10.6 / 21.7 / 151 / 1,387판에 1번 |
| BIG 이상 | 21.5판에 1번 | 18.7판에 1번 |
| 잭팟 라인 | 62,138판에 1번 | 209,715판에 1번 |
| 최대 지급 | 233× | 231.5× |
| 10⁷판 표본의 표준오차 | 0.086%p | 0.099%p |

`sumLinePay`는 32⁵개 정지 조합 전체에서 20개 라인의 지급 배수를 모두 더한 뒤 20으로 나눈 값이다(20라인 합계는 변형 a 630,757,200, 변형 b 630,816,000). 단위 테스트의 고정 상수: `slotExact(SLOT_A)`의 `sumLinePay === 31_537_860`·당첨 조합 13,636,608, `slotExact(SLOT_B)`의 `sumLinePay === 31_540_800`·당첨 조합 10,065,920. 이 값이 다르게 나오면 옮겨 적는 과정에서 틀린 것이다. 심해전설 페이테이블에서는 `sumLinePay === 20_131_740`이다.

### 7.3 보정 방법 (값을 다시 맞춰야 할 때)
1. 릴이 독립이고 띠가 원형이므로 어느 행이든 심볼 분포가 띠의 개수 비율과 같다. 그래서 **RTP는 페이라인 모양과 무관**하고 닫힌 식으로 나온다. 심볼 `x`의 릴 `i` 일치 확률을 `m_i = (count_i(x) + count_i(W)) / 32`, `p_1 = count_1(x) / 32`라 하면
   `RTP = Σ_x p_1 · m_2 · m_3 · [ pay3·(1 − m_4) + pay4·m_4·(1 − m_5) + pay5·m_4·m_5 ]`.
2. 띠는 그대로 두고 페이테이블만 "보기 좋은 수"(10, 12, 20, 25, 30, 40, 50, 60, 75, 80, 100, …) 안에서 바꾼다. 낮은 심볼부터 손댄다. 목표는 94.00% ± 0.05%p.
3. 전수 계산으로 σ, 당첨 비율, 등급 빈도를 다시 확인한다. 몬테카를로로 보정하지 않는다.
4. **당첨 판 비율은 릴 1~3에만 달려 있고(3개 일치가 최소 당첨), 개수뿐 아니라 배열에도 크게 좌우된다.** 같은 개수라도 낮은 심볼을 `shcd` 묶음으로 모으면 한 번에 여러 라인이 함께 맞아 당첨 판 비율이 내려간다(변형 b의 개수에서 배열만 바꿔 29~35%가 나왔다). 그래서 당첨 판 비율을 맞출 때는 32³ = 32,768개 조합 전수 계산으로 릴 1~3의 띠를 먼저 고정하고(RTP는 배열과 무관하므로 영향이 없다), 그 다음 2번 단계로 RTP를 맞춘다. 변형 b는 이 순서로 만들었다.

### 7.4 ±0.3%p 기준의 통계 검토와 대체 기준
- 변형 a는 σ = 2.712이므로 10⁶판 표본의 표준오차가 **0.271%p**다. ±0.3%p는 1.1σ에 지나지 않아, 수학이 정확해도 무작위 시드의 약 27%에서 실패한다. 3σ로 ±0.3%p를 보장하려면 7.4 × 10⁶판이 필요하다. 변형 b(σ = 3.130)는 10⁶판 표준오차가 0.313%p여서 더 나쁘다.
- **결정(조정자 승인):** 슬롯의 합격 기준은 전수 계산이다(**두 변형 각각** 설계값 94.0%와 ±0.05%p 이내). 몬테카를로는 실제 추첨 경로(`spin`)가 모형과 맞는지 보는 확인용으로, 변형마다 10⁷판에서 `|표본 − 정확값| ≤ 4 × 표준오차`(변형 a 약 0.34%p, 변형 b 약 0.40%p)로 본다. 게임별 기준은 §11.2.

### 7.5 표시 변형(`dispVar`)과 기대 연출
5×3에 20라인이면 세 행이 모두 페이라인이라 BASE_PROMPT의 "페이라인 바로 위·아래"가 성립하지 않는다. 화면의 3행은 **항상 실제 결과**를 보여준다. 아래 규칙은 `cfg`만 다를 뿐 두 변형에 똑같이 적용한다(확률 0.28, 감속 조건, 정지 시각 모두 같다). 표시 변형은 릴 창 위아래에 반쯤 보이는 **엿보기 칸**(위 = `strip[i−1]`, 아래 = `strip[i+3]`, 높이의 35%만 보임)에만 적용한다.
- `slotPresentation`(연출 스트림만 사용):
  - `top5`가 아니면 확률 **0.28**로 표시 변형을 한다. 화면 3행과 실제 엿보기 칸에 `7`이 없는 릴 가운데 1개(60%) 또는 2개(40%)를 고르고, 위·아래를 반반으로 골라 그 엿보기 칸에 `7`을 그린다. `dispVar.cells`에 기록한다.
  - `antic`: 실제 화면 기준. 릴 `i`(2 ≤ i ≤ 4)가 멈췄을 때 릴 1..i 가운데 `7`이 보이는 릴이 2개 이상이면 남은 릴을 하나씩 1.2초 더 천천히 멈추고 테두리 발광과 심장박동음을 낸다. `antic` = 감속한 릴 수.
- 회전 중에 지나가는 심볼은 `7`이 많은 표시용 띠에서 뽑는다(연출 스트림).
- 정지 시각: 릴 1~5가 1.0 / 1.3 / 1.6 / 1.9 / 2.2초(터보는 0.9초 안에 모두). STOP은 남은 릴을 80ms 간격으로 즉시 멈춘다. 결과는 `begin` 직후 이미 정해져 있다.
- 스와이프: 릴 영역에서 아래로 40px 이상 끌면 스핀(`ctl.gesture = "swipe"`). 오토 스핀 10 / 25 / 50 / 100, 잔고 부족·백그라운드·탭·CASH OUT에서 멈춘다.

## 8. 심해전설 수학

### 8.1 구성과 RTP
- 기본 게임: 슬롯 **변형 a와 같은 릴 띠·페이라인·평가 함수**에 페이테이블만 다르다. `?sv=`는 심해전설에 영향을 주지 않는다.

| 7 | B | R | C | H | s, h | c, d |
|---|---|---|---|---|---|---|
| 100 / 500 / 2000 | 40 / 150 / 600 | 30 / 100 / 400 | 20 / 60 / 250 | 12 / 50 / 200 | 8 / 25 / 100 | 6 / 20 / 60 |

  기본 RTP = 20,131,740 / 33,554,432 = **59.997%**, σ = 1.694, 당첨 판 40.64%, 베팅보다 적은 당첨이 전체 판의 22.0%.
- 보너스 시퀀스: 매 판 결과 스트림으로 `rng.int(68) === 0`이면 트리거(확률 1/68). 총액 배수 `M`(트리거 판 베팅 대비)은 아래 가중치로 뽑는다.

| 배수 M | 5 | 10 | 15 | 30 | 50 | 100 | 250 | 500 | 1250 |
|---|---|---|---|---|---|---|---|---|---|
| 가중치(합 1000) | 330 | 300 | 150 | 120 | 60 | 25 | 10 | 4 | 1 |
| 생물 | clam | clam | clam | shark | shark | shark | whale | whale | whale |

  `E[M] = 21.75`, `E[M²] = 3767.5`. 상한 1,250배는 표의 최댓값으로 지켜진다.
- **전체 RTP = 기본 RTP + P(트리거) × E[M] = 0.59997 + 21.75 / 68 = 0.59997 + 0.31985 = 91.98%** (목표 92% ± 0.1%p). 이 식은 근사가 아니라 정확하다. 이유 둘: ① 트리거는 큐 상태와 무관하게 매 판 독립으로 뽑는다. ② **트리거된 총액은 빠짐없이 지급된다** — 판을 돌려 조각으로 받든, 세션이 끝날 때 남은 금액을 한 번에 받든(§8.3) 합은 `total`이다. 그래서 플레이어가 언제 그만두어도 받은 총액의 기댓값은 건 금액의 91.98%이고, 그만두는 시점은 지급 **시점**만 바꾼다.
- 100판 안에 예시를 한 번 이상 볼 확률은 77%다.

### 8.2 시퀀스의 진행 (`oceanSpin` 한 번 = 한 판)
한 판 안에서 난수를 쓰는 순서: 릴 정지 5개 → 트리거 판정 → (트리거면) 배수 → 지연 `d = 1 + rng.int(3)` → 판 수 `n`(생물별 범위) → 조각 가중치 `n`개.
1. 릴을 뽑고 기본 지급 `basePay`를 계산한다.
2. 큐 맨 앞 시퀀스를 처리한다. `wait > 0`이면 1 줄인다. 줄인 결과가 0이면 **이 판에 예시**(`result.omen`)를 내고 `wait = −1`로 둔다. 이미 `−1`이면 다음 조각을 지급한다(`seqPay`, `released`). 조각을 다 주면 큐에서 뺀다.
3. 트리거를 판정한다. 트리거면 `total = M × bet`(정수 크레딧, **트리거 시점에 절대 금액으로 고정**), 조각을 만들고 `wait = d`로 큐 끝에 넣는다. 2번 단계는 큐 맨 앞 시퀀스만 처리하므로, 뒤에 쌓인 시퀀스의 `wait`는 맨 앞이 된 다음 판부터 줄어든다.
4. `payout = basePay + seqPay`.
- 결과적으로 트리거 판 r → 예시 판 r + d → 지급 판 r + d + 1 … r + d + n. 트리거 판은 기본 지급만 한다.
- 조각 나누기: `w_i = 1 + rng.float()`를 오름차순으로 정렬하고, `chunk_i = floor(total × w_i / Σw)`(i < n), 마지막 조각 = `total − 나머지 합`. 뒤로 갈수록 커진다.
- 한 번에 진행하는 시퀀스는 하나(FIFO)다. 진행 중에 또 트리거되면 뒤에 쌓인다.
- 화면: 릴은 실제 기본 결과를 그대로 보여주고, 조각은 릴 위에 `BONUS +금액` 덮개로 따로 보여준다. 등급은 `payout`과 그 판 베팅으로 정한다(§5.1).

### 8.3 베팅 변경·자리 이동·종료 (결정)
- **보너스는 절대 크레딧이다.** 큐에 든 금액은 트리거 판의 베팅으로 정해지고, 그 뒤에 베팅을 올리거나 내려도 바뀌지 않는다. STOP·터보·오토·베팅 변경은 지급 순서와 금액에 영향이 없다.
- 트리거가 베팅과 무관하고 보너스가 트리거 판 베팅에 비례하므로, 베팅을 어떻게 바꾸든 장기 RTP는 §8.1의 값이다.
- **큐는 세션에 묶인다(`GameStore`).** 로비로 나가거나 다른 게임을 해도 남아 있고, 돌아와서 스핀하면 이어서 풀린다. 세션이 계속되는 동안에는 판을 돌려야만 풀린다.
- **남은 큐는 세션이 끝날 때 한 번에 지급한다(사용자 결정. 초안의 "지급하지 않고 공개만"은 채택되지 않았다).**
  - **언제:** ① CASH OUT으로 세션을 끝낼 때. ② 큐가 남아 있는 상태에서 bust가 될 판정이 났을 때(`wallet.balance < MIN_BET_GLOBAL`, 어느 게임에서든). ②에서는 지급한 뒤 bust 판정을 다시 한다 — 잔고가 `MIN_BET_GLOBAL` 이상이 되면 세션은 계속되고, 아니면 bust로 끝난다.
  - **무엇을:** 큐에 든 모든 시퀀스의 남은 조각을 합쳐 **`Ev` 하나**로 지급한다: `game: "ocean"`, `bet: 0`, `payout: <남은 금액>`, `dec: { bonusSeqId, flush: true }`(형식은 §5.3, 실행 주체는 §6.2의 `flushOcean()`). 지급 뒤 큐는 비고, 예시를 아직 보여주지 않은 시퀀스도 함께 지급된다(그 시퀀스의 예시는 나오지 않는다).
  - 일괄 지급은 판이 아니다: 릴을 돌리지 않고, 난수와 판 번호를 쓰지 않고, 축하 연출을 하지 않는다. 그래서 그 뒤에 이어지는 심해전설 판의 결과는 일괄 지급이 없었을 때와 같다.
  - `session.unreleased`에는 이렇게 지급한 금액의 합을 적는다. 받지 못한 돈이라는 뜻이 아니라 "판을 돌리지 않고 받은 돈"의 기록이다.
  - 확률은 어떤 경우에도 바뀌지 않는다. 금액도 바뀌지 않는다. 바뀌는 것은 지급 시점뿐이다.
- 로그: 트리거 판 `dec = {bonusSeqId, queued: total}`, 예시 판 `out.omen`(+ 보여줬으면 `disp.omen`), 지급 판 `dec = {bonusSeqId, releasedFromSeq: true, queued: 남은 금액}`, 일괄 지급 `dec = {bonusSeqId, flush: true}`. "예시 뒤 추가 판 수·베팅액"과 "연타 중 조작 횟수"는 understanding이 `Ev` 순서, `ctl`, `bet` 변화로 계산한다.

### 8.4 ±0.3%p 기준 검토
한 판 수익의 분산은 `1.694² + (3767.5 / 68 − 0.31985²) = 2.87 + 55.30`, σ = **7.63**이다. 10⁶판의 표준오차는 0.76%p이고, 3σ로 ±0.3%p를 보려면 5.8 × 10⁷판이 필요하다. **결정:** 합격 기준은 `oceanExact`(기본 RTP 전수 계산 + 표에서 계산한 `E[M] / 68`)이고, 몬테카를로는 §11.2의 구조 검사로 쓴다. 몬테카를로의 표본 RTP는 마지막에 `oceanFlush`로 남은 큐를 지급한 뒤에 계산한다(그래야 보존식이 정확히 닫힌다).

## 9. 룰렛·블랙잭·크래시

### 9.1 룰렛 (RUBY ROULETTE)
- 유럽식 싱글 제로. 베팅 종류는 스트레이트, 스플릿, 빨강/검정, 홀/짝, 로우/하이, 더즌, 컬럼만. 0이 나오면 바깥 베팅은 모두 잃는다.
- 칩 10 / 50 / 100 / 500. 한도: 스트레이트 500, 스플릿 1,000, 더즌·컬럼 2,000, 반반 베팅 5,000, 판 전체 10 이상 10,000 이하.
- 칩은 놓을 때가 아니라 **스핀할 때** 차감한다(`rounds.begin({bet: 합계})`). 스핀 뒤 배치는 그대로 남는다(REBET 기본, CLEAR 버튼).
- 결과 번호는 `begin` 직후 `spinWheel`로 정하고, 휠 애니메이션(6초, 터보 2.5초)은 그 번호에 맞춰 돈다. 결과 보드는 최근 20개, 같은 색이 3번 이상 이어지면 강조한다.
- 표준편차: 스트레이트 σ = 5.84(10⁶판 표준오차 0.58%p). 그래서 검증은 37칸 전수 계산으로 한다.

### 9.2 블랙잭 (BLACKJACK 21)
- 6덱, 75%(234장) 컷, S17, 블랙잭 3:2, 아무 두 장이나 더블, 스플릿 후 더블 허용, **스플릿은 한 번만(최대 2손)**, 에이스 스플릿은 한 장씩만 받고 21이 되어도 블랙잭이 아님, 서렌더·인슈어런스·이븐머니 없음, 딜러는 A나 10이 보이면 홀 카드를 확인(peek).
- 베팅: 20 단위, 20~2,000, 칩 20 / 100 / 500. 3:2 지급이 항상 정수다. 더블·스플릿은 추가 금액을 낼 수 있을 때만 허용한다.
- **슈는 세션 동안 유지한다.** 테이블을 떠났다 돌아와도 같은 슈의 같은 위치에서 이어진다. 라운드를 시작할 때 `pos ≥ 234`이면 슈 번호를 1 올려 새로 섞는다. 슈 `k`의 카드 순서는 `res:blackjack`의 `at(k)`로만 정해지므로 플레이어의 행동이 카드 순서를 바꾸지 않는다.
- Hi-Lo: 2~6은 +1, 10·J·Q·K·A는 −1. 공개된 카드만 센다. `trueCountApprox`는 베팅 시점 값을 `dec`에, 각 결정 시점 값을 `dec.steps[]`에 넣는다. `optimal`은 화면에 보여주지 않는다.
- **기본 전략표(`optimalAction`)**. 열은 딜러 2 3 4 5 6 7 8 9 T A.
```
하드  ≤8      H H H H H H H H H H        소프트 13,14  H H H D D H H H H H
      9       H D D D D H H H H H               15,16  H H D D D H H H H H
      10      D D D D D D D D H H               17     H D D D D H H H H H
      11      D D D D D D D D D H               18     S d d d d S S H H H   (d = 더블, 불가면 S)
      12      H H S S S H H H H H               19+    S S S S S S S S S S
      13~16   S S S S S H H H H H
      17+     S S S S S S S S S S
페어  2,2 3,3 P P P P P P H H H H        7,7   P P P P P P H H H H
      4,4     H H H P P H H H H H        8,8   P P P P P P P P P P
      5,5     D D D D D D D D H H        9,9   P P P P P S P P S S
      6,6     P P P P P H H H H H        T,T   S S S S S S S S S S      A,A   P P P P P P P P P P
```
  `D`가 불가능하면 `H`(소프트 18의 `d`만 `S`). 스플릿이 불가능하면 같은 합의 하드·소프트 행을 따른다(A,A는 소프트 12 = `H`).
- 예상 엣지는 기본 전략 기준 약 0.5%다. σ ≈ 1.15이므로 10⁶판의 표준오차가 0.115%p여서 0.4~0.7% 범위 판정이 불안정하다. **결정:** 10⁷판(표준오차 0.036%p)을 돌려 엣지가 0.35~0.75% 안인지 본다.

### 9.3 크래시 (SKYROCKET)
- 베팅 100 / 200 / 500 / 1,000 / 2,000. **100 단위로 한 이유:** 배수가 소수 둘째 자리까지이므로 `bet × 배수`가 항상 정수가 되어 내림 때문에 RTP가 깎이지 않는다.
- 목표 배수(자동 캐시아웃)는 선택 사항, 1.01~1000.00. **1.00은 허용하지 않는다**(공식의 `max(1.00, …)` 때문에 1.00 목표는 손실이 없다).
- 진행: 카운트다운 3초 → `begin` → `crash = crashPoint(round.res)`를 **상승 시작 전에** 뽑는다 → 배수 `multAt(t)`가 오른다(`k = 0.12`: 2×까지 5.8초, 10×까지 19.2초, 100×까지 38.4초) → `t ≥ timeOf(crash)`가 되면 종료.
- **수동 캐시아웃의 판정:** 탭 이벤트 시각의 `ctx.clock` 경과 시간 `t_tap`으로 `m = multAt(t_tap)`을 계산한다. `t_tap < timeOf(crash)`이면 성공이고 `cashoutAt = min(m, crash)`. 자동 목표가 먼저 도달하면 `cashoutAt = target`. 지급은 `settleCrash`. 결과는 (crash, 탭 시각)만으로 정해진다. 테스트는 `ManualClock`으로 탭 시각을 지정한다.
- 그래프 곡선과 배수 숫자는 SVG·DOM으로 그린다(게임 정보이므로 fx=off에서도 같다, §4.1). Pixi 계층은 `fx.antic({ kind: "rise" })`의 장식분(로켓 끝의 배기 불꽃)만 그린다.
- 캐시아웃 뒤에도 그래프는 크래시 지점까지 계속 오른다(탭하면 건너뛰고 지점을 바로 보여준다). 정산은 캐시아웃 시점에 한다. 실패한 판은 소리와 연출 없이 끝난다(상승음이 끊길 뿐).
- 백그라운드로 가면 `clock.pause()`로 판이 멈추고 돌아오면 이어진다.
- 가짜 접속자와 그들의 캐시아웃 표시는 `pre:crash`로 만들고 `disp.crowd`에 인원만 남긴다. 최근 배수 기록 막대는 실제 값 20개.
- 정확한 RTP: 0.01 격자의 목표 `x ≥ 1.01`에서 `P(crash ≥ x) = 0.99 / x`이므로 `x`와 무관하게 99%.

## 10. understanding

### 10.1 구조
```
understanding/src/
  main.ts          handoff 해석 → analyze → 섹션 장착, 언어 전환, 접는 목차
  source.ts        Source = full | summary | demo | none
  analysis/        metrics.ts stimulus.ts strategy.ts ocean.ts mapping.ts  (+ *.test.ts) — 순수 함수
  sections/        intro.ts debrief.ts stimulus.ts replayPlain.ts strategyCheck.ts sim.ts quiz.ts caseStudy.ts help.ts
  charts/kit.ts    uPlot 래퍼
  sim/             worker.ts client.ts jobs.ts
  demo/session.json  (빌드 시점 생성물, 커밋한다)
  style.css
```
- 섹션 계약: `export interface Section { id: string; titleKey: string; needs: "full" | "any"; mount(el: HTMLElement, c: SectionCtx): void | (() => void) }`. `SectionCtx = { source, analysis, t, lang, sim: SimClient, charts: ChartKit }`.
- 순서: intro(체감 시간·손익 질문, 답하기 전에는 아래 섹션을 가린다) → debrief → stimulus → replayPlain → strategyCheck → sim → quiz → caseStudy(사건 해설 + 내 세션 연결) → help(1336, 앱 삭제 방법). help의 연락처는 debrief 끝에도 한 번 둔다.
- `needs: "full"`인 섹션은 요약만 있을 때 요약 수치 카드 + "데모 세션으로 보기"로 바꿔 보여준다.
- **중립 이름 → 의미 매핑은 `analysis/mapping.ts` 한 곳**에 둔다(`dispVar` → 니어미스 표시, `celebrate && payout < bet` → LDW, `antic` → 기대 연출, `aux.ticker/hot/crowd` → 가짜 사회적 증거).
- 엣지 값은 하드코딩하지 않고 `slotExact`, `oceanExact`, `rouletteExact`, `CRASH.edge`에서 가져온다. 슬롯은 **세션의 변형**으로 계산한다: `SLOTS[session.sv ?? "a"]`(요약만 있을 때는 `summary.sv`). `slotExact`는 32⁵ 전수라 워커의 `slotStats` job으로만 부른다(§10.3). 블랙잭은 `rtp-check`가 측정한 값을 `understanding/src/analysis/constants.ts`에 출처 주석과 함께 둔다.
- 화면 아래쪽 섹션은 `IntersectionObserver`로 보일 때 장착한다. uPlot은 동적 import.

### 10.2 uPlot (`charts/kit.ts`)
```ts
export interface ChartKit {
  line(el: HTMLElement, o: { x: number[]; series: { label: string; y: number[]; dash?: boolean }[]; marks?: { x: number; label: string }[] }): Chart;
  bars(el: HTMLElement, o: { x: number[]; y: number[]; label: string }): Chart;
  stacked2(el: HTMLElement, top: LineOpts, bottom: LineOpts): Chart;   // x축을 함께 쓰는 위아래 두 장 (자극 강도 / 누적 손익)
}
export interface Chart { update(data: unknown): void; destroy(): void }
```
`ResizeObserver`로 폭을 맞춘다. `touchstart/touchmove`를 `u.setCursor`에 연결해 손가락으로 값을 읽게 한다. 색은 강조색과 회색 계열만 쓴다.

### 10.3 시뮬레이션 워커
- `new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' })`. `shared/rules`와 `shared/rng`를 그대로 import한다.
- 메시지: 요청 `{id, job, params}` / 진행 `{id, p}` / 결과 `{id, ok, data}` / 취소 `{id, cancel: true}`. 계산은 5,000회 단위로 끊어 취소를 확인한다.
- job: `slotStats`(변형 a·b 각각의 `slotExact` 결과. 한 번 계산해 워커 안에 캐시한다), `bankroll`(플레이어 10,000명 × N판, 엣지·판 수·베팅 시스템(균등·마틴게일·피보나치·달랑베르) → 최종 잔고 히스토그램, 파산 비율, 표본 경로 20개, 상위 1%), `strategy`(내 전략 / 무작위 / 최적 각 10⁵판), `crashTargets`(목표 배수별 RTP).
- "내 전략"의 모형: 블랙잭은 `dec.steps`에서 (손 범주, 딜러 카드)별 행동 빈도를 세고 본 적 없는 상황은 최적 행동으로 채운다. 룰렛은 실제 배치를 복원 추출한다. 크래시는 실제 목표·수동 캐시아웃 배수 분포를 쓴다.
- `navigator.hardwareConcurrency ≤ 4`이면 반복 횟수를 0.3배로 줄이고 화면에 실제 횟수를 표시한다.

### 10.4 데모 세션
**빌드 시점에 만든다.** `scripts/gen-demo.ts`가 `gambling/harness`(§11.1)로 시드 `OROBELLE-DEMO-1`, fx on, 슬롯 변형 a, 봇 플레이(슬롯 180판 → 룰렛 40판 → 블랙잭 60판 → 크래시 30판 → 심해전설 150판 → cashout. 심해전설 큐가 남아 있으면 실제와 같이 일괄 지급 `Ev`로 끝난다)를 돌려 `understanding/src/demo/session.json`을 쓴다. 시각은 `ManualClock`의 가상 시간이다. 파일은 커밋하고, CI에서 `gen-demo --check`로 다시 만들어 내용이 같은지 확인한다. understanding은 이 JSON을 동적 import로 읽으므로 gambling 코드를 번들에 넣지 않는다.

### 10.5 i18n
- 평평한 JSON, 점으로 구분한 키. **네임스페이스마다 파일을 나눈다**(병렬 작업 충돌 방지): `i18n/gambling/<ns>.<lang>.json`, `i18n/understanding/<ns>.<lang>.json`. 조정자가 `shared/i18n.gambling.ts`와 `shared/i18n.understanding.ts`를 `import.meta.glob('@i18n/gambling/*.ko.json', { eager: true })` 식으로 합치게 바꾼다. 기존 `i18n/gambling.*.json`, `i18n/understanding.*.json`은 `app` 네임스페이스로 옮긴다.
- 키 형식: `<ns>.<화면 또는 묶음>.<항목>`. 파일 이름의 `<ns>`와 키의 첫 마디가 같아야 한다(테스트로 강제).
  - gambling 네임스페이스: `app gate lobby hud tier slot roulette blackjack crash ocean cashout install`. 예: `hud.cashout`, `tier.2`, `slot.btn.spin`, `ocean.ticket.title`, `cashout.btn.detail`.
  - understanding 네임스페이스: `app intro debrief stimulus replay strategy sim quiz case help`. 긴 글은 문단마다 번호 키(`case.p1`, `case.p2`), 출처는 `case.src1.title` / `case.src1.url`.
- 치환은 `{name}` 형식. `t(key, params)`로 확장한다(조정자가 `shared/i18n.ts`에 추가).
- 숫자는 `Intl.NumberFormat(lang)`. `BIG WIN`, `CASH OUT`, `HOT`, `SPIN` 같은 카지노 관용 표현은 모든 언어에서 영어로 두되 키를 거친다.
- 언어 선택: `?lang=` → `localStorage["eg.lang"]` → `navigator.language` 앞 두 글자 → `ko`. MVP는 ko만 채우고 en·it는 같은 키에 빈 문자열(ko로 대체). `scripts/i18n-sync.ts`가 ko 키를 en·it 파일에 맞춰 넣는다.

### 10.6 사용자 결정에 따라 해석이 달라지는 곳
**슬롯 변형 (§7).** understanding은 어느 변형의 세션이든 처리한다.
- 모든 슬롯 수치(환수율, 당첨 판 비율, "베팅보다 적은 당첨" 비율, 등급 빈도)는 세션의 변형으로 계산한 값을 쓴다. 문구에 40.6%나 30.0% 같은 숫자를 직접 적지 않는다(i18n 문장은 `{hit}` 같은 치환 자리만 둔다).
- `sv`는 `Session.sv`(없으면 "a"), 요약 해시에서는 `summary.sv`. 데모 세션은 변형 a다.
- **비교 카드(sim 섹션, 권장. 두 변형을 만든 목적이 비교이므로 P5-B3에 넣는다):** "같은 환수율, 다른 체감" — 두 변형의 `slotStats`를 나란히 놓는다(환수율 94.0% 대 94.0%, 당첨 판 40.6% 대 30.0%, 베팅보다 적은 당첨 12.7% 대 8.2%, BIG 이상 21.5판 대 18.7판에 1번). 그리고 `bankroll` job으로 같은 판 수·같은 베팅의 최종 잔고 분포를 두 변형으로 겹쳐 그린다. 전하려는 것: 자주 당첨되는 쪽이 더 "잘 주는" 기계처럼 느껴지지만 장기 손실률은 같다.
- 수업 모드에서는 같은 시드를 `?sv=a`와 `?sv=b` 두 그룹에 나눠 주고 intro의 체감 손익 답을 비교할 수 있다. 변형이 다르면 같은 시드라도 슬롯 결과가 다르다는 점을 debrief에 한 줄로 밝힌다(다른 게임의 결과는 같다).

**심해전설의 남은 큐 (§8.3).** "자리 지키기"의 해석은 다음 사실에 맞춘다.
- 금액은 트리거 판에서 정해졌다. 예시가 뜬 시점에는 이미 정해져 있었다.
- **계속 앉아 있어도 그 금액은 변하지 않았고, 그 자리에서 그만두었어도 같은 금액을 받았다**(이 기계는 종료 시 남은 금액을 한 번에 지급한다). 그러므로 예시 뒤에 더 돌린 M판과 더 건 X 크레딧은 보너스를 "받기 위한" 것이 아니었다. 그 X는 새로 건 돈이고, 기대 손실은 X × (1 − 0.9198)이다.
- 일괄 지급 `Ev`가 있으면 그대로 보여준다: "N 크레딧은 판을 돌리지 않고 받았다."
- 이 구현에서는 자리를 떠도 잃는 것이 없다. 그런데도 예시 뒤에 계속 돌렸는지를 내 세션 데이터로 보여준다(예시 뒤 판 수·베팅액 대 예시 없는 구간). 실제 기계에서 자리를 뜨면 남은 연타가 어떻게 되었는지는 출처로 확인한 경우에만 caseStudy에 쓴다(CONTEXT §4.8.3).
- "연타 중 조작이 결과에 미친 영향 0"은 그대로다. 분석에서 판 수·베팅 합계를 셀 때 `dec.flush`인 `Ev`는 판으로 세지 않는다.

## 11. 테스트와 CI

### 11.1 단위 테스트 (Vitest, node 환경)
| 대상 | 증명하는 것 |
|---|---|
| `rng` | xoshiro128\*\* 기준 벡터 일치. `int(n)` 균등성(카이제곱). 라벨이 다르면 스트림이 다름. `at(n)`이 호출 순서와 무관하게 같은 값 |
| `slot` | **두 변형 각각:** `sumLinePay`(a `31_537_860`, b `31_540_800`)와 당첨 조합 수(a 13,636,608, b 10,065,920)가 상수와 일치, 닫힌 식과 전수 계산 일치, 띠 길이 32와 릴별 심볼 개수(§7.1), `W`가 릴 2·3·4에만 있음. 공통: 와일드·라인 평가 사례, `drawStops` 균등성. 변형 b의 당첨 판 비율이 0.28~0.32 |
| `ocean` | `oceanExact().total`이 0.9198 ± 0.0005. **보존(일괄 지급 포함):** 10⁶판을 돌리다 임의의 판에서 멈추고 `oceanFlush`를 했을 때 `Σ seqPay + flush.amount = Σ 트리거된 total`이 정확히 성립(멈추는 판을 여러 개로 바꿔 확인). `oceanFlush` 뒤 `oceanPending === 0`, 빈 큐에서는 `null`, `round`와 난수를 건드리지 않음(일괄 지급 뒤의 판 결과 = 일괄 지급 없이 같은 번호 판의 릴·트리거 결과). 조각이 모두 1 이상이고 합이 total. 베팅을 바꿔도 큐 금액이 그대로. 같은 시드·같은 판에서 STOP·터보 여부와 무관하게 같은 결과. `OCEAN.slot.strips === SLOT_A.strips` |
| `roulette` | 모든 베팅 종류가 36/37. 스플릿 인접성 검사. 지급 사례 |
| `blackjack` | `optimalAction`이 §9.2 표의 모든 칸(하드 5~21, 소프트 13~21, 페어 10종 × 딜러 10장)과 일치. 불가능한 행동의 대체. 슈 312장 구성. 컷 위치. 블랙잭·푸시·스플릿 에이스 지급. `actionEv`의 최댓값 행동이 표와 일치(무한 덱 차이로 어긋나는 칸은 목록으로 명시) |
| `crash` | `crashFromU`를 `u = (i + 0.5) / 10⁷` 격자로 적분해 목표 1.01, 1.5, 2, 10, 100에서 0.99 ± 0.0005. `settleCrash` 경계(`cashoutAt === crash`는 성공) |
| `flashGuard` | 60초 동안 무작위·고빈도 요청을 넣어도 허용된 시각의 어떤 1초 구간에도 3회 이하. 큰 빨간 점멸은 항상 거절. reduced-motion이면 1회 |
| `fx` (node, `nullBackend`) | `emit`이 0을 돌려주면 `particles:*` 기록이 없고, n을 돌려주면 `k = n`. `particles.ts` 순수 시뮬레이션: 동시 상한(600 / 250 / 100), 수명이 끝나면 0개, 같은 `pre` 시드면 같은 궤적. `envelope(t, ms)`의 오름·내림이 각각 200ms 이상(§6.6). `quality.ts` 상태 기계: 내림·올림·꺼짐 조건(§4.5) |
| Pixi 격리 (소스 검사) | `'pixi.js'`(및 `pixi.js/*`)를 import하는 파일은 `gambling/fx/gl/stage.ts` 하나. `gl/stage.ts`를 가리키는 것은 `gl/loader.ts`의 `import()` 하나. `gambling/src/main.ts`에서 정적 import만 따라가면 `gl/stage.ts`·`gl/atlas.ts`에 닿지 않음. `fx/null.ts`와 `gambling/harness/**`는 `fx/gl/**`를 import하지 않음 |
| CSS 점멸 | `gambling/**/*.css`의 `infinite` 애니메이션 가운데 밝기·색을 바꾸는 것은 주기 1초 이상(§2.3) |
| `logger` / `handoff` | 저장 실패(`setItem`이 throw)에도 계속 진행. 요약 인코딩 왕복(`sv`, `unreleased` 포함). 해시 2,000자 이하. `resolveHandoff` 세 갈래. 일괄 지급 `Ev`가 판 수에 들어가지 않음 |
| import 경계 | §0.4를 소스의 import 문 검사로 확인 |

**fx on/off 결과 일치 (`gambling/harness/parity.test.ts`)** — 정의:
- `createHeadlessCtx({ seed, fx })`: 실제 `wallet`, `session`, `RoundApi`, `Streams`에 `ManualClock`(`wait`가 가상 시간을 즉시 진행)을 붙인다. `fx: "on"`은 **실제 `createFx`에 `nullBackend`** 를 붙인 것(연출 결정·연출 난수 소비·기록이 모두 실제로 일어난다. Pixi와 DOM은 로드하지 않는다, §4.7), `fx: "off"`는 `createNullFx()`. `createHeadlessCtx`는 `sv`도 받는다(기본 "a").
- `runScript(game, ctx, script)`: 각 게임의 `core.ts`를 직접 조작한다. 스크립트는 결정적이다 — 슬롯 300판을 **변형 a와 b 각각**, 심해전설 300판(베팅 단계를 바꾸고 7판마다 STOP, 일부는 터보. 심해전설은 큐가 남은 시점에 CASH OUT으로 끝내 일괄 지급 `Ev`가 on과 off에 똑같이 생기는지 본다), 룰렛 100판(정해진 배치 순환), 블랙잭 200판(보이는 상태만으로 정하는 정책 2종: 기본 전략, "15 미만이면 히트"), 크래시 100판(목표 배수와 수동 캐시아웃 시각 목록).
- 합격: 같은 시드에서 `events.map(e => ({game, round, bet, payout, net, balance, out, dec}))`가 on과 off에서 **깊은 비교로 같다.** off의 모든 `Ev.fx`는 비어 있고, on에는 기록이 있다.
- 추가: 슬롯 50판 → 룰렛 20판 → 슬롯 50판의 슬롯 `out`이 슬롯 100판만 한 것과 같다(게임 순서 독립).
- 추가(일괄 지급, Phase 3~4): ① 심해전설에서 큐를 만든 뒤 룰렛에서 잔고를 10 미만으로 만들면 bust 대신 일괄 지급 `Ev`가 생기고 세션이 계속된다. 남은 금액이 모자라 지급 뒤에도 10 미만이면 `endReason: "bust"`. ② 일괄 지급 뒤 심해전설을 다시 돌리면 판 번호가 이어지고 결과가 일괄 지급 없는 실행의 같은 번호 판과 같다. ③ CASH OUT으로 끝난 세션 전체에서 `Σ ocean payout − Σ basePay = Σ 트리거된 total`.
- Phase 1에는 게임 코어가 없으므로 규칙 수준 테스트만 둔다: `slotPresentation`을 호출하든 않든 `spin` 결과가 같다. 위의 하네스 테스트는 Phase 2(슬롯), Phase 3(나머지)에서 추가한다.

### 11.2 `scripts/rtp-check.ts` (CI, 고정 시드 `--seed`로 결정적 실행. 로컬에서 `--seed random`으로 3번 통과하는지도 본다)
| 게임 | 합격 기준(정확) | 몬테카를로 확인 |
|---|---|---|
| slot-a | `slotExact(SLOT_A)` RTP가 94.0% ± 0.05%p | 10⁷판, 표본과 정확값의 차이 ≤ 4 × 표준오차(약 0.34%p) |
| slot-b | `slotExact(SLOT_B)` RTP가 94.0% ± 0.05%p, 당첨 판 비율 30% ± 2%p | 10⁷판, 표본과 정확값의 차이 ≤ 4 × 표준오차(약 0.40%p) |
| ocean | `oceanExact().total`이 92.0% ± 0.1%p | 2 × 10⁷판: 트리거 비율·배수별 빈도가 각각 이항 4σ 이내, 마지막에 `oceanFlush`한 뒤 `Σ seqPay + flush = Σ total`(정확히), 전체 RTP 차이 ≤ 4 × 표준오차(약 0.68%p) |
| roulette | 모든 베팅 종류 36/37 (전수) | 종류별 10⁶판, 4 × 표준오차 이내 |
| crash | 격자 적분 0.99 ± 0.0005 | 목표 2×, 10×에서 10⁶판, 4 × 표준오차 이내 |
| blackjack | — | 기본 전략 10⁷판, 엣지 0.35~0.75% |

표로 결과(정확값, 표본값, 표준오차, 판정)를 출력하고 하나라도 실패하면 종료 코드 1. 전체 실행 시간 목표는 120초 이내(슬롯 변형이 둘이라 초안의 90초에서 늘렸다).

### 11.3 `scripts/check-gambling-bundle.ts`
§1.2~1.3 그대로(예산 = 엔트리의 정적 import 폐포, Pixi 청크 크기 별도 출력, Pixi 격리 검사 포함). 검사 함수 `scanText(text, rules)`와 매니페스트 폐포 계산 `staticClosure(manifest, key)`는 순수 함수로 두고 Vitest에서 금지어를 심은 문자열이 걸리는지, 동적 import가 폐포에 들어가지 않는지 확인한다. CI 순서: `typecheck → test → rtp → build(BASE_PATH=/gambling/) → check:bundle → e2e`.

### 11.4 Playwright E2E (Phase 7, `e2e/`)
- 프로젝트: iPhone 13(WebKit), Pixel 7(Chromium). 서버는 `BASE_PATH=/gambling/`로 빌드한 `vite preview`.
- 요소 선택은 중립적인 `data-testid`로 한다(`gate`, `balance`, `btn-spin`, `btn-cashout`, `card-slot` …).
- 시나리오:
  1. 게이트 탭 → 로비 → 게임 5종 각각 한 판 → 잔고가 `Ev`와 맞는지 → CASH OUT → 영수증 → understanding에서 모든 섹션이 그려짐.
  2. bust 경로: 고정 시드에서 `shared/rules`로 첫 룰렛 번호를 미리 계산하고, 지는 반반 베팅 두 곳에 5,000씩 걸어 한 판에 소진 → 정산 화면 자동 표시.
  3. localStorage 차단(`Storage.prototype.setItem`이 throw하도록 주입) → 해시 요약만으로 understanding이 그려짐.
  4. 같은 시드로 fx on과 `?fx=off`에서 슬롯 10판 뒤 잔고가 같음. 같은 시드의 `?sv=b`는 `Session.sv === "b"`이고 잔고가 `shared/rules`의 `SLOT_B`로 미리 계산한 값과 같음.
  5. 320×568과 가로 모드 스크린샷(`?fx=off`로 고정). 가로에서는 회전 안내 덮개.
  6. 터치 영역: `button, [role=button]`의 크기가 모두 44×44 이상.
  7. 외부 요청 0건(`page.on('request')`로 같은 origin만 허용).
  8. 오프라인(Chromium): 서비스 워커 활성화 뒤 `context.setOffline(true)`로 두 페이지 새로고침.
  9. 로그가 없을 때 understanding이 데모 세션을 제안.
  10. **Pixi 계층:** `?fx=off`에서는 세션 내내 문서에 `<canvas>`가 없고 페이지가 Pixi 청크(매니페스트의 `gambling/fx/gl/stage.ts` 파일)를 요청하지 않음(`page.on('request')`, 서비스 워커의 precache 요청은 제외). fx on(Chromium)에서는 게이트 탭 뒤 3초 안에 `#gfx canvas`가 생김. 게이트 탭 전에는 어느 모드에서도 Pixi 청크 요청이 없음.
  11. **컨텍스트 손실(Chromium):** `WEBGL_lose_context`로 `#gfx canvas`의 컨텍스트를 잃게 한 뒤에도 슬롯 한 판이 끝까지 진행되고 잔고가 `Ev`와 맞음. 복구 뒤에도 오류가 없음. WebKit에서 WebGL 초기화가 실패하는 환경이면 캔버스 없이 게임이 진행되는지만 본다.
  12. **심해전설 일괄 지급:** 고정 시드에서 `shared/rules`로 트리거 판을 미리 찾아 그 직후 CASH OUT → 영수증의 최종 크레딧에 남은 금액이 포함되고 마지막 `Ev`가 `dec.flush`.

## 12. 작업 분해

규칙: 한 작업은 자기 소유 파일만 만든다. 같은 물결(알파벳) 안의 작업은 병렬로 돌릴 수 있다. i18n은 자기 네임스페이스 파일만 만든다. 조정자 전용 파일(§0.2)이 바뀌어야 하면 보고서에 적는다.

| ID | 작업 | 소유 파일 | 모델 | 선행 |
|---|---|---|---|---|
| **P1-A1** | 계약과 난수: 타입 파일과 rng 구현·테스트. 개정 반영: `SlotVariant`, `Session.sv`, `Settings.sv`, 일괄 지급 `Ev` 주석 | `shared/config.ts`, `shared/rng.ts`(+test), `shared/schema.ts`, `gambling/src/types.ts`, `gambling/fx/types.ts` | sonnet | — |
| P1-B1 | 슬롯(**변형 a·b**: `SLOT_A`, `SLOT_B`, `SLOTS`)·심해전설 규칙(`oceanPending`, `oceanFlush` 포함), 전수 계산, 테스트 | `shared/rules/slot.ts`, `ocean.ts`(+test) | opus | A1 |
| P1-B2 | 룰렛 규칙 | `shared/rules/roulette.ts`(+test) | sonnet | A1 |
| P1-B3 | 블랙잭 규칙, 기본 전략, EV | `shared/rules/blackjack.ts`, `blackjackEv.ts`(+test) | opus | A1 |
| P1-B4 | 크래시 규칙 | `shared/rules/crash.ts`(+test) | sonnet | A1 |
| P1-B5 | logger, handoff(요약에 `sv`·`unreleased`, 일괄 지급 `Ev`는 판 수에서 제외) | `shared/logger.ts`, `handoff.ts`(+test) | sonnet | A1 |
| P1-C1 | rtp-check(slot-a·slot-b 둘 다, ocean은 `oceanFlush` 뒤 보존 검사) | `scripts/rtp-check.ts` | sonnet | B1~B4 |
| **P2-0** | (조정자) §1.1의 설정 변경, §10.5의 i18n 파일 분리와 `t(key, params)`, 폰트 패키지 추가. pixi.js는 그대로 둔다 | §0.2의 파일, `i18n/**` 이동 | sonnet | P1 |
| **P2-A1** | 런타임 뼈대: 부팅(fx 분기와 게이트 탭의 `loadGfx` 호출 자리), `params`(`sv` 포함), 라우터, 시계, 세션·RoundApi(bust 판정과 `flushOcean`, §6.2), 지갑, 레지스트리(게임 5종의 빈 `index.ts` 포함), 헤드리스 ctx | `gambling/src/{main,params,env,clock,router,session,wallet,registry}.ts`(+test), `gambling/harness/ctx.ts`, `gambling/games/*/index.ts`(빈 틀) | sonnet | P1 |
| P2-A2 | fx 시각 계층: 지휘부, null, `createDomBackend`·`nullBackend`, flashGuard, 품질 상태 기계, 등급, 카운트업, 파티클 순수 시뮬레이션과 `envelope`, 흔들림, 기대 연출, glow.css. **Pixi 장식 계층(§4):** `gl/loader.ts`(WebGL 확인, 동적 import, 실패 시 null), `gl/stage.ts`(§4.2의 import만 사용, `WebGLRenderer` 직접 생성, `ParticleContainer` 2개 + 가산 스프라이트, 쉬는 동안 렌더 생략, DPR·품질, 컨텍스트 손실 처리), `gl/atlas.ts`(Canvas 2D로 아틀라스 굽기). Pixi 격리 소스 검사 테스트 | `gambling/fx/*`, `gambling/fx/gl/*` (sfx·haptics 제외) (+test) | opus | P1 |
| P2-A3 | 소리 합성과 진동 | `gambling/fx/sfx.ts`, `haptics.ts` | opus | P1 |
| P2-A4 | 브랜드 UI 키트: 테마, 폰트, 로고, 버튼·시트·칩 부품, SVG 도우미, `icon.svg` | `gambling/src/ui/*`, `public/icons/icon.svg`, `i18n/gambling/{app,tier}.*` | opus | P2-0 |
| P2-A5 | 번들 검사(금지어, 정적 폐포 예산 250KB, Pixi 청크 크기 별도 출력, Pixi 격리 검사 §1.3)와 i18n 동기화 스크립트 | `scripts/check-gambling-bundle.ts`(+test), `scripts/i18n-sync.ts` | sonnet | — |
| P2-B1 | 게이트(탭에서 `loadGfx` 시작), 로비(카드·HOT·티커·섹션), HUD(잔고·레벨·CASH OUT·`hud.bonus` 알림), `index.html`(`#gfx`, `#fx-dom` 자리와 겹침 순서 §4.4) | `gambling/src/{gate,lobby,hud}.ts`, `index.html`, `i18n/gambling/{gate,lobby,hud}.*` | opus | A1, A2, A4 |
| P2-B2 | 슬롯: core(`SLOTS[ctx.settings.sv]`), view, 심볼 아트, 스와이프, 오토·터보·STOP, 하네스 실행기와 일치 테스트(변형 a·b) | `gambling/games/slot/*`, `gambling/harness/{run,bots,parity.test}.ts`, `i18n/gambling/slot.*` | opus | A1, A2, A3, A4 |
| P2-C1 | 통합·실기기 점검: 중급 안드로이드에서 Pixi 계층 프레임 측정(최소 30fps), §4.5의 품질 단계·파티클 상한 조정, 정적 폐포 ≤ 250KB 확인과 Pixi 청크 크기 실측값을 DECISIONS에 기록, `?fx=off`에서 Pixi 미로드 확인, 컨텍스트 손실·WebGL 없음 경로 수동 확인, 블룸 필터 추가 여부 판단(§4.1) | 위 파일의 수정(단독 실행) | opus | B1, B2 |
| **P3-A1** | 룰렛 게임 | `gambling/games/roulette/*`, `i18n/gambling/roulette.*` | sonnet | P2 |
| P3-A2 | 블랙잭 게임 | `gambling/games/blackjack/*`, `i18n/gambling/blackjack.*` | sonnet | P2 |
| P3-A3 | 크래시 게임 | `gambling/games/crash/*`, `i18n/gambling/crash.*` | sonnet | P2 |
| P3-A4 | 심해전설: 캐비닛, 생물 3종, 티켓, 슬롯 view 재사용. `OceanState`는 `GameStore` 키 `"ocean.state"`(세션의 일괄 지급으로 큐가 비워질 수 있으므로 판마다 다시 읽는다) | `gambling/games/ocean/*`, `i18n/gambling/ocean.*` | opus | P2 |
| P3-B1 | 일치 테스트에 4종 추가(일괄 지급 시나리오 §11.1 포함), 44px·세로 레이아웃 점검 | `gambling/harness/*` | sonnet | A1~A4 |
| **P4-A1** | 정산 화면(종료 전 `flushOcean`, 영수증의 BONUS 줄), 요약 전달, 이어하기(`eg.rt.v1`, `fx`·`sv` 일치 조건), bust 연결 | `gambling/src/cashout.ts`, `session.ts` 수정, `i18n/gambling/cashout.*` | sonnet | P3 |
| **P5-A1** | understanding 뼈대: main, source, 섹션 계약, 스타일, 목차, 차트 키트, `understanding/index.html` | `understanding/src/{main,source}.ts`, `style.css`, `charts/*`, `understanding/index.html`, `i18n/understanding/app.*` | sonnet | P4 |
| P5-A2 | 분석 함수와 테스트(세션의 `sv`로 슬롯 수치 선택, `dec.flush`인 `Ev` 처리, §10.6) | `understanding/src/analysis/*` | opus | P4 |
| P5-A3 | 시뮬레이션 워커(`slotStats` job 포함) | `understanding/src/sim/*` | opus | P1 |
| P5-A4 | 데모 세션 생성기와 봇 | `scripts/gen-demo.ts`, `understanding/src/demo/session.json` | sonnet | P4 |
| P5-B1 | intro, debrief | `sections/{intro,debrief}.ts`, `i18n/understanding/{intro,debrief}.*` | sonnet | A1, A2 |
| P5-B2 | stimulus, replayPlain | `sections/{stimulus,replayPlain}.ts`, i18n `stimulus`, `replay` | sonnet | A1, A2 |
| P5-B3 | strategyCheck, sim(슬롯 변형 비교 카드 §10.6) | `sections/{strategyCheck,sim}.ts`, i18n `strategy`, `sim` | opus | A1~A3 |
| P5-B4 | caseStudy(CONTEXT §4.8.1의 사실과 출처만), quiz, help(1336, 앱 삭제 안내) | `sections/{caseStudy,quiz,help}.ts`, i18n `case`, `quiz`, `help` | sonnet | A1, A2 |
| **P6-A1** | PWA: 플러그인 설정안(조정자 적용), 아이콘 생성, 설치 버튼, iOS 안내, 서비스 워커 등록, 오프라인 확인 | `scripts/gen-icons.ts`, `public/icons/*.png`, `gambling/src/install.ts`, `i18n/gambling/install.*` | sonnet | P5 |
| **P7-A1** | Playwright E2E(§11.4의 1~12) | `e2e/*`, `playwright.config.ts` | sonnet | P6 |
| P7-A2 | 성능·품질 마무리(적응형 품질, 320px, 가로 모드) | 게임·fx 파일 수정(단독 실행) | opus | P6 |
| P7-A3 | README, LICENSE, en·it 키 동기화 | `README.md`, `LICENSE`, i18n en·it | haiku | P6 |

각 작업의 완료 조건: `npm run typecheck && npm test`가 통과하고, 해당 Phase의 BASE_PROMPT §7 완료 기준을 만족하며, 내린 판단을 `- YYYY-MM-DD [영역] 결정 — 이유` 형식으로 보고한다.

## 13. 미결 질문 (기본값으로 진행하고, 사용자 답이 오면 고친다)
(초안의 1~5번 — 이펙트 엔진, 이름, 심해전설의 남은 큐, 슬롯 체감, CI 기준 — 은 2026-11-24에 답을 받아 §14로 옮겼다.)
1. **이어하기와 재시작:** 새로고침·앱 종료 뒤 6시간 안에는 세션을 이어 간다. 정산이 끝난 뒤 앱을 다시 열면 10,000 크레딧으로 새 세션이 시작된다(사실상 "다시 하기"가 된다). 막을지.
2. ~~**크레딧 환산**~~ → 2026-11-25 사용자 확정: 1크레딧 = 10원, 최저시급 2026년 10,320원(`analysis/constants.ts`에 출처).
3. **브라우저 모드 전체화면:** 게이트 탭에서 `requestFullscreen()`을 부르지 않는다(기본값). 부르면 안드로이드 브라우저에서도 시계가 가려진다.
4. **슬롯 변형의 최종 선택:** 두 변형을 실기기에서 비교한 뒤 기본값을 무엇으로 둘지, 둘 다 남길지(Phase 2 뒤, CONTEXT §9.2와 함께).
5. **Pixi 계층의 수치:** 파티클 상한(600 / 250 / 100)과 블룸 필터 추가 여부는 P2-C1의 실기기 측정으로 정한다(§4.5).
6. CONTEXT §8의 기존 미결(대상, 사용 환경, 세션 상한, 서사 레이어, 이탈리아 연락처, 블랙잭 연속 셔플, 가상 스포츠)은 그대로 남아 있다. CONTEXT §6·§8의 "이펙트 엔진 미결"과 "CI ±0.3%p" 표기는 이 개정에 맞춰 조정자가 고친다.

## 14. 이 문서에서 내린 결정 (DECISIONS.md에 옮길 한 줄 목록)
- [brand] 카지노 이름 "오로벨 카지노 / OROBELLE CASINO", short_name "오로벨" — 검색에서 동명 브랜드 없음
- [brand] 팔레트 `#0B0612` 바탕 + 금·크림슨·네온 3색, 글로우는 정적 레이어의 opacity·transform만 애니메이션 — 중급 기기 성능
- [font] Lilita One + Press Start 2P 라틴 서브셋만 번들, 한글은 시스템 글꼴 — 한글 웹폰트 용량
- [ocean] 머신 이름 "심해전설 / ABYSS LEGEND", 예시 생물은 총액 구간으로 결정(조개 5~15×, 상어 30~100×, 고래 250~1250×), 가짜 예시 없음 — 예시가 정직한 신호여야 해석이 성립
- [build] gambling 산출물 = Vite 매니페스트에서 `index.html` 엔트리의 import 그래프 + index.html·404.html·매니페스트(+sw) — 로비가 루트라 폴더로 구분 불가
- [build] `understanding` 문자열은 gambling JS에 `understanding/` 형태로 1회만 허용 — 정산 링크
- [pwa] start_url = scope = base, 폴백은 index.html, `understanding` 경로는 폴백 제외 + 쿼리 무시 목록으로 precache 일치 — 로비 루트 배치
- [rng] xoshiro128\*\* + cyrb128, 라벨별 스트림 + 라운드 카운터 기반(`at(n)`) — 게임 순서·난수 소비량이 결과를 바꾸지 않음
- [schema] `Ev.out`, `Ev.te`, `Session.aux/id/lang/sv/rm/unreleased/demo` 추가 — 결과 사실과 라운드 밖 표시를 담을 자리가 없었음
- [runtime] 게임은 core(DOM 없음)와 view로 분리, 해시 라우팅, 게임별 지연 로드 — 헤드리스 검증과 첫 로딩 예산
- [runtime] fx는 결정부와 백엔드(`FxBackend`)를 분리, fx=off는 같은 인터페이스의 null 구현 — 게임 코드에 모드 분기 없음
- [runtime] fx=off에서는 표시 변형·기대 연출·예시·티켓·티커·HOT 배지·접속자 표시도 끈다 — 모두 결과가 아닌 연출
- [runtime] 세션 이어하기(6시간), bust는 잔고 < 10 — 모바일에서 앱이 자주 종료됨
- [slot] 변형 a: 띠 5개(길이 32)·페이테이블 확정, 정확한 RTP 93.990%, σ 2.712, 당첨 판 40.64%, 프리 스핀·스캐터 없음 — 전수 계산으로 검증 가능
- [slot] 표시 변형은 엿보기 칸에만, 화면 3행은 항상 실제 결과 — 20라인에서는 모든 행이 페이라인
- [ocean] 기본 59.997% + 보너스 1/68 × 21.75 = 91.98%, 보너스는 트리거 시점의 절대 크레딧, 큐는 세션에 유지 — 베팅 변경이 결과에 영향 없음
- [rtp] 합격 기준을 정확 계산으로, 몬테카를로는 4σ 확인으로(조정자 승인 2026-11-24) — 10⁶판 ±0.3%p는 슬롯 1.1σ, 심해전설 0.4σ라 통계적으로 성립하지 않음
- [blackjack] 스플릿 1회, 인슈어런스 없음, 슈는 세션 유지, 검증은 10⁷판 0.35~0.75% — 10⁶판 표준오차 0.115%p
- [crash] 베팅 100 단위, 목표 1.01 이상, 성장 `e^(0.12t)`, 수동 캐시아웃은 탭 시각으로 판정 — 정수 지급과 결정성
- [roulette] 칩 10/50/100/500, 스핀 시 차감, 표준 베팅 7종만 — BASE_PROMPT 목록 유지
- [understanding] 데모 세션은 빌드 시점 JSON, 의미 매핑은 `analysis/mapping.ts` 한 곳 — gambling 코드를 번들에 넣지 않음
- [i18n] 네임스페이스별 파일 분리(`i18n/<page>/<ns>.<lang>.json`) — 병렬 작업 충돌 방지
- [layout] 가로 모드·낮은 높이에서는 회전 안내 덮개 — 세로 전용 레이아웃 유지

**2026-11-24 개정에서 더한 결정 (사용자 답변 반영)**
- 2026-11-24 [fx] PixiJS v8 유지(사용자 결정). Pixi는 게임 정보가 없는 장식 계층 한 장(파티클, 광선, 가산 글로우, 크래시 배기 불꽃)만 그리고 릴·카드·판·크래시 곡선·글자는 DOM/SVG — fx=off·E2E·폴백에서 Pixi 없이 게임이 완전해야 함
- 2026-11-24 [fx] Pixi는 게이트 탭 뒤 `import('./gl/stage')` 하나로 지연 로드, `?fx=off`에서는 받지도 실행하지도 않음 — 첫 로딩 정적 JS 250KB 유지, 무자극 모드의 순수성
- 2026-11-24 [fx] Pixi import는 `WebGLRenderer, Container, Sprite, Texture, Rectangle, ParticleContainer, Particle`만, `skipExtensionImports: true`, `Application`·`Graphics`·`Text`·`Assets`·`Ticker`·필터 미사용 — 실측 gzip 91KB(`Application` 경로 117~138KB, `Graphics` +22KB)
- 2026-11-24 [fx] 텍스처는 Canvas 2D로 구운 아틀라스 한 장, 글로우는 미리 흐린 스프라이트의 가산 합성(필터 없음) — v8 ParticleContainer는 단일 텍스처 소스, 전체 화면 필터는 중급 기기 필레이트 부담
- 2026-11-24 [fx] 캔버스 배율 `min(dpr, 2)`, 품질 2/1/0/꺼짐(파티클 상한 600/250/100/0), 컨텍스트 손실은 Pixi 자동 복구 + 5초·3회 한도, WebGL 불가 시 폴백은 "장식 계층 없음"(Canvas 폴백 없음) — DOM 연출이 남아 비대칭은 유지되고 두 번째 렌더러의 구현·검증 비용을 피함
- 2026-11-24 [fx] `FxBackend.emit`은 실제 개수를 돌려주고 0이면 기록하지 않음, 계층 상태는 `aux("gfx")` — 기록은 실제로 보여준 자극만
- 2026-11-24 [build] 예산은 `index.html` 엔트리의 정적 import 폐포 gzip ≤ 250KB, Pixi 청크는 따로 출력(기준 91KB, 110KB 초과 경고), 정적 폐포에 Pixi가 없음을 검사, URL 허용 목록에 `http://www.pixijs.com/`(Pixi 청크의 문자열) — 지연 로드가 깨지면 CI가 잡도록
- 2026-11-24 [ocean] 남은 큐는 CASH OUT 때, 또는 큐가 남은 채 bust가 될 때 `Ev` 하나(`game:"ocean"`, `bet:0`, `dec:{bonusSeqId, flush:true}`)로 일괄 지급하고 bust를 다시 판정(사용자 결정, 몰수안 폐기) — 트리거된 보너스가 전부 지급되어 전체 RTP 91.98%가 종료 시점과 무관하게 정확
- 2026-11-24 [ocean] 일괄 지급은 판이 아님: 판 번호·난수를 쓰지 않고 `round`는 직전 판 번호, 축하 연출 없음, `session.ts`의 `flushOcean()`이 `oceanFlush`로 수행, `Session.unreleased`는 그 금액의 기록 — 이후 판의 결과가 일괄 지급 여부와 무관해야 함
- 2026-11-24 [slot] 체감 변형 a·b를 둘 다 구현, `?sv=b`(기본 a), `Session.sv`에 기록, 연출 규칙·베팅은 동일, 이어하기는 `fx`·`sv`가 같을 때만(사용자 결정) — 실기기에서 비교해 고르기 위함
- 2026-11-24 [slot] 변형 b: 띠 5개(길이 32, 와일드 릴당 1개)·페이테이블 확정, 정확한 RTP 93.999%(31,540,800 / 32⁵), σ 3.130, 당첨 판 30.00%, BIG 이상 18.7판에 1번 — 당첨 판 비율은 릴 1~3의 배열로, RTP는 페이테이블로 맞춤(전수 계산)
- 2026-11-24 [slot] 심해전설은 슬롯 변형과 무관하게 변형 a의 띠를 사용 — 심해전설의 59.997%·91.98% 설계값 유지
- 2026-11-24 [rtp] rtp-check는 slot-a와 slot-b를 각각 검증(정확 94.0% ± 0.05%p + 10⁷판 4σ), 실행 시간 목표 120초 — 두 변형 모두 CI가 지킴
- 2026-11-24 [brand] "오로벨 카지노 / OROBELLE CASINO", "심해전설 / ABYSS LEGEND" 사용자 승인 — 미결에서 확정으로
- 2026-11-24 [understanding] 슬롯 수치는 세션의 `sv`로 계산하고 두 변형 비교 카드를 둠, "자리 지키기" 해석은 "금액은 트리거 때 정해졌고 머물러도 변하지 않았으며 떠났어도 같은 금액을 받았다"로 — 변형과 일괄 지급 결정에 맞춤
