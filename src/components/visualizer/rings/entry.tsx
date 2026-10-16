// Copyright (c) 2026 chthollyphile
import React from 'react';
import { DEFAULT_RINGS_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';
import RingsSettingsPanel from './RingsSettingsPanel';

const VisualizerRings = React.lazy(() => import('./VisualizerRings'));

// src/components/visualizer/rings/entry.tsx
// Registers 年轮, the tree-ring lyric mode ported from the 52Hz sample mod: the current line
// lights up character by character while a ring leaves its glyph outline on every beat, so the
// screen fills with a growth record of the song. Instrumentals grow from random piths.
export default defineVisualizer({
    mode: 'rings',
    order: 135,
    labelKey: 'ui.visualizerRings',
    labelFallback: '年轮',
    previewSeed: 'rings',
    previewStartOffset: 0,
    tuningKind: 'rings',
    render: props => <VisualizerRings {...props} />,
    renderSettingsPanel: props => <RingsSettingsPanel {...props} />,
    resetSettings: ({ resetRingsTuning, setDraftRingsTuning }) => {
        setDraftRingsTuning?.(DEFAULT_RINGS_TUNING);
        resetRingsTuning?.();
    },
});
