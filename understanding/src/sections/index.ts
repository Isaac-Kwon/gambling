import type { Section, SectionId } from './types';
export { SECTION_IDS } from './types';

/** Lazy loaders in page order. Each module default-exports a Section. */
export const loaders: Record<SectionId, () => Promise<{ default: Section }>> = {
  intro: () => import('./intro'),
  debrief: () => import('./debrief'),
  stimulus: () => import('./stimulus'),
  replayPlain: () => import('./replayPlain'),
  strategyCheck: () => import('./strategyCheck'),
  sim: () => import('./sim'),
  quiz: () => import('./quiz'),
  caseStudy: () => import('./caseStudy'),
  help: () => import('./help'),
};
