/// Bonus de energía por ronda para el de MAYOR valor.
/// = min(max_edge, round(0.5*log2(v_high/v_low))) reescrito con enteros.
pub fn compute_edge(v_high: u64, v_low: u64, max_edge: u8, edge_enabled: bool) -> u8 {
    if !edge_enabled || v_low == 0 || v_high <= v_low {
        return 0;
    }
    let mut edge: u8 = 0;
    if v_high >= v_low.saturating_mul(2) {
        edge = 1;
    }
    if v_high >= v_low.saturating_mul(8) {
        edge = 2;
    }
    if v_high >= v_low.saturating_mul(32) {
        edge = 3;
    }
    if v_high >= v_low.saturating_mul(128) {
        edge = 4;
    }
    edge.min(max_edge)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ratio_2x_gives_1() {
        assert_eq!(compute_edge(2000, 1000, 4, true), 1);
    }

    #[test]
    fn ratio_100x_gives_3() {
        assert_eq!(compute_edge(100_000, 1000, 4, true), 3);
    }

    #[test]
    fn ratio_10m_gives_4() {
        assert_eq!(compute_edge(10_000_000, 1, 4, true), 4);
    }

    #[test]
    fn equal_gives_0() {
        assert_eq!(compute_edge(1000, 1000, 4, true), 0);
    }

    #[test]
    fn disabled_gives_0() {
        assert_eq!(compute_edge(10_000_000, 1, 4, false), 0);
    }

    #[test]
    fn max_edge_caps_at_2() {
        assert_eq!(compute_edge(10_000_000, 1, 2, true), 2);
    }

    #[test]
    fn just_under_2x_gives_0() {
        assert_eq!(compute_edge(1999, 1000, 4, true), 0);
    }

    #[test]
    fn ratio_8x_gives_2() {
        assert_eq!(compute_edge(8000, 1000, 4, true), 2);
    }

    #[test]
    fn v_low_zero_gives_0() {
        assert_eq!(compute_edge(1000, 0, 4, true), 0);
    }
}
