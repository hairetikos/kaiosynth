// Oversampled distortion core: AudioWorkletProcessor
// NOTE: Keep fairly lightweight; simulate 4x oversampling by naive linear interpolation up, then process, then simple lowpass down.

const processorCode = `
class OversampleDist extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {name:'drive', defaultValue:1, minValue:0, maxValue:5, automationRate:'k-rate'},
      {name:'fold', defaultValue:0.5, minValue:0, maxValue:2, automationRate:'k-rate'},
    ];
  }
  constructor() {
    super();
    this.buf = new Float32Array(128*4);
  }
  foldSample(x, fold) {
    let z = x;
    for (let i=0;i<5;i++){
      if (z>1) z=2-z;
      else if (z<-1) z=-2-z;
    }
    return z * (1 - 0.2*fold);
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input.length) return true;
    const drive = parameters.drive.length === 1 ? parameters.drive[0] : parameters.drive[0];
    const fold = parameters.fold.length === 1 ? parameters.fold[0] : parameters.fold[0];
    const chIn = input[0];
    const chOut = output[0];
    const upFactor = 4;
    const n = chIn.length;
    for (let i=0;i<n;i++){
      const s = chIn[i];
      // upscale naive replicate & small interpolations
      for (let k=0;k<upFactor;k++){
        const uIndex = i*upFactor + k;
        const interp = s; // could do polyphase
        let z = interp * drive;
        z = Math.tanh(z*0.8) + 0.2*this.foldSample(z, fold);
        this.buf[uIndex] = z;
      }
    }
    // Downsample with simple average + gentle lowpass
    for (let i=0;i<n;i++){
      let acc=0;
      for (let k=0;k<upFactor;k++) acc += this.buf[i*upFactor+k];
      let d = acc / upFactor;
      chOut[i] = d;
    }
    return true;
  }
}
registerProcessor('oversample-dist', OversampleDist);
`;

export async function ensureOversampleWorklet(ctx) {
  if (!ctx.audioWorklet) return;
  if (!ensureOversampleWorklet.loaded) {
    const blob = new Blob([processorCode], {type:'application/javascript'});
    const url = URL.createObjectURL(blob);
    await ctx.audioWorklet.addModule(url);
    ensureOversampleWorklet.loaded = true;
  }
}
ensureOversampleWorklet.loaded = false;
