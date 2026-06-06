use crate::state::Allocation;
use sha2::{Digest, Sha256};

/// Hash canónico del commit: SHA-256 sobre `"apertura|choque|remate|salt"`.
pub fn commit_hash(a: &Allocation, salt: &str) -> [u8; 32] {
    let canonical = format!("{}|{}|{}|{}", a.apertura, a.choque, a.remate, salt);
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
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
    fn deterministic() {
        let a = alloc(10, 20, 30);
        assert_eq!(commit_hash(&a, "sal"), commit_hash(&a, "sal"));
    }

    #[test]
    fn changes_with_salt() {
        let a = alloc(10, 20, 30);
        assert_ne!(commit_hash(&a, "sal1"), commit_hash(&a, "sal2"));
    }

    #[test]
    fn changes_with_allocation() {
        let a = alloc(10, 20, 30);
        let b = alloc(10, 20, 31);
        assert_ne!(commit_hash(&a, "sal"), commit_hash(&b, "sal"));
    }
}
