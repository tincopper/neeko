/**
 * 头像色与首字母的**唯一**派生点。
 *
 * # 为什么必须按 `memberId` 派生，而不是按列表下标
 *
 * 花名册的位置由后端给（按 id 排序，见 `TeamRoster`），成员会**增删**。按下标取色时，
 * 加一个成员就会让后面所有人的颜色整体错位 —— 而颜色是**记忆线索**：
 * 用户记住的是「绿色那个在改 worktree」，颜色一漂，他就得重新认一遍（比没有颜色更糟，
 * 因为错位后的颜色看起来仍然「有意义」）。
 *
 * 所以取色只依赖 `memberId` 本身：同一个 id 恒同色，重排、增删都不影响。
 *
 * # 调色板为什么是这五个
 *
 * 只用手上真有的语义 token：`accent-blue / green / orange / brick / yellow`
 * （主题层没有 purple，硬造一个就在亮色主题下失效）。`red` 不进调色板 ——
 * 它是「失败/错误」的专属色，拿来当身份色会让一条红色头像与 `failed` 徽标混淆。
 */
export type MemberTintTone = 'blue' | 'green' | 'orange' | 'brick' | 'yellow';

/** 调色板（顺序固定：它是哈希取模的模数，改顺序 = 换掉所有人的颜色）。 */
export const MEMBER_TINT_TONES: readonly MemberTintTone[] = [
  'blue',
  'green',
  'orange',
  'brick',
  'yellow',
];

/**
 * FNV-1a（32 位）。
 *
 * 选它的理由只有两条：纯函数、且相邻 id（`w1@tm_1` / `w2@tm_1`）会散到不同的桶里。
 * 用「字符和」那种取模时，`w1`→`w2` 只会让颜色 +1，看起来仍像「按顺序分配」。
 */
function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // `Math.imul` 保住 32 位乘法的低位（`*` 会先丢精度再取模）。
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** tone → token class 的唯一映射（MemberAvatar / AgentIcon 共用，不许各抄一份）。 */
export const MEMBER_TINT_CLASS: Record<MemberTintTone, string> = {
  blue: 'bg-accent-blue/20 text-accent-blue',
  green: 'bg-accent-green/20 text-accent-green',
  orange: 'bg-accent-orange/20 text-accent-orange',
  brick: 'bg-accent-brick/20 text-accent-brick',
  yellow: 'bg-accent-yellow/20 text-accent-yellow',
};

/** 头像色：**只**由 `memberId` 决定（同一 id 恒同色，重排后不变）。 */
export function memberTint(memberId: string): MemberTintTone {
  if (memberId.length === 0) return MEMBER_TINT_TONES[0];
  return MEMBER_TINT_TONES[hash32(memberId) % MEMBER_TINT_TONES.length];
}

/**
 * 头像上的首字母。
 *
 * 用 `Array.from` 取第一个**码点**：`name[0]` 在 emoji / 代理对名字上会切出半个字符，
 * 渲染成方块。CJK 名字取第一个字（`toUpperCase` 对它是恒等）。
 */
export function memberInitial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  return Array.from(trimmed)[0].toUpperCase();
}
