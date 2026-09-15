/** Strict domain JSON Schema. Optional properties stay optional; provider wire adaptation lives in agents/design-schema.ts. */
export const DESIGN_LIMITS = Object.freeze({ maxBytes: 24000, maxString: 2000, maxArray: 12, maxDepth: 4, maxNodes: 150 });
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });
const list = (maxItems: number, maxLength: number, minItems = 1) => ({ type: 'array', minItems, maxItems, items: text(maxLength) });
export const designColorSchema = { type: 'string', pattern: '^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$' };
export const designColorsSchema = {
  type: 'object', additionalProperties: false, required: ['primary','background','text'],
  properties: { primary: designColorSchema, secondary: designColorSchema, background: designColorSchema, text: designColorSchema, accent: designColorSchema },
};
export const designDirectionSchema = {
  type: 'object', additionalProperties: false,
  required: ['styleName','description','mood','colors','typography','layoutPrinciples'],
  properties: {
    styleName: text(100), description: text(2000), mood: list(8,80), colors: designColorsSchema,
    typography: { type:'object', additionalProperties:false, required:['headingStyle','bodyStyle'], properties:{headingStyle:text(300),bodyStyle:text(300)} },
    layoutPrinciples:list(12,300), visualReferences:list(8,300,0), notes:text(1000),
  },
};
