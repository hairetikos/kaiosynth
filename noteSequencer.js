// 16-step monophonic note sequencer with velocity & gate
export class NoteSequencer {
  constructor({
    steps=16,
    getBPM,
    onStepNoteOn,
    onStepNoteOff,
    getFreqForMidi,
    isPlayingRef
  }) {
    this.steps = new Array(steps).fill(0).map(()=> ({
      enabled:false,
      midi:60,
      velocity:0.8,
      gate:0.5
    }));
    this.getBPM = getBPM;
    this.onStepNoteOn = onStepNoteOn;
    this.onStepNoteOff = onStepNoteOff;
    this.getFreqForMidi = getFreqForMidi;
    this.isPlayingRef = isPlayingRef;
    this._timer = null;
    this._pos = 0;
    this._activeNote = null;
  }

  start() {
    if (this._timer) return;
    this._pos = 0;
    this.loop();
  }
  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._activeNote != null) {
      this.onStepNoteOff && this.onStepNoteOff(this._activeNote);
      this._activeNote = null;
    }
  }

  loop() {
    if (!this.isPlayingRef()) { this.stop(); return; }
    const bpm = this.getBPM();
    const stepDur = 60 / bpm / 4; // 16th
    const step = this.steps[this._pos];
    if (step.enabled) {
      this._activeNote = step.midi;
      this.onStepNoteOn && this.onStepNoteOn(step.midi, step.velocity);
      // schedule note off after gate %
      const gateMs = stepDur * step.gate * 1000;
      setTimeout(()=>{
        if (this._activeNote === step.midi) {
          this.onStepNoteOff && this.onStepNoteOff(step.midi);
          this._activeNote = null;
        }
      }, gateMs);
    }
    this._pos = (this._pos + 1) % this.steps.length;
    this._timer = setTimeout(()=> this.loop(), stepDur*1000);
  }
}
