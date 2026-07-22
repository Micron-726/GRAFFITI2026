import { sql } from "@/lib/db";
import { YIELD_CONFIG } from "@/config/yield";

// 플레이 가능한 라운드 순서 ('ended' 는 제외)
export const ROUND_ORDER = [
  "seed",
  "series-a",
  "series-b",
  "series-c",
] as const;

// 매칭권 자동정산 종료 시 다음 라운드의 min_order_price 는
//   - 승자 2명 이상: 2등 승자 가격
//   - 승자 1명: 그 팀 가격
//   - 승자 0명: 유지
// 회사별 초기 min_order_price 는 admin 이 회사 등록 시 설정 (initial_min_order_price 로 백업).
// 라운드별 강제 floor 는 없음.

// ===== 수익률 공식 (비대칭 σ) =====
// R(M, Z) = mean(M) + σ(M, Z) · Z, Z ~ N(0,1) ∩ [-1, 1]
// σ 는 Z 의 부호에 따라 다름 (config/yield.ts 주석 참조).

// 표준정규분포 샘플 (Box-Muller). |z|>1 이면 [-1, 1] 안의 값을 얻을 때까지 재시도.
function sampleTruncatedNormal(): number {
  for (let i = 0; i < 100; i++) {
    const u = 1 - Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    if (z >= -1 && z <= 1) return z;
  }
  return 0; // 안전망 — 사실상 도달 불가
}

// 회사별 총 투자금 M (원 단위) 으로부터 수익률(%) 계산.
// teamCount 와 avgInitialSeed 는 DB game_state 에서 읽은 값 (admin UI 에서 조정 가능).
function computeYieldPct(
  M: number,
  teamCount: number,
  avgInitialSeed: number,
): number {
  const {
    mean_min,
    mean_max,
    sigma_up_max,
    sigma_up_min,
    sigma_down_max,
    sigma_down_min,
    k_scale,
  } = YIELD_CONFIG;

  const totalMoney = Math.max(1, teamCount * avgInitialSeed);
  const k = k_scale / totalMoney;
  const kM = k * (Number(M) || 0);

  const factorDown = kM / (1 + kM); // M=0 → 0, M=∞ → 1 (linear-in-M 스케일)
  const factorDownSq = factorDown * factorDown; // 2차 곡선. σ 를 여기에 태워서 저 M 에선 σ 유지, 고 M 에서 급감.

  // 평균: linear — M 클수록 mean_max 로 수렴. 모두 양수.
  const mean = mean_min + (mean_max - mean_min) * factorDown;
  // 상방·하방 변동: factorDown² 로 곡선 감소 → 저 M(비인기) 에선 σ 크게 유지,
  // M 커질수록 감소 폭이 가팔라져 인기 회사는 확 압축됨.
  const sigmaUp =
    sigma_up_max - (sigma_up_max - sigma_up_min) * factorDownSq;
  const sigmaDown =
    sigma_down_max - (sigma_down_max - sigma_down_min) * factorDownSq;

  const Z = sampleTruncatedNormal();
  const sigma = Z >= 0 ? sigmaUp : sigmaDown;
  return mean + sigma * Z;
}

export type GameStateRow = {
  current_round: string;
  current_phase: string;
  team_count: number;
  avg_initial_seed: number;
  matching_top_n: number;
};

export async function readGameState(): Promise<GameStateRow> {
  const rows = (await sql`
    SELECT current_round, current_phase, team_count, avg_initial_seed, matching_top_n
    FROM game_state WHERE id = 1
  `) as GameStateRow[];
  if (!rows[0]) {
    throw new Error("게임 상태가 없습니다 — npm run db:init 을 실행하세요.");
  }
  // Neon 이 NUMERIC/INT 를 string 으로 줄 수도 있어서 방어적 변환.
  const r = rows[0];
  return {
    current_round: r.current_round,
    current_phase: r.current_phase,
    team_count: Number(r.team_count) || 25,
    avg_initial_seed: Number(r.avg_initial_seed) || 10_000_000,
    matching_top_n: Number(r.matching_top_n ?? 2),
  };
}

