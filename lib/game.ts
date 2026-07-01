import { sql } from "@/lib/db";
import { YIELD_CONFIG } from "@/config/yield";

// 플레이 가능한 라운드 순서 ('ended' 는 제외)
export const ROUND_ORDER = [
  "seed",
  "series-a",
  "series-b",
  "series-c",
] as const;

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
    u_max,
    sigma_up_base,
    sigma_up_bonus,
    sigma_down_base,
    sigma_down_growth,
    k_scale,
  } = YIELD_CONFIG;

  const totalMoney = Math.max(1, teamCount * avgInitialSeed);
  const k = k_scale / totalMoney;
  const kM = k * (Number(M) || 0);

  const factorUp = 1 / (1 + kM); // M=0 → 1, M=∞ → 0
  const factorDown = kM / (1 + kM); // M=0 → 0, M=∞ → 1

  const mean = u_max - 2 * u_max * factorUp;
  const sigmaUp = sigma_up_base + sigma_up_bonus * factorUp;
  const sigmaDown = sigma_down_base + sigma_down_growth * factorDown;

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

// 다음 단계 계산: idle → stock → results → matching → (다음 라운드) idle ...
export function computeNextState(
  round: string,
  phase: string,
): { round: string; phase: string } {
  if (round === "ended") return { round, phase };
  if (phase === "idle") return { round, phase: "stock" };
  if (phase === "stock") return { round, phase: "results" };
  if (phase === "results") return { round, phase: "matching" };
  if (phase === "matching") {
    const idx = (ROUND_ORDER as readonly string[]).indexOf(round);
    if (idx < 0 || idx >= ROUND_ORDER.length - 1) {
      return { round: "ended", phase: "idle" };
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

// 패자 처리: 가격×개수 의 50% 환불 (만원 내림), 입찰 삭제.
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
  const refundAmt = Math.floor((total * 0.5) / 10000) * 10000;
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

// 매칭권 단계 자동 정산: 회사별로 가격 desc → 개수 desc → seed asc → random
// 순서로 상위 topN 팀 확정, 나머지는 50% 환불.
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

    // 승자가 있으면 다음 라운드의 min_order_price 를 승자 중 최저가로 갱신.
    if (winnerPrices.length > 0) {
      const newMinPrice = Math.min(...winnerPrices);
      await sql`UPDATE companies SET min_order_price = ${newMinPrice} WHERE id = ${c.id}`;
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
  await sql`UPDATE teams SET seed = ${avg_initial_seed}`;
  // 매칭권 자동정산이 덮어쓴 min_order_price 를 admin 이 마지막에 설정한 초기값으로 복구.
  await sql`UPDATE companies SET min_order_price = initial_min_order_price`;
  await sql`UPDATE game_state SET current_round = 'seed', current_phase = 'idle' WHERE id = 1`;
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
