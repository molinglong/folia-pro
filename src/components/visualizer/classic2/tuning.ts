import { defineVisualizerTuning } from '../tuningRegistry';

// 流光-2 暂时共用流光的 classicTuning：settingsKey/setterKey 都指向 classic 的那一份，
// 这样两个模式跟着同一组滑杆走。将来若要独立参数，改成新的 classic2Tuning 键并补 store 字段。
export default defineVisualizerTuning({ mode: 'classic2', settingsKey: 'classicTuning', settingsSetterKey: 'handleSetClassicTuning', apply: (props, tuning) => ({ ...props, classicTuning: tuning }) });
