// Updated synth.js integrating microtuning, virtual keyboard & note step sequencer
import { FMGraph } from './dsp/fmGraph.js';
import { makeWaveshapeCurve, applyBitcrushDownsample } from './dsp/waveshaper.js';
import { ensureOversampleWorklet } from './dsp/oversampleProcessor.js';
import { transientTick } from './dsp/noiseInjection.js';
import { BUILTIN_PRESETS } from './presets.js';
import { ADSREnvelope } from './dsp/envelope.js';
import { ChaosLFO, maybeSpike } from './dsp/modulators.js';
import { initMIDIInterface, enableMIDI, setInput, setChannel, setBendRange, midiState, startMacroLearn } from './midi.js';
import { SCL_PRESETS } from './sclPresets.js';
import { parseSCL, default12 } from './sclParser.js';
import { buildVirtualKeyboard } from './virtualKeyboard.js';
import { NoteSequencer } from './noteSequencer.js';

let ctx;
let fm;
let mainOut;
let distNode;
let shaperA, shaperB, shaperMix;
let bitNode;
let filter1, filter2;
let combDelay, combFeedback;
let analyser;
let seqTimer;
let oversampleNode;

const envelopes = [];
let chaosLFO;
const spikeState = {enabled:true, probability:0.18, boost:1.6};

const microtuning = {
  sclName: '12-TET (Standard)',
  scale: default12(), // cents list including 1200
  rootMidi: 60,       // reference root (C4)
  isTritype: false,   // if using non-octave (like tritave) – (future detection)
  // Derived:
  periodCents: 1200
};

const state = {
  macros: [0.3,0.5,0.2,0.4],
  baseFreq: 55,
  bendBase: 55,
  targetFreq: 55,
  glideMs: 40,
  currentNote: null,
  gate: false,
  unisonVoices: 3,
  unisonDetune: 25,
  seq: new Array(16).fill(false), // macro accent lane
  bpm: 172,
  seqEnabled: true,
  oversample: false,
  chaos: {rate:3.5, amount:0.3, targetFilter:true, targetDrive:true, targetMod:false},
  velocityMode: 'random',
  accentToggle: false,
  pitchBendRatio: 1
};

// NOTE SEQUENCER
let noteSequencer;

// VIRTUAL KEYBOARD
let vkRef;

/* ===================== Microtuning Helpers ===================== */
function tunedMidiToFreq(midi) {
  // Determine semitone distance from root in *scale degrees*, then wrap.
  // We map MIDI steps into scale degrees: Each scale step replaces '1 semitone' spacing notion.
  const scale = microtuning.scale;
  const period = microtuning.periodCents;
  // For non-12 step scales, we approximate: every 1 semitone in MIDI leaps by one scale degree.
  // Better approach: treat MIDI integer difference as degree difference directly.
  const diff = midi - microtuning.rootMidi;
  const scaleLen = scale.length - 1; // last expected to be 1200 (period); if not, treat last as period
  let degree = diff % scaleLen;
  if (degree < 0) degree += scaleLen;
  const octaveCount = Math.floor(diff / scaleLen);
  const baseCents = scale[degree];
  const totalCents = baseCents + octaveCount * period;
  // Reference A440: (rootMidi -> some cents offset). We assume microtuning root maps to equal tempered frequency of that MIDI.
  const rootFreq = 440 * Math.pow(2,(microtuning.rootMidi - 69)/12);
  // Cents between rootMidi and target
  const rootCentsFromA = (microtuning.rootMidi - 69) * 100;
  const targetCentsFromA = rootCentsFromA + totalCents;
  return 440 * Math.pow(2, targetCentsFromA / 1200);
}

function applyTuningPreset(raw, name) {
  const parsed = parseSCL(raw);
  microtuning.scale = normalizeScale(parsed.scale);
  microtuning.sclName = name;
  microtuning.periodCents = detectPeriod(microtuning.scale);
  updateTuningInfo();
  vkRef && vkRef.refreshTooltips();
}

function normalizeScale(scale) {
  // Ensure last element is >= 1200 or append 1200 for octave cycle; if not, find max and force 1200 as period
  let max = scale[scale.length-1];
  if (max < 1199.5 || max > 1200.5) {
    if (!scale.includes(1200)) scale.push(1200);
  }
  // Sort & unique
  const uniq = Array.from(new Set(scale.map(x=> parseFloat(x.toFixed(6)))));
  uniq.sort((a,b)=>a-b);
  if (uniq[0] !== 0) uniq.unshift(0);
  return uniq;
}

function detectPeriod(scale) {
  const last = scale[scale.length-1];
  // If last not near 1200 maybe treat as last anyway; keep general
  return last;
}

function updateTuningInfo() {
  const el = document.getElementById('tuningInfo');
  if (!el) return;
  el.textContent = `Tuning: ${microtuning.sclName} | Steps: ${microtuning.scale.length-1} | Root MIDI: ${microtuning.rootMidi} | Period: ${microtuning.periodCents.toFixed(2)}¢`;
}

