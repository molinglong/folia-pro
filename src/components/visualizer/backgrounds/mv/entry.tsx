import React from 'react';
import MvBackground from './MvBackground';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/mv/entry.tsx
// Registers the "current song MV" shell background.

export default defineVisualizerBackground({
    mode: 'mv',
    order: 45,
    labelKey: 'options.visualizerBackgroundModeMv',
    labelFallback: 'MV',
    render: props => <MvBackground {...props} />,
});
