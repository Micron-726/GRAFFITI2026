# GRAFFITI2026 투자 게임 — 프로젝트 개요

> 이 파일은 Claude Code 가 세션 시작 시 자동 로드. 새 Claude 세션이 빠르게 파악할 수 있도록 작성됨.

## 한 줄 요약

스타트업 투자 게임. 최대 21팀 참가, 4라운드(Seed → Series A → B → C), 각 라운드마다 주식 단계(투자) → 결과 발표(정산) → 매칭권 단계(입찰)로 진행. admin 이 라운드 진행을 통제하고, 참가자(플레이어)는 자기 화면에서 투자·입찰·매칭권 판매를 직접 함.

## 기술 스택

- **Next.js 15** (App Router, Server Actions, RSC)
- **TypeScript**, **Tailwind CSS**
- **Neon Postgres** (`@neondatabase/serverless` HTTP fetch 모드)
- **JWT 세션** (`jose`, HS256), **bcryptjs** 비밀번호 해시
- **Vercel** 배포 (git push → 자동 재배포)
- 외부 의존성 최소: 정산 그래프는 TSX/CSS 누적 막대 그래프, drag-and-drop 은 HTML5 native

## 화폐 단위 규약 ★ 중요

- **DB·서버 코드는 won (원) 단위**로 저장/계산.
- **UI 의 모든 입력·표시는 만원 (10,000) 단위**.
- 정산·환불 계산은 **만원 단위로 내림** (`FLOOR(x/10000)*10000` 또는 `floorToManwon(x)`).
- 헬퍼: [app/game/play/format.ts](app/game/play/format.ts) 의 `formatManwon`, `manwonToWon`, `wonToManwon`, `floorToManwon`, `MANWON` 상수.
- 입력 컨버전: UI 입력값(만원) → `manwonToWon(v)` 호출 → 서버로 won 단위 전달.

## 파일 구조

```
투자게임/
├── CLAUDE.md                    ← 이 파일
├── accounts.md                  ← 평문 계정 비번 메모 (gitignored)
├── config/
│   └── yield.ts                 ← 수익률 공식 매개변수 (μ_max, σ_*, k_scale)
│                                  팀 수·평균 시드는 DB 의 game_state 에 들어있음 (admin UI 에서 수정)
├── lib/
│   ├── db.ts                    ← Neon SQL 클라이언트
│   ├── auth.ts                  ← JWT 세션 (7일)
│   ├── users.ts                 ← AUTH_USERS_B64 디코드, bcrypt 검증
│   ├── permissions.ts           ← isAdminUsername, requireAdmin
│   └── game.ts                  ← op* (투자·입찰·판매), settleStockRound, readGameState, computeYieldPct
├── app/
│   ├── layout.tsx, globals.css, page.tsx
│   ├── components/NavBar.tsx, LoginForm.tsx
│   ├── login/page.tsx
│   ├── game/
│   │   ├── info/page.tsx (+ GameInfoTabs)
│   │   └── play/
│   │       ├── page.tsx         ← 서버, 로그인 게이트 + admin/player 분기
│   │       ├── data.ts          ← fetchGameData (page.tsx 와 display 가 공유)
│   │       ├── types.ts         ← 공유 타입 + ROUND/PHASE_LABELS + describeNext, latestSettledRound
│   │       ├── format.ts        ← 만원 단위 변환·포맷 헬퍼
│   │       ├── AdminDashboard.tsx ← admin 컨트롤 패널 (700+줄)
│   │       ├── PlayerView.tsx   ← 플레이어 화면
│   │       ├── shared.tsx       ← InvestmentBarChart, SettledResultsPanel, TicketHoldingsTable, AllTeamsSeedTable
│   │       └── display/
│   │           ├── page.tsx     ← 큰 화면용 디스플레이 라우트 (admin 전용)
│   │           └── DisplayView.tsx ← 읽기 전용 디스플레이 UI
│   ├── actions/
│   │   ├── admin.ts             ← admin 서버 액션 (모두 ActionResult 반환)
│   │   └── player.ts            ← player 서버 액션 (모두 ActionResult 반환)
│   └── api/
│       ├── login/route.ts       ← 401/500 구분
│       └── logout/route.ts
├── scripts/
│   ├── hash-password.mjs
│   ├── build-auth-users.mjs
│   ├── db-init.mjs              ← 모든 테이블 CREATE IF NOT EXISTS
│   └── db-reset.mjs
├── .env.local, .env.example
└── package.json, tsconfig.json, next.config.mjs, tailwind.config.ts, postcss.config.mjs
```

## 환경 변수