/* ===================== Init ===================== */
async function init() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ensureOversampleWorklet(ctx);
  buildGraph();
  populatePresetSelect();
  buildEnvelopeUI();
  buildRoutingUISelectors();
  refreshRoutingTable();
  setupMicrotuningUI();
  setupVirtualKeyboard();
  buildNoteSequencerUI();
  startAnimationLoop();
  setupMIDI();
  updateTuningInfo();
}

function setupVirtualKeyboard() {
  const container = document.getElementById('virtualKeyboard');
  vkRef = buildVirtualKeyboard(container, {
    start:36, end:84, root: microtuning.rootMidi,
    getFreqForMidi: (m)=> tunedMidiToFreq(m),
    onNoteOn: (m, vel)=> noteOn(m, vel),
    onNoteOff: (m)=> {
      // Only turn off if matches current note (monophonic)
      if (state.currentNote === m) noteOff();
    }
  });
}

/* ===================== Graph Build ===================== */
function buildGraph() {
  fm = new FMGraph(ctx, 4);
  fm.setOperatorRatio(0, 1);
  fm.setOperatorRatio(1, 1.5);
  fm.setOperatorRatio(2, 2.01);
  fm.setOperatorRatio(3, 0.5);

  mainOut = ctx.createGain();
  mainOut.gain.value = 0.6;

  shaperA = ctx.createWaveShaper();
  shaperB = ctx.createWaveShaper();
  shaperMix = ctx.createGain(); shaperMix.gain.value = 0.7;
  updateShapers();

  distNode = ctx.createGain(); distNode.gain.value = 1.0;
  bitNode = applyBitcrushDownsample(ctx, distNode, 12, 3);

  filter1 = ctx.createBiquadFilter(); filter1.type='lowpass'; filter1.frequency.value = 3200; filter1.Q.value=0.3;
  filter2 = ctx.createBiquadFilter(); filter2.type='bandpass'; filter2.frequency.value = 800; filter2.Q.value=1.2;

  combDelay = ctx.createDelay(0.05);
  combFeedback = ctx.createGain(); combFeedback.gain.value=0.3;
  combDelay.connect(combFeedback).connect(combDelay);
  const combMix = ctx.createGain(); combMix.gain.value=0.5;

  fm.routeAllOutputs()
    .connect(distNode)
    .connect(shaperA)
    .connect(shaperB)
    .connect(shaperMix)
    .connect(bitNode)
    .connect(filter1)
    .connect(filter2)
    .connect(combMix)
    .connect(mainOut)
    .connect(ctx.destination);

  filter2.connect(combDelay).connect(mainOut);

  analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
  mainOut.connect(analyser);

  for (let i=0;i<fm.ops.length;i++) envelopes[i] = new ADSREnvelope(ctx, fm.ops[i].envGain, {});
  chaosLFO = new ChaosLFO(ctx, state.chaos);
  scheduleMacroAccentLane();
}

/* ===================== Shapers & Oversample ===================== */
function updateShapers() {
  if (!shaperA) return;
  const len=2048;
  const m1=state.macros[0], m2=state.macros[1];
  shaperA.curve = makeWaveshapeCurve(len, m1<0.33?'tanh':m1<0.66?'fold':'hybrid', 1+m2*2.2, 0.3+m1*0.8, 0.123*m1);
  shaperB.curve = makeWaveshapeCurve(len, 'diode', 1.2+m2*2.5, 0.2+m1*0.5, 0.987*m2);
}
function setOversample(on) {
  if (!ctx) return;
  if (on && !oversampleNode) {
    oversampleNode = new AudioWorkletNode(ctx, 'oversample-dist', {numberOfInputs:1, numberOfOutputs:1});
    distNode.disconnect();
    distNode.connect(oversampleNode).connect(shaperA);
  } else if (!on && oversampleNode) {
    distNode.disconnect();
    oversampleNode.disconnect();
    oversampleNode=null;
    distNode.connect(shaperA);
  }
}

/* ===================== MIDI ===================== */
function setupMIDI() {
  initMIDIInterface({
    noteOn: (m,v)=> noteOn(m, v),
    noteOff: (m)=> { if (state.currentNote===m) noteOff(); },
    setMacro: (i,val)=> {
      state.macros[i]=val; syncMacrosToUI(); updateParamsFromUI();
    },
    setFilterCut: (norm)=>{
      const min=80,max=12000;
      const val = min*Math.pow(max/min, norm);
      filterCut.value = Math.round(val);
      updateParamsFromUI();
    },
    setOutGain: (norm)=>{
      outGain.value = (0.1+norm*1.1).toFixed(3);
      updateParamsFromUI();
    },
    pitchBend: (ratio)=>{
      state.pitchBendRatio = ratio;
      applyPitchBend();
    }
  });
}

/* ===================== Pitch & Notes ===================== */
function applyPitchBend() {
  const tuned = tunedMidiToFreq(state.currentNote ?? microtuning.rootMidi);
  fm.setBaseFrequency(tuned * state.pitchBendRatio);
}

function computeVelocity() {
  switch(state.velocityMode) {
    case 'fixed': return 100/127;
    case 'random': return (60+Math.random()*67)/127;
    case 'accent': state.accentToggle=!state.accentToggle; return state.accentToggle?1.0:0.55;
  }
  return 0.8;
}

