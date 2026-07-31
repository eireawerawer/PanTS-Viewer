import Preview from "../../../../components/Preview";
import type { CaseId } from "../../../../helpers/search";
import type { SavedCase } from "../../../../helpers/savedCases";
import type { PreviewType } from "../../../../types";
import { CARD_COUNT, PER_PAGE } from "../../constants";
import styles from "./CaseGrid.module.css";

interface Props {
  showSaved: boolean;
  savedCases: SavedCase[];
  loading: boolean;
  resultCount: number | null;
  previewIds: CaseId[];
  previewMetadata: { [key: string]: PreviewType };
  savedIds: Set<CaseId>;
  compareIds: CaseId[];
  onToggleSave: (id: CaseId, meta?: PreviewType) => void;
  onToggleCompare: (id: CaseId) => void;
}

export default function CaseGrid({
  showSaved,
  savedCases,
  loading,
  resultCount,
  previewIds,
  previewMetadata,
  savedIds,
  compareIds,
  onToggleSave,
  onToggleCompare,
}: Props) {
  if (showSaved && savedCases.length === 0) {
    return (
      <div className={styles.emptyState}>
        No saved cases yet — click the bookmark on any case to save it here.
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
      {showSaved
        ? savedCases.map((c) => (
            <Preview
              key={c.id}
              id={c.id}
              previewMetadata={{ sex: c.sex, age: c.age, tumor: c.tumor }}
              saved
              onToggleSave={() =>
                onToggleSave(c.id, { sex: c.sex, age: c.age, tumor: c.tumor })
              }
              compareSelected={compareIds.includes(c.id)}
              onToggleCompare={() => onToggleCompare(c.id)}
            />
          ))
        : loading
          ? Array.from({ length: resultCount !== null ? PER_PAGE : CARD_COUNT }).map((_, i) => (
              <div key={i} className={`bm-card-skeleton rounded-xl ${styles.skeleton}`} />
            ))
          : previewIds.map((id) => (
              <Preview
                key={id}
                id={id}
                previewMetadata={previewMetadata[id]}
                saved={savedIds.has(id)}
                onToggleSave={() => onToggleSave(id)}
                compareSelected={compareIds.includes(id)}
                onToggleCompare={() => onToggleCompare(id)}
              />
            ))}
    </div>
  );
}
