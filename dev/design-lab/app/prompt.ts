import type { LabState, PreviewVariant, TemplateRecord } from '../types';
import { VIEWPORTS } from '../types';

// dev/design-lab/app/prompt.ts：将当前比较条件和可修改边界一起交给 AI。
export function buildPrompt(state: LabState, template: TemplateRecord, variant?: PreviewVariant): string {
    const viewport = VIEWPORTS[state.device];
    const target = variant && variant.id !== 'baseline' && state.experiment
        ? `继续修改试验 ${state.experiment} 的「${variant.title}」。\n仅可修改 dev/design-lab${variant.directory}/ 内的视图和样式，并更新本轮 experiment.json 中该方案的说明。`
        : `请基于「${template.title}」模板生成三个有明确差异的方案。\n先在 repo 目录执行：npm run design:new -- --template ${template.id} --version ${template.version} --id <新的试验标识>\n再修改新试验目录下 a/、b/、c/，并在 experiment.json 中写出各案差异。`;
    return [
        target,
        `基准模板：dev/design-lab${template.directory}/（公共资源锁定 ${template.sharedVersion}）`,
        `参考源码：${template.sourcePaths.join('、')}`,
        `对比条件：${viewport.width}×${viewport.height}，${state.theme === 'light' ? '浅色' : '深色'}，场景 ${state.scene}。`,
        '保留现有试验；不覆盖基准稿，不修改其他方案或公共版本文件。需要改公共外观时在当前方案内覆盖样式。',
        '使用已有示例歌曲与数据；不导入正式应用 store、服务或有副作用的组件，不请求外部接口，不写 localStorage／IndexedDB。',
        '方案使用同一 runtime/scene 接口；保持场景重置、主题和模拟时间兼容，弹层支持 Esc。',
        '验证预览和交互后返回本轮对比链接。没有明确落地指令，不改 src/ 或正式构建。',
        '具体设计要求：',
    ].join('\n\n');
}
