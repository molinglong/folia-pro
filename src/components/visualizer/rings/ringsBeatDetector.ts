// Copyright (c) 2026 chthollyphile

// src/components/visualizer/rings/ringsBeatDetector.ts
// Onset ("beat") detection on the low end, so rings are born on the rhythm.
// The onset signal is spectral flux: how much the low FFT bins rose since the
// previous reading (only rises count). A beat is a flux value clearly above its
// own recent level — an exponential mean and deviation over about a second —
// and at least MIN_GAP_SEC after the previous beat. Hosts without a spectrum
// fall back to the rise of the bass band. Long silences get a filler beat so
// quiet passages still leave faint rings instead of a gap.
//
// The audio input is one per-frame sample, normalized by the React shell:
// power/bass/lowMid in 0..1, spectrum the raw 0..255 analyser bins
// (~21.5 Hz per bin, matching the host's analyser FFT size).

export interface RingsAudioSample {
    power: number;
    bass: number;
    lowMid: number;
    spectrum: Uint8Array | null;
}

const LOW_BIN_START = 1;       // ~21.5 Hz per bin at the host's FFT size
const LOW_BIN_END = 12;        // up to ~260 Hz: kick and bass
const TRACK_SEC = 1.2;         // how fast the adaptive threshold follows the music
const MIN_GAP_SEC = 0.28;      // fastest ring cadence (~214 BPM)
const MAX_GAP_SEC = 2;         // longest stretch without a ring
const FLOOR = 0.012;           // flux below this is never a beat (noise, silence)

export const ENERGY_FLOOR = 0.06; // silence still leaves faint growth lines

export const createBeatDetector = () => {
    let previousBins: Float32Array | null = null;
    let previousLow = 0;
    let mean = 0;
    let variance = 0;
    let lastBeat = -Infinity;

    const lowFlux = (sample: RingsAudioSample): number => {
        const spectrum = sample.spectrum;
        if (spectrum && spectrum.length > LOW_BIN_END) {
            const count = LOW_BIN_END - LOW_BIN_START + 1;
            if (!previousBins) previousBins = new Float32Array(count);
            let flux = 0;
            for (let i = 0; i < count; i += 1) {
                const value = spectrum[LOW_BIN_START + i] / 255;
                flux += Math.max(0, value - previousBins[i]);
                previousBins[i] = value;
            }
            return flux / count;
        }
        const low = 0.7 * sample.bass + 0.3 * sample.lowMid;
        const flux = Math.max(0, low - previousLow);
        previousLow = low;
        return flux;
    };

    return {
        reset() {
            previousBins = null;
            previousLow = 0;
            mean = 0;
            variance = 0;
            lastBeat = -Infinity;
        },

        /**
         * Feeds one reading at song time `time` (dt s after the previous one).
         * `sensitivity` > 1 lowers the threshold. Returns true on a beat.
         */
        step(sample: RingsAudioSample | null, time: number, dt: number, sensitivity: number): boolean {
            const flux = sample ? lowFlux(sample) : 0;
            const alpha = 1 - Math.exp(-Math.max(dt, 0) / TRACK_SEC);
            const deviation = Math.sqrt(Math.max(variance, 0));
            const threshold = Math.max(FLOOR, mean + (1.8 / Math.max(sensitivity, 0.1)) * deviation);
            const sinceLast = time - lastBeat;
            const onset = flux > threshold && sinceLast >= MIN_GAP_SEC;
            mean += alpha * (flux - mean);
            variance += alpha * ((flux - mean) ** 2 - variance);
            if (onset || sinceLast >= MAX_GAP_SEC) {
                lastBeat = time;
                return true;
            }
            return false;
        },
    };
};

/*
 * Audio -> a 0..1 "growth" value per frame. Loudness is divided by a slowly
 * decaying peak so quiet and loud masters both use the full range, then an
 * envelope with a fast attack and slow release gives beats a clear ring.
 */
export const createEnergyFollower = () => {
    let peak = 0.2;
    let envelope = 0;
    return {
        reset() {
            envelope = 0;
        },
        step(sample: RingsAudioSample | null, sensitivity: number, dt: number): number {
            if (!sample) return ENERGY_FLOOR;
            const raw = 0.6 * sample.power + 0.4 * sample.bass;
            peak = Math.max(raw, peak * Math.exp(-dt / 8), 0.08);
            const target = Math.min(1, (raw / peak) * sensitivity);
            const rate = target > envelope ? 1 - Math.exp(-dt / 0.03) : 1 - Math.exp(-dt / 0.35);
            envelope += (target - envelope) * rate;
            return ENERGY_FLOOR + (1 - ENERGY_FLOOR) * envelope;
        },
    };
};
