import { SoundSettings } from '../types/chess';

type SoundKey = 'move' | 'capture' | 'correct' | 'incorrect' | 'complete';

const SOUND_URLS: Record<SoundKey, string> = {
  move: '/sounds/standard/Move.mp3',
  capture: '/sounds/standard/Capture.mp3',
  correct: '/sounds/standard/Confirmation.mp3',
  incorrect: '/sounds/standard/Error.mp3',
  complete: '/sounds/standard/GenericNotify.mp3',
};

const SOUND_VOLUMES: Record<SoundKey, number> = {
  move: 0.85,
  capture: 0.9,
  correct: 0.55,
  incorrect: 0.65,
  complete: 0.7,
};

class ChessSoundEngine {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SoundKey, AudioBuffer>();
  private loadingPromises = new Map<SoundKey, Promise<AudioBuffer | null>>();
  private preloaded = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const warmUp = () => {
        this.getContext();
        window.removeEventListener('pointerdown', warmUp);
      };
      window.addEventListener('pointerdown', warmUp, { once: true, passive: true });
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.ctx && !this.preloaded) {
      this.preloaded = true;
      (Object.keys(SOUND_URLS) as SoundKey[]).forEach((k) => {
        void this.loadBuffer(k);
      });
    }
    return this.ctx;
  }

  private async loadBuffer(key: SoundKey): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(key);
    if (cached) return cached;

    const existingPromise = this.loadingPromises.get(key);
    if (existingPromise) return existingPromise;

    const ctx = this.ctx;
    if (!ctx) return null;

    const promise = (async () => {
      try {
        const res = await fetch(SOUND_URLS[key]);
        if (!res.ok) return null;
        const arrayBuf = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuf);
        this.buffers.set(key, decoded);
        return decoded;
      } catch {
        return null;
      }
    })();

    this.loadingPromises.set(key, promise);
    return promise;
  }

  /**
   * Subtle acoustic wooden knock fallback (short damped wood resonance + transient click)
   * used only if decoded MP3 buffers are not yet available.
   */
  private playAcousticWoodFallback(isHeavy = false) {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const duration = isHeavy ? 0.055 : 0.038;
    const sampleCount = Math.floor(ctx.sampleRate * duration);
    const noiseBuffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);

    for (let i = 0; i < sampleCount; i++) {
      const env = Math.exp(-i / (ctx.sampleRate * (isHeavy ? 0.011 : 0.007)));
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isHeavy ? 520 : 680, now);
    filter.Q.setValueAtTime(1.8, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(isHeavy ? 0.35 : 0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + duration);
  }

  private playBuffer(key: SoundKey) {
    const ctx = this.getContext();
    const volume = SOUND_VOLUMES[key];

    if (ctx) {
      const buffer = this.buffers.get(key);
      if (buffer) {
        try {
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(volume, ctx.currentTime);
          source.connect(gain);
          gain.connect(ctx.destination);
          source.start(ctx.currentTime);
          return;
        } catch {
          // Fall through to HTMLAudio fallback
        }
      }
      void this.loadBuffer(key);
    }

    if (typeof Audio !== 'undefined') {
      try {
        const audio = new Audio(SOUND_URLS[key]);
        audio.volume = volume;
        audio.play().catch(() => {
          if (key === 'move' || key === 'capture') {
            this.playAcousticWoodFallback(key === 'capture');
          }
        });
        return;
      } catch {
        // Fall through to wood fallback
      }
    }

    if (key === 'move' || key === 'capture') {
      this.playAcousticWoodFallback(key === 'capture');
    }
  }

  playMove(settings: SoundSettings, isCapture = false) {
    if (!settings.enabled || !settings.moveSound) return;
    this.playBuffer(isCapture ? 'capture' : 'move');
  }

  playCorrect(settings: SoundSettings) {
    if (!settings.enabled || !settings.correctSound) return;
    this.playBuffer('correct');
  }

  playIncorrect(settings: SoundSettings) {
    if (!settings.enabled || !settings.incorrectSound) return;
    this.playBuffer('incorrect');
  }

  playComplete(settings: SoundSettings) {
    if (!settings.enabled || !settings.correctSound) return;
    this.playBuffer('complete');
  }
}

export const soundEngine = new ChessSoundEngine();
