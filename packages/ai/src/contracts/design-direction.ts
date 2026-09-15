/** Descriptive design direction, not CSS, HTML or a complete Website DesignSystem.
 * Runtime policy: bounded plain text, HEX colors (#RGB/#RRGGBB), no URLs or credentials.
 */
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
  /** Textual visual motifs only; URLs and downloadable references are not allowed. */
  visualReferences?: string[];
  notes?: string;
}
