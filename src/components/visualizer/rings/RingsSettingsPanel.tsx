// Copyright (c) 2026 chthollyphile
import React from 'react';
import { DEFAULT_RINGS_TUNING, type RingsTuning } from '../../../types';
import type { VisualizerSettingsPanelProps } from '../definition';
import { TemperaRangeControl as RangeControl, TemperaSettingsSection as SettingsSection } from '../tempera/TemperaSettingsControls';

// src/components/visualizer/rings/RingsSettingsPanel.tsx
// 年轮的参数面板：一张卡四个滑杆，控制年轮的生长节奏与浓淡。滑块遵循草稿 / 松手提交语义。

const formatPlain = (value: number) => value.toFixed(2);

const RingsSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    controlCardBg,
    rangeInputClass,
    ringsTuning = DEFAULT_RINGS_TUNING,
    onRingsTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => (
    <div className="rounded-[24px] border border-white/10 p-4 space-y-4" style={{ backgroundColor: controlCardBg }}>
        <div className="space-y-1">
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {t('options.ringsSettings')}
            </div>
            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                {t('options.ringsSettingsDesc')}
            </div>
        </div>

        <SettingsSection title={t('options.ringsGrowthSection')}>
            <RangeControl
                label={t('options.ringsReach')}
                value={ringsTuning.reach}
                min={0.4}
                max={2}
                step={0.05}
                formatValue={formatPlain}
                rangeInputClass={rangeInputClass}
                onChange={reach => onRingsTuningChange?.({ reach })}
                onPointerDown={onSliderPointerDown}
                onPointerUp={onSliderCommit}
            />
            <RangeControl
                label={t('options.ringsBeatSensitivity')}
                value={ringsTuning.beatSensitivity}
                min={0.4}
                max={2.5}
                step={0.05}
                formatValue={formatPlain}
                rangeInputClass={rangeInputClass}
                onChange={beatSensitivity => onRingsTuningChange?.({ beatSensitivity })}
                onPointerDown={onSliderPointerDown}
                onPointerUp={onSliderCommit}
            />
            <RangeControl
                label={t('options.ringsSensitivity')}
                value={ringsTuning.sensitivity}
                min={0.2}
                max={3}
                step={0.05}
                formatValue={formatPlain}
                rangeInputClass={rangeInputClass}
                onChange={sensitivity => onRingsTuningChange?.({ sensitivity })}
                onPointerDown={onSliderPointerDown}
                onPointerUp={onSliderCommit}
            />
            <RangeControl
                label={t('options.ringsOpacity')}
                value={ringsTuning.opacity}
                min={0.1}
                max={1}
                step={0.05}
                formatValue={formatPlain}
                rangeInputClass={rangeInputClass}
                onChange={opacity => onRingsTuningChange?.({ opacity })}
                onPointerDown={onSliderPointerDown}
                onPointerUp={onSliderCommit}
            />
            <p className="text-xs leading-relaxed opacity-55" style={{ color: 'var(--text-secondary)' }}>
                {t('options.ringsGrowthHint')}
            </p>
        </SettingsSection>
    </div>
);

export default RingsSettingsPanel;
