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

## Phase 2 구현 결정
- 2026-11-25 [build] `chunkFileNames: assets/c-[hash].js`, sourcemap 끔, `optimizeDeps.include: ['pixi.js']`(개발 서버 지연 로드 504 방지), CI에서 `dist/.vite` 매니페스트는 검사 후 삭제(배포 안 함)
- 2026-11-25 [i18n] `t(key, params?, lang?)`, 페이지별 `import.meta.glob`로 사전 분리, `pickLang`은 주입 가능한 순수 함수
- 2026-11-25 [runtime] `eg.rt.v1`은 마지막 정산 시점 상태만 저장(라운드 중 저장 시 차감된 잔고로 재개되는 문제 방지), 재개는 fx·sv·잔고·세션 id가 모두 맞을 때만
- 2026-11-25 [fx] Pixi 장식 계층 실측 96.5KB gz(기준 91KB, 경고선 110KB 미만); 자연 종료는 계획 ms, 스킵·컨텍스트 손실만 실제 경과 ms 기록; 연출 난수는 WebGL 유무와 무관하게 같은 양 소비
- 2026-11-25 [fx] UI 피드백 소리(tap·tick)는 기록하지 않음, 음소거 중 기록 없음 — 기록은 결과에 대한 자극만
- 2026-11-25 [sfx] 마스터 0.5 상한 + 컴프레서 + −2dB 리미터, 모든 엔벨로프 어택 ≥10ms, 동시 14음, 휴대폰 스피커용 서브베이스 배음 추가, `unlock()`은 1초 안에 반드시 끝남(iOS resume 무한 대기 대비)
- 2026-11-25 [ui] 금색 글자는 3겹(글로우·외곽선·그라데이션), 무한 애니메이션은 opacity/transform만, fx=off는 `<html data-fx="off">` 한 곳으로 처리
- 2026-11-25 [lobby] 빈 게임 모듈은 로비로 되돌림(Phase 3에서 자연 해소), HUD 잔고 카운트업은 `fx.countup`이 아닌 HUD 자체 트윈(라운드 fx 기록 오염 방지), 레벨 표시는 내부값+1
- 2026-11-25 [lobby] 티커·HOT는 `pre("lobby")` 스트림, 표시한 항목마다 aux 기록, fx=off에서는 그리지도 기록하지도 않음; 앰비언트 루프는 페이지당 1회 시작
- 2026-11-25 [slot] 코어는 `ctx.fx.enabled`를 한 번만 읽어 표시 변형·기대 연출·축하 기록 여부를 정함(결과는 읽지 않음); STOP은 남은 릴을 80ms 간격으로 멈춤; 기대 연출은 터보에서도 릴당 1.2초 추가
- 2026-11-25 [slot] 감당할 수 없는 베팅은 가능한 최고 단계로 자동 하향, 20 미만이면 "크레딧 부족" 시트; 스핀 중 이탈하면 이미 정해진 결과로 축하 없이 정산
- 2026-11-25 [slot] 프레임 실측(375×812, DPR 2): 하드웨어 GPU 평균 16.7ms, CPU 4배 감속 17.3ms, 소프트웨어 WebGL 축하 구간 23.9ms(p95 50ms) — 축하 시작 첫 프레임 ~117ms 스파이크(4배 감속)는 P2-C1에서 처리
- 2026-11-25 [perf] Pixi 셰이더·아틀라스를 로드 직후 유휴 시간에 미리 준비, 티어 징글과 자주 쓰는 효과음은 unlock 뒤 OfflineAudioContext로 미리 렌더, 정산→축하 경로의 강제 동기 레이아웃 제거 — CPU 4배 감속에서 축하 시작 프레임 100~150ms → 50ms 이하
- 2026-11-25 [fx] 적응형 품질의 "빠름" 기준 = max(14ms, 1.15 × 관측 최소 프레임), 단계 하락 뒤 상승 대기는 2배씩(최대 80초) — 60Hz 화면에서 rAF 간격이 16.7ms 아래로 내려가지 않아 품질이 회복되지 않던 버그 수정; 블룸 필터는 넣지 않음
- 2026-11-25 [crash] 탭 시각(pointerdown 시점의 clock)으로 캐시아웃 판정, 손실은 조용하게(작은 연기·빨간 숫자만), 군중은 fx on에서만 생성·기록
- 2026-11-25 [roulette] 칩은 SPIN 때 차감, 셀 가장자리 탭으로 스플릿, 0행과 컬럼 행은 스크롤 영역 밖에 고정, 결과 보드는 store에 20개
- 2026-11-25 [blackjack] 슈는 store의 `{no,pos,rc}`로 저장해 이어하기에도 유지, 코어는 `Round.res`를 읽지 않음(카드 순서는 시드·슈 번호로만 결정), 홀카드 값은 뒤집기 전에는 DOM에 없음, 푸시도 tier 0 축하
- 2026-11-25 [cashout] 정산 화면은 크림색 감열지 티켓(OROBELLE 헤더, 금색 최종 크레딧), 위에서 아래로 인쇄 연출, 인쇄가 끝나야 "상세 내역 보기" 활성; 저장 실패와 무관하게 요약 해시를 붙여 같은 창에서 이동
- 2026-11-25 [cashout] 최고 당첨과 게임 목록은 일괄 지급 Ev를 제외(판이 아님), 일괄 지급액은 별도 "BONUS PAYOUT" 줄 — Phase 5에서 `summarize().maxWin`도 같은 기준으로 맞출 것
