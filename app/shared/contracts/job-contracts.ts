export type JobStage =
  | "queued"
  | "parsing"
  | "normalizing"
  | "validating"
  | "exporting"
  | "completed"
  | "failed";

export interface JobRequest {
  documentPath: string;
  profileId?: string;
  pluginIds?: string[];
}

export interface JobStatus {
  jobId: string;
  stage: JobStage;
  progressPercent: number;
  detail?: string;
}
