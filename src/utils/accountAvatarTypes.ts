// src/utils/accountAvatarTypes.ts
// 头像处理的错误码：UI 需要按它映射文案，单独放一个纯类型模块，
// 让不依赖 canvas 的调用方（如账号表单的错误映射）也能引用。

export type AccountAvatarErrorCode = 'not_image' | 'too_large' | 'process_failed';
