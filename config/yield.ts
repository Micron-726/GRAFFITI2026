// ===== 주식 단계 수익률 공식 매개변수 (양수 baseline + 2차 곡선 σ) =====
//
// 공식:
//   R(M, Z) = mean(M) + σ(M, Z) · Z,  Z ~ N(0,1) ∩ [-1, 1]
//
//   factorDown  = k·M / (1 + k·M)          ← M=0 일 때 0, M=∞ 일 때 1
//   factorDown² = (k·M)² / (1+k·M)²        ← σ 계수. M 작을 땐 σ 대체로 유지,
//                                              M 커질수록 감소 폭이 커짐 (2차 곡선 느낌)
//
//   mean(M)    = mean_min + (mean_max − mean_min) · factorDown       (linear, 이해 쉬움)
//   σ_up(M)    = sigma_up_max − (sigma_up_max − sigma_up_min) · factorDown²
//   σ_down(M)  = sigma_down_max − (sigma_down_max − sigma_down_min) · factorDown²
//
//   k = k_scale / (TEAM_COUNT × AVG_INITIAL_SEED)
//
// 밸런스 설계 (v4):
//   - k_scale 30: 실제 게임 (20팀·7회사) 에서 M 는 대개 5~30% → factorDown 0.6~0.9,
//     factorDown² 0.36~0.81 로 σ 가 이미 크게 압축됨.
//   - σ 곡선을 2차로 → 저 M(2% 미만) 에서는 σ 가 대체로 유지되고 도박성 (그 회사 비었으니까),
//     M 커질수록 σ 감소 폭이 커져서 M=30% 즈음이면 거의 M=∞ 값 (안전한 인기 회사).
//   - 균형: σ_up 폭 30 = D + Δmean 20+10, σ_down 폭 10 = D − Δmean 20−10 → 저점/고점 diff 각 20%p.
//
// 극단값:
//   - M=0: 평균 +15, σ_up=45, σ_down=25, 범위 [-10, +60]
//   - M=∞: 평균 +25, σ_up=15, σ_down=15, 범위 [+10, +40]
//
// 실제 게임 구간:
//   - M=5%  : 평균 +21,   범위 [-0.4, +55.2]
//   - M=10% : 평균 +22.5, 범위 [+3.1, +50.6]  ← 거의 양수
//   - M=20% : 평균 +23.6, 범위 [+5.9, +46.5]
//   - M=30% : 평균 +24,   범위 [+7.1, +44.7]  ← 완전 양수, "인기 회사는 안전+큰 수익"

export const YIELD_CONFIG = {
  mean_min: 15,
  mean_max: 25,
  sigma_up_max: 45,
  sigma_up_min: 15,
  sigma_down_max: 25,
  sigma_down_min: 15,
  k_scale: 30,
} as const;
