import React from 'react';
import { defineVisualizer } from '../definition';

const VisualizerPaperWindow = React.lazy(() => import('./VisualizerPaperWindow'));

// src/components/visualizer/paperwindow/entry.tsx
// Registers 纸窗, the shadow-play paper-screen mode: glyphs are holes cut in a paper screen,
// a small lantern roams behind them and only the glyphs near it let the light through.
export default defineVisualizer({
    mode: 'paperwindow',
    order: 26,
    labelKey: 'ui.visualizerPaperWindow',
    labelFallback: '纸窗',
    previewSeed: 'paperwindow',
    previewStartOffset: 0,
    tuningKind: 'none',
    render: props => <VisualizerPaperWindow {...props} />,
});
