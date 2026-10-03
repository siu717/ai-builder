"use client";

import { ListChecks, Plus, Trash2 } from "lucide-react";
import {
  checklistProgress,
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT_LENGTH,
  type ChecklistItem,
} from "@/lib/checklist";
import styles from "./checklist-editor.module.css";

export function ChecklistProgress({ items = [] }: { items?: ChecklistItem[] }) {
  const { completed, total } = checklistProgress(items);
  if (!total) return null;
  return (
    <span className={styles.badge} aria-label={`준비물 ${total}개 중 ${completed}개 완료`}>
      <ListChecks size={13} aria-hidden="true" /> 준비 {completed}/{total}
    </span>
  );
}

export default function ChecklistEditor({
  items,
  onChange,
  disabled = false,
}: {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
  disabled?: boolean;
}) {
  const { completed, total } = checklistProgress(items);

  function update(id: string, patch: Partial<Pick<ChecklistItem, "text" | "completed">>) {
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  return (
    <section className={styles.section} aria-label="준비물 체크리스트">
      <div className={styles.heading}>
        <h3>준비물 체크리스트</h3>
        <span className={styles.count} aria-live="polite">{completed}/{total}개 준비 완료</span>
      </div>
      {total > 0 && (
        <progress className={styles.progress} value={completed} max={total} aria-label="준비 진행률" />
      )}
      <ul className={styles.list}>
        {items.map((item, index) => (
          <li className={styles.row} key={item.id} data-completed={item.completed}>
            <input
              type="checkbox"
              aria-label={`${item.text || `준비물 ${index + 1}`} 준비 완료`}
              checked={item.completed}
              disabled={disabled}
              onChange={(event) => update(item.id, { completed: event.target.checked })}
            />
            <input
              type="text"
              aria-label={`준비물 ${index + 1}`}
              value={item.text}
              required
              maxLength={MAX_CHECKLIST_TEXT_LENGTH}
              placeholder="예: 재학증명서 발급"
              disabled={disabled}
              onChange={(event) => update(item.id, { text: event.target.value })}
            />
            <button
              type="button"
              className="icon-button danger-text"
              aria-label={`준비물 ${index + 1} 삭제`}
              disabled={disabled}
              onClick={() => onChange(items.filter((current) => current.id !== item.id))}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div>
        <button
          type="button"
          className="text-button"
          disabled={disabled || total >= MAX_CHECKLIST_ITEMS}
          onClick={() => onChange([...items, { id: crypto.randomUUID(), text: "", completed: false }])}
        >
          <Plus size={15} aria-hidden="true" /> 준비물 추가
        </button>
      </div>
      <p className={styles.hint}>
        {total >= MAX_CHECKLIST_ITEMS ? `준비물은 최대 ${MAX_CHECKLIST_ITEMS}개까지 추가할 수 있습니다. ` : ""}
        일정 저장을 누르면 반영됩니다. 지원·제출을 마친 뒤 일정도 완료 처리해 주세요.
      </p>
    </section>
  );
}