function noteOn(midi, velocityOverride) {
  state.currentNote = midi;
  const freq = tunedMidiToFreq(midi);
  state.baseFreq = freq;
  const vel = velocityOverride ?? computeVelocity();
  envelopes.forEach(env=> env.gateOn(vel));
  state.macros[1] = Math.min(1, state.macros[1]*0.7 + vel*0.6);
  syncMacrosToUI();
  updateShapers();
  transientTick(ctx, distNode, ctx.currentTime, 0.1 + vel*0.15);
  fm.setBaseFrequency(freq * state.pitchBendRatio);
  state.gate = true;
}

function noteOff() {
  envelopes.forEach(env=> env.gateOff());
  state.gate=false;
}

/* ===================== Randomization ===================== */
function randomize(safe=true) {
  if (!fm) return;
  for (let i=0;i<4;i++){
    const ratio = safe ? (1 + Math.random()*4) : (0.25 + Math.random()*12);
    fm.setOperatorRatio(i, ratio);
  }
  fm.modMatrix.forEach(m=>{
    const depth = safe ? 40+Math.random()*200 : 10+Math.random()*800;
    m.gain.gain.setTargetAtTime(depth, ctx.currentTime, 0.05);
  });
  state.macros = state.macros.map(()=> Math.random());
  syncMacrosToUI();
  randomizeEnvelopes(safe?0.3:1.0);
  updateShapers();
  updateParamsFromUI();
  refreshRoutingTable();
}
function randomizeEnvelopes(intensity=1.0) {
  envelopes.forEach(env=>{
    env.set({
      a:0.003+Math.random()*0.15*intensity,
      d:0.05+Math.random()*0.35*intensity,
      s:Math.random()*0.8,
      r:0.05+Math.random()*0.5*intensity,
      level:0.4+Math.random()*0.7,
      modScale:0.8+Math.random()*1.5*intensity
    });
  });
  syncEnvelopeUI();
}
function randomizeAll() {
  randomize(false);
  baseFreq.value = (30+Math.random()*80).toFixed(2);
  filterCut.value = Math.floor(200+Math.random()*10000);
  filterRes.value = (0.1+Math.random()*0.9).toFixed(3);
  combDepth.value = Math.random().toFixed(3);
  distDrive.value = (Math.random()*2.5).toFixed(3);
  foldAmt.value = (Math.random()*1.5).toFixed(3);
  bitDepth.value = Math.floor(4+Math.random()*13);
  downsample.value = Math.floor(1+Math.random()*15);
  unisonVoices.value = Math.floor(1+Math.random()*6);
  unisonDetune.value = Math.floor(Math.random()*70);
  outGain.value = (0.3+Math.random()*0.8).toFixed(3);
  chaosRate.value = (0.2+Math.random()*12).toFixed(2);
  chaosAmount.value = Math.random().toFixed(3);
  chaosFilter.checked = Math.random()>0.3;
  chaosDrive.checked = Math.random()>0.3;
  chaosMod.checked = Math.random()>0.6;
  spikesEnable.checked = Math.random()>0.4;
  spikeProb.value = (Math.random()*0.4).toFixed(3);
  spikeBoost.value = (1+Math.random()*2).toFixed(2);
  applyChaosUI();
  applySpikeUI();
  randomizeEnvelopes();
  syncMacrosToUI();
  updateParamsFromUI();
  refreshRoutingTable();
}

/* ===================== UI Sync ===================== */
function syncMacrosToUI() {
  document.querySelectorAll('[data-macro]').forEach(inp=>{
    const i=parseInt(inp.dataset.macro);
    if (inp.value != state.macros[i]) inp.value = state.macros[i];
  });
}
function updateParamsFromUI() {
  const f=parseFloat(baseFreq.value);
  state.baseFreq=f;
  fm && fm.setBaseFrequency(f * state.pitchBendRatio);
  filter1.frequency.setTargetAtTime(parseFloat(filterCut.value), ctx.currentTime, 0.02);
  filter1.Q.setTargetAtTime(parseFloat(filterRes.value), ctx.currentTime, 0.05);
  if (oversampleNode) {
    oversampleNode.parameters.get('drive').setValueAtTime(parseFloat(distDrive.value), ctx.currentTime);
    oversampleNode.parameters.get('fold').setValueAtTime(parseFloat(foldAmt.value), ctx.currentTime);
  }
  state.unisonVoices = parseInt(unisonVoices.value);
  state.unisonDetune = parseFloat(unisonDetune.value);
  mainOut && mainOut.gain.setTargetAtTime(parseFloat(outGain.value), ctx.currentTime, 0.1);
  filter2.frequency.setTargetAtTime(400 + state.macros[0]*2200, ctx.currentTime, 0.05);
  filter2.Q.setTargetAtTime(0.5 + state.macros[1]*6, ctx.currentTime, 0.05);
  combFeedback.gain.setTargetAtTime(parseFloat(combDepth.value)*0.8, ctx.currentTime, 0.1);
  updateShapers();
}

