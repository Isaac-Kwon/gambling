# gambling (OROBELLE CASINO / ABYSS LEGEND)

> **English summary.** An educational project. Visitors play a fictional mobile casino (`/`) built to feel like a real commercial one. Afterwards, `/understanding/` replays their own session and explains the mechanisms that were at work. The game has no warnings on purpose. All interpretation lives on the understanding page. Languages: ko (default), en, it. The brands are fictional. No real money, payments, external requests, analytics or cookies.

## 목적

도박이 사람을 어떻게 붙잡는지를 직접 체험하게 하는 교육용 프로젝트다. 플레이어는 실제 상업용 모바일 카지노처럼 화려하게 만들어진 가상 카지노(`/`)에서 게임을 한다. 정산 화면에서 `/understanding/`으로 넘어가면, 방금 한 플레이의 기록을 되짚으며 그때 작동한 장치들을 설명한다.

- 게임 페이지(`/`)에는 경고 문구, 교육 안내, 퀴즈를 두지 않는다. 해석은 모두 `/understanding/`에 있다.
- 실제 돈, 결제, 외부 링크는 없다. 크레딧은 무료로 다시 채워진다. 서버, 분석 도구, 쿠키도 없다.

## 주소

- 게임 로비: https://isaack.dev/gambling/
- 해석 페이지: https://isaack.dev/gambling/understanding/

## 실행 방법

```bash
npm install            # 의존성 설치
npm run dev            # 개발 서버 (로컬 주소 /)
npm test               # Vitest 단위 테스트
npm run typecheck      # 타입 검사 (build에도 포함)
npm run build          # 타입 검사 후 프로덕션 빌드 (dist/)
npm run rtp            # RTP 검증 (정확 계산 + 몬테카를로)
npm run check:bundle   # gambling 번들의 금지어 검사
npm run gen:demo       # understanding용 데모 세션 생성 (--check로 검사만)
npm run gen:icons      # PWA 아이콘 생성
npm run e2e            # Playwright 모바일 E2E
```

GitHub Pages 배포용 빌드는 `BASE_PATH=/gambling/ npm run build`로 만든다. CI는 typecheck, test, rtp, build, check:bundle, i18n 동기화 검사 순서로 돈다.

## 숨은 URL 매개변수

게임 UI에는 드러나지 않는 옵션이다.

| 매개변수 | 값 | 뜻 |
|---|---|---|
| `?seed=` | 임의의 문자열 | 시드를 고정한다. 값이 있으면 수업 모드(class)가 된다. 같은 시드는 같은 결과를 낸다. |
| `?fx=off` | `off` | 무자극 모드. 점멸, 흔들림, 사운드 등 연출을 끈다. 결과는 같다. |
| `?sv=b` | `b` | 슬롯 변형 B를 쓴다. 기본값은 `a`다. |
| `?lang=` | `ko`, `en`, `it` | 언어를 지정한다. 없으면 저장된 설정, 브라우저 언어, 순서로 정하고 기본값은 `ko`다. |
| (understanding) `?demo=1` | `1` | 실제 세션 기록이 없을 때 데모 세션으로 해석 페이지를 연다. |

## 앱으로 설치하고 삭제하기

게임은 PWA로 설치할 수 있다. 설치하면 전체 화면으로 열리고, 완전히 오프라인에서도 동작한다. 푸시 알림, 아이콘 배지, 백그라운드 동기화는 없다. 새 버전은 다음 실행 때 적용된다.

- **Android Chrome:** 로비의 "앱 설치" 버튼, 또는 메뉴의 "홈 화면에 추가 / 앱 설치".
- **iOS Safari:** 공유 버튼에서 "홈 화면에 추가". 로비에 안내 툴팁이 한 번 뜬다.
- **데스크톱 Chrome / Edge:** 주소창의 설치 아이콘, 또는 "앱 설치".

**삭제 방법:**

- Android: 앱 아이콘을 길게 눌러 제거하거나, 앱 정보에서 제거한다. 사이트 데이터는 Chrome 사이트 설정에서 지운다.
- iOS: 홈 화면의 아이콘을 길게 눌러 "앱 삭제"를 고른다. 사파리의 웹사이트 데이터도 설정에서 지울 수 있다.
- 데스크톱: 브라우저의 앱 관리 메뉴(Chrome, Edge의 설치된 앱 목록)나 OS의 앱 제거 메뉴에서 지운다.
- 브라우저 사이트 데이터(저장된 세션, 설정)를 지우려면 해당 브라우저의 "사이트 데이터 삭제"를 쓴다.

`/understanding/`에도 같은 안내가 있다.

## 안전 원칙

- **정직한 결과:** 결과는 정직하게 무작위로 뽑는다. 연출은 결과가 정해진 뒤에 표시만 한다. 플레이어 행동에 따라 확률을 몰래 바꾸지 않는다.
- **연출은 표시에만:** 결과용 난수 스트림과 연출용 난수 스트림을 분리했다. `?fx=off`와 켠 상태는 같은 시드에서 같은 결과를 내며, 이것을 테스트로 확인한다.
- **광과민성:** 점멸은 초당 3회 이하다(WCAG 2.3.1). 모든 점멸은 `flashGuard`를 거친다. 화면 흔들림에는 진폭 상한이 있다.
- **사운드:** 첫 상호작용 뒤에만 켜고, 마스터 볼륨에 상한을 둔다.
- **금지:** 실제 돈, 결제, 외부 네트워크 요청, 분석 도구, 쿠키, 리더보드, 일일 보상, 푸시, 배지, 백그라운드 동기화.
- **가상 브랜드:** 카지노는 "오로벨 카지노 / OROBELLE CASINO", 해양 아케이드 머신은 "심해전설 / ABYSS LEGEND"다. 실존 브랜드, 로고, 상용 에셋은 쓰지 않는다.
- **실제 사건:** 2006년 한국의 한 게임장 사건(바다이야기)의 구조를 가상 해양 머신으로 모델링했다. 제품 이름과 그래픽은 게임에 넣지 않았다. 출처가 있는 사건 해설은 `/understanding/`에만 둔다.
- gambling 번들에는 교육 용어와 해설을 넣지 않는다. `scripts/check-gambling-bundle.ts`가 빌드 결과물에서 금지어를 검사하고, 걸리면 CI가 실패한다.

## 도움

도박 문제가 걱정된다면 **한국도박문제예방치유원 1336**에 전화할 수 있다.

## 저장소 구조

```
index.html          게임 로비 (사이트 루트)
gambling/           게임 페이지: src/, games/ (slot, roulette, blackjack, crash, ocean), fx/
understanding/      해석 페이지: src/ (sections, charts, sim, analysis, demo)
shared/             공유 계층: rng, schema, logger, handoff, i18n, rules/ (규칙 엔진)
i18n/               문자열: gambling/, understanding/ (각각 ko, en, it)
scripts/            rtp-check, check-gambling-bundle, gen-demo, gen-icons, i18n-sync
public/icons/       PWA 아이콘
docs/               설계 문서
```

## 문서

- `docs/CONTEXT.md`: 목표, 구조, 확정 결정, 미결 사항 (단일 기준 문서)
- `docs/ARCHITECTURE.md`: 설계와 테스트 계획
- `docs/DECISIONS.md`: 결정 로그
- `docs/BASE_PROMPT.md`: 구현 프롬프트와 원칙

## 라이선스

CC BY-NC-SA 4.0 (Attribution-NonCommercial-ShareAlike 4.0 International) — see LICENSE. Fonts (Lilita One, Press Start 2P via @fontsource) are under the SIL Open Font License 1.1.
