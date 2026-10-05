/**
 * Section helpers for dynamic resume section management.
 *
 * These utilities handle section metadata operations including
 * getting default sections, sorting, and managing custom sections.
 */

import type { ResumeData, SectionMeta, SectionType } from '@/components/dashboard/resume-component';
import { getMessages } from '@/lib/i18n/messages';
import { locales } from '@/i18n/config';

export type TranslationFunction = (key: string, params?: Record<string, string | number>) => string;

/**
 * Default section metadata for backward compatibility.
 * Used when a resume doesn't have sectionMeta defined.
 */
export const DEFAULT_SECTION_META: SectionMeta[] = [
  {
    id: 'personalInfo',
    key: 'personalInfo',
    displayName: 'Personal Info',
    sectionType: 'personalInfo',
    isDefault: true,
    isVisible: true,
    order: 0,
  },
  {
    id: 'summary',
    key: 'summary',
    displayName: 'Summary',
    sectionType: 'text',
    isDefault: true,
    isVisible: true,
    order: 1,
  },
  {
    id: 'workExperience',
    key: 'workExperience',
    displayName: 'Experience',
    sectionType: 'itemList',
    isDefault: true,
    isVisible: true,
    order: 2,
  },
  {
    id: 'education',
    key: 'education',
    displayName: 'Education',
    sectionType: 'itemList',
    isDefault: true,
    isVisible: true,
    order: 3,
  },
  {
    id: 'personalProjects',
    key: 'personalProjects',
    displayName: 'Projects',
    sectionType: 'itemList',
    isDefault: true,
    isVisible: true,
    order: 4,
  },
  {
    id: 'additional',
    key: 'additional',
    displayName: 'Skills & Awards',
    sectionType: 'stringList',
    isDefault: true,
    isVisible: true,
    order: 5,
  },
];

const DEFAULT_SECTION_DISPLAY_NAME_BY_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(DEFAULT_SECTION_META.map((section) => [section.id, section.displayName]))
);

const DEFAULT_SECTION_I18N_KEY_BY_ID: Readonly<Record<string, string>> = Object.freeze({
  personalInfo: 'resume.sections.personalInfo',
  summary: 'resume.sections.summary',
  workExperience: 'resume.sections.experience',
  education: 'resume.sections.education',
  personalProjects: 'resume.sections.projects',
  additional: 'resume.sections.skills',
});

const ALL_DEFAULT_NAMES_BY_SECTION_ID: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze(
  Object.fromEntries(
    Object.entries(DEFAULT_SECTION_I18N_KEY_BY_ID).map(([sectionId, i18nKey]) => {
      const names = new Set<string>();
      const enDefault = DEFAULT_SECTION_DISPLAY_NAME_BY_ID[sectionId];
      if (enDefault) names.add(enDefault);

      for (const loc of locales) {
        try {
          const msgs = getMessages(loc);
          const parts = i18nKey.split('.');
          let val: unknown = msgs;
          for (const p of parts) {
            if (val && typeof val === 'object' && p in val) {
              val = (val as Record<string, unknown>)[p];
            } else {
              val = undefined;
              break;
            }
          }
          if (typeof val === 'string' && val.trim()) {
            names.add(val.trim());
          }
        } catch {
          // ignore if locale message unavailable
        }
      }
      return [sectionId, names];
    })
  )
);

/**
 * Localize default section display names without overwriting user customizations.
 *
 * Rules:
 * - Only affects built-in sections (isDefault === true)
 * - Only overwrites when displayName matches a recognized default title in any supported language
 */
export function localizeDefaultSectionMeta(
  sections: SectionMeta[],
  t: TranslationFunction
): SectionMeta[] {
  return sections.map((section) => {
    if (!section.isDefault) return section;

    const i18nKey = DEFAULT_SECTION_I18N_KEY_BY_ID[section.id];
    if (!i18nKey) return section;

    const defaultNames = ALL_DEFAULT_NAMES_BY_SECTION_ID[section.id];
    const isRecognizedDefault =
      section.displayName === DEFAULT_SECTION_DISPLAY_NAME_BY_ID[section.id] ||
      (defaultNames ? defaultNames.has(section.displayName) : false);

    if (!isRecognizedDefault) return section;

    return { ...section, displayName: t(i18nKey) };
  });
}

