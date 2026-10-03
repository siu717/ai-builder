import type { ChecklistItem } from "./checklist";

export const EVENT_KINDS = ["scholarship", "job", "career", "interview", "assignment", "academic"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type Channel = "app" | "telegram";

export const KIND_LABELS: Record<EventKind, string> = {
  scholarship: "장학금",
  job: "채용 지원",
  career: "취업 준비",
  interview: "면접",
  assignment: "과제",
  academic: "학사 일정",
};

export interface Profile {
  name: string;
  year: string;
  major: string;
  gpa: string;
  gpaScale: string;
  interests: string;
  experience: string;
}

export const DEFAULT_PROFILE: Profile = {
  name: "학생",
  year: "",
  major: "",
  gpa: "",
  gpaScale: "4.5",
  interests: "",
  experience: "",
};

export const TASK_SAMPLE = "[샘플 공지]\n웹 프로그래밍 과제 안내\n다음 주 목요일 수업 전까지 반응형 시간표 페이지를 완성해 LMS 과제함에 ZIP 파일로 제출하세요. 수업 시작 전에 업로드를 마쳐 주세요.";
export const COACH_JOB_SAMPLE = "[샘플 채용 공고]\n캠퍼스랩 프론트엔드 인턴\n필수: 재학 중인 3~4학년, JavaScript 기초. 우대: React 프로젝트 경험, Git 협업 경험. 주요 업무: 학생용 웹 서비스의 화면 구현과 접근성 개선. 이 공고에는 지원 마감과 면접 일시가 명시되지 않았습니다.";
export const COACH_RESUME_SAMPLE = "[샘플 자기소개서]\n컴퓨터공학과 3학년입니다. JavaScript와 React를 사용해 팀 프로젝트로 과제 관리 웹앱을 만들었습니다. 저는 일정 목록과 입력 폼을 구현했고 Git으로 팀원들과 협업했습니다. 사용자가 쉽게 일정을 등록하도록 만들었습니다. 사용자 수나 개선 수치는 아직 측정하지 않았습니다.";

export interface ReminderInput {
  at: string;
  channel: Channel;
}

export interface EventInput {
  title: string;
  kind: EventKind;
  date: string;
  time: string | null;
  notes: string;
  source: string;
  isSample: boolean;
  reminders: ReminderInput[];
  checklist?: ChecklistItem[];
  idempotencyKey?: string;
}

export interface CalendarEvent extends EventInput {
  id: string;
  completed: boolean;
  createdAt: string;
}

export interface ReminderRecord {
  id: string;
  eventId: string;
  title: string;
  kind: EventKind;
  scheduledAt: string;
  channel: Channel;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
  attempts: number;
  error: string | null;
  sentAt: string | null;
  read: boolean;
}

export type KeySource = "saved" | "environment" | null;
export type DataProvider = "dataGoKr" | "saramin";
export const DATA_PROVIDERS: DataProvider[] = ["dataGoKr", "saramin"];

export interface PublicSettings {
  accessMode?: "anonymous" | "private";
  telegramConfigured: boolean;
  telegramEnabled: boolean;
  telegramChatId: string;
  botUsername: string | null;
  workerLastSeen: string | null;
  aiConfigured: boolean;
  aiKeySource: KeySource;
  dataKeys: Record<DataProvider, KeySource>;
}

export interface AppState {
  profile: Profile;
  events: CalendarEvent[];
  notifications: ReminderRecord[];
  settings: PublicSettings;
}

export interface EligibilityCondition {
  label: string;
  status: "met" | "unmet" | "unknown";
  reason: string;
}

export interface Opportunity {
  id: string;
  kind: "scholarship" | "job";
  title: string;
  organization: string;
  description: string;
  date: string;
  time: string | null;
  amount: string;
  tags: string[];
  source: string;
  originalText: string;
  documents: string[];
  conditions: EligibilityCondition[];
  recommendation: string;
  isSample: boolean;
}

export const QUALIFICATION_TYPES = {
  T: "국가기술자격",
  S: "국가전문자격",
  C: "과정평가형자격",
  W: "일학습병행자격",
} as const;
export type QualificationType = keyof typeof QUALIFICATION_TYPES;

export interface ExamStep {
  id: string;
  label: string;
  start: string | null;
  end: string | null;
}

export interface ExamSchedule {
  id: string;
  year: string;
  round: string;
  qualification: string;
  title: string;
  steps: ExamStep[];
}

export interface BackupFile {
  name: string;
  createdAt: string;
  sizeBytes: number;
  automatic: boolean;
}

// 설정 화면의 '저장된 데이터'. 비밀값은 앞뒤 4자만 보여준다.
export interface StorageOverview {
  accessMode: "anonymous" | "private";
  database: { path: string | null; sizeBytes: number | null; modifiedAt: string | null };
  keys: { anthropic: string | null; anthropicFormatValid: boolean | null; dataGoKr: string | null; saramin: string | null; telegramToken: string | null };
  telegram: { chatId: string; enabled: boolean; botUsername: string | null };
  profile: Profile;
  counts: { events: number; reminders: number; sentReminders: number; scholarshipNotices: number };
  backups: { directory: string | null; intervalHours: number; keep: number; latest: BackupFile[]; total: number };
}

export interface PublicDataResult<T> {
  items: T[];
  total: number;
  fetchedAt: string;
  // 여러 서비스를 합쳐 조회할 때 일부 서비스가 실패한 이유
  notices?: string[];
}

export interface AnalysisResult {
  mode: "live" | "sample";
  title: string;
  kind: EventKind;
  date: string | null;
  time: string | null;
  subject: string;
  submission: string;
  summary: string;
  missing: string[];
  documents: string[];
  conditions: EligibilityCondition[];
}

export interface CoachingResult {
  mode: "live" | "sample";
  summary: string;
  feedback: { quote: string; suggestion: string; reason: string }[];
  questions: string[];
  tasks: { title: string; notes: string }[];
}

export type KookminBoard = "academic" | "scholarship" | "general";

export const KOOKMIN_BOARD_LABELS: Record<KookminBoard, string> = {
  academic: "학사공지",
  scholarship: "장학공지",
  general: "일반공지",
};

export interface KookminScheduleItem {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  year: number;
  source: string;
}

export interface KookminNotice {
  id: string;
  board: KookminBoard;
  articleNo: string;
  title: string;
  date: string;
  url: string;
}

export interface KookminNoticeDetail extends KookminNotice {
  text: string;
}

export interface EcampusAssignment {
  uid: string;
  title: string;
  course: string | null;
  date: string;
  time: string | null;
  description: string | null;
  url: string | null;
}

export interface KookminImportItem {
  kind: EventKind;
  title: string;
  date: string;
  time: string | null;
  notes: string;
  source: string;
  idempotencyKey: string;
  reminders: ReminderInput[];
}

export interface KookminImportResult {
  created: number;
  skipped: number;
  failed: { idempotencyKey: string; error: string }[];
  state: AppState;
}

export interface BookmarkletPayload {
  v: 1;
  source: "ecampus-bookmarklet";
  exportedAt: string;
  items: EcampusAssignment[];
}

/** 키 없이 읽는 실시간 공고(lib/sources). 공공데이터포털 연동은 lib/public-data.ts 참고. */
export interface LiveOpportunity {
  id: string;
  kind: "scholarship" | "job";
  title: string;
  organization: string;
  description: string;
  date: string | null;
  time: string | null;
  postedAt: string | null;
  tags: string[];
  url: string;
  sourceId: string;
  sourceName: string;
  matchReason: string;
  matchScore: number;
  isSample: false;
}

export interface LiveSourceStatus {
  id: string;
  name: string;
  ok: boolean;
  count: number;
  error: string | null;
}

export interface LiveOpportunityResponse {
  items: LiveOpportunity[];
  sources: LiveSourceStatus[];
  fetchedAt: string;
}
