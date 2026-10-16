// dev/design-lab/types.ts：模板目录、试验和预览场景的最小契约。
export type SceneOption = { id: string; label: string };
export type TemplateMeta = {
    id: string;
    title: string;
    description: string;
    version: string;
    sharedVersion: string;
    createdAt: string;
    order: number;
    sourcePaths: string[];
    scenes: SceneOption[];
};
export type VariantMeta = { id: string; title: string; description: string };
export type ExperimentMeta = {
    id: string;
    templateId: string;
    templateVersion: string;
    title: string;
    createdAt: string;
    variants: VariantMeta[];
};
export type TemplateRecord = TemplateMeta & { directory: string };
export type ExperimentRecord = ExperimentMeta & { directory: string };
export type Catalog = { templates: TemplateRecord[]; experiments: ExperimentRecord[]; issues: string[] };
export type PreviewVariant = VariantMeta & { directory: string; entryPath: string };
export type LabState = {
    page: string;
    experiment: string;
    mode: 'single' | 'split' | 'grid';
    left: string;
    right: string;
    device: 'desktop' | 'tablet' | 'phone';
    theme: 'light' | 'dark';
    scene: string;
};
export type SceneConfig = {
    theme: 'light' | 'dark';
    scene: string;
    epoch: number;
    playing: boolean;
    reducedMotion: boolean;
};
export const VIEWPORTS = {
    desktop: { width: 1440, height: 900, label: '桌面' },
    tablet: { width: 768, height: 1024, label: '平板' },
    phone: { width: 390, height: 844, label: '手机' },
} as const;
export const DURATION = 240;