| 변수 | 용도 |
|---|---|
| `SESSION_SECRET` | JWT 서명 키 (32자+) |
| `AUTH_USERS_B64` | `[{username, passwordHash}]` 의 base64 ($ 충돌 회피용) |
| `ADMIN_USERNAMES` | admin username 콤마 구분 (기본 `admin`) |
| `DATABASE_URL` | Neon Postgres 연결 문자열 |
| `NEXT_PUBLIC_NOTION_URL` | (선택) Notion 메뉴 URL |

현재 계정: `admin/1234`, `test/test`, `test2/test2` (자세한 내용은 [accounts.md](accounts.md)).

## DB 스키마 (`npm run db:init`)

| 테이블 | 컬럼 | 비고 |
|---|---|---|
| `game_state` | id PK(=1), current_round, current_phase, **team_count**, **avg_initial_seed**, **matching_top_n** | 싱글톤. team_count/avg_initial_seed 는 수익률 공식에 사용, matching_top_n 은 매칭권 자동 정산 시 회사별 가격→개수→낮은 seed 순 상위 N 팀만 확정. 모두 admin UI 에서 수정 가능 |
| `companies` | id SERIAL PK, name UNIQUE, min_order_price, **sort_order**, created_at | sort_order 로 드래그 순서 관리. UI 에선 ID 대신 "순번" (sort_order+1) 표시 |
| `teams` | username PK, seed (CHECK >= 0) | seed 는 won 단위, 만원 배수 (앱이 강제) |
| `tickets` | (team, company) PK, count | |
| `investments` | (round, team, company) PK, amount | 정산 후에도 보존 (history) |
| `round_results` | (round, company) PK, yield_pct | 정산 결과 |
| `bids` | (team, company) PK, price, count | 한 팀 한 회사 = 한 가격. 정산·취소 시 삭제 |
| `matching_results` | (round, team, company) PK, bid_price, bid_count, awarded_count, min_order_price | 매칭권 정산 결과 스냅샷. 대기 단계에서 `성공 / 입찰` 및 보유 현황 `(+n)` 표시 |
| `ticket_sales` | (round, team, company) PK, count, refund_amount, min_order_price | 매칭권 단계 자발 판매 환급 기록. 대기 단계 My Results 에 표시 |

## 게임 상태 머신

```
(seed, idle) → stock → results → matching →
(series-a, idle) → ... → (series-c, matching) → (ended, idle)
```

[lib/game.ts](lib/game.ts) `computeNextState`. admin 의 **"다음 단계로 넘어가기"** 버튼(맨 아래 오른쪽).
- **stock → results** 전이 시 `settleStockRound` 자동 수익률 정산
- **matching → next round** 전이 시 `autoResolveMatchingPhase(round, matching_top_n)` 자동 매칭권 정산 (회사별 가격→개수→낮은 seed 순 상위 N 팀 확정, 그래도 같으면 랜덤, 나머지 50% 환불, 승자 최저가를 다음 최소 주문 금액으로 반영)

> 게임 상태 섹션의 라운드/페이즈 직접 변경 박스는 escape hatch — 두 자동 정산 모두 skip.

## 수익률 공식 (비대칭 σ)

```
R(M, Z) = mean(M) + σ(M, Z) · Z,   Z ~ N(0,1) ∩ [-1, 1]

mean(M)   = μ_max − 2·μ_max / (1 + k·M)
σ_up(M)   = σ_up_base   + σ_up_bonus   / (1 + k·M)     (Z ≥ 0)
σ_down(M) = σ_down_base + σ_down_growth · k·M/(1+k·M)  (Z < 0)

k = k_scale / (team_count × avg_initial_seed)    ← DB game_state 에서 읽음
```

- 파라미터: [config/yield.ts](config/yield.ts) (`u_max=5, σ_up_base=10, σ_up_bonus=17, σ_down_base=15, σ_down_growth=3, k_scale=10`)
- team_count, avg_initial_seed 는 DB 에서 읽음 (admin UI 게임 설정 섹션에서 수정 가능). ★ 테스트 때 작은 값으로 바꿔야 공식이 의도대로 동작 (예: test 계정 2개로 1000만원 seed 면 team_count=2, avg_initial_seed=10000000).
- `|2·u_max − σ_up_bonus|` = `|2·u_max − σ_down_growth|` = 7 → M 변화에 따른 저점·고점 변화량이 ≈ 균형 (각 ~5.7%). σ_up_bonus 를 σ_down_growth 보다 크게 두는 건 같지만, 그 차이가 너무 크면 고점 변동만 가팔라져 밸런스 깨짐.
- 20팀·평균 1000만원 기준 분포 (M=풀의 %): 1% → 평균 −1.8% / 저점 −19% / 고점 +21%. 10% → +0.5% / −17% / +19%. 100% → +2.7% / −14% / +16%.
- 구현: [lib/game.ts](lib/game.ts) `computeYieldPct(M, teamCount, avgInitialSeed)`. `settleStockRound` 가 game_state 에서 두 값을 읽고 회사별 SUM 후 호출 → 만원 단위 내림 적용.

