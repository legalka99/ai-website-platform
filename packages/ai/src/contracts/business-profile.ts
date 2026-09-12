export interface BusinessProfile {
  companyName: string;
  industry: string;
  description: string;
  productsOrServices: string[];
  targetAudience: string[];
  geography?: string[];
  advantages?: string[];
  websiteGoals: string[];
  desiredActions: string[];
  competitors?: string[];
  notes?: string;
}
