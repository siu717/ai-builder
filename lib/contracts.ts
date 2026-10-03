import type { ChecklistItem } from "./checklist";

export const EVENT_KINDS = ["scholarship", "job", "career", "interview", "assignment"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type Channel = "app" | "telegram";

export const KIND_LABELS: Record<EventKind, string> = {
  scholarship: "장학금",
  job: "채용 지원",
  career: "취업 준비",
  interview: "면접",
  assignment: "과제",
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

export interface PublicSettings {
  telegramConfigured: boolean;
  telegramEnabled: boolean;
  telegramChatId: string;
  botUsername: string | null;
  workerLastSeen: string | null;
  aiConfigured: boolean;
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
  isSample: true;
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