## 인증·권한

- 비밀번호는 bcrypt 해시만 env (`AUTH_USERS_B64`)
- 로그인: `/api/login` 검증 → JWT → httpOnly+secure(prod)+sameSite=lax 쿠키 (7일)
- admin server action: `requireAdmin()` 권한 검증 후 try/catch 로 비즈니스 에러를 `{error}` 로 반환
- player server action: 세션 username 만 사용해서 자기 팀만 수정, phase 검증, 동일하게 `{error}` 반환
- LoginForm: 401 (비번 틀림) vs 500 (서버 에러) 구분 표시

## Server Actions 패턴 ★ 중요

모든 admin/player action 은 `Promise<ActionResult>` 반환 (`ActionResult = { error?: string }`). 예외 throw 안 함 (Next.js 의 server-error 오버레이 회피).

**클라이언트 사용 패턴**:
```ts
const result = await someAction(...);
if (result?.error) { setError(result.error); return; }
router.refresh();
```

[AdminDashboard.tsx](app/game/play/AdminDashboard.tsx) 와 [PlayerView.tsx](app/game/play/PlayerView.tsx) 의 `run()` 헬퍼가 이걸 처리하고 throw 도 catch.

### [app/actions/admin.ts](app/actions/admin.ts) (`requireAdmin` 필수)

| 함수 | 용도 |
|---|---|
| `setGameState(round, phase)` | 라운드/페이즈 직접 변경 (escape hatch) |
| `setGameConfig(teamCount, avgInitialSeed, matchingTopN)` | 수익률 공식 파라미터 + 매칭권 자동 정산 상위 N 변경 |
| `advanceToNextPhase()` | 정상 흐름. stock→results 시 수익률 정산, matching→next 시 매칭권 자동 정산 |
| `addCompany / updateCompany / deleteCompany` | 회사 CRUD. delete 시 sort_order 자동 압축 |
| `reorderCompanies(orderedIds: number[])` | 드래그로 순서 변경 — 새 순서대로 sort_order 0..N-1 재할당 |
| `setTeamSeed / deleteTeam / setTeamTickets` | 팀 직접 조정 |
| `setInvestment / clearInvestment` | admin 대리 투자 |
| `setBid / clearBid` | admin 대리 입찰 |
| `awardBid / refundFailedBid` | (수동) 매칭권 개별 승자 확정 / 패자 50% 환불 — 자동 정산 외 보정용 |
| `sellTickets` | admin 대리 매칭권 80% 판매 |

### [app/actions/player.ts](app/actions/player.ts) (세션 username 사용)

| 함수 | 사용 가능 phase |
|---|---|
| `playerSetInvestment(companyId, amount)` | stock |
| `playerClearInvestment(companyId)` | stock |
| `playerSetBid(companyId, price, count)` | matching |
| `playerClearBid(companyId)` | matching |
| `playerSellTickets(companyId, count)` | matching |

### [lib/game.ts](lib/game.ts) 공유 ops (auth 검증 안 함)

`opSetInvestment`, `opClearInvestment`, `opSetBid`, `opClearBid`, `opSellTickets(round, ...)`, `opAwardBid(round, ...)`, `opRefundFailedBid(round, ...)`, `settleStockRound`, `autoResolveMatchingPhase(round, topN)`, `readGameState`, `computeNextState`.

## 라우트 / UI 구조

| URL | 누구 | 내용 |
|---|---|---|
| `/game/play` | 비로그인 | "로그인 하시오" 페이지 |
| `/game/play` | 플레이어 | [PlayerView](app/game/play/PlayerView.tsx) — 본인 seed/투자/입찰/판매/결과 |
| `/game/play` | admin | [AdminDashboard](app/game/play/AdminDashboard.tsx) — 전체 컨트롤 |
| `/game/play/display` | admin | [DisplayView](app/game/play/display/DisplayView.tsx) — 큰 화면용 읽기 전용 (축소 헤더, 상위 팀 시드, 정산 결과 누적 막대 그래프, 매칭권 보유 매트릭스) |

`/game/play/display` 는 admin 대시보드 우측 상단의 "큰 화면용 디스플레이 열기 ↗" 링크로 새 탭에서 열기 가능. 게임 진행 중 큰 모니터에는 display 만 띄우고, 별도 노트북에서 admin 대시보드로 조작.

