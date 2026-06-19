type AmbienceId = "lobby" | "clock" | "security" | "interrogation" | "archive" | "break" | "server";
type SoundAssetKey =
  | "click"
  | "hover"
  | "pickup"
  | "success"
  | "fail"
  | "open"
  | "glitch"
  | "machine"
  | "metal"
  | "paper"
  | "drop"
  | "glass"
  | "stinger"
  | "toggle";

interface StartedNode {
  stop: () => void;
}

export class AudioDirector {
  private context?: AudioContext;
  private master?: GainNode;
  private ambienceNodes: StartedNode[] = [];
  private currentAmbience?: AmbienceId;
  private ambienceToken = 0;
  private phoneTimers: number[] = [];
  private phonePlaying = false;
  private volume = 0.72;
  private muted = false;
  private lastHoverAt = 0;
  private assetPlayer?: (key: SoundAssetKey, volume: number) => void;

  setAssetPlayer(player: (key: SoundAssetKey, volume: number) => void): void {
    this.assetPlayer = player;
  }

  async resume(): Promise<void> {
    const AudioCtor =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      return;
    }

    if (!this.context) {
      this.context = new AudioCtor();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.applyVolume();
    }

    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyVolume();
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(value: boolean): void {
    this.muted = value;
    this.applyVolume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  private applyVolume(): void {
    if (!this.master) {
      return;
    }

    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context?.currentTime ?? 0, 0.025);
  }

  startAmbience(id: AmbienceId): void {
    if (this.currentAmbience === id && this.ambienceNodes.length > 0) {
      return;
    }
    const token = ++this.ambienceToken;
    this.currentAmbience = id;
    void this.resume().then(() => {
      if (token !== this.ambienceToken) {
        return;
      }
      this.stopAmbienceNodes();
      if (!this.context || !this.master) {
        return;
      }

      const ctx = this.context;
      const now = ctx.currentTime;
      const roomSettings: Record<AmbienceId, { low: number; high: number; pulse: number; noise: number }> = {
        lobby: { low: 58, high: 184, pulse: 0.08, noise: 0.028 },
        clock: { low: 44, high: 314, pulse: 0.18, noise: 0.018 },
        security: { low: 49, high: 288, pulse: 0.14, noise: 0.045 },
        interrogation: { low: 52, high: 267, pulse: 0.1, noise: 0.05 },
        archive: { low: 71, high: 121, pulse: 0.05, noise: 0.04 },
        break: { low: 97, high: 246, pulse: 0.12, noise: 0.032 },
        server: { low: 39, high: 420, pulse: 0.22, noise: 0.024 }
      };
      const settings = roomSettings[id];

      const low = this.createOscillator(settings.low, "sine", 0.05);
      const high = this.createOscillator(settings.high, "triangle", 0.018);
      const tremolo = this.createOscillator(settings.pulse, "sine", 0.02);
      const noise = this.createNoise(settings.noise);

      low.osc.start(now);
      high.osc.start(now);
      tremolo.osc.start(now);
      noise.source.start(now);

      this.ambienceNodes.push(
        { stop: () => low.osc.stop() },
        { stop: () => high.osc.stop() },
        { stop: () => tremolo.osc.stop() },
        { stop: () => noise.source.stop() }
      );
    });
  }

  stopAmbience(): void {
    this.ambienceToken += 1;
    this.currentAmbience = undefined;
    this.stopAmbienceNodes();
  }

  private stopAmbienceNodes(): void {
    for (const node of this.ambienceNodes) {
      try {
        node.stop();
      } catch {
        // Already stopped.
      }
    }
    this.ambienceNodes = [];
  }

  click(): void {
    this.playAsset("click", 0.55);
    this.tone(420, 0.035, 0.045, "square");
  }

  hover(): void {
    const now = performance.now();
    if (now - this.lastHoverAt < 85) {
      return;
    }
    this.lastHoverAt = now;
    this.playAsset("hover", 0.38);
    this.tone(820, 0.018, 0.018, "sine");
  }

  pickup(): void {
    this.playAsset("pickup", 0.72);
    this.tone(420, 0.06, 0.05, "triangle");
    window.setTimeout(() => this.tone(630, 0.08, 0.045, "triangle"), 65);
  }

