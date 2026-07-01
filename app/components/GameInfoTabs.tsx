"use client";

import katex from "katex";
import { useState } from "react";

type Stage = {
  id: string;
  title: string;
  summary: string;
  detail?: string;
};

const STAGES: Stage[] = [
  {
    id: "seed",
    title: "Seed",
    summary: "스타트업 키워드 공개",
    detail:
      "🌱 Seed — 스타트업 키워드 공개\n" +
      "게임의 출발점, 모든 건 작은 키워드 하나에서 시작됩니다. 각 스타트업은 자신을 설명하는 핵심 키워드만 살짝 공개합니다.\n\n" +
      "🎤 스타트업이 들려주는 것\n" +
      "• 회사를 한마디로 압축한 핵심 키워드\n" +
      "• 어떤 분야·기술에 발을 담그고 있는지에 대한 작은 힌트\n\n" +
      '정보가 가장 적은 만큼, 상상력이 가장 빛나는 순간이에요. "이 회사가 앞으로 어떤 그림을 그려낼까?" 키워드 하나로 가능성을 먼저 알아본 안목 — 그게 곧 당신의 수익이 됩니다. 🚀',
  },
  {
    id: "series-a",
    title: "Series A",
    summary: "문제 인식 · 해결 방안 · 사업 모델",
    detail:
      "🚀 Series A — 문제 인식 · 해결 방안 · 사업 모델\n" +
      "스타트업이 본격적으로 자신을 펼쳐 보이는 단계입니다. 어떤 문제를 발견했고, 그걸 어떻게 풀어내며, 그 과정에서 어떻게 돈을 버는지를 직접 피칭해요.\n\n" +
      "🎤 스타트업이 들려주는 것\n" +
      "• 문제 인식 배경과 그 문제를 해결해야 하는 이유\n" +
      "• 문제를 풀어낼 제품·서비스 소개\n" +
      "• 사업 모델과 수익 구조\n\n" +
      "좋은 창업은 언제나 '진짜 문제'에서 출발하죠. 이 회사가 짚은 문제가 충분히 절실한지, 해결책이 설득력 있는지, 그 모델이 실제로 돈이 되는지 — 당신의 투자 감각으로 직접 판단해보세요. 💡",
  },
  {
    id: "series-b",
    title: "Series B",
    summary: "사회적 가치와 영리적 가치의 균형",
    detail:
      "🌍 Series B — 사회적 가치와 영리적 가치의 균형\n" +
      "회사가 성장하며 마주하는 진짜 질문! 세상에 기여하는 것과 돈을 버는 것, 그 사이에서 어디에 무게를 두고 어떻게 균형을 잡아가는지를 발표합니다.\n\n" +
      "🎤 스타트업이 들려주는 것\n" +
      "• 이 회사가 생각하는 사회적 가치와 영리적 가치의 균형\n" +
      "• 창업 초기의 가치와 현재의 방향성, 그 사이의 변화\n" +
      "• 사회 문제 해결 생태계 속에서 맡은 역할 (사회적 가치 중심)\n" +
      "• 벌어들인 수익을 어디에 다시 투자하고 어떻게 쓰는지 (영리적 가치 중심)\n\n" +
      "오래가는 기업은 두 가치를 함께 끌고 갑니다. 이 회사의 균형 감각이 건강한지, 초심과 현재가 한 방향을 보고 있는지 — 장기적인 신뢰를 가늠해 투자해보세요. 🤝",
  },
  {
    id: "series-c",
    title: "Series C",
    summary: "미래 시장 전망 · 투자 유치 현황",
    detail:
      "📈 Series C — 미래 시장 전망 · 투자 유치 현황\n" +
      "성숙기에 접어든 스타트업의 마지막 피칭! 자신이 속한 시장이 앞으로 어디로 향하는지, 지금 투자 유치는 어디까지 왔는지, 그리고 끝내 무엇을 이루려 하는지를 이야기합니다.\n\n" +
      "🎤 스타트업이 들려주는 것\n" +
      "• 관련 시장의 미래 전망\n" +
      "• 현재 시리즈 위치와 투자 유치 현황\n" +
      "• 앞으로의 최종 목표\n\n" +
      "마지막 단계인 만큼 회사의 그림이 가장 또렷하게 드러나요. 시장의 성장성과 이 회사의 위치를 종합해, 끝까지 함께 그려나갈 가치가 있는지 판단해보세요. 🎨",
  },
  {
    id: "hint",
    title: "힌트",
    summary: "수익률 공식 & 전략",
  },
];

export function GameInfoTabs() {
  const [selectedId, setSelectedId] = useState<string>("seed");
  const selected = STAGES.find((s) => s.id === selectedId) ?? STAGES[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <div className="grid gap-2 self-start rounded-lg border border-[#dfe4dc] bg-white p-2 shadow-sm">
        {STAGES.map((stage) => {
          const active = stage.id === selectedId;
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => setSelectedId(stage.id)}
              className={
                "rounded-md px-4 py-3 text-left transition " +
                (active
                  ? "bg-[#071120] text-white"
                  : "text-[#3f473d] hover:bg-[#f1f3ef]")
              }
            >
              <div className="font-semibold">{stage.title}</div>
              <div className={active ? "mt-1 text-sm text-[#c7d7e7]" : "mt-1 text-sm text-[#667065]"}>
                {stage.summary}
              </div>
            </button>
          );
        })}
      </div>

      <article className="rounded-lg border border-[#dfe4dc] bg-white p-6 shadow-sm sm:p-8">
        {selected.id === "hint" ? (
          <HintContent />
        ) : (
          <div className="whitespace-pre-wrap text-lg leading-9 text-[#20261f]">
            {selected.detail ?? ""}
          </div>
        )}
      </article>
    </div>
  );
}