**AdminDashboard 섹션 순서**:
1. 게임 상태 (escape hatch 라운드/페이즈 선택)
2. **게임 설정** (team_count, avg_initial_seed, matching_top_n) — 수익률 공식 + 매칭권 자동 정산에 영향
3. 회사 (추가 + 드래그 정렬 + 만원 단위 수정/삭제)
4. 팀 (seed 만원 입력, 매칭권 개수, 미등록 계정 자동완성)
5. 주식 단계 매트릭스 (phase=stock 시)
6. 매칭권 단계 (phase=matching 시): 입찰 매트릭스 + 정산 리스트(상위 N 초록 강조, 경계 동률 랜덤 배지) + 자발 판매 폼. 수동 "확정"/"50% 환불" 버튼은 자동 정산 외 보정용으로 유지
7. SettledResultsPanel (round_results 있으면 항상, 회사 순서 유지 누적 막대 그래프)
8. TicketHoldingsTable
9. AdvanceButton (다음 단계로) — matching 일 때는 자동 정산 노트 표시

**PlayerView 섹션 (만원 단위 통일)**:
1. 헤더 (라운드/페이즈, 내 seed 만원 표시)
2. 주식 단계: 투자하기 (회사별 만원 입력, 보유/투자 합계 표시)
3. 매칭권 단계: 매칭권 구매 (만원 가격, 라이브 "이 회사에 쓸 금액", 최소가 미만 시 "금액이 낮습니다" + 버튼 비활성)
4. 매칭권 단계: 매칭권 판매 (80% 환불 만원 단위 내림, 미리보기)
5. My Results: 결과 발표 단계에는 내 투자 수익 요약/상세, 대기 단계에는 직전 라운드 매칭권 `성공 / 입찰` 및 판매 환급
6. SettledResultsPanel (회사 순서 유지, 팀 고정색 누적 막대 그래프)
7. TicketHoldingsTable (대기 단계에는 모든 팀의 직전 매칭권 증가분을 `5 (+2)` 형태로 표시)

**폴링**: 양쪽 다 3초마다 `router.refresh()`. 폼 입력값은 로컬 state 라 안 덮어쓰임.

**보안**: 플레이어 화면엔 자기 입찰만 fetch ([app/game/play/data.ts](app/game/play/data.ts) `WHERE team_username = ${username}`).

## 자주 하는 작업

| 하고 싶은 것 | 방법 |
|---|---|
| 계정 추가/비번 변경 | `npm run build-auth-users -- admin:1234 test:test test2:test2 ...` → 출력 base64 를 `.env.local` 및 Vercel env `AUTH_USERS_B64` 에 교체. [accounts.md](accounts.md) 표도 갱신 |
| 수익률 공식 튜닝 | [config/yield.ts](config/yield.ts) 6개 숫자 수정 → git push |
| 팀 수·평균 시드·매칭권 상위 N 변경 | admin 대시보드의 "게임 설정" 섹션 (DB 에 저장됨, 재배포 불필요) |
| 게임 설명 페이지 힌트 수정 | [app/components/GameInfoTabs.tsx](app/components/GameInfoTabs.tsx) 의 `hint` stage 수정 — 공식·전략 텍스트 |
| 회사 순서 변경 | admin 대시보드 회사 섹션 ⋮⋮ 핸들 드래그 |
| DB 스키마 변경 후 적용 | `npm run db:reset && npm run db:init` (테스트 데이터 OK 가정) |
| 로컬 개발 | `npm run dev` → http://localhost:3000 |
| Vercel 재배포 | `git push` 하면 자동 |
| 큰 화면 띄우기 | admin 로그인 → `/game/play/display` 또는 admin 대시보드 우상단 링크 |

## 알아두면 좋은 디테일 / 함정

