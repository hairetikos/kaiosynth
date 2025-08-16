// Waveshaper + Distortion Curves
export function makeWaveshapeCurve(len, type='tanh', drive=1, fold=0.5, seed=0.0) {
  const curve = new Float32Array(len);
  const r = (n)=> {
    seed = (seed * 16807 + 17) % 2147483647;
    return ((seed/2147483647)*2 - 1);
  };
  for (let i=0;i<len;i++) {
    const x = (i / (len -1))*2 -1;
    let y = x;
    if (type === 'tanh') {
      y = Math.tanh(x * drive * (1 + fold*1.5));
    } else if (type === 'fold') {
      const f = fold*2 + 1;
      let z = x * drive * f;
      // naive wavefolder
      for (let k=0;k<6;k++) {
        if (z > 1) z = 2 - z;
        else if (z < -1) z = -2 - z;
      }
      y = z * 0.8;
    } else if (type === 'diode') {
      const bias = 0.2 + fold*0.3;
      const k = drive * 2.5;
      const h = (x + bias);
      y = (h > 0 ? (1 - Math.exp(-h*k)) : 0) - (bias>0?(1 - Math.exp(-bias*k)):0);
      y *= 1.2;
    } else if (type === 'hybrid') {
      let z = x * (drive+0.0001);
      z = Math.tanh(z + 0.4*Math.sin(z*3 + r()*0.2*fold));
      z += 0.15 * Math.sin(x*8 + fold*3) + 0.1 * Math.sin(x*23 * (0.5+fold));
      y = Math.tanh(z * (1+fold*2));
    }
    // subtle random asymmetry
    y += r()*0.02*fold;
    curve[i] = y;
  }
  // normalize
  let max = 0;
  for (let i=0;i<len;i++) max = Math.max(max, Math.abs(curve[i]));
  if (max>0) for (let i=0;i<len;i++) curve[i] /= max;
  return curve;
}

export function applyBitcrushDownsample(ctx, inputNode, bits=12, downsample=2) {
  // Cheap bitcrush using ScriptProcessor (deprecated) replaced by AudioWorklet desirable;
  // For brevity we do offline: create gain node placeholder; user could adapt.
  // We'll simulate by a waveshaper for bit depth; not perfect but illustrative.
  const crush = ctx.createWaveShaper();
  const levels = Math.pow(2, bits);
  const curve = new Float32Array(65536);
  for (let i=0;i<65536;i++) {
    const x = (i/65535)*2 -1;
    const q = Math.round((x*0.5+0.5)*(levels-1))/(levels-1);
    curve[i] = (q*2 -1);
  }
  crush.curve = curve;
  inputNode.connect(crush);
  // downsample simulation: lowpass pre + sample&hold gap using DelayNode + Gain scheduling (simplified)
  const lp = ctx.createBiquadFilter();
  lp.type='lowpass';
  lp.frequency.value = Math.max(20000 / downsample, 1000);
  crush.connect(lp);
  return lp;
}
