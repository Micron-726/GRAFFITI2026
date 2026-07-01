// DB 스키마 초기화 스크립트
// 사용법: npm run db:init
// 스키마를 바꾼 뒤에는 npm run db:reset 후 npm run db:init 권장
import nextEnv from "@next/env";
import { neon } from "@neondatabase/serverless";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) {
  console.error("DATABASE_URL 환경 변수가 설정되어 있지 않습니다.");
  process.exit(1);
}

const sql = neon(url);

const statements = [
  // 싱글톤 게임 상태 + 게임 설정 (팀 수, 평균 시드머니).
  // 시드 단위는 won, 만원이 기본 단위 (10,000 의 배수). default = 1천만원 (10,000,000).
  // ★ round/phase 값 CHECK 은 앱 레이어에서 처리 (신규 phase 추가 시 DB 마이그레이션 부담 회피).
  `CREATE TABLE IF NOT EXISTS game_state (
     id INTEGER PRIMARY KEY DEFAULT 1,
     current_round TEXT NOT NULL DEFAULT 'seed',
     current_phase TEXT NOT NULL DEFAULT 'idle',
     team_count INTEGER NOT NULL DEFAULT 25 CHECK (team_count >= 1),
     avg_initial_seed INTEGER NOT NULL DEFAULT 10000000 CHECK (avg_initial_seed >= 1),
     matching_top_n INTEGER NOT NULL DEFAULT 2 CHECK (matching_top_n >= 0),
     CHECK (id = 1)
   )`,

  // 기존 DB 에 컬럼 추가 (없으면 무시). db:reset 안 해도 새 기능 동작하도록.
  `ALTER TABLE game_state ADD COLUMN IF NOT EXISTS matching_top_n INTEGER NOT NULL DEFAULT 2`,

  // 기존 DB 의 round/phase CHECK 제약 제거 (final/preference 추가 대응).
  // 익명 CHECK 이라 이름을 pg_constraint 에서 찾아 지움.
  `DO $$
   DECLARE r RECORD;
   BEGIN
     FOR r IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'game_state'::regclass AND contype = 'c'
                AND pg_get_constraintdef(oid) LIKE '%current_round%' LOOP
       EXECUTE 'ALTER TABLE game_state DROP CONSTRAINT ' || quote_ident(r.conname);
     END LOOP;
     FOR r IN SELECT conname FROM pg_constraint
              WHERE conrelid = 'game_state'::regclass AND contype = 'c'
                AND pg_get_constraintdef(oid) LIKE '%current_phase%' LOOP
       EXECUTE 'ALTER TABLE game_state DROP CONSTRAINT ' || quote_ident(r.conname);
     END LOOP;
   END $$`,

  `INSERT INTO game_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,

  // sort_order: 사용자가 드래그로 회사 순서를 바꿀 때 사용. ID 는 SERIAL 이라 삭제 시 빈
  // 자리가 생기지만, UI 에선 sort_order 기준으로 "순번" 1..N 을 표시함.
  // max_slots: 최종 팀 매칭 단계에서 이 회사에 배정될 수 있는 팀 수 상한.
  `CREATE TABLE IF NOT EXISTS companies (
     id SERIAL PRIMARY KEY,
     name TEXT UNIQUE NOT NULL,
     min_order_price INTEGER NOT NULL DEFAULT 0 CHECK (min_order_price >= 0),
     initial_min_order_price INTEGER NOT NULL DEFAULT 0 CHECK (initial_min_order_price >= 0),
     sort_order INTEGER NOT NULL DEFAULT 0,
     max_slots INTEGER NOT NULL DEFAULT 1 CHECK (max_slots >= 0),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // initial_min_order_price: 게임 초기화 시 min_order_price 를 이 값으로 복구.
  // 기존 DB 마이그레이션: 컬럼 없으면 추가하고 현재 min_order_price 값으로 채움.
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS initial_min_order_price INTEGER NOT NULL DEFAULT 0 CHECK (initial_min_order_price >= 0)`,
  `UPDATE companies SET initial_min_order_price = min_order_price WHERE initial_min_order_price = 0 AND min_order_price > 0`,
  `ALTER TABLE companies ADD COLUMN IF NOT EXISTS max_slots INTEGER NOT NULL DEFAULT 1 CHECK (max_slots >= 0)`,

  // 시드는 won 단위, 10,000 의 배수만 들어옴 (앱에서 강제). DB CHECK 로는 음수만 막음.
  // display_seed: stock/matching 단계 진입 시 seed 를 박제 → 디스플레이·순위 표시용.
  // NULL 이면 실시간 seed 를 그대로 사용.
  `CREATE TABLE IF NOT EXISTS teams (
     username TEXT PRIMARY KEY,
     seed INTEGER NOT NULL DEFAULT 0 CHECK (seed >= 0),
     display_seed INTEGER
   )`,

  `ALTER TABLE teams ADD COLUMN IF NOT EXISTS display_seed INTEGER`,

  // display_count: matching 단계 진입 시 count 를 박제 → 다른 팀의 매칭권 판매가
  // 그 즉시 표에 반영되지 않도록. NULL 이면 실시간 count 사용.
  `CREATE TABLE IF NOT EXISTS tickets (
     team_username TEXT NOT NULL REFERENCES teams(username) ON DELETE CASCADE,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
     display_count INTEGER,
     PRIMARY KEY (team_username, company_id)
   )`,

  `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS display_count INTEGER`,

  // 라운드별 투자 내역. 정산 후에도 삭제하지 않고 history 로 남김.
  `CREATE TABLE IF NOT EXISTS investments (
     round TEXT NOT NULL,
     team_username TEXT NOT NULL REFERENCES teams(username) ON DELETE CASCADE,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     amount INTEGER NOT NULL CHECK (amount >= 0),
     PRIMARY KEY (round, team_username, company_id)
   )`,

  // 라운드별 회사 수익률 (정산 시 기록)
  `CREATE TABLE IF NOT EXISTS round_results (
     round TEXT NOT NULL,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     yield_pct INTEGER NOT NULL,
     PRIMARY KEY (round, company_id)
   )`,

  `CREATE TABLE IF NOT EXISTS bids (
     team_username TEXT NOT NULL REFERENCES teams(username) ON DELETE CASCADE,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     price INTEGER NOT NULL CHECK (price >= 0),
     count INTEGER NOT NULL CHECK (count > 0),
     PRIMARY KEY (team_username, company_id)
   )`,

  // 매칭권 입찰 정산 이력. bids 는 정산 후 삭제되므로, 대기 단계에서 이전 라운드
  // 성공 개수/입찰 개수와 당시 최소 주문 금액을 보여주기 위해 별도 보존.
  `CREATE TABLE IF NOT EXISTS matching_results (
     round TEXT NOT NULL,
     team_username TEXT NOT NULL REFERENCES teams(username) ON DELETE CASCADE,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     bid_price INTEGER NOT NULL CHECK (bid_price >= 0),
     bid_count INTEGER NOT NULL CHECK (bid_count >= 0),
     awarded_count INTEGER NOT NULL CHECK (awarded_count >= 0),
     min_order_price INTEGER NOT NULL CHECK (min_order_price >= 0),
     resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (round, team_username, company_id)
   )`,

  // 매칭권 자발 판매 이력. 대기 단계에서 각 팀의 환급 금액을 보여주기 위해 보존.
  `CREATE TABLE IF NOT EXISTS ticket_sales (
     round TEXT NOT NULL,
     team_username TEXT NOT NULL REFERENCES teams(username) ON DELETE CASCADE,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     count INTEGER NOT NULL CHECK (count >= 0),
     refund_amount INTEGER NOT NULL CHECK (refund_amount >= 0),
     min_order_price INTEGER NOT NULL CHECK (min_order_price >= 0),
     sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (round, team_username, company_id)
   )`,

  // 최종 팀 매칭용 참가자 지망 (rank=1 이 1지망). (team, company) 로 유일.
  `CREATE TABLE IF NOT EXISTS preferences (
     team_username TEXT NOT NULL REFERENCES teams(username) ON DELETE CASCADE,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     rank INTEGER NOT NULL CHECK (rank >= 1),
     PRIMARY KEY (team_username, company_id),
     UNIQUE (team_username, rank)
   )`,

  // 최종 매칭 결과 — 팀 하나당 회사 하나. 미매칭 팀은 아예 행 없음.
  `CREATE TABLE IF NOT EXISTS final_matches (
     team_username TEXT PRIMARY KEY REFERENCES teams(username) ON DELETE CASCADE,
     company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
     matched_rank INTEGER NOT NULL CHECK (matched_rank >= 1)
   )`,
];

for (const stmt of statements) {
  const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
  console.log("→", preview, "...");
  await sql.query(stmt);
}

console.log("✓ DB 초기화 완료");
