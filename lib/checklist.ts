export const MAX_CHECKLIST_ITEMS = 50;
export const MAX_CHECKLIST_TEXT_LENGTH = 200;

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

/** 공고의 제출 서류를 사용자가 검토할 준비 목록으로 옮긴다. */
export function checklistFromDocuments(documents: string[]): ChecklistItem[] {
  const unique = [...new Set(documents.map((text) => text.trim()).filter(Boolean))];
  return unique.map((text) => ({
    id: crypto.randomUUID(),
    text,
    completed: false,
  }));
}

export function checklistProgress(items: readonly ChecklistItem[] = []) {
  const completed = items.filter((item) => item.completed).length;
  return { completed, total: items.length };
}
