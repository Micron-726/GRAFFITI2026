// ===== 주식 단계 수익률 공식 매개변수 (양수 baseline + 비대칭 σ) =====
//
// 공식:
//   R(M, Z) = mean(M) + σ(M, Z) · Z,  Z ~ N(0,1) ∩ [-1, 1]
//
//   factorDown = k·M / (1 + k·M)          ← M=0 일 때 0, M=∞ 일 때 1
//
//   mean(M)    = mean_min + (mean_max − mean_min) · factorDown
//                모든 M 에서 양수. M 클수록 mean_max 로 수렴.
//   σ_up(M)    = sigma_up (상수)          Z ≥ 0 일 때 적용.
//   σ_down(M)  = sigma_down_max − (sigma_down_max − sigma_down_min) · factorDown
//                M 클수록 줄어듦 (= 인기 회사일수록 하방 리스크 작음).
//
//   k = k_scale / (TEAM_COUNT × AVG_INITIAL_SEED)
//
// 의도:
//   - 모든 M 에서 평균은 양수 (마이너스가 너무 자주 나오지 않도록 전면 재설계)
//   - M=0 극단: 평균 +10, σ_up=70, σ_down=40 → 범위 [-30, +80]
//   - M=∞ 극단: 평균 +30, σ_up=70, σ_down=30 → 범위 [0, +100]
//   - 인기 회사(고 M): 큰 보상 + 하방 안전 / 비인기 회사(저 M): 큰 변동성
//   - 예시 (20팀·평균 1000만원): M=풀의 10% → 평균 ~15 / 저점 ~-20 / 고점 ~+85
//                                M=풀의 50% → 평균 ~23 / 저점 ~-10 / 고점 ~+93

export const YIELD_CONFIG = {
  mean_min: 10,
  mean_max: 30,
  sigma_up: 70,
  sigma_down_max: 40,
  sigma_down_min: 30,
  k_scale: 10,
} as const;