/**
 * Return a ResumeData object with localized default sectionMeta.
 *
 * - If resumeData.sectionMeta is missing, it generates it from DEFAULT_SECTION_META.
 * - If sectionMeta exists, it only localizes untouched default English section names.
 */
export function withLocalizedDefaultSections(
  resumeData: ResumeData,
  t: TranslationFunction
): ResumeData {
  const baseMeta = resumeData.sectionMeta?.length ? resumeData.sectionMeta : DEFAULT_SECTION_META;
  const localizedMeta = localizeDefaultSectionMeta(baseMeta, t);
  return { ...resumeData, sectionMeta: localizedMeta };
}

/**
 * Get section metadata from resume data, falling back to defaults.
 */
export function getSectionMeta(resumeData: ResumeData): SectionMeta[] {
  return resumeData.sectionMeta?.length ? resumeData.sectionMeta : DEFAULT_SECTION_META;
}

/**
 * Get sorted sections (visible only) for rendering.
 */
export function getSortedSections(resumeData: ResumeData): SectionMeta[] {
  return [...getSectionMeta(resumeData)]
    .filter((s) => s.isVisible)
    .sort((a, b) => a.order - b.order);
}

/**
 * Get all sections (including hidden) for management UI.
 */
export function getAllSections(resumeData: ResumeData): SectionMeta[] {
  return [...getSectionMeta(resumeData)].sort((a, b) => a.order - b.order);
}

/**
 * Generate a unique ID for a new custom section.
 */
export function generateCustomSectionId(existingSections: SectionMeta[]): string {
  const customSections = existingSections.filter((s) => s.id.startsWith('custom_'));
  const maxId = customSections.reduce((max, s) => {
    const num = parseInt(s.id.replace('custom_', ''), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return `custom_${maxId + 1}`;
}

/**
 * Create a new custom section with metadata.
 */
export function createCustomSection(
  existingSections: SectionMeta[],
  displayName: string,
  sectionType: SectionType
): SectionMeta {
  const id = generateCustomSectionId(existingSections);
  const maxOrder = Math.max(...existingSections.map((s) => s.order), 0);

  return {
    id,
    key: id,
    displayName,
    sectionType,
    isDefault: false,
    isVisible: true,
    order: maxOrder + 1,
  };
}

/**
 * Duplicate a custom section, placing the copy directly below the source.
 *
 * Only custom sections can be duplicated whole. A built-in or unknown section
 * returns `resumeData` itself, so callers can tell nothing happened by
 * reference. The copy is deep-cloned, and later sections shift down by one so
 * `order` stays unique. The input is never mutated.
 */
export function duplicateCustomSection(
  resumeData: ResumeData,
  sectionId: string,
  copySuffix: string
): ResumeData {
  const sections = getSectionMeta(resumeData);
  const source = sections.find((s) => s.id === sectionId);
  if (!source || source.isDefault) return resumeData;

  const id = generateCustomSectionId(sections);
  const copy: SectionMeta = {
    ...source,
    id,
    key: id,
    displayName: `${source.displayName} ${copySuffix}`,
    isDefault: false,
    order: source.order + 1,
  };

  const shifted = sections.map((s) => (s.order > source.order ? { ...s, order: s.order + 1 } : s));
  const sourceIndex = shifted.findIndex((s) => s.id === source.id);
  const sectionMeta = [
    ...shifted.slice(0, sourceIndex + 1),
    copy,
    ...shifted.slice(sourceIndex + 1),
  ];

  const sourceData = resumeData.customSections?.[source.key];
  const customSections = sourceData
    ? { ...resumeData.customSections, [id]: structuredClone(sourceData) }
    : resumeData.customSections;

  return { ...resumeData, sectionMeta, customSections };
}
