export function createNoiseTick(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i=0;i<data.length;i++) {
    const t = i / ctx.sampleRate;
    // short decaying high freq noise
    data[i] = (Math.random()*2-1) * Math.exp(-t*50);
  }
  return buffer;
}

export function transientTick(ctx, dest, time, gain=0.2) {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseTick(ctx);
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(dest);
  src.start(time);
}
