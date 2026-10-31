// The archive documents' registry (filler visuals, 31 Oct 2026): every document kind, its plain name, the page
// that draws it, how the pen marks it and the sound it lands with. The integration step asks documentFor
// (./choose.ts) for a candidate per bare sentence and, when it wins, renders DocumentShot with the scene and the
// sentence's word timings.
import type React from "react";
import { DOC_KINDS, LABEL, documentFor, type DocKind } from "./choose.ts";
import { MARK_STYLE, PAGE_SIZE, layoutPage, type MarkStyle } from "./layout.ts";
import { PAGES, type PageProps } from "./pages.tsx";
import { DocumentShot } from "./DocumentShot.tsx";

export interface DocumentStyle {
  kind: DocKind;
  label: string;
  page: React.FC<PageProps>;
  mark: MarkStyle;
  size: { w: number; h: number };
  /** Sound on entry: "pop" (a whoosh as the page slides in). */
  sound: "pop";
}

export const DOCUMENTS: Record<DocKind, DocumentStyle> = Object.fromEntries(
  DOC_KINDS.map((k) => [
    k,
    { kind: k, label: LABEL[k], page: PAGES[k], mark: MARK_STYLE[k], size: PAGE_SIZE[k], sound: "pop" as const },
  ]),
) as Record<DocKind, DocumentStyle>;

export { DocumentShot, documentFor, layoutPage };
export type { DocCandidate, DocScene, DocKind, DocMomentLike, DocChapterFacts } from "./choose.ts";
export type { DocumentShotProps, DocWord } from "./DocumentShot.tsx";
