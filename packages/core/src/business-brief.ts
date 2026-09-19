/** User-entered input, never an AI BusinessProfile or a workflow output. */
export const briefFields = {
  companyName: { label: "Название бизнеса / бренда", max: 200, required: true },
  description: { label: "Чем занимается бизнес", max: 2000, required: true },
  productsOrServices: { label: "Основные товары / услуги", max: 1500, required: true },
  targetAudience: { label: "Целевая аудитория", max: 1000, required: true },
  geography: { label: "География работы", max: 500, required: false },
  websiteGoals: { label: "Основная цель сайта", max: 1000, required: true },
  advantages: { label: "Ключевые преимущества", max: 1500, required: false },
  desiredActions: { label: "Желаемое действие посетителя / CTA", max: 500, required: true },
  contacts: { label: "Контактные данные для сайта", max: 1000, required: false },
  notes: { label: "Дополнительные пожелания", max: 2000, required: false },
} as const;
export type BriefField = keyof typeof briefFields;
export const BRIEF_ADVANTAGES_MAX_ITEMS = 8;
export const BRIEF_ADVANTAGE_MAX_LENGTH = 300;
export const BRIEF_ADVANTAGES_MAX_TOTAL_LENGTH = briefFields.advantages.max;
export interface BriefAdvantage { readonly text: string }
/**
 * New immutable Brief versions use BriefAdvantage[]. A string is retained only
 * while reading historical JSON documents; it remains one legacy claim until
 * the owner explicitly saves a new structured version.
 */
export type BriefAdvantages = readonly BriefAdvantage[] | string | null;
export type BusinessBrief = Omit<Record<BriefField, string | null>, 'advantages'> & { advantages: BriefAdvantages };
export interface BriefSnapshot { id: string; organizationId: string; projectId: string; version: number; createdAt: string; brief: BusinessBrief }
export interface BriefView { snapshot: BriefSnapshot | null }