/* ===================== Macro Accent Lane ===================== */
function scheduleMacroAccentLane() {
  clearTimeout(seqTimer);
  if (!ctx) return;
  if (!state.seqEnabled) {
    seqTimer = setTimeout(scheduleMacroAccentLane,120);
    return;
  }
  const stepDur = 60/state.bpm/4;
  const now=ctx.currentTime;
  for (let i=0;i<16;i++){
    if (state.seq[i]) {
      const t=now+i*stepDur;
      fm.modMatrix.forEach(m=>{
        const modDepth = m.gain.gain.value;
        m.gain.gain.setTargetAtTime(modDepth*(1 + 0.1*state.macros[0]), t, 0.01);
      });
    }
  }
  seqTimer = setTimeout(scheduleMacroAccentLane, stepDur*4000/4);
}
function toggleSeqCell(idx, el) {
  state.seq[idx]=!state.seq[idx];
  el.classList.toggle('active', state.seq[idx]);
}

/* ===================== Chaos Loop ===================== */
function startAnimationLoop() {
  function loop(){
    if (ctx) {
      const cVal = chaosLFO.step();
      if (state.chaos.targetFilter){
        const base=parseFloat(filterCut.value);
        filter1.frequency.setTargetAtTime(Math.max(80, base*(1+cVal*0.4)), ctx.currentTime,0.03);
      }
      if (state.chaos.targetDrive){
        const baseD=parseFloat(distDrive.value);
        const d=Math.max(0, baseD*(1+cVal*0.5));
        if (oversampleNode)
          oversampleNode.parameters.get('drive').setValueAtTime(d, ctx.currentTime);
        else
          distNode.gain.setTargetAtTime(1 + cVal*0.4, ctx.currentTime,0.05);
      }
      if (state.chaos.targetMod){
        fm.modMatrix.forEach(m=>{
          const base=m.gain.gain.value;
            m.gain.gain.setTargetAtTime(base*(1 + cVal*0.15), ctx.currentTime,0.05);
        });
      }
      maybeSpike(spikeState, fm);
      fm.modMatrix.forEach(m=>{
        const env = envelopes[m.source];
        if (env) {
          const scale = env.modScale * env.gainNode.gain.value;
          const base=m.gain.gain.value;
          m.gain.gain.setTargetAtTime(base*(0.9 + 0.1*scale), ctx.currentTime,0.03);
        }
      });
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

/* ===================== Presets (same structure, diff connections) ===================== */
const LOCAL_KEY='neuroSynthPresets_v2';
function getUserPresets() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY))||[]; } catch { return []; } }
function saveUserPresets(list){ localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); }
function defaultEnvelope(){ return {a:0.01,d:0.12,s:0.6,r:0.3,level:1.0,modScale:1.0}; }

function collectPreset(){
  const modDepths = fm.modMatrix.map(m=>({s:m.source,d:m.dest,depth:m.gain.gain.value}));
  const outLevels = fm.ops.map(o=> o.outGain.gain.value);
  const envs = envelopes.map(e=> ({a:e.a,d:e.d,s:e.s,r:e.r,level:e.level,modScale:e.modScale}));
  return {
    name:'Unsaved', version:2,
    fm:{ ratios: fm.ops.map(o=>o.ratio), modDepths, outLevels },
    envelopes: envs,
    macros:[...state.macros],
    chaos:{...state.chaos},
    spikes:{...spikeState},
    params:{
      baseFreq: parseFloat(baseFreq.value),
      filterCut: parseFloat(filterCut.value),
      filterRes: parseFloat(filterRes.value),
      combDepth: parseFloat(combDepth.value),
      distDrive: parseFloat(distDrive.value),
      foldAmt: parseFloat(foldAmt.value),
      bitDepth: parseInt(bitDepth.value),
      downsample: parseInt(downsample.value),
      unisonVoices: parseInt(unisonVoices.value),
      unisonDetune: parseFloat(unisonDetune.value),
      outGain: parseFloat(outGain.value)
    }
  };
}

