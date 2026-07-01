export type Round =
  | "seed"
  | "series-a"
  | "series-b"
  | "series-c"
  | "final"
  | "ended";

export type Phase =
  | "idle"
  | "stock"
  | "results"
  | "matching"
  | "preference"
  | "final-result";

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
  /** 최종 팀 매칭 단계에서 이 회사에 배정될 수 있는 팀 수 상한 */
  max_slots: number;
};

/** 최종 팀 매칭용 참가자 지망 (rank=1 이 1지망) */
export type Preference = {
  team_username: string;
  company_id: number;
  rank: number;
};

/** 최종 팀 매칭 결과: 팀 하나당 회사 하나 (미매칭 팀은 아예 행 없음) */
export type FinalMatch = {
  team_username: string;
  company_id: number;
  /** 배정된 지망 순위 (1 이면 1지망 배정, null 이면 배정 실패 팀은 애초에 이 테이블에 없음) */
  matched_rank: number;
};

export type Team = {
  username: string;
  seed: number;
  /** 디스플레이 화면·순위용 스냅샷. stock/matching 진입 시 freeze. NULL 이면 실시간 seed 사용. */
  display_seed: number | null;
};

export type Ticket = {
  team_username: string;
  company_id: number;
  count: number;
  /** matching 단계 동안 표시용 스냅샷. NULL 이면 실시간 count 사용. */
  display_count: number | null;
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
  preferences: Preference[];
  finalMatches: FinalMatch[];
  /** 인증 env 에 등록된, admin 이 아닌 사용자 목록 */
  configuredUsernames: string[];
};

export const ROUND_LABELS: Record<Round, string> = {
  seed: "Seed",
  "series-a": "Series A",
  "series-b": "Series B",
  "series-c": "Series C",
  final: "최종 팀 매칭",
  ended: "종료",
};

export const PHASE_LABELS: Record<Phase, string> = {
  idle: "대기",
  stock: "주식 단계",
  results: "결과 발표",
  matching: "매칭권 단계",
  preference: "지망 제출",
  "final-result": "매칭 결과",
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
  // final 라운드 idle 은 series-c 매칭 종료 직후 → 이전 매칭 라운드 = series-c
  if (round === "final") return "series-c";
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
  if (round === "final") {
    if (phase === "idle") return "최종 팀 매칭 · 지망 제출";
    if (phase === "preference") return "최종 팀 매칭 결과 발표";
    if (phase === "final-result") return "게임 종료";
    return "최종 팀 매칭 · 결과 발표";
  }
  if (phase === "idle") return `${ROUND_LABELS[round]} · 주식 단계 시작`;
  if (phase === "stock") return `${ROUND_LABELS[round]} · 결과 발표 (수익률 공식 정산)`;
  if (phase === "results") return `${ROUND_LABELS[round]} · 매칭권 단계`;
  if (phase === "matching") {
    const idx = PLAYABLE_ORDER.indexOf(round);
    if (idx < 0 || idx >= PLAYABLE_ORDER.length - 1) {
      return "최종 팀 매칭 · 결과 발표";
    }
    return `${ROUND_LABELS[PLAYABLE_ORDER[idx + 1]]} 라운드 · 대기`;
  }
  return "";
}
