// Chaos LFO & neuron spike utilities
export class ChaosLFO {
  constructor(ctx, {rate=3.5, amount=0.3}={}) {
    this.ctx = ctx;
    this.rate = rate;
    this.amount = amount;
    this._x = Math.random()*0.8+0.1; // logistic seed
    this._lastTime = ctx.currentTime;
    this.value = 0;
  }
  step() {
    const now = this.ctx.currentTime;
    const dt = now - this._lastTime;
    const interval = 1/this.rate;
    if (dt >= interval) {
      // logistic map
      this._x = 3.72 * this._x * (1 - this._x);
      this.value = (this._x - 0.5) * 2 * this.amount;
      this._lastTime = now;
    }
    return this.value;
  }
}

export function maybeSpike(spikeState, fm) {
  if (!spikeState.enabled) return;
  if (Math.random() < spikeState.probability) {
    // Choose random mod connection
    if (fm.modMatrix.length === 0) return;
    const idx = Math.floor(Math.random()*fm.modMatrix.length);
    const entry = fm.modMatrix[idx];
    const g = entry.gain.gain;
    const base = g.value;
    const boost = base * spikeState.boost;
    const t = fm.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(base, t);
    g.linearRampToValueAtTime(boost, t + 0.02);
    g.linearRampToValueAtTime(base, t + 0.18);
  }
}
