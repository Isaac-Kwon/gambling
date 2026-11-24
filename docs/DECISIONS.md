# Decisions

- 2026-11-24 [url] Site deployed at https://isaack.dev/gambling/ (GitHub Pages project site, repo Isaac-Kwon/gambling) — custom domain comes from the user site, so no CNAME here
- 2026-11-24 [url] Lobby lives at site root (`/index.html` loads `/gambling/src/main.ts`), second page at `/understanding/` — user decision, replaces the redirect default
- 2026-11-24 [build] Vite `base` read from env `BASE_PATH` (default `/`, CI sets `/gambling/`) — one config for local dev and Pages
- 2026-11-24 [build] dist/404.html is a copy of dist/index.html (vite plugin) — Pages serves it for unknown paths, so deep links land on the lobby
- 2026-11-24 [build] `build.manifest: true`, target es2020 — later bundle-purity check walks dist/.vite/manifest.json
- 2026-11-24 [test] Tests are colocated `*.test.ts`, environment node — DOM env added only when a test needs it
- 2026-11-24 [i18n] Sync JSON dictionaries, `makeT` per-page modules (i18n.gambling / i18n.understanding, so each bundle only holds its own strings) fall back to ko on empty/missing — en/it hold keys only in MVP; test enforces key parity
- 2026-11-24 [deps] vite 8.3.8, typescript 7.0.2, vitest 5.1.1, vite-plugin-pwa 2.0.0 (peer supports vite ^8), pixi.js 8.23.0, uplot 1.6.32, tsx 4.23.15 — current releases; vite 8 is within vite-plugin-pwa peer range
- 2026-11-24 [ci] Actions: checkout@v6, setup-node@v6, upload-pages-artifact@v5, deploy-pages@v5 — rtp and check:bundle steps left as comments until those scripts exist
- 2026-11-24 [ci] CI uses `npm install` instead of `npm ci` — a lockfile generated on Windows drops @emnapi/core|runtime (rolldown wasm optional deps), so `npm ci` fails on Linux (npm bug); revisit when npm fixes it

## 설계 결정 (Fable)
설계 단계의 결정 전체 목록은 `docs/ARCHITECTURE.md` §14에 있다. 사용자 결정 요약:
- 2026-11-24 [user] 이펙트 엔진은 PixiJS v8 유지 (DOM+Canvas 2D 제안 기각) — 장식 계층만 Pixi, 게이트 탭 뒤 지연 로드
- 2026-11-24 [user] 브랜드 "오로벨 카지노 / OROBELLE CASINO", 해양 머신 "심해전설 / ABYSS LEGEND" 승인
- 2026-11-24 [user] 심해전설의 남은 보너스 큐는 세션 종료(또는 bust 직전) 시 일괄 지급 (몰수안 기각)
- 2026-11-24 [user] 슬롯 체감 변형 a(당첨 40.6%)·b(당첨 30.0%)를 둘 다 구현해 `?sv=b`로 비교한 뒤 결정
- 2026-11-24 [rtp] CI 기준을 "10⁶판 ±0.3%p"에서 "정확 계산 + 몬테카를로 4σ"로 변경 — 10⁶판 ±0.3%p는 슬롯 1.1σ, 해양 0.4σ에 불과

## Phase 1 구현 결정
- 2026-11-24 [types] `Lang`은 `shared/i18n.ts`에서 type-only import — 정의를 한 곳에 둠
- 2026-11-24 [schema] `NAV_TARGETS` 상수 추가, `Session.unreleased`는 일괄 지급액 기록으로 유지
- 2026-11-24 [rng] `Rng.int(n)`은 [1, 2^32] 밖이면 RangeError — 조용한 편향 방지
- 2026-11-24 [roulette] 잘못된 베팅은 지급 0(throw 안 함), 스플릿 인접성은 산술로 판정, `settle`/`wins`/`multOf` 공개 — 정산이 절대 멈추지 않게, 정확 계산과 실제 지급이 같은 함수를 쓰게
- 2026-11-24 [crash] 지급은 `floor(bet × round(cashoutAt×100)/100)` 정수 센트 계산, `multAt`에 1e-9 보정, 정확히 `timeOf(crash)`에 탭하면 실패 — 부동소수 오차 제거
- 2026-11-24 [blackjack] 10점 카드 두 장은 페어(스플릿 가능), 21·버스트는 자동 종료, 홀카드는 공개 시 카운트 반영(라운드 경계에서 카운트 = 나온 카드의 Hi-Lo 합), 번 카드 없음
- 2026-11-24 [blackjack] 기본 전략 엣지 10⁷판 0.4957% (SE 0.036%p); 무한 덱 EV와 차트가 다른 칸 2개(A,2 vs 5; A,4 vs 4)는 테스트에 명시
- 2026-11-24 [logger] `endedAt`은 epoch ms, 첫 `scheduleSave`는 즉시 저장 후 1.5초 스로틀
- 2026-11-24 [handoff] 요약에 `sv`·`lang`·`rm`·`unreleased` 포함, 압축은 `CompressionStream`(deflate-raw) 없으면 JSON base64url, 일괄 지급 Ev는 판 수·축하·추격 집계에서 제외
- 2026-11-24 [rtp] 크래시 정확값은 u = k/2^32 격자 적분, MC는 검사별 독립 스트림, `--quick`에서는 블랙잭 대역을 4 SE 넓힘
- 2026-11-25 [slot] 정확값: a 93.9901%(σ 2.712, 당첨 40.64%), b 93.9989%(σ 3.130, 당첨 29.999%); 닫힌 식과 32⁵ 전수 계산 일치; `hit`·`tierFreq`는 조합 수, 인덱스는 0부터
- 2026-11-25 [ocean] 정확값: 기본 59.9967% + 보너스 31.9853% = 91.9826%; 베팅은 20의 배수만 허용, 예시 시점·생물은 결과 스트림에서만 정함(연출 스트림은 티켓 일련번호만)
- 2026-11-25 [rtp] 해양 MC의 SE는 보너스를 트리거 판에 귀속한 i.i.d. 수익으로 계산(보존 법칙으로 지급 합과 일치 검증); 전체 rtp-check 55항목 약 15초
