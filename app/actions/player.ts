"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { isAdminUsername } from "@/lib/permissions";
import {
  readGameState,
  opSetInvestment,
  opClearInvestment,
  opSetBid,
  opClearBid,
  opSellTickets,
} from "@/lib/game";

export type ActionResult = { error?: string };

// 플레이어 본인 팀 액션. username 은 세션에서만 가져오므로 남의 팀은 조작 불가.
async function requirePlayer(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("로그인이 필요합니다");
  if (isAdminUsername(session.username)) {
    throw new Error("admin 계정은 이 기능을 사용할 수 없습니다");
  }
  return session.username;
}

function refresh() {
  revalidatePath("/game/play");
  revalidatePath("/game/play/display");
}

async function guard(
  fn: (username: string) => Promise<void>,
): Promise<ActionResult> {
  const username = await requirePlayer();
  try {
    await fn(username);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function playerSetInvestment(
  companyId: number,
  amount: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error("투자 금액은 0 이상의 정수여야 합니다");
    }
    const state = await readGameState();
    if (state.current_phase !== "stock") {
      throw new Error("지금은 투자할 수 있는 단계가 아닙니다");
    }
    await opSetInvestment(state.current_round, username, companyId, amount);
    refresh();
  });
}

export async function playerClearInvestment(
  companyId: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_phase !== "stock") {
      throw new Error("지금은 투자를 취소할 수 있는 단계가 아닙니다");
    }
    await opClearInvestment(state.current_round, username, companyId);
    refresh();
  });
}

export async function playerSetBid(
  companyId: number,
  price: number,
  count: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_phase !== "matching") {
      throw new Error("지금은 매칭권을 살 수 있는 단계가 아닙니다");
    }
    await opSetBid(username, companyId, price, count);
    refresh();
  });
}

export async function playerClearBid(
  companyId: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_phase !== "matching") {
      throw new Error("지금은 매칭권 입찰을 취소할 수 있는 단계가 아닙니다");
    }
    await opClearBid(username, companyId);
    refresh();
  });
}

export async function playerSellTickets(
  companyId: number,
  count: number,
): Promise<ActionResult> {
  return guard(async (username) => {
    if (!Number.isInteger(companyId)) throw new Error("잘못된 회사");
    const state = await readGameState();
    if (state.current_phase !== "matching") {
      throw new Error("지금은 매칭권을 팔 수 있는 단계가 아닙니다");
    }
    await opSellTickets(state.current_round, username, companyId, count);
    refresh();
  });
}
