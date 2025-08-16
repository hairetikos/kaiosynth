# kaiosynth (Web Audio)

Experimental browser-based bass synthesizer for intense chaotic neuro sound design.

features .SCL microtuning preset support with some built-in scales.

## Core Features
- 4 FM operators with dynamic modulation routing (editable UI)
- Per-operator ADSR amplitude envelopes + modulation scaling (envelope influence on outgoing FM depth)
- Unison, glide placeholder, transient tick
- .SCL microtuning preset support with some built-in scales.
- Multi-stage distortion (fold / diode / hybrid) + optional oversampled drive core
- Bitcrush & pseudo downsample
- Dual filter + comb/notch hybrid
- 4 Macros + 16-step trigger lane
- Chaos LFO (logistic map) modulating filter / drive / FM depth
- Neuron spike system (probabilistic FM depth bursts)
- Glitch stutter
- Preset system (v2) with built-ins + user save / load / import / export
- Randomization (Safe / Wild / All; envelopes + chaos + spikes)
- MIDI Support (NEW)
  - Device & channel selection
  - Note On/Off with velocity mapping
  - Pitch Bend (configurable range)
  - CC mappings (default):
    - CC1 → Macro1 (Motion)
    - CC2 → Macro2 (Drive)
    - CC74 → Filter Cut
    - CC7 → Output Gain
    - CC64 Sustain pedal
    - Channel Pressure → Macro3 (Morph)
  - MIDI Learn mode for macros (click “Learn” then move a CC)

## Mod Routing Editor
- Add modulation paths: pick Source Operator → Destination Operator; set depth
- Remove paths with one click
- Normalize Depths utility rescales all mod depths to a selected max
- Presets: Loading replaces existing routes with preset routes (non-listed routes removed)
- Randomization affects existing routes; add more for complexity.

## Preset JSON (v2)
Same as previous version (see earlier description) with fields:
- fm.ratios, fm.modDepths[{s,d,depth}], fm.outLevels
- envelopes[]
- chaos{}, spikes{}
- macros[], params{}

MIDI mappings are session-only (not serialized) to keep presets portable.

## MIDI Usage
1. Click “Enable MIDI” (browser prompt).
2. Select input + channel (or Omni).
3. Play your controller; adjust pitch bend, mod wheel, aftertouch, etc.
4. Use “Bend Range” to set semitone pitch bend range.
5. Click a macro’s Learn button; move a CC to bind (overrides default mapping for that macro).

## Build / Run
Static site: `npx http-server -c-1 -p 8080 .` then open `src/index.html`.

## Safety
High gain + spikes + chaos may cause loud bursts. Keep output gain moderate and monitor levels.

## Roadmap Ideas
- Preset morph slider
- MIDI clock sync & tempo follow
- MPE / per-note modulation
- Envelope MSEGs
- FFT spectral warp
- Proper oversampled bitcrush worklet
- Mod routing matrix visualization (graph)

Enjoy destroying some waveforms.