// 다음 단계 계산:
//   (seed, idle) → stock → results → matching → (series-a, idle) → ...
//   (series-c, matching) → (final, idle: 결과 발표 대기)
//                       → (final, preference: 지망 제출)
//                       → (final, final-result: 자동 매칭 결과)
//                       → (ended, idle)
export function computeNextState(
  round: string,
  phase: string,
): { round: string; phase: string } {
  if (round === "ended") return { round, phase };
  if (round === "final") {
    if (phase === "idle") return { round: "final", phase: "preference" };
    if (phase === "preference") return { round: "final", phase: "final-result" };
    if (phase === "final-result") return { round: "ended", phase: "idle" };
    return { round: "final", phase: "idle" };
  }
  if (phase === "idle") return { round, phase: "stock" };
  if (phase === "stock") return { round, phase: "results" };
  if (phase === "results") return { round, phase: "matching" };
  if (phase === "matching") {
    const idx = (ROUND_ORDER as readonly string[]).indexOf(round);
    if (idx < 0 || idx >= ROUND_ORDER.length - 1) {
      // series-c 매칭 종료 → 최종 팀 매칭 라운드의 idle (결과 발표 대기)
      return { round: "final", phase: "idle" };
    }
    return { round: ROUND_ORDER[idx + 1], phase: "idle" };
  }
  return { round, phase };
}

// ===== 투자 (round 별) =====
// 모든 금액은 won 단위. 앱 레이어에서 만원의 배수만 들어오게 강제.

export async function opSetInvestment(
  round: string,
  username: string,
  companyId: number,
  amount: number,
): Promise<void> {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error("투자 금액은 0 이상의 정수여야 합니다");
  }

  const existing = (await sql`
    SELECT amount FROM investments
    WHERE round = ${round} AND team_username = ${username} AND company_id = ${companyId}
  `) as { amount: number }[];
  const prev = Number(existing[0]?.amount ?? 0);
  const delta = amount - prev;

  if (delta > 0) {
    const teamRows = (await sql`
      SELECT seed FROM teams WHERE username = ${username}
    `) as { seed: number }[];
    const seed = Number(teamRows[0]?.seed ?? 0);
    if (seed < delta) {
      throw new Error(`보유 시드가 부족합니다 (보유 ${seed}, 추가 필요 ${delta})`);
    }
  }

  if (delta !== 0) {
    await sql`UPDATE teams SET seed = seed - ${delta} WHERE username = ${username}`;
  }
  await sql`
    INSERT INTO investments (round, team_username, company_id, amount)
    VALUES (${round}, ${username}, ${companyId}, ${amount})
    ON CONFLICT (round, team_username, company_id)
    DO UPDATE SET amount = EXCLUDED.amount
  `;
}

export async function opClearInvestment(
  round: string,
  username: string,
  companyId: number,
): Promise<void> {
  const existing = (await sql`
    SELECT amount FROM investments
    WHERE round = ${round} AND team_username = ${username} AND company_id = ${companyId}
  `) as { amount: number }[];
  const prev = Number(existing[0]?.amount ?? 0);

  if (prev > 0) {
    await sql`UPDATE teams SET seed = seed + ${prev} WHERE username = ${username}`;
  }
  await sql`
    DELETE FROM investments
    WHERE round = ${round} AND team_username = ${username} AND company_id = ${companyId}
  `;
}

