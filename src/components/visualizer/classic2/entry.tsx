import React from 'react';
import { defineVisualizer } from '../definition';
import { ClassicSettingsPanel } from '../settingsPanels';

const Visualizer = React.lazy(() => import('./Visualizer'));

// src/components/visualizer/classic2/entry.tsx
// 流光-2：从流光（classic）复制而来的独立模式。当前复用 classic 的参数与设置面板，
// 后续若要单独调参，再拆出独立的 tuningKind / settingsKey。
export default defineVisualizer({
    mode: 'classic2',
    order: 31,
    labelKey: 'ui.visualizerClassic2',
    labelFallback: 'Luminous-2',
    previewSeed: 'classic2',
    previewStartOffset: 0,
    tuningKind: 'classic',
    usesWordSegmentation: true,
    render: props => <Visualizer {...props} />,
    renderSettingsPanel: props => <ClassicSettingsPanel {...props} />,
    resetSettings: ({ resetClassicTuning }) => {
        resetClassicTuning?.();
    },
});
