export interface DesignDirection {
  styleName: string;
  description: string;
  mood: string[];
  colors: {
    primary: string;
    secondary?: string;
    background: string;
    text: string;
    accent?: string;
  };
  typography: {
    headingStyle: string;
    bodyStyle: string;
  };
  layoutPrinciples: string[];
  visualReferences?: string[];
  notes?: string;
}