// 주식 단계 정산: 회사별 총 투자금 M 으로 R(M) 을 계산해 수익률을 결정,
// 모든 투자에 적용하고 round_results 에 기록.
// 이미 정산된 라운드면 (round_results 존재) 아무것도 하지 않음 (중복 정산 방지).
export async function settleStockRound(round: string): Promise<void> {
  const already = (await sql`
    SELECT 1 FROM round_results WHERE round = ${round} LIMIT 1
  `) as unknown[];
  if (already.length > 0) return;

  const { team_count, avg_initial_seed } = await readGameState();
  const companies = (await sql`SELECT id FROM companies`) as { id: number }[];

  for (const c of companies) {
    // 회사별 총 투자금 M 집계
    const sumRows = (await sql`
      SELECT COALESCE(SUM(amount), 0)::BIGINT AS m
      FROM investments
      WHERE company_id = ${c.id} AND round = ${round}
    `) as { m: number | string }[];
    const M = Number(sumRows[0]?.m ?? 0);

    const yieldPct = Math.round(computeYieldPct(M, team_count, avg_initial_seed));

    // 페이아웃 계산: amount × (1 + y/100) 를 만원(10000)의 배수로 내림.
    // 또한 음수가 되지 않도록 GREATEST(0, ...) 로 클램프.
    await sql`
      UPDATE teams t
      SET seed = t.seed + GREATEST(
        0,
        FLOOR(i.amount * (1 + (${yieldPct}::numeric) / 100.0) / 10000)::INTEGER * 10000
      )
      FROM investments i
      WHERE t.username = i.team_username
        AND i.company_id = ${c.id}
        AND i.round = ${round}
    `;
    await sql`
      INSERT INTO round_results (round, company_id, yield_pct)
      VALUES (${round}, ${c.id}, ${yieldPct})
      ON CONFLICT (round, company_id) DO UPDATE SET yield_pct = EXCLUDED.yield_pct
    `;
  }
}

// ===== 매칭권 입찰 (한 팀, 한 회사 = 한 가격) =====

export async function opSetBid(
  username: string,
  companyId: number,
  price: number,
  count: number,
): Promise<void> {
  if (!Number.isInteger(price) || price < 0) {
    throw new Error("가격은 0 이상의 정수여야 합니다");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("개수는 1 이상의 정수여야 합니다");
  }

  const companyRows = (await sql`
    SELECT min_order_price FROM companies WHERE id = ${companyId}
  `) as { min_order_price: number }[];
  if (!companyRows[0]) throw new Error("회사를 찾을 수 없습니다");
  const minPrice = Number(companyRows[0].min_order_price);
  if (price < minPrice) {
    throw new Error(`최소 주문 금액 이상이어야 합니다`);
  }

  const existing = (await sql`
    SELECT price, count FROM bids
    WHERE team_username = ${username} AND company_id = ${companyId}
  `) as { price: number; count: number }[];
  const prevTotal = existing[0]
    ? Number(existing[0].price) * Number(existing[0].count)
    : 0;
  const newTotal = price * count;
  const delta = newTotal - prevTotal;

  if (delta > 0) {
    const teamRows = (await sql`
      SELECT seed FROM teams WHERE username = ${username}
    `) as { seed: number }[];
    const seed = Number(teamRows[0]?.seed ?? 0);
    if (seed < delta) {
      throw new Error(`보유 시드가 부족합니다 (보유 ${seed}, 추가 필요 ${delta})`);
    }
  }

  if (delta !== 0) {
    await sql`UPDATE teams SET seed = seed - ${delta} WHERE username = ${username}`;
  }
  await sql`
    INSERT INTO bids (team_username, company_id, price, count)
    VALUES (${username}, ${companyId}, ${price}, ${count})
    ON CONFLICT (team_username, company_id)
    DO UPDATE SET price = EXCLUDED.price, count = EXCLUDED.count
  `;
}

export async function opClearBid(
  username: string,
  companyId: number,
): Promise<void> {
  const existing = (await sql`
    SELECT price, count FROM bids
    WHERE team_username = ${username} AND company_id = ${companyId}
  `) as { price: number; count: number }[];

  if (existing[0]) {
    const refund = Number(existing[0].price) * Number(existing[0].count);
    await sql`UPDATE teams SET seed = seed + ${refund} WHERE username = ${username}`;
  }
  await sql`
    DELETE FROM bids WHERE team_username = ${username} AND company_id = ${companyId}
  `;
}

