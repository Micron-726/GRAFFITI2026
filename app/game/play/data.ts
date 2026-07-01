// 서버에서만 import. /game/play 와 /game/play/display 가 함께 사용.
import { sql } from "@/lib/db";
import { isAdminUsername } from "@/lib/permissions";
import { getAllUsernames } from "@/lib/users";
import type {
  Bid,
  Company,
  GameData,
  GameState,
  Investment,
  MatchingResult,
  RoundResult,
  Team,
  Ticket,
  TicketSale,
} from "./types";
import { compareUsernames } from "./types";

export async function fetchGameData(
  isAdmin: boolean,
  username: string,
): Promise<GameData> {
  const [
    stateRows,
    companyRows,
    teamRows,
    ticketRows,
    investmentRows,
    roundResultRows,
  ] = await Promise.all([
    sql`SELECT current_round, current_phase, team_count, avg_initial_seed, matching_top_n FROM game_state WHERE id = 1`,
    sql`SELECT id, name, min_order_price, sort_order FROM companies ORDER BY sort_order, id`,
    sql`SELECT username, seed FROM teams ORDER BY username`,
    sql`SELECT team_username, company_id, count FROM tickets`,
    sql`SELECT round, team_username, company_id, amount FROM investments`,
    sql`SELECT round, company_id, yield_pct FROM round_results`,
  ]);

  // admin 은 모든 입찰을, 플레이어는 자기 팀 입찰만 받음
  const bidRows = isAdmin
    ? await sql`SELECT team_username, company_id, price, count FROM bids`
    : await sql`SELECT team_username, company_id, price, count FROM bids WHERE team_username = ${username}`;

  let matchingResultRows: MatchingResult[] = [];
  try {
    matchingResultRows = (await sql`
      SELECT round, team_username, company_id, bid_price, bid_count, awarded_count, min_order_price
      FROM matching_results
    `) as MatchingResult[];
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("matching_results")) {
      throw e;
    }
  }

  let ticketSaleRows: TicketSale[] = [];
  try {
    ticketSaleRows = isAdmin
      ? ((await sql`
          SELECT round, team_username, company_id, count, refund_amount, min_order_price
          FROM ticket_sales
        `) as TicketSale[])
      : ((await sql`
          SELECT round, team_username, company_id, count, refund_amount, min_order_price
          FROM ticket_sales
          WHERE team_username = ${username}
        `) as TicketSale[]);
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("ticket_sales")) {
      throw e;
    }
  }

  const configuredUsernames = getAllUsernames()
    .filter((u) => !isAdminUsername(u))
    .sort(compareUsernames);

  // Neon 이 INTEGER/NUMERIC 을 string 으로 줄 수 있는 케이스 방어
  const state = stateRows[0] as
    | (Omit<GameState, "team_count" | "avg_initial_seed" | "matching_top_n"> & {
        team_count: number | string;
        avg_initial_seed: number | string;
        matching_top_n: number | string | null;
      })
    | undefined;

  return {
    state: state
      ? {
          current_round: state.current_round,
          current_phase: state.current_phase,
          team_count: Number(state.team_count) || 25,
          avg_initial_seed: Number(state.avg_initial_seed) || 10_000_000,
          matching_top_n: Number(state.matching_top_n ?? 2),
        }
      : undefined,
    companies: (companyRows as Company[]).map((c) => ({
      ...c,
      id: Number(c.id),
      min_order_price: Number(c.min_order_price),
      sort_order: Number(c.sort_order),
    })),
    teams: (teamRows as Team[])
      .map((t) => ({
        ...t,
        seed: Number(t.seed),
      }))
      .sort((a, b) => compareUsernames(a.username, b.username)),
    tickets: (ticketRows as Ticket[]).map((t) => ({
      ...t,
      company_id: Number(t.company_id),
      count: Number(t.count),
    })),
    investments: (investmentRows as Investment[]).map((i) => ({
      ...i,
      company_id: Number(i.company_id),
      amount: Number(i.amount),
    })),
    roundResults: (roundResultRows as RoundResult[]).map((r) => ({
      ...r,
      company_id: Number(r.company_id),
      yield_pct: Number(r.yield_pct),
    })),
    bids: (bidRows as Bid[]).map((b) => ({
      ...b,
      company_id: Number(b.company_id),
      price: Number(b.price),
      count: Number(b.count),
    })),
    matchingResults: matchingResultRows.map((r) => ({
      ...r,
      company_id: Number(r.company_id),
      bid_price: Number(r.bid_price),
      bid_count: Number(r.bid_count),
      awarded_count: Number(r.awarded_count),
      min_order_price: Number(r.min_order_price),
    })),
    ticketSales: ticketSaleRows.map((s) => ({
      ...s,
      company_id: Number(s.company_id),
      count: Number(s.count),
      refund_amount: Number(s.refund_amount),
      min_order_price: Number(s.min_order_price),
    })),
    configuredUsernames,
  };
}