function HintContent() {
  return (
    <div className="text-lg leading-9 text-[#20261f]">
      <p className="font-semibold">💡 힌트 — 수익률 공식 & 전략</p>

      <p className="mt-4">
        스타트업들의 이야기를 다 들었다면, 이제 진짜 게임의 시작!
        &quot;어디에 투자해야 더 벌까?&quot;를 고민할 시간입니다. 각 회사의
        수익률 <InlineMath latex="R" /> 은 다음 공식으로 결정돼요.
      </p>

      <DisplayMath latex={String.raw`R(M, Z) = \operatorname{mean}(M) + \sigma(M, Z) \cdot Z`} />

      <div className="mt-6">
        <p className="font-semibold">여기서</p>
        <p>
          <InlineMath latex="M" /> : 그 회사에 모든 팀이 투자한 총 시드머니
        </p>
        <p>
          <InlineMath latex="Z" /> : 정규분포를 따르며{" "}
          <InlineMath latex="[-1, +1]" /> 사이의 무작위 값
        </p>
      </div>

      <p className="mt-6">
        평균은 <strong>모든 <InlineMath latex="M" /> 에서 양수</strong>입니다.
        <InlineMath latex="M" /> 이 작으면 약 <InlineMath latex="+10\%" />,
        많이 모일수록 최대 <InlineMath latex="+30\%" /> 까지 상승해요.
        상방(<InlineMath latex={String.raw`Z \ge 0`} />) 의{" "}
        <InlineMath latex={String.raw`\sigma_{\mathrm{up}}`} /> 은
        모든 <InlineMath latex="M" /> 에서 큰 상수(약 70%p) — 어떤 회사든 최고점이
        평균에서 상당히 멀리 갈 수 있어요. 하방(<InlineMath latex={String.raw`Z < 0`} />) 의{" "}
        <InlineMath latex={String.raw`\sigma_{\mathrm{down}}`} /> 은{" "}
        <InlineMath latex="M" /> 이 커질수록 작아져서(40→30)
        <strong> 인기 회사는 손실 폭이 줄어듭니다</strong>.
      </p>

      <div className="mt-6">
        <p>즉,</p>
        <p>• 많은 팀이 모이는 회사 → 평균 <InlineMath latex="+30" />, 범위 약 <InlineMath latex="[0, +100]" /> (안전 + 큰 보상)</p>
        <p>• 적은 팀만 모이는 회사 → 평균 <InlineMath latex="+10" />, 범위 약 <InlineMath latex="[-30, +80]" /> (변동성 큼)</p>
        <p>• 어떤 회사든 평균은 양수 — 다만 운 나쁘면 마이너스도 가능</p>
      </div>

      <p className="mt-6">
        인기 종목은 안정적인 큰 수익을, 비인기 종목은 변동성 게임을 노릴 수 있는 구조예요.
        다른 팀들이 어디에 몰릴지 예측해 균형을 잡거나, 역으로 비인기 종목에
        과감히 베팅해보세요. 스타트업의 이야기에서 얻은 확신과, 다른 팀들의
        심리를 읽는 눈 — 이 둘을 함께 굴리는 것이 GRAFFITI 투자 게임의 진짜
        묘미입니다. 🎨
      </p>

      <div className="mt-6 grid gap-3">
        <DisplayMath latex={String.raw`\operatorname{mean}(M) = \mu_{\mathrm{min}} + (\mu_{\mathrm{max}} - \mu_{\mathrm{min}}) \cdot \frac{kM}{1 + kM}`} />
        <DisplayMath latex={String.raw`\sigma_{\mathrm{up}}(M) = \sigma_{\mathrm{up}} \quad (\text{상수},\ Z \ge 0)`} />
        <DisplayMath latex={String.raw`\sigma_{\mathrm{down}}(M) = \sigma_{\mathrm{down\_max}} - (\sigma_{\mathrm{down\_max}} - \sigma_{\mathrm{down\_min}}) \cdot \frac{kM}{1 + kM} \quad (Z < 0)`} />
      </div>
    </div>
  );
}

function InlineMath({ latex }: { latex: string }) {
  const html = katex.renderToString(latex, {
    displayMode: false,
    throwOnError: false,
    strict: false,
  });

  return (
    <span
      className="whitespace-nowrap align-baseline text-[#111827]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function DisplayMath({ latex }: { latex: string }) {
  const html = katex.renderToString(latex, {
    displayMode: true,
    throwOnError: false,
    strict: false,
  });

  return (
    <div className="my-5 overflow-x-auto rounded-lg border border-[#dfe4dc] bg-[#f6f7f4] px-4 py-5">
      <div
        className="min-w-max text-[#20261f]"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