// 입찰 승자 처리: 입찰 count 만큼 tickets 추가, 환불 없음 (이미 차감됨).
export async function opAwardBid(
  round: string,
  username: string,
  companyId: number,
): Promise<void> {
  const bidRows = (await sql`
    SELECT price, count FROM bids
    WHERE team_username = ${username} AND company_id = ${companyId}
  `) as { price: number; count: number }[];
  if (!bidRows[0]) throw new Error("해당 입찰을 찾을 수 없습니다");
  const price = Number(bidRows[0].price);
  const cnt = Number(bidRows[0].count);

  await sql`INSERT INTO teams (username, seed) VALUES (${username}, 0) ON CONFLICT (username) DO NOTHING`;
  await sql`
    INSERT INTO tickets (team_username, company_id, count)
    VALUES (${username}, ${companyId}, ${cnt})
    ON CONFLICT (team_username, company_id)
    DO UPDATE SET count = tickets.count + EXCLUDED.count
  `;
  await recordMatchingResult(round, username, companyId, price, cnt, cnt);
  await sql`DELETE FROM bids WHERE team_username = ${username} AND company_id = ${companyId}`;
}

// 패자 처리: 가격×개수 의 80% 환불 (만원 내림), 입찰 삭제.
// 매칭권 자발적 판매(opSellTickets) 도 80% 인 것과 통일.
export async function opRefundFailedBid(
  round: string,
  username: string,
  companyId: number,
): Promise<void> {
  const bidRows = (await sql`
    SELECT price, count FROM bids
    WHERE team_username = ${username} AND company_id = ${companyId}
  `) as { price: number; count: number }[];
  if (!bidRows[0]) throw new Error("해당 입찰을 찾을 수 없습니다");

  const total = Number(bidRows[0].price) * Number(bidRows[0].count);
  const refundAmt = Math.floor((total * 0.8) / 10000) * 10000;
  await sql`UPDATE teams SET seed = seed + ${refundAmt} WHERE username = ${username}`;
  await recordMatchingResult(
    round,
    username,
    companyId,
    Number(bidRows[0].price),
    Number(bidRows[0].count),
    0,
  );
  await sql`DELETE FROM bids WHERE team_username = ${username} AND company_id = ${companyId}`;
}

async function recordMatchingResult(
  round: string,
  username: string,
  companyId: number,
  bidPrice: number,
  bidCount: number,
  awardedCount: number,
): Promise<void> {
  const companyRows = (await sql`
    SELECT min_order_price FROM companies WHERE id = ${companyId}
  `) as { min_order_price: number }[];
  const minOrderPrice = Number(companyRows[0]?.min_order_price ?? 0);

  await sql`
    INSERT INTO matching_results (
      round,
      team_username,
      company_id,
      bid_price,
      bid_count,
      awarded_count,
      min_order_price
    )
    VALUES (
      ${round},
      ${username},
      ${companyId},
      ${bidPrice},
      ${bidCount},
      ${awardedCount},
      ${minOrderPrice}
    )
    ON CONFLICT (round, team_username, company_id)
    DO UPDATE SET
      bid_price = EXCLUDED.bid_price,
      bid_count = EXCLUDED.bid_count,
      awarded_count = EXCLUDED.awarded_count,
      min_order_price = EXCLUDED.min_order_price,
      resolved_at = NOW()
  `;
}

