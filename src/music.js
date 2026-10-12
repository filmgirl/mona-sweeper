// Original, quiet Web Audio chiptune loop for Mona Sweeper. No external audio files.
const BPM = 116;
const STEP = 60 / BPM / 2; // eighth notes
const LOOKAHEAD = 0.12;
// Sixteen eighth notes per bar, four bars. null leaves breathing room for sweep SFX.
const LEAD = [
  64, null, 67, 71, 72, null, 71, 67, 69, null, 72, 76, 74, null, null, null,
  64, null, 67, 71, 76, null, 74, 71, 72, null, 69, 67, 64, null, null, null,
  60, null, 64, 67, 69, null, 67, 64, 62, null, 67, 71, 74, null, 72, 71,
  69, 71, 72, null, 71, 67, 64, null, 60, null, null, null, 67, null, null, null,
];
const BASS = [48, 48, 45, 45, 41, 41, 43, 43];
const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

export class Chiptune {
  constructor(context, destination = context.destination) {
    this.context = context;
    this.output = context.createGain();
    this.output.gain.value = 0.12;
    this.output.connect(destination);
    this.enabled = true;
    this.playing = false;
    this.transpose = 0;
    this.timer = null;
    this.step = 0;
    this.next = 0;
    this.voices = new Set();
  }

  setEnabled(value) { this.enabled = Boolean(value); this.sync(); }
  setPlaying(value) { this.playing = Boolean(value); this.sync(); }
  setDifficulty(diff) {
    this.transpose = diff === 'monorepo' ? 3 : diff === 'active' ? 2 : 0;
  }

  sync() {
    const run = this.enabled && this.playing && this.context.state === 'running';
    if (run && this.timer === null) {
      this.next = this.context.currentTime + 0.05;
      this.timer = setInterval(() => this.tick(), 30);
      this.tick();
    } else if (!run && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      const now = this.context.currentTime;
      for (const voice of this.voices) {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(0, now);
        try { voice.osc.stop(now + 0.01); } catch { /* already stopped */ }
      }
      this.voices.clear();
    }
  }

  tick() {
    while (this.next < this.context.currentTime + LOOKAHEAD) {
      const i = this.step % LEAD.length;
      const lead = LEAD[i];
      if (lead !== null) this.note(freq(lead + this.transpose), this.next, STEP * 0.82, 'triangle', 0.08);
      if (i % 2 === 0) this.note(freq(BASS[Math.floor(i / 8) % BASS.length] + this.transpose), this.next, STEP * 1.5, 'sine', 0.18);
      this.next += STEP;
      this.step += 1;
    }
  }

  note(frequency, time, length, type, level) {
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(level, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(gain).connect(this.output);
    osc.start(time);
    osc.stop(time + length + 0.02);
    const voice = { osc, gain };
    this.voices.add(voice);
    osc.onended = () => { this.voices.delete(voice); osc.disconnect(); gain.disconnect(); };
  }
}