function applyPreset(p){
  if (!p) return;
  const v=p.version||1;
  // Diff mod matrix
  const target= new Set((p.fm?.modDepths||[]).map(md=>`${md.s}:${md.d}`));
  fm.modMatrix.slice().forEach(m=>{
    if (!target.has(`${m.source}:${m.dest}`)) fm.removeConnection(m.source,m.dest);
  });
  if (p.fm?.modDepths) {
    p.fm.modDepths.forEach(md=>{
      fm.connect(md.s, md.d, md.depth);
      fm.setModDepth(md.s, md.d, md.depth);
    });
  }
  if (p.fm?.ratios) p.fm.ratios.forEach((r,i)=> fm.setOperatorRatio(i,r));
  if (p.fm?.outLevels) p.fm.outLevels.forEach((lvl,i)=> fm.setOutLevel(i,lvl));
  if (Array.isArray(p.macros)) {
    state.macros = p.macros.slice(0,4);
    syncMacrosToUI();
  }
  const envArr = v>=2 && p.envelopes ? p.envelopes : new Array(4).fill(0).map(()=> defaultEnvelope());
  envArr.forEach((e,i)=> envelopes[i].set(e));
  syncEnvelopeUI();
  if (v>=2 && p.chaos) {
    state.chaos = {
      rate: p.chaos.rate ?? 3.5,
      amount: p.chaos.amount ?? 0.3,
      targetFilter: !!p.chaos.targetFilter,
      targetDrive: !!p.chaos.targetDrive,
      targetMod: !!p.chaos.targetMod
    };
    applyChaosToUI();
  }
  if (v>=2 && p.spikes) {
    spikeState.enabled=!!p.spikes.enabled;
    spikeState.probability=p.spikes.probability ?? 0.15;
    spikeState.boost=p.spikes.boost ?? 1.5;
    applySpikeUIToControls();
  }
  const params = p.params||{};
  baseFreq.value = params.baseFreq ?? baseFreq.value;
  filterCut.value = params.filterCut ?? filterCut.value;
  filterRes.value = params.filterRes ?? filterRes.value;
  combDepth.value = params.combDepth ?? combDepth.value;
  distDrive.value = params.distDrive ?? distDrive.value;
  foldAmt.value = params.foldAmt ?? foldAmt.value;
  bitDepth.value = params.bitDepth ?? bitDepth.value;
  downsample.value = params.downsample ?? downsample.value;
  unisonVoices.value = params.unisonVoices ?? unisonVoices.value;
  unisonDetune.value = params.unisonDetune ?? unisonDetune.value;
  outGain.value = params.outGain ?? outGain.value;
  updateParamsFromUI();
  chaosLFO.rate = state.chaos.rate;
  chaosLFO.amount = state.chaos.amount;
  refreshRoutingTable();
}