// 매칭권 단계 자동 정산.
// 회사별 정렬 우선순위:
//   1. price DESC          (높은 가격이 우선)
//   2. count  DESC         (같은 가격이면 많이 산 팀이 우선)
//   3. seed   ASC          (count 까지 같으면 시드 적은 팀이 우선)
//   4. RANDOM()            (시드까지 같으면 무작위)
// 상위 topN 팀은 매칭권 확정, 나머지는 80% 환불.
// 다음 라운드 min_order_price 갱신:
//   - 승자 2명 이상: 2등 승자 가격
//   - 승자 1명: 그 팀 가격
//   - 승자 0명: 기존 값 유지
export async function autoResolveMatchingPhase(
  round: string,
  topN: number,
): Promise<void> {
  if (!Number.isInteger(topN) || topN < 0) {
    throw new Error("매칭권 상위 N 값은 0 이상의 정수여야 합니다");
  }
  const companies = (await sql`SELECT id FROM companies`) as { id: number }[];
  for (const c of companies) {
    const bids = (await sql`
      SELECT b.team_username, b.price, b.count, t.seed
      FROM bids b
      JOIN teams t ON t.username = b.team_username
      WHERE b.company_id = ${c.id}
      ORDER BY b.price DESC, b.count DESC, t.seed ASC, RANDOM()
    `) as { team_username: string; price: number; count: number; seed: number }[];

    // price DESC 정렬이므로 winnerPrices[0] 이 1등, [1] 이 2등.
    const winnerPrices: number[] = [];
    for (let i = 0; i < bids.length; i++) {
      const b = bids[i];
      if (i < topN) {
        winnerPrices.push(Number(b.price));
        await opAwardBid(round, b.team_username, c.id);
      } else {
        await opRefundFailedBid(round, b.team_username, c.id);
      }
    }

    // 다음 라운드 min_order_price 갱신
    // - 승자 2명 이상: 2등 승자 가격
    // - 승자 1명: 1등 (= 그 팀) 가격
    // - 승자 0명: 유지
    const nextMinOrderPrice = winnerPrices[1] ?? winnerPrices[0];
    if (nextMinOrderPrice !== undefined) {
      await sql`UPDATE companies SET min_order_price = ${nextMinOrderPrice} WHERE id = ${c.id}`;
    }
  }
}

// 게임 전체 초기화: bids / round_results / investments / tickets 삭제,
// 모든 팀의 seed 를 game_state.avg_initial_seed 로 재설정, 라운드/페이즈 → (seed, idle).
// 회사·팀·게임 설정(team_count, avg_initial_seed, matching_top_n) 은 유지.
export async function opResetGame(): Promise<void> {
  const { avg_initial_seed } = await readGameState();
  await sql`DELETE FROM bids`;
  await sql`DELETE FROM ticket_sales`;
  await sql`DELETE FROM matching_results`;
  await sql`DELETE FROM round_results`;
  await sql`DELETE FROM investments`;
  await sql`DELETE FROM tickets`;
  await sql`DELETE FROM preferences`;
  await sql`DELETE FROM final_matches`;
  // tickets 이미 삭제되었으므로 display_count 도 자연히 없음
  await sql`UPDATE teams SET seed = ${avg_initial_seed}, display_seed = NULL`;
  // 매칭권 자동정산이 덮어쓴 min_order_price 를 admin 이 마지막에 설정한 초기값으로 복구.
  await sql`
    UPDATE companies
    SET min_order_price = initial_min_order_price
  `;
  await sql`UPDATE game_state SET current_round = 'seed', current_phase = 'idle' WHERE id = 1`;
}

// 디스플레이·순위 표시용 시드 스냅샷.
// 주식/매칭권 단계 진입 시 seed 를 display_seed 에 박제 → 단계 진행 중 다른 팀의
// 실시간 시드가 화면에 노출되지 않도록 함. 결과/대기 단계에서는 clear 해서 실시간 seed 사용.
export async function freezeTeamSnapshot(): Promise<void> {
  await sql`UPDATE teams SET display_seed = seed`;
}

export async function clearTeamSnapshot(): Promise<void> {
  await sql`UPDATE teams SET display_seed = NULL`;
}

