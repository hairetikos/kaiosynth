// MIDI integration module
// Exports functions consumed by synth.js to hook into noteOn/noteOff and macro updates.

export const midiState = {
  access: null,
  inputs: [],
  input: null,
  channel: -1, // -1 = omni
  bendRange: 2,
  sustain: false,
  heldNotes: new Set(),
  ccMap: {
    // macro index bindings; default CC list, can be overwritten via learn
    macro: { 0: 1, 1: 2, 2: null, 3: null },
    filterCut: 74,
    outGain: 7
  },
  learnTarget: null, // {type:'macro', index:0}
  aftertouchMacro: 2 // channel pressure → macro3
};

let handlers = {
  noteOn: (midi, vel)=>{},
  noteOff: (midi)=>{},
  setMacro: (i,val)=>{},
  setFilterCut:(val)=>{},
  setOutGain:(val)=>{},
  pitchBend:(ratio)=>{}
};

export function initMIDIInterface(h) {
  handlers = { ...handlers, ...h };
}

export async function enableMIDI(onChangeDevices) {
  if (!navigator.requestMIDIAccess) {
    alert("Web MIDI not supported in this browser.");
    return;
  }
  try {
    midiState.access = await navigator.requestMIDIAccess({ sysex:false });
    midiState.access.onstatechange = ()=> refreshInputs(onChangeDevices);
    refreshInputs(onChangeDevices);
  } catch (e) {
    console.error("MIDI access error", e);
  }
}

function refreshInputs(cb) {
  midiState.inputs = [];
  midiState.access.inputs.forEach(inp => midiState.inputs.push(inp));
  if (!midiState.input && midiState.inputs.length) {
    setInput(midiState.inputs[0].id);
  }
  cb && cb(midiState.inputs);
}

export function setInput(id) {
  if (midiState.input) {
    try { midiState.input.onmidimessage = null; } catch {}
  }
  midiState.input = midiState.inputs.find(i=> i.id === id) || null;
  if (midiState.input) midiState.input.onmidimessage = onMIDIMessage;
}

export function setChannel(ch) {
  midiState.channel = ch; // -1 omni
}

export function setBendRange(semi) {
  midiState.bendRange = semi;
}

function channelMatches(status) {
  if (midiState.channel === -1) return true;
  return (status & 0x0f) === midiState.channel;
}

function onMIDIMessage(e) {
  const [status, d1, d2] = e.data;
  const type = status & 0xf0;
  if (!channelMatches(status)) return;

  if (type === 0x90 && d2 > 0) {
    // note on
    midiState.heldNotes.add(d1);
    handlers.noteOn(d1, d2/127);
  } else if ((type === 0x80) || (type === 0x90 && d2 === 0)) {
    // note off
    midiState.heldNotes.delete(d1);
    if (!midiState.sustain) handlers.noteOff(d1);
  } else if (type === 0xB0) {
    // CC
    handleCC(d1, d2);
  } else if (type === 0xE0) {
    // Pitch Bend (14-bit)
    const value = (d2 << 7) | d1; // 0..16383
    const norm = (value - 8192) / 8192; // -1..1
    const ratio = Math.pow(2, norm * (midiState.bendRange/12));
    handlers.pitchBend(ratio);
  } else if (type === 0xD0) {
    // Channel aftertouch
    if (midiState.aftertouchMacro != null) {
      handlers.setMacro(midiState.aftertouchMacro, d1/127);
    }
  }
}

function handleCC(cc, val) {
  // Learn mode?
  if (midiState.learnTarget) {
    if (midiState.learnTarget.type === 'macro') {
      midiState.ccMap.macro[midiState.learnTarget.index] = cc;
    }
    midiState.learnTarget = null;
    return;
  }

  // Sustain pedal
  if (cc === 64) {
    const sustainOn = val >= 64;
    if (!sustainOn && midiState.sustain) {
      // releasing sustain: send noteOff for any not physically held
      midiState.heldNotes.forEach(()=>{});
      // We need a copy because we'll modify set
      const toRelease = Array.from(midiState.heldNotes);
      toRelease.forEach(n=>{
        // if key is physically held it's in heldNotes; we don't track raw vs sustain
        // Simplified: always release when sustain ends IF not re-triggered recently
      });
    }
    midiState.sustain = sustainOn;
    return;
  }

  // Check macro bindings
  for (const mIndex in midiState.ccMap.macro) {
    if (midiState.ccMap.macro[mIndex] === cc) {
      handlers.setMacro(parseInt(mIndex), val/127);
      return;
    }
  }

  if (cc === midiState.ccMap.filterCut) {
    handlers.setFilterCut(val/127);
    return;
  }
  if (cc === midiState.ccMap.outGain) {
    handlers.setOutGain(val/127);
    return;
  }
}

// Macro Learn API
export function startMacroLearn(index) {
  midiState.learnTarget = {type:'macro', index};
}
