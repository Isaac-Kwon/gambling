import type { Lang, Translator } from '@shared/i18n';
import type { Summary } from '../../../shared/handoff';
import type { Session } from '../../../shared/schema';
import type { ChartKit } from '../charts/kit';
import type { DataSource } from '../source';
import type { SimClient } from '../sim';

/**
 * Section contract. Each file in sections/ default-exports one Section (see ids in ./index.ts).
 *  - needs 'full':    needs the full log (ctx.session is set). With a summary-only source main.ts shows a
 *                     summary card + "view the demo session" instead and never calls render().
 *  - needs 'summary': needs at least the summary (always true when any data exists; ctx.session may be undefined).
 *  - needs 'any':     same as 'summary'; use ctx.session when present, otherwise degrade inside render().
 * render() is called once, lazily (when the section nears the viewport; intro immediately). It may be async.
 * Whatever it returns from dispose() cleanup (charts, workers, listeners) runs when the source changes.
 * Section titles live in i18n `app.toc.<id>`; the heading (<h2>) is created by main.ts, render() fills the body.
 */
export type SectionNeeds = 'full' | 'summary' | 'any';

export interface SectionCtx {
  source: DataSource;
  /** Full log; undefined for a summary-only source. */
  session?: Session;
  summary: Summary;
  t: Translator;
  lang: Lang;
  charts: ChartKit;
  /** Simulation worker client (one per page). Cancelled runs reject with SimCancelled: catch it. */
  sim: SimClient;
}

export interface Section {
  id: string;
  /** i18n key of the section title (TOC + heading). */
  titleKey: string;
  needs: SectionNeeds;
  render(el: HTMLElement, ctx: SectionCtx): void | Promise<void>;
  dispose?(): void;
}

export const SECTION_IDS = [
  'intro', 'debrief', 'stimulus', 'replayPlain', 'strategyCheck', 'sim', 'quiz', 'caseStudy', 'help',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];
