// Simple per-operator ADSR envelope helper
export class ADSREnvelope {
  constructor(ctx, gainNode, params = {}) {
    this.ctx = ctx;
    this.gainNode = gainNode;
    this.set(params);
    this._gate = false;
    this.velocity = 1.0;
  }

  set({a=0.01,d=0.12,s=0.6,r=0.3,level=1.0,modScale=1.0}={}) {
    this.a=a; this.d=d; this.s=s; this.r=r; this.level=level; this.modScale=modScale;
  }

  gateOn(velocity = 1.0) {
    const t = this.ctx.currentTime;
    this.velocity = velocity;
    this._gate = true;
    const peak = this.level * velocity;
    const g = this.gainNode.gain;
    g.cancelScheduledValues(t);
    const startVal = g.value;
    if (startVal < 1e-5) g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + Math.max(0.001, this.a));
    g.linearRampToValueAtTime(peak * this.s, t + this.a + Math.max(0.001, this.d));
  }

  gateOff() {
    if (!this._gate) return;
    this._gate = false;
    const t = this.ctx.currentTime;
    const g = this.gainNode.gain;
    const current = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(current, t);
    g.linearRampToValueAtTime(0, t + Math.max(0.001, this.r));
  }

  isActive() { return this._gate; }
}
