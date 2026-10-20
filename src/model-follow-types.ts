/** 模型引用（provider + id）：判定与调用层共用，避免循环 import。 */
export type ModelRef = { provider: string; id: string };
