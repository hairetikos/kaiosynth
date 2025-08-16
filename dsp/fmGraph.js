// FM Operator Network with envelope gain stage per operator and removable connections
export class FMGraph {
  constructor(ctx, operatorCount = 4) {
    this.ctx = ctx;
    this.operatorCount = operatorCount;
    this.ops = [];
    this.modMatrix = []; // {source,dest,gain}
    this.gainOut = ctx.createGain();
    this.gainOut.gain.value = 0.4;
    for (let i = 0; i < operatorCount; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const envGain = ctx.createGain();
      envGain.gain.value = 0;
      const outGain = ctx.createGain();
      outGain.gain.value = (i === 0) ? 1 : 0;
      osc.connect(envGain).connect(outGain);
      osc.start();
      this.ops.push({ osc, envGain, outGain, ratio: 1, baseFreq: 55 });
    }
    this._buildInitialMatrix();
  }

  _buildInitialMatrix() {
    const pairs = [
      { s:2, d:1, depth: 110 },
      { s:3, d:2, depth: 140 },
      { s:1, d:0, depth: 180 }
    ];
    pairs.forEach(p => this.connect(p.s, p.d, p.depth));
  }

  connect(sourceIndex, destIndex, depth = 100) {
    if (sourceIndex === destIndex) return;
    if (this.modMatrix.find(m => m.source === sourceIndex && m.dest === destIndex)) return;
    const s = this.ops[sourceIndex];
    const d = this.ops[destIndex];
    const gain = this.ctx.createGain();
    gain.gain.value = depth;
    s.osc.connect(gain);
    gain.connect(d.osc.frequency);
    this.modMatrix.push({ source: sourceIndex, dest: destIndex, gain });
  }

  removeConnection(sourceIndex, destIndex) {
    const idx = this.modMatrix.findIndex(m => m.source === sourceIndex && m.dest === destIndex);
    if (idx >= 0) {
      const entry = this.modMatrix[idx];
      try { entry.gain.disconnect(); } catch {}
      this.modMatrix.splice(idx, 1);
    }
  }

  setOperatorRatio(opIndex, ratio) {
    this.ops[opIndex].ratio = ratio;
    const op = this.ops[opIndex];
    op.osc.frequency.setTargetAtTime(op.baseFreq * ratio, this.ctx.currentTime, 0.02);
  }

  setBaseFrequency(freq) {
    this.ops.forEach(op => {
      op.baseFreq = freq;
      op.osc.frequency.setTargetAtTime(freq * op.ratio, this.ctx.currentTime, 0.02);
    });
  }

  setOutLevel(opIndex, level) {
    this.ops[opIndex].outGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.05);
  }

  setModDepth(source, dest, depth) {
    const entry = this.modMatrix.find(m => m.source === source && m.dest === dest);
    if (entry) entry.gain.gain.setTargetAtTime(depth, this.ctx.currentTime, 0.02);
  }

  routeAllOutputs() {
    this.ops.forEach(op => op.outGain.connect(this.gainOut));
    return this.gainOut;
  }
}