// 매칭권 개수 스냅샷. matching 단계 동안 판매(opSellTickets) 로 count 가 즉시 감소해도
// 다른 팀 화면에서는 스냅샷을 보여줌. 결과 발표 대기 단계에서 clear 해서 실 count + (-N) delta 표시.
export async function freezeTicketSnapshot(): Promise<void> {
  await sql`UPDATE tickets SET display_count = count`;
}

export async function clearTicketSnapshot(): Promise<void> {
  await sql`UPDATE tickets SET display_count = NULL`;
}

// 매칭권 자발적 판매: 현재 최소 주문 금액 × 개수 의 80% 환불 (만원 내림)
export async function opSellTickets(
  round: string,
  username: string,
  companyId: number,
  count: number,
): Promise<void> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("개수는 1 이상의 정수여야 합니다");
  }

  const ticketRows = (await sql`
    SELECT count FROM tickets
    WHERE team_username = ${username} AND company_id = ${companyId}
  `) as { count: number }[];
  const owned = Number(ticketRows[0]?.count ?? 0);
  if (owned < count) {
    throw new Error(`보유 매칭권이 부족합니다 (보유 ${owned}, 요청 ${count})`);
  }

  const companyRows = (await sql`
    SELECT min_order_price FROM companies WHERE id = ${companyId}
  `) as { min_order_price: number }[];
  if (!companyRows[0]) throw new Error("회사를 찾을 수 없습니다");
  const minPrice = Number(companyRows[0].min_order_price);

  // 80% 환불을 만원 단위 내림
  const refund = Math.floor((minPrice * count * 0.8) / 10000) * 10000;
  await sql`UPDATE teams SET seed = seed + ${refund} WHERE username = ${username}`;
  await recordTicketSale(round, username, companyId, count, refund, minPrice);
  await sql`
    UPDATE tickets SET count = count - ${count}
    WHERE team_username = ${username} AND company_id = ${companyId}
  `;
}

async function recordTicketSale(
  round: string,
  username: string,
  companyId: number,
  count: number,
  refundAmount: number,
  minOrderPrice: number,
): Promise<void> {
  await sql`
    INSERT INTO ticket_sales (
      round,
      team_username,
      company_id,
      count,
      refund_amount,
      min_order_price
    )
    VALUES (
      ${round},
      ${username},
      ${companyId},
      ${count},
      ${refundAmount},
      ${minOrderPrice}
    )
    ON CONFLICT (round, team_username, company_id)
    DO UPDATE SET
      count = ticket_sales.count + EXCLUDED.count,
      refund_amount = ticket_sales.refund_amount + EXCLUDED.refund_amount,
      min_order_price = EXCLUDED.min_order_price,
      sold_at = NOW()
  `;
}

// ===== 최종 팀 매칭 (Series C 이후) =====
// 각 참가자가 회사별 지망 순위를 제출 → advance 시 자동으로 회사에 배정.
// 배정 알고리즘:
//   for rank in 1..N:
//     unmatched 팀들의 rank 지망 회사 별로 후보 그룹핑
//     회사별 남은 슬롯만큼 [tickets DESC, seed DESC, RANDOM()] 순으로 배정
//     ※ 매칭권 구매 정산은 seed ASC (적은 팀 우선) 이지만, 여긴 seed DESC (많이 남은 팀 우선).
// 지망 순위가 매칭권/시드보다 강한 우선순위 (예: 1지망 0장 팀 > 2지망 30장 팀).

