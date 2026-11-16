// Synthesised sound: no audio files, no network. A tiny WebAudio kit — noise
// bursts for gunfire and explosions, short blips for UI — created lazily on the
// first user gesture so the browser's autoplay policy never blocks the game.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch (err) {
      return false;
    }
    return true;
  }

  function noise(dur, filterFreq, gain, type = 'lowpass') {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(t, Math.random() * 0.3, dur);
  }

  function tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    shot(kind) {
      // kind: 'rifle' | 'smg' | 'pistol' | 'sniper' | 'enemy'
      if (kind === 'sniper') {
        noise(0.22, 900, 0.9);
        tone(140, 0.16, 0.5, 'sawtooth', 50);
      } else if (kind === 'pistol') {
        noise(0.09, 1800, 0.55);
        tone(320, 0.06, 0.25, 'square', 120);
      } else if (kind === 'smg') {
        noise(0.07, 2400, 0.45);
      } else if (kind === 'enemy') {
        noise(0.12, 1100, 0.28);
      } else {
        noise(0.13, 1400, 0.7);
        tone(180, 0.09, 0.35, 'sawtooth', 70);
      }
    },
    dry() {
      tone(1400, 0.03, 0.18, 'square');
    },
    reload() {
      tone(900, 0.04, 0.2, 'square');
      setTimeout(() => tone(600, 0.04, 0.2, 'square'), 260);
    },
    hit() {
      tone(2100, 0.05, 0.3, 'sine');
    },
    kill() {
      tone(1560, 0.07, 0.3, 'sine');
      setTimeout(() => tone(2090, 0.1, 0.3, 'sine'), 70);
    },
    hurt() {
      tone(220, 0.12, 0.35, 'sawtooth', 110);
    },
    boom() {
      noise(0.7, 320, 1.0);
      tone(70, 0.55, 0.8, 'sine', 32);
    },
    beep(final) {
      tone(final ? 1760 : 1180, 0.09, 0.28, 'sine');
    },
    plant() {
      tone(880, 0.08, 0.25, 'sine');
      setTimeout(() => tone(1320, 0.12, 0.25, 'sine'), 110);
    },
    flash() {
      noise(0.25, 4000, 0.5, 'highpass');
      tone(3200, 0.5, 0.12, 'sine', 2400);
    },
    defuse() {
      tone(660, 0.08, 0.25, 'sine');
      setTimeout(() => tone(990, 0.12, 0.25, 'sine'), 110);
    },
    roundWin() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.28, 'sine'), i * 120));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.28, 'sine'), i * 130));
    },
    buy() {
      tone(1046, 0.06, 0.22, 'sine');
      setTimeout(() => tone(1318, 0.08, 0.22, 'sine'), 60);
    },
    denied() {
      tone(196, 0.12, 0.25, 'square');
    },
  };
}
