export interface ContentSection {
  type: string;
  purpose: string;
  heading?: string;
  text?: string;
  points?: string[];
  callToAction?: string;
}

export interface ContentPlan {
  pageTitle: string;
  pageGoal: string;
  sections: ContentSection[];
  toneOfVoice: string;
  keyMessages: string[];
  notes?: string;
}