  success(): void {
    this.playAsset("success", 0.78);
    [360, 540, 720].forEach((freq, i) => {
      window.setTimeout(() => this.tone(freq, 0.09, 0.05, "sine"), i * 72);
    });
  }

  fail(): void {
    this.playAsset("fail", 0.62);
    this.tone(156, 0.18, 0.07, "sawtooth");
    window.setTimeout(() => this.tone(118, 0.12, 0.045, "sawtooth"), 90);
  }

  open(): void {
    this.playAsset("open", 0.72);
    this.tone(260, 0.08, 0.04, "triangle");
  }

  glitch(): void {
    this.playAsset("glitch", 0.62);
    this.tone(96, 0.12, 0.04, "sawtooth");
  }

  machine(): void {
    this.playAsset("machine", 0.7);
    this.tone(180, 0.18, 0.04, "square");
  }

  metal(): void {
    this.playAsset("metal", 0.58);
    this.tone(140, 0.1, 0.035, "triangle");
  }

  paper(): void {
    this.playAsset("paper", 0.48);
    this.tone(520, 0.03, 0.018, "triangle");
  }

  drop(): void {
    this.playAsset("drop", 0.58);
    this.tone(190, 0.08, 0.035, "triangle");
  }

  glass(): void {
    this.playAsset("glass", 0.5);
    this.tone(760, 0.05, 0.024, "sine");
  }

  stinger(): void {
    this.playAsset("stinger", 0.7);
    [260, 390, 585].forEach((freq, i) => window.setTimeout(() => this.tone(freq, 0.16, 0.045, "triangle"), i * 80));
  }

  toggle(): void {
    this.playAsset("toggle", 0.48);
    this.tone(310, 0.045, 0.028, "square");
  }

  ending(kind: "filed" | "escaped"): void {
    const sequence = kind === "filed" ? [220, 185, 146, 110] : [196, 247, 330, 392, 494];
    sequence.forEach((freq, i) => {
      window.setTimeout(() => this.tone(freq, 0.42, 0.055, "triangle"), i * 260);
    });
  }

  playPhoneClue(): boolean {
    if (this.phonePlaying) {
      return false;
    }
    this.phonePlaying = true;
    void this.resume().then(() => {
      const groups = [7, 3, 1];
      let delay = 0;
      for (const group of groups) {
        for (let i = 0; i < group; i += 1) {
          this.phoneTimers.push(window.setTimeout(() => this.tone(910, 0.035, 0.07, "square"), delay));
          delay += 92;
        }
        delay += 520;
      }
      this.phoneTimers.push(
        window.setTimeout(() => {
          this.phonePlaying = false;
          this.phoneTimers = [];
        }, delay + 80)
      );
    });
    return true;
  }

  stopPhoneClue(): void {
    for (const timer of this.phoneTimers) {
      window.clearTimeout(timer);
    }
    this.phoneTimers = [];
    this.phonePlaying = false;
  }

  private createOscillator(
    frequency: number,
    type: OscillatorType,
    gainValue: number
  ): { osc: OscillatorNode; gain: GainNode } {
    if (!this.context || !this.master) {
      throw new Error("Audio context is not initialized.");
    }

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = gainValue;
    osc.connect(gain);
    gain.connect(this.master);
    return { osc, gain };
  }

  private createNoise(gainValue: number): { source: AudioBufferSourceNode; gain: GainNode } {
    if (!this.context || !this.master) {
      throw new Error("Audio context is not initialized.");
    }

    const ctx = this.context;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * 0.35;
    }

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = gainValue;
    source.connect(gain);
    gain.connect(this.master);
    return { source, gain };
  }

  private tone(frequency: number, duration: number, gainValue: number, type: OscillatorType): void {
    void this.resume().then(() => {
      if (!this.context || !this.master) {
        return;
      }
      const osc = this.context.createOscillator();
      const gain = this.context.createGain();
      const now = this.context.currentTime;
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(gainValue, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    });
  }

  private playAsset(key: SoundAssetKey, volume: number): void {
    if (this.muted) {
      return;
    }
    this.assetPlayer?.(key, volume * this.volume);
  }
}
