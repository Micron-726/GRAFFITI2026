export type Round =
  | "seed"
  | "series-a"
  | "series-b"
  | "series-c"
  | "ended";

export type Phase = "idle" | "stock" | "results" | "matching";

export type GameState = {
  current_round: Round;
  current_phase: Phase;
  team_count: number;
  avg_initial_seed: number;
  matching_top_n: number;
};

export type Company = {
  id: number;
  name: string;
  min_order_price: number;
  sort_order: number;
};

export type Team = {
  username: string;
  seed: number;
};

export type Ticket = {
  team_username: string;
  company_id: number;
  count: number;
};

export type Investment = {
  round: Round;
  team_username: string;
  company_id: number;
  amount: number;
};

export type RoundResult = {
  round: Round;
  company_id: number;
  yield_pct: number;
};

export type Bid = {
  team_username: string;
  company_id: number;
  price: number;
  count: number;
};

export type MatchingResult = {
  round: Round;
  team_username: string;
  company_id: number;
  bid_price: number;
  bid_count: number;
  awarded_count: number;
  min_order_price: number;
};

export type TicketSale = {
  round: Round;
  team_username: string;
  company_id: number;
  count: number;
  refund_amount: number;
  min_order_price: number;
};

export type GameData = {
  state: GameState | undefined;
  companies: Company[];
  teams: Team[];
  tickets: Ticket[];
  investments: Investment[];
  roundResults: RoundResult[];
  bids: Bid[];
  matchingResults: MatchingResult[];
  ticketSales: TicketSale[];
  /** 인증 env 에 등록된, admin 이 아닌 사용자 목록 */
  configuredUsernames: string[];
};

export const ROUND_LABELS: Record<Round, string> = {
  seed: "Seed",
  "series-a": "Series A",
  "series-b": "Series B",
  "series-c": "Series C",
  ended: "종료",
};

export const PHASE_LABELS: Record<Phase, string> = {
  idle: "대기",
  stock: "주식 단계",
  results: "결과 발표",
  matching: "매칭권 단계",
};

const USERNAME_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

export function compareUsernames(a: string, b: string): number {
  return USERNAME_COLLATOR.compare(a, b);
}

const PLAYABLE_ORDER: Round[] = ["seed", "series-a", "series-b", "series-c"];

export function previousPlayableRound(round: Round): Round | null {
  if (round === "ended") return PLAYABLE_ORDER[PLAYABLE_ORDER.length - 1];
  const idx = PLAYABLE_ORDER.indexOf(round);
  if (idx <= 0) return null;
  return PLAYABLE_ORDER[idx - 1];
}

/** round_results 중 가장 마지막에 정산된 라운드 */
export function latestSettledRound(
  roundResults: RoundResult[],
): Round | null {
  let best: Round | null = null;
  let bestIdx = -1;
  for (const rr of roundResults) {
    const idx = PLAYABLE_ORDER.indexOf(rr.round);
    if (idx > bestIdx) {
      bestIdx = idx;
      best = rr.round;
    }
  }
  return best;
}

/** "다음 단계로 넘어가기" 버튼에 표시할 다음 상태 설명 (UI 전용) */
export function describeNext(round: Round, phase: Phase): string {
  if (round === "ended") return "게임이 종료되었습니다";
  if (phase === "idle") return `${ROUND_LABELS[round]} · 주식 단계 시작`;
  if (phase === "stock") return `${ROUND_LABELS[round]} · 결과 발표 (수익률 공식 정산)`;
  if (phase === "results") return `${ROUND_LABELS[round]} · 매칭권 단계`;
  if (phase === "matching") {
    const idx = PLAYABLE_ORDER.indexOf(round);
    if (idx < 0 || idx >= PLAYABLE_ORDER.length - 1) return "게임 종료";
    return `${ROUND_LABELS[PLAYABLE_ORDER[idx + 1]]} 라운드 · 대기`;
  }
  return "";
}
