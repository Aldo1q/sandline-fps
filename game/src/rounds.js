// Rounds: buy phase, live phase, end, repeat. A round is won by eliminating
// the other team, by the bomb going off, by a defuse, or by the clock running
// out with no plant. First team to 5 round wins takes the match. All timing
// lives here; main.js owns the world, this file owns the clock and the score.
export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const END_TIME = 4;
export const MATCH_WINS = 5;

export function createRounds() {
  const state = {
    phase: 'buy', // 'buy' | 'live' | 'end' | 'match'
    round: 1,
    scoreAttack: 0,
    scoreDefend: 0,
    timeLeft: BUY_TIME,
    endReason: '',
    endWinner: null, // 'attack' | 'defend' | null
    matchWinner: null,
    attackSite: 'A',
  };

  function startRound(round, attackSite) {
    state.round = round;
    state.attackSite = attackSite;
    state.phase = 'buy';
    state.timeLeft = BUY_TIME;
    state.endReason = '';
    state.endWinner = null;
  }

  function startLive() {
    state.phase = 'live';
    state.timeLeft = ROUND_TIME;
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.phase === 'match') return false;
    state.phase = 'end';
    state.endWinner = winner;
    state.endReason = reason;
    state.timeLeft = END_TIME;
    if (winner === 'attack') state.scoreAttack += 1;
    else state.scoreDefend += 1;
    if (state.scoreAttack >= MATCH_WINS || state.scoreDefend >= MATCH_WINS) {
      state.matchWinner = winner;
    }
    return true;
  }

  function finishEnd() {
    if (state.matchWinner) {
      state.phase = 'match';
      return 'match';
    }
    state.round += 1;
    return 'next';
  }

  // Returns 'live' when the buy clock runs out, 'end' when the end banner does.
  function step(dt) {
    if (state.phase === 'buy' || state.phase === 'live' || state.phase === 'end') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        if (state.phase === 'buy') {
          startLive();
          return 'live';
        }
        if (state.phase === 'end') return 'end';
      }
    }
    return null;
  }

  return {
    state,
    startRound,
    startLive,
    endRound,
    finishEnd,
    step,
  };
}
