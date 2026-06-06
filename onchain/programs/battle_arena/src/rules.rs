use crate::state::Allocation;

/// Aguante: solidez derivada del grado del NFT.
pub fn solidez(grade: u8) -> u32 {
    (grade as u32) * 10
}

#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub enum FrontWinner {
    A,
    B,
    Disputed,
}

#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub enum RoundWinner {
    A,
    B,
    Disputed,
}

/// Resuelve un frente: más energía gana (estricto). Empate de energía -> mayor
/// solidez (Aguante). Si energía y solidez empatan -> Disputed.
pub fn resolve_front(a: u32, b: u32, sol_a: u32, sol_b: u32) -> FrontWinner {
    if a > b {
        FrontWinner::A
    } else if b > a {
        FrontWinner::B
    } else if sol_a > sol_b {
        FrontWinner::A
    } else if sol_b > sol_a {
        FrontWinner::B
    } else {
        FrontWinner::Disputed
    }
}

/// Resuelve una ronda: gana quien tome más frentes. Desempate 1: mayor energía
/// total. Desempate 2: mayor solidez. Si todo empata -> Disputed.
pub fn resolve_round(ra: &Allocation, rb: &Allocation, sol_a: u32, sol_b: u32) -> RoundWinner {
    let fronts = [
        resolve_front(ra.apertura, rb.apertura, sol_a, sol_b),
        resolve_front(ra.choque, rb.choque, sol_a, sol_b),
        resolve_front(ra.remate, rb.remate, sol_a, sol_b),
    ];

    let mut wins_a = 0u8;
    let mut wins_b = 0u8;
    for f in fronts.iter() {
        match f {
            FrontWinner::A => wins_a += 1,
            FrontWinner::B => wins_b += 1,
            FrontWinner::Disputed => {}
        }
    }

    if wins_a > wins_b {
        return RoundWinner::A;
    }
    if wins_b > wins_a {
        return RoundWinner::B;
    }

    // Desempate 1: energía total.
    let total_a = ra.total();
    let total_b = rb.total();
    if total_a > total_b {
        return RoundWinner::A;
    }
    if total_b > total_a {
        return RoundWinner::B;
    }

    // Desempate 2: solidez.
    if sol_a > sol_b {
        return RoundWinner::A;
    }
    if sol_b > sol_a {
        return RoundWinner::B;
    }

    RoundWinner::Disputed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alloc(apertura: u32, choque: u32, remate: u32) -> Allocation {
        Allocation {
            apertura,
            choque,
            remate,
        }
    }

    #[test]
    fn solidez_scales_with_grade() {
        assert_eq!(solidez(0), 0);
        assert_eq!(solidez(5), 50);
    }

    #[test]
    fn front_strict_more_wins() {
        assert_eq!(resolve_front(50, 40, 0, 0), FrontWinner::A);
        assert_eq!(resolve_front(40, 50, 0, 0), FrontWinner::B);
    }

    #[test]
    fn front_tie_aguante_by_solidez() {
        assert_eq!(resolve_front(50, 50, 30, 10), FrontWinner::A);
        assert_eq!(resolve_front(50, 50, 10, 30), FrontWinner::B);
    }

    #[test]
    fn front_tie_equal_solidez_disputed() {
        assert_eq!(resolve_front(50, 50, 20, 20), FrontWinner::Disputed);
    }

    #[test]
    fn round_most_fronts() {
        // A gana apertura y choque; B gana remate -> 2-1 a favor de A.
        let ra = alloc(60, 60, 10);
        let rb = alloc(10, 10, 90);
        assert_eq!(resolve_round(&ra, &rb, 0, 0), RoundWinner::A);
    }

    #[test]
    fn round_tiebreak_by_total_energy() {
        // A gana apertura, B gana choque, remate empata -> 1-1 frentes.
        // total_a = 100 > total_b = 90 -> A.
        let ra = alloc(60, 10, 30);
        let rb = alloc(10, 50, 30);
        assert_eq!(ra.total(), 100);
        assert_eq!(rb.total(), 90);
        assert_eq!(resolve_round(&ra, &rb, 0, 0), RoundWinner::A);
    }

    #[test]
    fn round_tiebreak_by_solidez() {
        // 1-1 frentes, totales iguales -> desempata solidez.
        let ra = alloc(60, 10, 30);
        let rb = alloc(10, 60, 30);
        assert_eq!(ra.total(), rb.total());
        assert_eq!(resolve_round(&ra, &rb, 50, 10), RoundWinner::A);
    }

    #[test]
    fn round_full_tie_disputed() {
        // Todos los frentes empatan en energía y solidez -> Disputed.
        let ra = alloc(30, 30, 30);
        let rb = alloc(30, 30, 30);
        assert_eq!(resolve_round(&ra, &rb, 20, 20), RoundWinner::Disputed);
    }
}
