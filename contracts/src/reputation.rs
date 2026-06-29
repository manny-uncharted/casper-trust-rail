//! Accuracy-weighted reputation for autonomous agents.
//!
//! Every agent starts neutral (5000 / 10000). As its posted data points are
//! scored against ground truth, an authorised `updater` (the off-chain scoring
//! job, or a future on-chain challenge game) records each outcome and the score
//! is recomputed as `correct / total` in basis points. The [`RwaOracle`] reads
//! this score to gate who may publish.
//!
//! Keeping the score on-chain — rather than in the agent's own database — is the
//! whole point: a consumer can verify an oracle's track record trustlessly.

use odra::prelude::*;

/// Neutral starting score, in basis points (50.00%).
pub const DEFAULT_SCORE_BPS: u32 = 5_000;
/// Maximum score, in basis points (100.00%).
pub const MAX_SCORE_BPS: u32 = 10_000;

/// Errors raised by [`Reputation`].
#[odra::odra_error]
pub enum ReputationError {
    /// Caller is not the authorised updater.
    NotUpdater = 1,
    /// Caller is not the admin.
    NotAdmin = 2,
}

/// Emitted whenever an agent's reputation moves.
#[odra::event]
pub struct ReputationUpdated {
    pub agent_id: String,
    pub accurate: bool,
    pub total: u64,
    pub correct: u64,
    pub score_bps: u32,
}

/// Emitted when the authorised updater is rotated.
#[odra::event]
pub struct UpdaterChanged {
    pub previous: Address,
    pub current: Address,
}

/// Per-agent accuracy reputation.
#[odra::module(events = [ReputationUpdated, UpdaterChanged])]
pub struct Reputation {
    admin: Var<Address>,
    updater: Var<Address>,
    total: Mapping<String, u64>,
    correct: Mapping<String, u64>,
    seen: Mapping<String, bool>,
}

#[odra::module]
impl Reputation {
    /// Deploy. `updater` is the only account allowed to record outcomes
    /// (typically the off-chain scoring service's key). The deployer is admin.
    pub fn init(&mut self, updater: Address) {
        self.admin.set(self.env().caller());
        self.updater.set(updater);
    }

    /// Record one scored outcome for `agent_id`. Updater only.
    pub fn record_outcome(&mut self, agent_id: String, accurate: bool) {
        self.assert_updater();
        let total = self.total.get_or_default(&agent_id).saturating_add(1);
        let correct = if accurate {
            self.correct.get_or_default(&agent_id).saturating_add(1)
        } else {
            self.correct.get_or_default(&agent_id)
        };
        self.total.set(&agent_id, total);
        self.correct.set(&agent_id, correct);
        self.seen.set(&agent_id, true);

        let score_bps = Self::compute_score(total, correct);
        self.env().emit_event(ReputationUpdated {
            agent_id,
            accurate,
            total,
            correct,
            score_bps,
        });
    }

    /// Current reputation of `agent_id`, in basis points. Returns the neutral
    /// default for agents with no recorded outcomes yet.
    pub fn score_of(&self, agent_id: String) -> u32 {
        if !self.seen.get_or_default(&agent_id) {
            return DEFAULT_SCORE_BPS;
        }
        let total = self.total.get_or_default(&agent_id);
        let correct = self.correct.get_or_default(&agent_id);
        Self::compute_score(total, correct)
    }

    /// Raw `(total, correct)` outcome counts for `agent_id`.
    pub fn stats_of(&self, agent_id: String) -> (u64, u64) {
        (
            self.total.get_or_default(&agent_id),
            self.correct.get_or_default(&agent_id),
        )
    }

    /// Rotate the authorised updater. Admin only.
    pub fn set_updater(&mut self, new_updater: Address) {
        if self.env().caller() != self.admin.get().unwrap_or_revert(&self.env()) {
            self.env().revert(ReputationError::NotAdmin);
        }
        let previous = self.updater.get().unwrap_or_revert(&self.env());
        self.updater.set(new_updater);
        self.env().emit_event(UpdaterChanged {
            previous,
            current: new_updater,
        });
    }

    /// The current authorised updater.
    pub fn updater(&self) -> Option<Address> {
        self.updater.get()
    }

    fn compute_score(total: u64, correct: u64) -> u32 {
        if total == 0 {
            return DEFAULT_SCORE_BPS;
        }
        // correct * 10_000 / total, saturated into u32. correct <= total so the
        // result is always <= MAX_SCORE_BPS.
        let bps = (correct as u128 * MAX_SCORE_BPS as u128) / total as u128;
        bps as u32
    }

    fn assert_updater(&self) {
        if self.env().caller() != self.updater.get().unwrap_or_revert(&self.env()) {
            self.env().revert(ReputationError::NotUpdater);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostRef};

    #[test]
    fn neutral_by_default() {
        let env = odra_test::env();
        let updater = env.get_account(1);
        let rep = Reputation::deploy(&env, ReputationInitArgs { updater });
        assert_eq!(rep.score_of("new-agent".to_string()), DEFAULT_SCORE_BPS);
    }

    #[test]
    fn score_tracks_accuracy() {
        let env = odra_test::env();
        let updater = env.get_account(1);
        let mut rep = Reputation::deploy(&env, ReputationInitArgs { updater });

        env.set_caller(updater);
        rep.record_outcome("a".to_string(), true);
        rep.record_outcome("a".to_string(), true);
        rep.record_outcome("a".to_string(), false);
        rep.record_outcome("a".to_string(), true);

        // 3 / 4 = 7500 bps
        assert_eq!(rep.score_of("a".to_string()), 7_500);
        assert_eq!(rep.stats_of("a".to_string()), (4, 3));
    }

    #[test]
    fn only_updater_records() {
        let env = odra_test::env();
        let updater = env.get_account(1);
        let mut rep = Reputation::deploy(&env, ReputationInitArgs { updater });

        env.set_caller(env.get_account(2));
        let err = rep.try_record_outcome("a".to_string(), true);
        assert_eq!(err, Err(ReputationError::NotUpdater.into()));
    }
}