export async function opSetPreference(
  username: string,
  companyId: number,
  rank: number,
): Promise<void> {
  if (!Number.isInteger(rank) || rank < 1) {
    throw new Error("지망 순위는 1 이상의 정수여야 합니다");
  }
  const companyCount = (await sql`SELECT COUNT(*)::INT AS c FROM companies`) as { c: number }[];
  const max = Number(companyCount[0]?.c ?? 0);
  if (rank > max) {
    throw new Error(`지망 순위는 ${max} 이하여야 합니다 (전체 회사 수)`);
  }
  // (team, company) unique + (team, rank) unique → 같은 팀이 같은 회사에 두 순위 X,
  // 같은 팀이 같은 순위에 두 회사 X. 기존 (team, company) 는 rank 만 갱신,
  // 다른 회사에 같은 rank 가 있으면 그것부터 지워야 함.
  await sql`
    DELETE FROM preferences
    WHERE team_username = ${username} AND rank = ${rank} AND company_id <> ${companyId}
  `;
  await sql`
    INSERT INTO preferences (team_username, company_id, rank)
    VALUES (${username}, ${companyId}, ${rank})
    ON CONFLICT (team_username, company_id) DO UPDATE SET rank = EXCLUDED.rank
  `;
}

export async function opClearPreference(
  username: string,
  companyId: number,
): Promise<void> {
  await sql`
    DELETE FROM preferences
    WHERE team_username = ${username} AND company_id = ${companyId}
  `;
}

// 최종 매칭 실행. 이미 결과가 있으면 skip (재진입 안전).
export async function computeFinalMatching(): Promise<void> {
  const already = (await sql`SELECT 1 FROM final_matches LIMIT 1`) as unknown[];
  if (already.length > 0) return;

  const companies = (await sql`
    SELECT id, max_slots FROM companies
  `) as { id: number; max_slots: number }[];
  const remainingSlots = new Map<number, number>();
  for (const c of companies) {
    remainingSlots.set(Number(c.id), Number(c.max_slots));
  }

  const teams = (await sql`SELECT username FROM teams`) as { username: string }[];
  const unmatched = new Set(teams.map((t) => t.username));

  // 지망 순위 최댓값 (팀별로 서로 다를 수 있으니 회사 개수까지 순회)
  const maxRankRows = (await sql`
    SELECT COALESCE(MAX(rank), 0)::INT AS r FROM preferences
  `) as { r: number }[];
  const maxRank = Number(maxRankRows[0]?.r ?? 0);

  for (let rank = 1; rank <= maxRank; rank++) {
    // rank 지망 후보를 회사별로 그룹핑 (아직 unmatched 팀만).
    // 우선순위: 매칭권 개수 DESC → seed DESC (많이 남은 팀 우선) → RANDOM()
    // ※ 매칭권 구매 정산은 seed ASC (적은 팀 우선) 이지만, 최종 팀 매칭은 반대로 seed DESC.
    const candidates = (await sql`
      SELECT p.team_username, p.company_id,
             COALESCE(SUM(t.count), 0)::INT AS total_tickets,
             COALESCE(MAX(tm.seed), 0)::BIGINT AS seed
      FROM preferences p
      JOIN teams tm ON tm.username = p.team_username
      LEFT JOIN tickets t ON t.team_username = p.team_username
      WHERE p.rank = ${rank}
      GROUP BY p.team_username, p.company_id, tm.seed
      ORDER BY p.company_id, total_tickets DESC, seed DESC, RANDOM()
    `) as {
      team_username: string;
      company_id: number;
      total_tickets: number;
      seed: number;
    }[];

    for (const cand of candidates) {
      if (!unmatched.has(cand.team_username)) continue;
      const cid = Number(cand.company_id);
      const left = remainingSlots.get(cid) ?? 0;
      if (left <= 0) continue;
      await sql`
        INSERT INTO final_matches (team_username, company_id, matched_rank)
        VALUES (${cand.team_username}, ${cid}, ${rank})
        ON CONFLICT (team_username) DO UPDATE
          SET company_id = EXCLUDED.company_id, matched_rank = EXCLUDED.matched_rank
      `;
      unmatched.delete(cand.team_username);
      remainingSlots.set(cid, left - 1);
    }
  }
}

