// Built-in presets (v2 includes envelopes / chaos / spikes)
// Backward compatible loader will fill defaults if missing
export const BUILTIN_PRESETS = [
  {
    name: "Neuro Growl",
    version: 2,
    fm: {
      ratios: [1, 1.49, 2.01, 0.50],
      modDepths: [
        {s:2,d:1,depth:180},
        {s:3,d:2,depth:140},
        {s:1,d:0,depth:190}
      ],
      outLevels:[1,0,0,0]
    },
    envelopes: [
      {a:0.01,d:0.11,s:0.55,r:0.28,level:1.0,modScale:1.0},
      {a:0.02,d:0.18,s:0.4,r:0.35,level:0.7,modScale:1.2},
      {a:0.015,d:0.09,s:0.5,r:0.30,level:0.6,modScale:1.35},
      {a:0.03,d:0.14,s:0.3,r:0.25,level:0.5,modScale:1.1}
    ],
    macros: [0.35,0.55,0.25,0.40],
    chaos: {rate:3.2, amount:0.3, targetFilter:true, targetDrive:true, targetMod:false},
    spikes: {enabled:true, probability:0.18, boost:1.6},
    params: {
      baseFreq:55, filterCut:3200, filterRes:0.35, combDepth:0.40,
      distDrive:1.30, foldAmt:0.55, bitDepth:10, downsample:3,
      unisonVoices:3, unisonDetune:25, outGain:0.60
    }
  },
  {
    name: "Laser Shred (Chaotic)",
    version: 2,
    fm: {
      ratios: [1,4.0,7.5,0.25],
      modDepths: [
        {s:2,d:1,depth:420},
        {s:3,d:2,depth:360},
        {s:1,d:0,depth:420}
      ],
      outLevels:[1,0,0,0]
    },
    envelopes: [
      {a:0.005,d:0.07,s:0.35,r:0.22,level:1.0,modScale:1.3},
      {a:0.012,d:0.09,s:0.2,r:0.25,level:0.6,modScale:1.5},
      {a:0.02,d:0.15,s:0.15,r:0.3,level:0.5,modScale:1.8},
      {a:0.03,d:0.18,s:0.1,r:0.35,level:0.4,modScale:1.4}
    ],
    macros:[0.8,0.75,0.20,0.10],
    chaos:{rate:7.5, amount:0.55, targetFilter:true, targetDrive:true, targetMod:true},
    spikes:{enabled:true, probability:0.22, boost:1.9},
    params:{
      baseFreq:63, filterCut:6200, filterRes:0.55, combDepth:0.65,
      distDrive:1.9, foldAmt:1.10, bitDepth:8, downsample:2,
      unisonVoices:3, unisonDetune:18, outGain:0.58
    }
  },
  {
    name: "Vowel Drift",
    version: 2,
    fm: {
      ratios: [1,2.02,3.01,1.5],
      modDepths: [
        {s:2,d:1,depth:140},
        {s:3,d:2,depth:260},
        {s:1,d:0,depth:210}
      ],
      outLevels:[1,0.06,0,0]
    },
    envelopes:[
      {a:0.02,d:0.18,s:0.65,r:0.4,level:1.0,modScale:1.0},
      {a:0.03,d:0.2,s:0.5,r:0.42,level:0.5,modScale:1.1},
      {a:0.025,d:0.22,s:0.55,r:0.5,level:0.4,modScale:1.3},
      {a:0.04,d:0.25,s:0.4,r:0.5,level:0.35,modScale:1.2}
    ],
    macros:[0.60,0.35,0.55,0.70],
    chaos:{rate:2.2, amount:0.25, targetFilter:true, targetDrive:false, targetMod:true},
    spikes:{enabled:false, probability:0.1, boost:1.4},
    params:{
      baseFreq:60, filterCut:4100, filterRes:0.42, combDepth:0.50,
      distDrive:1.1, foldAmt:0.40, bitDepth:12, downsample:4,
      unisonVoices:2, unisonDetune:12, outGain:0.55
    }
  },
  {
    name: "Sub Punch Env",
    version: 2,
    fm: {
      ratios: [1,1.01,2.0,0.5],
      modDepths: [
        {s:2,d:1,depth:90},
        {s:3,d:2,depth:60},
        {s:1,d:0,depth:110}
      ],
      outLevels:[1,0,0,0]
    },
    envelopes:[
      {a:0.005,d:0.12,s:0.0,r:0.25,level:1.0,modScale:0.9},
      {a:0.01,d:0.1,s:0.0,r:0.2,level:0.4,modScale:1.1},
      {a:0.015,d:0.09,s:0.0,r:0.25,level:0.4,modScale:1.2},
      {a:0.02,d:0.1,s:0.0,r:0.22,level:0.3,modScale:1.1}
    ],
    macros:[0.15,0.30,0.10,0.10],
    chaos:{rate:1.5, amount:0.15, targetFilter:false, targetDrive:false, targetMod:false},
    spikes:{enabled:false, probability:0.05, boost:1.2},
    params:{
      baseFreq:45, filterCut:1800, filterRes:0.25, combDepth:0.10,
      distDrive:0.9, foldAmt:0.25, bitDepth:14, downsample:3,
      unisonVoices:1, unisonDetune:0, outGain:0.55
    }
  }
];
