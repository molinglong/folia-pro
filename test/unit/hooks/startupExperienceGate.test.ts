import { describe, expect, it } from 'vitest';
import { resolveStartupExperienceStep } from '../../../src/hooks/useStartupExperienceGate';

// test/unit/hooks/startupExperienceGate.test.ts
// @fork 本地魔改版（2026-10-12）：首启序列里的「版本更新」弹窗与「认识思索模式」强制引导两步已摘掉，
// 只剩中间那两页提问（资料库界面 / 播放后进入的视图）。本文件因此从「三步顺序」改为「一步顺序 + 两步不存在」。
// 判据是可致死的：只要有人把 'release-notes' 或 'ponder' 重新接回 resolveStartupExperienceStep，
// 第一条与第二条用例就会红（它们断言的是"第一步就是提问页"和"答完提问后什么都不剩"）。
// 上游原用例（三步排序、每版仍弹发版说明、思索只弹一次）见 git 历史 f358c44d 之前的该文件。

const readyState = {
    isCurrentRelease: true,
    hasSeenPonder: false,
    hasFinishedThisRelease: false,
    hasSeenReleaseNotes: false,
    isReleaseNotesOpen: false,
    hasChosenPlaybackEntryView: false,
    needsLibrarySuitePrompt: false,
    isPlaybackEntryViewPromptOpen: false,
    isPonderOnboardingOpen: false,
};

describe('startup experience gate', () => {
    it('opens only the choice prompt first, and nothing after it is answered', () => {
        // 全新安装、什么都没答过：第一步是提问页，不是发版说明。
        expect(resolveStartupExperienceStep(readyState)).toBe('playback-entry-view');

        // 答过播放视图（且界面那一页不欠）：序列到此结束，思索引导不再补一刀。
        expect(resolveStartupExperienceStep({
            ...readyState,
            hasChosenPlaybackEntryView: true,
        })).toBeNull();
    });

    it('never resolves the removed release-notes or ponder steps', () => {
        // 原版会在这里返回 'release-notes'（没见过本版说明）与 'ponder'（没见过思索引导）。
        expect(resolveStartupExperienceStep(readyState)).not.toBe('release-notes');
        expect(resolveStartupExperienceStep({
            ...readyState,
            hasChosenPlaybackEntryView: true,
        })).not.toBe('ponder');
        // 老安装升级上来：这一版说明没见过、思索也从没做过，同样一步都不弹。
        expect(resolveStartupExperienceStep({
            ...readyState,
            hasChosenPlaybackEntryView: true,
            hasSeenPonder: false,
            hasSeenReleaseNotes: false,
        })).toBeNull();
    });

    it('waits for each blocking surface to close before advancing', () => {
        expect(resolveStartupExperienceStep({
            ...readyState,
            isPlaybackEntryViewPromptOpen: true,
        })).toBeNull();

        // 思索面板若被别处打开（恢复挂载后），重入保护仍然生效。
        expect(resolveStartupExperienceStep({
            ...readyState,
            isPonderOnboardingOpen: true,
        })).toBeNull();
        expect(resolveStartupExperienceStep({
            ...readyState,
            isReleaseNotesOpen: true,
        })).toBeNull();
    });

    it('does nothing once the sequence has finished for this release', () => {
        expect(resolveStartupExperienceStep({
            ...readyState,
            hasSeenPonder: true,
            hasFinishedThisRelease: true,
            hasChosenPlaybackEntryView: true,
        })).toBeNull();
    });

    it('stays quiet on builds without an auto-open release', () => {
        expect(resolveStartupExperienceStep({ ...readyState, isCurrentRelease: false })).toBeNull();
    });

    // 2026-10-10：「资料库界面」那一页每个安装都问一次，不看版本（发版说明的版本号每版都变，不能拿来门控它）。
    it('asks for the library interface once on every install, whatever the release', () => {
        const owed = { ...readyState, needsLibrarySuitePrompt: true };
        // @fork：原来发版说明排在这一页前面，现在这一页就是第一步。
        expect(resolveStartupExperienceStep(owed)).toBe('playback-entry-view');
        // 答过旧版单页提问、这一版的流程也走完了的老安装：仍然只问这一页。
        const answered = { ...owed, hasChosenPlaybackEntryView: true, hasSeenPonder: true, hasFinishedThisRelease: true };
        expect(resolveStartupExperienceStep(answered)).toBe('playback-entry-view');
        // 不是自动弹发版说明的那一版也问。
        expect(resolveStartupExperienceStep({ ...owed, isCurrentRelease: false, hasChosenPlaybackEntryView: true })).toBe('playback-entry-view');
        // 问过就不再问；开着时等它关。
        expect(resolveStartupExperienceStep({ ...answered, needsLibrarySuitePrompt: false })).toBeNull();
        expect(resolveStartupExperienceStep({ ...answered, isPlaybackEntryViewPromptOpen: true })).toBeNull();
    });
});