function populatePresetSelect(selectedName){
  const sel=document.getElementById('presetSelect');
  if(!sel) return;
  sel.innerHTML='';
  const grpB=document.createElement('optgroup'); grpB.label='Built-in';
  BUILTIN_PRESETS.forEach(p=>{
    const opt=document.createElement('option');
    opt.value=`builtin:${p.name}`; opt.textContent=p.name;
    if (selectedName===p.name) opt.selected=true;
    grpB.appendChild(opt);
  });
  sel.appendChild(grpB);
  const grpU=document.createElement('optgroup'); grpU.label='User';
  getUserPresets().forEach(p=>{
    const opt=document.createElement('option');
    opt.value=`user:${p.name}`; opt.textContent=p.name;
    if (selectedName===p.name) opt.selected=true;
    grpU.appendChild(opt);
  });
  sel.appendChild(grpU);
}
function getSelectedPresetMeta(){
  const sel=document.getElementById('presetSelect');
  if(!sel||!sel.value) return null;
  const [scope,...rest]=sel.value.split(':');
  return {scope,name:rest.join(':')};
}
function loadSelectedPreset(){
  const meta=getSelectedPresetMeta(); if(!meta) return;
  const p = meta.scope==='builtin'
    ? BUILTIN_PRESETS.find(x=>x.name===meta.name)
    : getUserPresets().find(x=>x.name===meta.name);
  applyPreset(p);
}
function savePresetAs(){
  const name=prompt('Preset name:'); if(!name) return;
  const preset=collectPreset();
  preset.name=name;
  const list=getUserPresets().filter(p=>p.name!==name);
  list.push(preset);
  saveUserPresets(list);
  populatePresetSelect(name);
  document.getElementById('presetSelect').value=`user:${name}`;
}
function deletePreset(){
  const meta=getSelectedPresetMeta(); if(!meta) return;
  if (meta.scope==='builtin') { alert('Cannot delete built-in.'); return; }
  const list=getUserPresets().filter(p=>p.name!==meta.name);
  saveUserPresets(list); populatePresetSelect();
}
async function exportPreset(){
  const meta=getSelectedPresetMeta(); if(!meta) return;
  let preset= meta.scope==='builtin'
    ? BUILTIN_PRESETS.find(p=>p.name===meta.name)
    : getUserPresets().find(p=>p.name===meta.name);
  if(!preset) return;
  const json=JSON.stringify(preset,null,2);
  try { await navigator.clipboard.writeText(json); } catch {}
  const blob=new Blob([json],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`${preset.name.replace(/\s+/g,'_')}.json`; a.click();
}
function importFromText(saveAlso=false){
  const ta=document.getElementById('presetImportText');
  if(!ta.value.trim()) return;
  try {
    const p=JSON.parse(ta.value);
    applyPreset(p);
    if (saveAlso){
      if(!p.name) p.name='Imported '+Date.now();
      const list=getUserPresets().filter(x=>x.name!==p.name);
      list.push(p); saveUserPresets(list);
      populatePresetSelect(p.name);
      document.getElementById('presetSelect').value=`user:${p.name}`;
    }
    hideImportArea();
  } catch(e){ alert('Invalid JSON: '+e.message); }
}
function showImportArea(){ document.getElementById('importArea').style.display='block'; }
function hideImportArea(){ document.getElementById('importArea').style.display='none'; document.getElementById('presetImportText').value=''; }

/* ===================== Envelopes ===================== */
function buildEnvelopeUI(){
  const c=document.getElementById('envContainer'); c.innerHTML='';
  for(let i=0;i<4;i++){
    const div=document.createElement('div');
    div.className='env-op';
    div.innerHTML=`
      <strong>Operator ${i}</strong>
      <label>A</label><input type="range" min="0" max="1" step="0.001" data-env="${i}" data-param="a" value="0.01" />
      <label>D</label><input type="range" min="0" max="1.5" step="0.001" data-env="${i}" data-param="d" value="0.12" />
      <label>Sustain</label><input type="range" min="0" max="1" step="0.001" data-env="${i}" data-param="s" value="0.6" />
      <label>Release</label><input type="range" min="0" max="2" step="0.001" data-env="${i}" data-param="r" value="0.3" />
      <label>Level</label><input type="range" min="0" max="1.5" step="0.001" data-env="${i}" data-param="level" value="1.0" />
      <label>Mod Scale</label><input type="range" min="0" max="2" step="0.001" data-env="${i}" data-param="modScale" value="1.0" />
    `;
    c.appendChild(div);
  }
  c.querySelectorAll('input[data-env]').forEach(el=>{
    el.addEventListener('input', e=>{
      const idx=parseInt(e.target.dataset.env);
      const param=e.target.dataset.param;
      const val=parseFloat(e.target.value);
      const env=envelopes[idx];
      if (env) env[param]=val;
    });
  });
}
function syncEnvelopeUI(){
  envelopes.forEach((env,i)=>{
    ['a','d','s','r','level','modScale'].forEach(p=>{
      const el=document.querySelector(`input[data-env="${i}"][data-param="${p}"]`);
      if (el) el.value=env[p];
    });
  });
}

/* ===================== Chaos & Spikes UI ===================== */
function applyChaosUI(){
  state.chaos.rate=parseFloat(chaosRate.value);
  state.chaos.amount=parseFloat(chaosAmount.value);
  state.chaos.targetFilter=chaosFilter.checked;
  state.chaos.targetDrive=chaosDrive.checked;
  state.chaos.targetMod=chaosMod.checked;
  chaosLFO.rate=state.chaos.rate;
  chaosLFO.amount=state.chaos.amount;
}
function applyChaosToUI(){
  chaosRate.value=state.chaos.rate;
  chaosAmount.value=state.chaos.amount;
  chaosFilter.checked=state.chaos.targetFilter;
  chaosDrive.checked=state.chaos.targetDrive;
  chaosMod.checked=state.chaos.targetMod;
}
function applySpikeUI(){
  spikeState.enabled=spikesEnable.checked;
  spikeState.probability=parseFloat(spikeProb.value);
  spikeState.boost=parseFloat(spikeBoost.value);
}
function applySpikeUIToControls(){
  spikesEnable.checked=spikeState.enabled;
  spikeProb.value=spikeState.probability;
  spikeBoost.value=spikeState.boost;
}

/* ===================== Routing Editor ===================== */
function buildRoutingUISelectors(){
  const addSource=document.getElementById('addSource');
  const addDest=document.getElementById('addDest');
  addSource.innerHTML=''; addDest.innerHTML='';
  for (let i=0;i<fm.ops.length;i++){
    const o1=document.createElement('option'); o1.value=i; o1.textContent=`Op ${i}`; addSource.appendChild(o1);
    const o2=document.createElement('option'); o2.value=i; o2.textContent=`Op ${i}`; addDest.appendChild(o2);
  }
}
function refreshRoutingTable(){
  const body=document.getElementById('modRoutesBody'); if(!body) return;
  body.innerHTML='';
  fm.modMatrix.forEach(entry=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>Op ${entry.source}</td><td>Op ${entry.dest}</td>`;
    const tdDepth=document.createElement('td');
    const slider=document.createElement('input');
    slider.type='range'; slider.min='0'; slider.max='1000'; slider.step='1';
    slider.value=entry.gain.gain.value.toFixed(0);
    slider.addEventListener('input',()=> {
      entry.gain.gain.setTargetAtTime(parseFloat(slider.value), ctx.currentTime, 0.05);
    });
    tdDepth.appendChild(slider);
    const tdAct=document.createElement('td');
    const btn=document.createElement('button'); btn.textContent='Remove'; btn.className='danger';
    btn.addEventListener('click', ()=> {
      fm.removeConnection(entry.source, entry.dest);
      refreshRoutingTable();
    });
    tdAct.appendChild(btn);
    tr.appendChild(tdDepth); tr.appendChild(tdAct);
    body.appendChild(tr);
  });
}
function addRouteFromUI(){
  const s=parseInt(addSource.value);
  const d=parseInt(addDest.value);
  const depth=parseFloat(addDepth.value);
  fm.connect(s,d,depth);
  refreshRoutingTable();
}
function normalizeRoutes(){
  if(!fm.modMatrix.length) return;
  const max=Math.max(...fm.modMatrix.map(m=>m.gain.gain.value));
  if (max<=0) return;
  const targetMax=300;
  fm.modMatrix.forEach(m=>{
    const scaled=(m.gain.gain.value/max)*targetMax;
    m.gain.gain.setTargetAtTime(scaled, ctx.currentTime, 0.05);
  });
  refreshRoutingTable();
}

/* ===================== Note Sequencer UI ===================== */
function buildNoteSequencerUI() {
  noteSequencer = new NoteSequencer({
    steps:16,
    getBPM: ()=> state.bpm,
    onStepNoteOn: (m,v)=> noteOn(m, v),
    onStepNoteOff: (m)=> { if (state.currentNote===m) noteOff(); },
    getFreqForMidi: (m)=> tunedMidiToFreq(m),
    isPlayingRef: ()=> noteSeqPlaying
  });
  const tbody = document.getElementById('noteSeqBody');
  tbody.innerHTML='';
  for (let i=0;i<noteSequencer.steps.length;i++){
    const step=noteSequencer.steps[i];
    const tr=document.createElement('tr');
    const tdIdx=document.createElement('td'); tdIdx.textContent=(i+1);
    const tdEn=document.createElement('td');
    const en=document.createElement('input'); en.type='checkbox';
    en.addEventListener('change', ()=> step.enabled=en.checked);
    tdEn.appendChild(en);
    const tdNote=document.createElement('td');
    const sel=document.createElement('select');
    createNoteOptions(sel, step.midi);
    sel.addEventListener('change', ()=> step.midi=parseInt(sel.value));
    tdNote.appendChild(sel);
    const tdVel=document.createElement('td');
    const vel=document.createElement('input'); vel.type='range'; vel.min='0'; vel.max='1'; vel.step='0.01'; vel.value=step.velocity;
    vel.style.width='80px';
    vel.addEventListener('input', ()=> step.velocity=parseFloat(vel.value));
    tdVel.appendChild(vel);
    const tdGate=document.createElement('td');
    const gate=document.createElement('input'); gate.type='range'; gate.min='0.05'; gate.max='1'; gate.step='0.01'; gate.value=step.gate;
    gate.style.width='80px';
    gate.addEventListener('input', ()=> step.gate=parseFloat(gate.value));
    tdGate.appendChild(gate);

    tr.appendChild(tdIdx); tr.appendChild(tdEn); tr.appendChild(tdNote); tr.appendChild(tdVel); tr.appendChild(tdGate);
    tbody.appendChild(tr);
  }
  document.getElementById('noteSeqPlay').addEventListener('click', ()=> { noteSeqPlaying=true; noteSequencer.start(); });
  document.getElementById('noteSeqStop').addEventListener('click', ()=> { noteSeqPlaying=false; noteSequencer.stop(); });
}

function createNoteOptions(selectEl, defaultMidi=60) {
  selectEl.innerHTML='';
  for (let m=24;m<=96;m++){
    const opt=document.createElement('option');
    opt.value=m;
    opt.textContent=midiName(m);
    if (m===defaultMidi) opt.selected=true;
    selectEl.appendChild(opt);
  }
}

function midiName(m){
  const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return names[m%12]+(Math.floor(m/12)-1);
}

let noteSeqPlaying=false;

/* ===================== Microtuning UI Setup ===================== */
function setupMicrotuningUI() {
  const sclPreset=document.getElementById('sclPreset');
  SCL_PRESETS.forEach(([name])=>{
    const opt=document.createElement('option'); opt.value=name; opt.textContent=name;
    sclPreset.appendChild(opt);
  });
  sclPreset.value = microtuning.sclName;
  sclPreset.addEventListener('change', ()=>{
    const chosen = SCL_PRESETS.find(p=> p[0]===sclPreset.value);
    if (chosen) applyTuningPreset(chosen[1], chosen[0]);
    vkRef && vkRef.setRoot(microtuning.rootMidi);
  });

  const sclFile=document.getElementById('sclFile');
  sclFile.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if (!file) return;
    const reader=new FileReader();
    reader.onload = ()=> {
      applyTuningPreset(reader.result, file.name);
      document.getElementById('sclPreset').value = ''; // no preset selected
    };
    reader.readAsText(file);
  });

  const tuningRoot=document.getElementById('tuningRoot');
  for (let m=24;m<=96;m++){
    const opt=document.createElement('option');
    opt.value=m; opt.textContent=`Root ${midiName(m)}`;
    if (m===microtuning.rootMidi) opt.selected=true;
    tuningRoot.appendChild(opt);
  }
  tuningRoot.addEventListener('change', ()=>{
    microtuning.rootMidi = parseInt(tuningRoot.value);
    updateTuningInfo();
    vkRef && vkRef.setRoot(microtuning.rootMidi);
    vkRef && vkRef.refreshTooltips();
  });

  document.getElementById('tuningReset').addEventListener('click', ()=>{
    applyTuningPreset(SCL_PRESETS[0][1], SCL_PRESETS[0][0]);
    microtuning.rootMidi = 60;
    tuningRoot.value = 60;
    vkRef && vkRef.setRoot(60);
  });
}

/* ===================== Utility ===================== */
function glideUpdate(){ setTimeout(glideUpdate, 30); }
function doStutter() {
  if(!ctx) return;
  const delay=ctx.createDelay(0.2);
  const fb=ctx.createGain(); fb.gain.value=0.55;
  delay.delayTime.value=0.08+Math.random()*0.05;
  delay.connect(fb).connect(delay);
  const tap=ctx.createGain(); tap.gain.value=0.6;
  mainOut.connect(delay).connect(tap).connect(ctx.destination);
  setTimeout(()=> {
    delay.disconnect();
    tap.disconnect();
  }, 220);
}

/* ===================== UI Init ===================== */
function initUI() {
  initBtn.addEventListener('click', init);
  noteOnBtn.addEventListener('click', ()=> noteOn(state.currentNote ?? microtuning.rootMidi));
  noteOffBtn.addEventListener('click', ()=> noteOff());
  noteRandom.addEventListener('click', ()=> noteOn(30+Math.floor(Math.random()*24)));
  panic.addEventListener('click', ()=> { noteOff(); ctx && ctx.close(); });

  rndSafe.addEventListener('click', ()=> randomize(true));
  rndWild.addEventListener('click', ()=> randomize(false));
  rndAll.addEventListener('click', ()=> randomizeAll());
  stutter.addEventListener('click', ()=> doStutter());

  oversampleToggle.addEventListener('change', e=>{
    state.oversample=e.target.checked;
    setOversample(state.oversample);
  });

  [baseFreq, distDrive, foldAmt, filterCut, filterRes, bitDepth, downsample,
   unisonVoices, unisonDetune, combDepth, outGain].forEach(el =>
     el.addEventListener('input', updateParamsFromUI)
  );

  glide.addEventListener('input', ()=> state.glideMs=parseFloat(glide.value));
  bpm.addEventListener('input', e=> { state.bpm=parseFloat(e.target.value); scheduleMacroAccentLane(); });
  seqEnable.addEventListener('change', e=> { state.seqEnabled=e.target.checked; scheduleMacroAccentLane(); });
  velocityMode.addEventListener('change', e=> state.velocityMode=e.target.value);

  document.querySelectorAll('[data-macro]').forEach(inp=>{
    inp.addEventListener('input', e=>{
      const i=parseInt(e.target.dataset.macro);
      state.macros[i]=parseFloat(e.target.value);
      updateParamsFromUI();
    });
  });

  chaosRate.addEventListener('input', applyChaosUI);
  chaosAmount.addEventListener('input', applyChaosUI);
  chaosFilter.addEventListener('change', applyChaosUI);
  chaosDrive.addEventListener('change', applyChaosUI);
  chaosMod.addEventListener('change', applyChaosUI);
  spikesEnable.addEventListener('change', applySpikeUI);
  spikeProb.addEventListener('input', applySpikeUI);
  spikeBoost.addEventListener('input', applySpikeUI);

  document.querySelectorAll('.learn-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx=parseInt(btn.dataset.learn);
      startMacroLearn(idx);
      document.querySelectorAll('.macro').forEach(m=> m.classList.remove('learn-active'));
      const box=document.querySelector(`.macro[data-macro-box="${idx}"]`);
      if (box) {
        box.classList.add('learn-active');
        setTimeout(()=> box.classList.remove('learn-active'), 6000);
      }
    });
  });

  // Macro accent lane grid
  const grid=document.getElementById('seqGrid');
  for (let i=0;i<16;i++){
    const cell=document.createElement('div');
    cell.className='seq-cell';
    cell.addEventListener('click', ()=> toggleSeqCell(i, cell));
    grid.appendChild(cell);
  }

  // Presets
  presetLoad.addEventListener('click', loadSelectedPreset);
  presetSaveAs.addEventListener('click', savePresetAs);
  presetDelete.addEventListener('click', deletePreset);
  presetExport.addEventListener('click', exportPreset);
  presetImportToggle.addEventListener('click', showImportArea);
  presetImportCancel.addEventListener('click', hideImportArea);
  presetImportLoad.addEventListener('click', ()=> importFromText(false));
  presetImportSave.addEventListener('click', ()=> importFromText(true));
  presetSelect.addEventListener('change', loadSelectedPreset);

  // Routing
  addRouteBtn.addEventListener('click', addRouteFromUI);
  normalizeRoutesBtn.addEventListener('click', normalizeRoutes);

  // MIDI
  const enableMIDIbtn=document.getElementById('enableMIDI');
  enableMIDIbtn.addEventListener('click', async ()=>{
    await enableMIDI(populateMIDIInputs);
    populateMIDIInputs(midiState.inputs);
  });
  midiInputSelect.addEventListener('change', ()=> setInput(midiInputSelect.value));
  midiChannelSelect.addEventListener('change', ()=> setChannel(parseInt(midiChannelSelect.value)));
  bendRange.addEventListener('input', ()=> setBendRange(parseInt(bendRange.value)));
}

function populateMIDIInputs(inputs){
  midiInputSelect.innerHTML='';
  inputs.forEach(inp=>{
    const opt=document.createElement('option');
    opt.value=inp.id; opt.textContent=inp.name;
    midiInputSelect.appendChild(opt);
  });
  if (inputs.length) setInput(inputs[0].id);
}

initUI();
glideUpdate();

window._neuro = { ctx:()=>ctx, fm:()=>fm, state, envelopes, spikeState, midiState, microtuning, tunedMidiToFreq };
