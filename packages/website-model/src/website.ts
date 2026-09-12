export type WebsiteStatus = 'draft' | 'published' | 'archived';

export type WebsitePageStatus = 'draft' | 'published';

export type WebsiteBlockType =
  | 'hero'
  | 'text'
  | 'image'
  | 'services'
  | 'advantages'
  | 'gallery'
  | 'faq'
  | 'testimonials'
  | 'contacts'
  | 'cta'
  | 'custom';

export interface DesignSystem {
  colors: {
    primary: string;
    secondary?: string;
    background: string;
    text: string;
    accent?: string;
  };

  typography: {
    headingFont: string;
    bodyFont: string;
    baseFontSize: number;
  };

  spacing: {
    section: number;
    block: number;
  };

  borderRadius: number;
}

export interface WebsiteBlock {
  id: string;
  type: WebsiteBlockType;
  order: number;
  visible: boolean;
  content: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export interface WebsitePage {
  id: string;
  slug: string;
  title: string;
  status: WebsitePageStatus;
  order: number;
  blocks: WebsiteBlock[];
  seo?: {
    title?: string;
    description?: string;
    keywords?: string[];
  };
}

export interface Website {
  id: string;
  projectId: string;
  name: string;
  status: WebsiteStatus;
  designSystem: DesignSystem;
  pages: WebsitePage[];
  createdAt: string;
  updatedAt: string;
}
