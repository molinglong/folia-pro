// Copyright (c) 2026 chthollyphile
import { defineVisualizerTuning } from '../tuningRegistry';

// src/components/visualizer/rings/tuning.ts
// Injects 年轮's strongly typed tuning at the renderer boundary.
export default defineVisualizerTuning({
    mode: 'rings',
    settingsKey: 'ringsTuning',
    settingsSetterKey: 'handleSetRingsTuning',
    apply: (props, tuning) => ({ ...props, ringsTuning: tuning }),
});
