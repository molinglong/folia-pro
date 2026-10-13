import React from 'react';
import SettingsHelpActions from '../../src/components/modal/SettingsHelpActions';
import PonderHost from '../../src/components/ponder/PonderHost';
import { openPonderNavigation } from '../../src/services/ponder/pagePonderTarget';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { ProbeDefinition } from './definition';

// dev/probes/settingsHelpActions.probe.tsx
// @fork 本地魔改版：「版本更新」入口已从 SettingsHelpActions 删除，本探针随之只挂思索入口。

const ProbeBody: React.FC = () => {
    return (
        <div
            data-ponder-page-scope="help-page"
            className="min-h-screen bg-zinc-950 p-10 text-white"
            style={{ '--text-primary': '#fafafa', '--text-secondary': '#a1a1aa' } as React.CSSProperties}
        >
            <SettingsHelpActions onOpenPonder={openPonderNavigation} />
            <PonderHost theme={DEFAULT_THEME} isDaylight={false} />
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'settingsHelpActions',
    title: 'Help · 页面思索入口',
    description: '验证帮助页的思索入口打开 Help 页面级 Ponder 导航。',
    Component: ProbeBody,
};

export default probe;