- **만원 단위 강제**: 모든 정산·환불 계산은 `FLOOR(x / 10000) * 10000` 패턴으로 만원 단위로 내림. 클라이언트 입력은 만원 단위 → `manwonToWon(v)` 변환 후 서버 전송. 새 곳에서 금액을 다룰 때 항상 만원 변환 잊지 말 것.
- **Server Action 에러 패턴**: 비즈니스 에러는 `{error: string}` 반환 (throw X). 권한 에러만 throw. 클라이언트 `run()` 헬퍼가 둘 다 처리.
- **dotenv `$` 확장 문제**: bcrypt 해시의 `$` 가 dotenv-expand 와 충돌 → JSON 을 base64 로 감싸 `AUTH_USERS_B64` 로 보관.
- **`@vercel/postgres` deprecated**: `@neondatabase/serverless` 사용. HTTP fetch 모드라 단일 쿼리만, 다중 statement 는 `sql.query()`.
- **Neon 의 INT/NUMERIC string 반환**: [data.ts](app/game/play/data.ts) 가 모든 숫자 필드를 `Number()` 로 정규화. lib/game.ts 도 `Number(M)` 으로 방어.
- **`investments.round` PK 컬럼**: 정산 후에도 안 지움. 정산 막대 그래프와 결과 패널이 이 history 를 읽음.
- **display seed 공개 타이밍**: 주식 단계/매칭권 단계에서는 진행 중 투자·입찰로 차감된 seed 를 공개하지 않고, 해당 금액을 다시 더해 직전 공개 seed 처럼 보이게 함. 결과 발표 단계와 다음 라운드 대기 단계에서만 바뀐 seed 를 공개.
- **매칭권 결과 공개 타이밍**: 매칭권 정산 결과는 `matching_results`, 판매 환급은 `ticket_sales` 에 저장하고, 다음 라운드 대기 단계에서만 My Results 와 TicketHoldingsTable 의 `(+n)`으로 노출.
- **정산 idempotency**: `settleStockRound` 는 `round_results` 가 이미 있으면 no-op. 재진입 안전.
- **manual setGameState 는 정산 skip**: 정상 흐름은 항상 advanceToNextPhase 사용.
- **bid 의 seed 차감**: 입찰 시 `price × count` 즉시 차감. clearBid 는 전액 환불, awardBid 는 환불 없음 (매칭권 전환), refundFailedBid 는 50% 환불 (만원 내림).
- **opSellTickets 환불**: `floor(min_order_price × count × 0.8 / 10000) * 10000`
- **세션 만료 7일**: [lib/auth.ts](lib/auth.ts) `MAX_AGE_SECONDS`.
- **OneDrive 경로**: npm install 중 파일 잠금 발생 가능 — OneDrive 일시정지 후 재시도.
- **드래그 동작**: HTML5 native. ⋮⋮ 핸들이 draggable=true, 행 자체가 drop target. 새 순서는 클라이언트에서 계산 후 `reorderCompanies(orderedIds)` 호출.
- **회사 ID 표시 안 함**: SERIAL ID 는 삭제 후 빈 자리 생김 — UI 엔 sort_order 기준 1..N 의 "순번" 만 보임.
- **db:init 은 idempotent**: 신규 컬럼 추가 시 `ALTER TABLE ADD COLUMN IF NOT EXISTS` 한 줄을 db-init.mjs 에 추가하면 기존 DB 도 db:reset 없이 자동 마이그레이션 (예: matching_top_n 이 이 패턴).
- **게임 설명 페이지 (`/game/info`)**: 5개 탭 (Seed, Series A, B, C, 힌트). 힌트 탭에 수익률 공식과 전략 직관 표시. [GameInfoTabs.tsx](app/components/GameInfoTabs.tsx) 의 `STAGES` 배열 수정.

## 배포

- 레포: `https://github.com/Micron-726/GRAFFITI2026`
- Vercel: GitHub 연결, `git push` → 자동 (Hobby 무료)
- DB: Neon (현재 로컬·prod 동일 DB 공유). 분리하려면 Neon 신규 프로젝트 + prod env 갱신.
- 환경변수 변경 시 Vercel Deployments → Redeploy 한 번 (`NEXT_PUBLIC_*` 은 빌드 타임)
- 처음 배포: Vercel → New Project → repo import → 환경변수 등록 → Deploy

## 게임 룰 핵심

- **매칭권 효용**: 게임 종료 후 별도 사용 (게임 중 카운트만 의미). 최종 = 팀별 seed + 회사별 매칭권 개수.
- **80% 자발 판매** 와 **50% 패자 환불** 은 매칭 단계 내 별개 행동.
- **매칭권 정산**: `advanceToNextPhase` 호출 시 자동으로 회사별 가격→입찰 개수→낮은 seed 순 상위 `matching_top_n` 팀이 확정되고 나머지는 50% 환불. 가격/개수/seed 가 모두 같아 상위 N 경계가 갈리지 않으면 랜덤으로 끊음. admin 정산 미리보기는 상위 N 에만 "확정", 나머지에만 "50% 환불"을 표시하고 경계 랜덤 후보에 `랜덤` 배지를 붙임.
- **seed 음수 불가**: DB CHECK 제약. 정산 페이아웃 `GREATEST(0, ...)` 클램프.
- **모든 금액은 만원 단위**: 정산·환불 시 만원 단위 내림. 천원 이하는 모두 버림.
